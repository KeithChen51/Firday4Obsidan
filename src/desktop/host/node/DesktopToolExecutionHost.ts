import { ToolGateway, type ToolGatewayRunInput, type ToolGatewayRunResult } from "../../../core/tools/ToolGateway";
import path from "path";
import type { DesktopTurnContext } from "../../contracts/DesktopHostAdapter";
import type { DesktopPermissionAction, PermissionHostPort } from "../../contracts/PermissionHostPort";
import type {
	DesktopToolInvocation,
	DesktopToolResult,
	ToolExecutionHostPort,
} from "../../contracts/ToolExecutionHostPort";
import type { TraceHostPort } from "../../contracts/TraceHostPort";

export type DesktopToolExecutor = (
	invocation: DesktopToolInvocation,
	context: DesktopTurnContext,
) => Promise<unknown>;

export interface DesktopToolGatewayLike {
	run<T>(input: ToolGatewayRunInput<T>): Promise<ToolGatewayRunResult<T>>;
}

export interface DesktopToolExecutionHostOptions {
	traceHost: TraceHostPort;
	permissionHost: PermissionHostPort;
	gateway?: DesktopToolGatewayLike;
	executor?: DesktopToolExecutor;
}

const READ_TOOL_NAMES = new Set([
	"ls",
	"read",
	"read_many",
	"grep",
	"search_text",
	"search_and_read",
	"glob",
	"project_tree",
	"canvas_read",
	"markdown_outline",
	"validate_canvas",
	"validate_markdown",
	"validate_outputs",
]);

const WRITE_TOOL_NAMES = new Set([
	"write",
	"edit",
	"canvas_apply",
	"frontmatter_update",
	"markdown_insert_reference",
	"compile_wiki",
	"memory",
]);

export class DesktopToolExecutionHost implements ToolExecutionHostPort {
	private readonly traceHost: TraceHostPort;
	private readonly permissionHost: PermissionHostPort;
	private readonly gateway: DesktopToolGatewayLike;
	private readonly executor: DesktopToolExecutor;
	private readonly usesDefaultGateway: boolean;

	constructor(options: DesktopToolExecutionHostOptions) {
		this.traceHost = options.traceHost;
		this.permissionHost = options.permissionHost;
		this.usesDefaultGateway = !options.gateway;
		this.gateway = options.gateway ?? new ToolGateway();
		this.executor = options.executor ?? defaultExecutor;
	}

	async executeToolInvocation(
		context: DesktopTurnContext,
		invocation: DesktopToolInvocation,
	): Promise<DesktopToolResult> {
		if (await this.permissionHost.isTurnCancelled(context)) {
			const event = await this.appendToolTrace(context, "tool_execution_cancelled", invocation, "Tool execution cancelled.");
			return {
				invocationId: invocation.id,
				status: "cancelled",
				traceEventId: event.id,
			};
		}

		const action = inferPermissionAction(context, invocation);
		const permission = await this.permissionHost.requestApproval(context, {
			action,
			summary: invocation.reason ?? `Run tool ${invocation.toolName}`,
			target: resolveInvocationTarget(invocation),
			risk: action === "read_project_file" ? "low" : "high",
		});
		if (!permission.allowed) {
			return {
				invocationId: invocation.id,
				status: isCancellationError(permission.reason) ? "cancelled" : "error",
				error: permission.reason,
				traceEventId: permission.traceEventId,
			};
		}

		if (await this.permissionHost.isTurnCancelled(context)) {
			const event = await this.appendToolTrace(context, "tool_execution_cancelled", invocation, "Tool execution cancelled.");
			return {
				invocationId: invocation.id,
				status: "cancelled",
				traceEventId: event.id,
			};
		}

		await this.appendToolTrace(context, "tool_execution_start", invocation, "Tool execution started.");
		let gatewayResult: ToolGatewayRunResult<unknown>;
		try {
			gatewayResult = await this.runThroughGateway(context, invocation);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "Tool execution failed.");
			const event = await this.appendToolTrace(context, "tool_execution_failure", invocation, "Tool execution failed.", {
				error: message,
			});
			return {
				invocationId: invocation.id,
				status: "error",
				error: message,
				traceEventId: event.id,
			};
		}
		if (gatewayResult.status === "ok") {
			const event = await this.appendToolTrace(context, "tool_execution_success", invocation, "Tool execution succeeded.", {
				audit: gatewayResult.audit,
			});
			return {
				invocationId: invocation.id,
				status: "ok",
				output: gatewayResult.data,
				traceEventId: event.id,
			};
		}

		if (isCancellationError(gatewayResult.error)) {
			const event = await this.appendToolTrace(context, "tool_execution_cancelled", invocation, "Tool execution cancelled.", {
				audit: gatewayResult.audit,
				error: gatewayResult.error,
			});
			return {
				invocationId: invocation.id,
				status: "cancelled",
				error: gatewayResult.error,
				traceEventId: event.id,
			};
		}

		const event = await this.appendToolTrace(context, "tool_execution_failure", invocation, "Tool execution failed.", {
			audit: gatewayResult.audit,
			error: gatewayResult.error,
		});
		return {
			invocationId: invocation.id,
			status: "error",
			error: gatewayResult.error ?? "Tool execution failed.",
			traceEventId: event.id,
		};
	}

	private async runThroughGateway(
		context: DesktopTurnContext,
		invocation: DesktopToolInvocation,
	): Promise<ToolGatewayRunResult<unknown>> {
		if (context.permissionMode === "autonomous" && this.usesDefaultGateway) {
			return this.runAutonomousFullAccess(invocation, context);
		}
		return this.gateway.run({
			policyInput: {
				agentMode: context.permissionMode === "autonomous" ? "developer" : "debug",
				enableExecTool: context.permissionMode === "autonomous",
				toolName: invocation.toolName,
				args: invocation.input,
				scope: "vault",
				targetPath: resolveInvocationTarget(invocation),
				workspaceRoot: context.projectRoot,
			},
			approvalRequest: {
				agentId: context.conversationId,
				tool: invocation.toolName,
				scope: "vault",
				targetPath: resolveInvocationTarget(invocation),
				description: invocation.reason ?? `Run tool ${invocation.toolName}`,
			},
			requestApproval: async () => ({
				allowed: true,
				persisted: false,
				viaRule: false,
				reason: "Desktop permission host already allowed this invocation.",
			}),
			execute: () => this.executor(invocation, context),
		});
	}

	private async runAutonomousFullAccess(
		invocation: DesktopToolInvocation,
		context: DesktopTurnContext,
	): Promise<ToolGatewayRunResult<unknown>> {
		try {
			const data = await this.executor(invocation, context);
			return {
				status: "ok",
				decision: {
					allow: true,
					approval: "none",
					reason: "Desktop autonomous mode allows execution under the local user account.",
				},
				audit: buildAutonomousAudit(invocation, "ok", resolveInvocationTarget(invocation)),
				data,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "Tool execution failed.");
			return {
				status: "failed",
				decision: {
					allow: true,
					approval: "none",
					reason: "Desktop autonomous mode allows execution under the local user account.",
				},
				audit: buildAutonomousAudit(invocation, "failed", resolveInvocationTarget(invocation)),
				error: message,
			};
		}
	}

	private async appendToolTrace(
		context: DesktopTurnContext,
		type: string,
		invocation: DesktopToolInvocation,
		summary: string,
		extraPayload: Record<string, unknown> = {},
	) {
		return this.traceHost.appendTraceEvent(context, {
			type,
			at: "",
			summary,
			payload: {
				invocationId: invocation.id,
				toolName: invocation.toolName,
				input: invocation.input,
				reason: invocation.reason,
				...extraPayload,
			},
		});
	}
}

function inferPermissionAction(context: DesktopTurnContext, invocation: DesktopToolInvocation): DesktopPermissionAction {
	const toolName = invocation.toolName.trim().toLowerCase();
	if (READ_TOOL_NAMES.has(toolName)) {
		return "read_project_file";
	}
	if (WRITE_TOOL_NAMES.has(toolName)) {
		const pathValue = resolveInvocationTarget(invocation);
		return isFridayArtifactTarget(context.projectRoot, pathValue)
			? "write_friday_artifact"
			: "write_project_file";
	}
	if (toolName === "delete") {
		return "delete_project_file";
	}
	if (toolName === "use_skill") {
		return "enable_skill";
	}
	return "run_command";
}

function resolveInvocationTarget(invocation: DesktopToolInvocation): string {
	const pathValue = invocation.input.path;
	if (typeof pathValue === "string") {
		return pathValue;
	}
	const command = invocation.input.command;
	if (typeof command === "string") {
		return command;
	}
	return invocation.toolName;
}

function isFridayArtifactTarget(projectRoot: string, targetPath: string): boolean {
	const rawTarget = targetPath.trim();
	if (!rawTarget) {
		return false;
	}
	const root = path.resolve(projectRoot);
	const artifactRoot = path.join(root, "FRIDAY", "artifacts");
	const normalizedTarget = rawTarget.replace(/[\\/]+/g, path.sep);
	const resolvedTarget = path.isAbsolute(normalizedTarget)
		? path.resolve(normalizedTarget)
		: path.resolve(root, normalizedTarget);
	return isPathInside(artifactRoot, resolvedTarget);
}

function isPathInside(root: string, candidatePath: string): boolean {
	const relativePath = path.relative(path.resolve(root), path.resolve(candidatePath));
	return relativePath === "" || Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function buildAutonomousAudit(
	invocation: DesktopToolInvocation,
	status: "ok" | "failed",
	targetPath: string,
): ToolGatewayRunResult<unknown>["audit"] {
	return {
		tool: invocation.toolName.trim().toLowerCase(),
		capability: "desktop.full_access",
		scope: "any",
		targetPath,
		policy: {
			allow: true,
			reason: "Desktop autonomous mode allows execution under the local user account.",
			approval: "none",
		},
		execution: {
			attempted: true,
			status,
		},
	};
}

async function defaultExecutor(): Promise<unknown> {
	throw new Error("No desktop tool executor registered.");
}

function isCancellationError(error: unknown): boolean {
	const message = String(error ?? "").toLowerCase();
	return message.includes("cancel") || message.includes("abort");
}
