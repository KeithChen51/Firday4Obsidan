import type { DesktopPermissionMode, DesktopTurnContext } from "../../contracts/DesktopHostAdapter";
import type {
	DesktopPermissionAction,
	DesktopPermissionSnapshot,
	PermissionApprovalRequest,
	PermissionDecision,
	PermissionHostPort,
} from "../../contracts/PermissionHostPort";
import type { DesktopTraceEvent, TraceHostPort } from "../../contracts/TraceHostPort";

export type DesktopPermissionReviewResult = "allow" | "deny" | "cancel";

export interface DesktopPermissionHostOptions {
	traceHost: TraceHostPort;
	defaultMode?: DesktopPermissionMode;
	reviewHandler?: (
		request: PermissionApprovalRequest,
		context: DesktopTurnContext,
	) => Promise<DesktopPermissionReviewResult>;
}

type PermissionPolicyOutcome = "allow" | "review" | "deny";

const KNOWN_ACTIONS = new Set<DesktopPermissionAction>([
	"read_project_file",
	"write_project_file",
	"write_friday_artifact",
	"write_managed_file",
	"delete_project_file",
	"run_command",
	"network_access",
	"git_push",
	"install_dependency",
	"enable_skill",
]);

const STANDARD_REVIEW_ACTIONS = new Set<DesktopPermissionAction>([
	"write_project_file",
	"delete_project_file",
	"run_command",
	"network_access",
	"git_push",
	"install_dependency",
	"enable_skill",
]);

const SAFE_REVIEW_ACTIONS = new Set<DesktopPermissionAction>([
	"write_project_file",
	"delete_project_file",
	"run_command",
	"network_access",
	"git_push",
	"install_dependency",
	"enable_skill",
]);

export class DesktopPermissionHost implements PermissionHostPort {
	private readonly traceHost: TraceHostPort;
	private readonly defaultMode: DesktopPermissionMode;
	private readonly reviewHandler?: DesktopPermissionHostOptions["reviewHandler"];
	private readonly cancelledTurns = new Set<string>();

	constructor(options: DesktopPermissionHostOptions) {
		this.traceHost = options.traceHost;
		this.defaultMode = options.defaultMode ?? "standard";
		this.reviewHandler = options.reviewHandler;
	}

	async getPermissionMode(_projectId: string, _conversationId: string): Promise<DesktopPermissionMode> {
		return this.defaultMode;
	}

	async snapshotTurnPermissions(context: DesktopTurnContext): Promise<DesktopPermissionSnapshot> {
		const mode = context.permissionMode;
		return {
			turnId: context.turnId,
			mode,
			allowedScopes: resolveAllowedScopes(mode),
			requiresApprovalFor: resolveReviewActions(mode),
		};
	}

	async requestApproval(
		context: DesktopTurnContext,
		request: PermissionApprovalRequest,
	): Promise<PermissionDecision> {
		if (await this.isTurnCancelled(context)) {
			const event = await this.appendPermissionTrace(context, "permission_cancelled", request, "Turn already cancelled.");
			return {
				allowed: false,
				requiresReview: false,
				reason: "Turn already cancelled.",
				traceEventId: requireTraceId(event),
			};
		}

		const outcome = evaluatePermission(context.permissionMode, request.action);
		if (outcome === "deny") {
			const event = await this.appendPermissionTrace(context, "permission_denied", request, "Action is not recognized.");
			return {
				allowed: false,
				requiresReview: false,
				reason: "Action is not recognized.",
				traceEventId: requireTraceId(event),
			};
		}

		if (outcome === "allow") {
			const event = await this.appendPermissionTrace(context, "permission_allowed", request, "Allowed by current permission mode.");
			return {
				allowed: true,
				requiresReview: false,
				reason: "Allowed by current permission mode.",
				traceEventId: requireTraceId(event),
			};
		}

		const reviewEvent = await this.appendPermissionTrace(
			context,
			"permission_review_required",
			request,
			"Action requires review or confirmation.",
		);
		if (!this.reviewHandler) {
			return {
				allowed: false,
				requiresReview: true,
				reason: "Action requires review or confirmation.",
				traceEventId: requireTraceId(reviewEvent),
			};
		}

		let reviewResult: DesktopPermissionReviewResult;
		try {
			reviewResult = await this.reviewHandler(request, context);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "Review failed.");
			const event = await this.appendPermissionTrace(
				context,
				"permission_review_failed",
				request,
				`Review handler failed: ${message}`,
			);
			return {
				allowed: false,
				requiresReview: true,
				reason: `Review handler failed: ${message}`,
				traceEventId: requireTraceId(event),
			};
		}
		if (reviewResult === "allow") {
			const event = await this.appendPermissionTrace(context, "permission_confirmed", request, "User confirmed action.");
			return {
				allowed: true,
				requiresReview: true,
				reason: "User confirmed action.",
				traceEventId: requireTraceId(event),
			};
		}
		if (reviewResult === "cancel") {
			const event = await this.appendPermissionTrace(context, "permission_cancelled", request, "User cancelled action.");
			return {
				allowed: false,
				requiresReview: true,
				reason: "User cancelled action.",
				traceEventId: requireTraceId(event),
			};
		}
		const event = await this.appendPermissionTrace(context, "permission_denied", request, "User denied action.");
		return {
			allowed: false,
			requiresReview: true,
			reason: "User denied action.",
			traceEventId: requireTraceId(event),
		};
	}

	async cancelTurn(context: DesktopTurnContext, reason = "Turn cancelled."): Promise<void> {
		this.cancelledTurns.add(this.turnKey(context));
		await this.traceHost.appendTraceEvent(context, {
			type: "permission_cancelled",
			at: "",
			summary: reason,
			payload: {
				reason,
			},
		});
	}

	async isTurnCancelled(context: DesktopTurnContext): Promise<boolean> {
		return this.cancelledTurns.has(this.turnKey(context));
	}

	private async appendPermissionTrace(
		context: DesktopTurnContext,
		type: string,
		request: PermissionApprovalRequest,
		reason: string,
	): Promise<DesktopTraceEvent> {
		return this.traceHost.appendTraceEvent(context, {
			type,
			at: "",
			summary: request.summary,
			payload: {
				action: request.action,
				target: request.target,
				risk: request.risk,
				reason,
			},
		});
	}

	private turnKey(context: DesktopTurnContext): string {
		return `${context.projectId}:${context.conversationId}:${context.turnId}`;
	}
}

function evaluatePermission(mode: DesktopPermissionMode, action: DesktopPermissionAction): PermissionPolicyOutcome {
	if (!KNOWN_ACTIONS.has(action)) {
		return "deny";
	}
	if (mode === "autonomous") {
		return "allow";
	}
	if (mode === "safe") {
		return SAFE_REVIEW_ACTIONS.has(action) ? "review" : "allow";
	}
	return STANDARD_REVIEW_ACTIONS.has(action) ? "review" : "allow";
}

function resolveAllowedScopes(mode: DesktopPermissionMode): string[] {
	if (mode === "autonomous") {
		return ["project", "FRIDAY", "command", "network", "git", "dependency"];
	}
	if (mode === "safe") {
		return ["project-read", "FRIDAY-managed"];
	}
	return ["project-read", "FRIDAY-artifacts", "FRIDAY-managed"];
}

function resolveReviewActions(mode: DesktopPermissionMode): string[] {
	if (mode === "autonomous") {
		return [];
	}
	return mode === "safe" ? [...SAFE_REVIEW_ACTIONS] : [...STANDARD_REVIEW_ACTIONS];
}

function requireTraceId(event: DesktopTraceEvent): string {
	if (!event.id) {
		throw new Error("Trace event id missing.");
	}
	return event.id;
}
