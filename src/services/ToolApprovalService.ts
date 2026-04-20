import { readFile, writeFile } from "fs/promises";
import { normalizePath } from "obsidian";
import { RuntimeStateStore } from "./RuntimeStateStore";

export type ToolApprovalScope = "vault" | "external" | "any";

export interface ToolApprovalRule {
	id: string;
	tool: string;
	scope: ToolApprovalScope;
	pathPrefix: string;
	createdAt: string;
}

interface ToolApprovalStore {
	version: number;
	rules: ToolApprovalRule[];
}

export interface ToolApprovalRequest {
	agentId: string;
	tool: string;
	scope: ToolApprovalScope;
	targetPath?: string;
	description: string;
}

export interface ToolApprovalResult {
	allowed: boolean;
	persisted: boolean;
	viaRule: boolean;
	reason: string;
}

export type ApprovalDecision = "allow_once" | "allow_session" | "allow_always" | "deny";
export type ApprovalPromptFn = (request: ToolApprovalRequest) => Promise<ApprovalDecision>;

const STORE_VERSION = 1;
const READ_ONLY_TOOLS = new Set(["ls", "read", "grep", "search_text", "glob"]);

export class ToolApprovalService {
	private promptFn: ApprovalPromptFn | null = null;
	private readonly sessionRules = new Map<string, true>();

	constructor(
		private readonly runtimeStateStore: RuntimeStateStore,
		private readonly getSettings: () => { agentRuntime: { toolPermissionMode: string } },
	) {}

	setPromptHandler(fn: ApprovalPromptFn): void {
		this.promptFn = fn;
	}

	clearPromptHandler(): void {
		this.promptFn = null;
	}

	clearSessionRules(): void {
		this.sessionRules.clear();
	}

	async requestApproval(input: ToolApprovalRequest): Promise<ToolApprovalResult> {
		const mode = this.getSettings().agentRuntime.toolPermissionMode;

		if (mode === "auto") {
			return {
				allowed: true,
				persisted: false,
				viaRule: false,
				reason: "Auto permission mode.",
			};
		}

		if (mode === "standard" && READ_ONLY_TOOLS.has(input.tool)) {
			return {
				allowed: true,
				persisted: false,
				viaRule: false,
				reason: "Read-only tool allowed in standard mode.",
			};
		}

		const normalizedTarget = this.normalizeTargetPath(input.targetPath);
		const store = await this.readStore("global");
		const matchedRule = this.findMatchedRule(store.rules, input.tool, input.scope, normalizedTarget);
		if (matchedRule) {
			return {
				allowed: true,
				persisted: true,
				viaRule: true,
				reason: `Matched stored rule: ${matchedRule.tool} ${matchedRule.pathPrefix || "(all paths)"}`,
			};
		}

		const sessionKey = this.buildSessionKey(input.tool, normalizedTarget);
		if (this.sessionRules.has(sessionKey)) {
			return {
				allowed: true,
				persisted: false,
				viaRule: false,
				reason: "Matched current session rule.",
			};
		}

		if (this.promptFn) {
			const decision = await this.promptFn(input);
			return this.handleDecision(decision, input, normalizedTarget, sessionKey);
		}

		return this.fallbackDeny();
	}

	private async handleDecision(
		decision: ApprovalDecision,
		input: ToolApprovalRequest,
		normalizedTarget: string,
		sessionKey: string,
	): Promise<ToolApprovalResult> {
		if (decision === "deny") {
			return { allowed: false, persisted: false, viaRule: false, reason: "User denied tool call." };
		}
		if (decision === "allow_session") {
			this.sessionRules.set(sessionKey, true);
			return { allowed: true, persisted: false, viaRule: false, reason: "Allowed for current session." };
		}
		if (decision === "allow_always") {
			const rule = await this.persistAllowAlwaysRule({
				tool: input.tool,
				scope: input.scope,
				targetPath: normalizedTarget,
			});
			return {
				allowed: true,
				persisted: true,
				viaRule: false,
				reason: `Saved allow rule: ${rule.tool} ${rule.pathPrefix || "(all paths)"}`,
			};
		}
		return { allowed: true, persisted: false, viaRule: false, reason: "Allowed once." };
	}

	private fallbackDeny(): ToolApprovalResult {
		return {
			allowed: false,
			persisted: false,
			viaRule: false,
			reason: "Approval UI unavailable; request denied by non-modal fallback.",
		};
	}

	private buildSessionKey(tool: string, targetPath: string): string {
		if (!targetPath) {
			return `${tool}:*`;
		}
		const parts = targetPath.split("/");
		parts.pop();
		return `${tool}:${parts.join("/")}`;
	}

	async listRules(scopeKey = "global"): Promise<ToolApprovalRule[]> {
		const store = await this.readStore(scopeKey);
		return store.rules;
	}

	private async persistAllowAlwaysRule(input: {
		tool: string;
		scope: ToolApprovalScope;
		targetPath: string;
	}): Promise<ToolApprovalRule> {
		const store = await this.readStore("global");
		const rule: ToolApprovalRule = {
			id: this.createRuleId(),
			tool: input.tool,
			scope: input.scope,
			pathPrefix: this.resolvePathPrefix(input.targetPath, input.scope),
			createdAt: new Date().toISOString(),
		};

		const deduped = store.rules.filter((item) => {
			return !(item.tool === rule.tool && item.scope === rule.scope && item.pathPrefix === rule.pathPrefix);
		});
		deduped.push(rule);
		await this.writeStore("global", { version: STORE_VERSION, rules: deduped });
		return rule;
	}

	async mergeLegacyRules(rules: ToolApprovalRule[], scopeKey = "global"): Promise<void> {
		const store = await this.readStore(scopeKey);
		const merged = [...store.rules];
		for (const rule of rules) {
			const normalized: ToolApprovalRule = {
				id: String(rule.id ?? this.createRuleId()),
				tool: String(rule.tool ?? "*"),
				scope: this.normalizeScope(rule.scope),
				pathPrefix: this.normalizeTargetPath(rule.pathPrefix),
				createdAt: String(rule.createdAt ?? new Date().toISOString()),
			};
			const exists = merged.some(
				(item) =>
					item.tool === normalized.tool &&
					item.scope === normalized.scope &&
					item.pathPrefix === normalized.pathPrefix,
			);
			if (!exists) {
				merged.push(normalized);
			}
		}
		await this.writeStore(scopeKey, {
			version: STORE_VERSION,
			rules: merged,
		});
	}

	private findMatchedRule(
		rules: ToolApprovalRule[],
		tool: string,
		scope: ToolApprovalScope,
		targetPath: string,
	): ToolApprovalRule | null {
		for (const rule of rules) {
			const toolMatched = rule.tool === "*" || rule.tool === tool;
			const scopeMatched = rule.scope === "any" || rule.scope === scope;
			const prefix = this.normalizeTargetPath(rule.pathPrefix);
			const pathMatched =
				!prefix || !targetPath || targetPath === prefix || targetPath.startsWith(`${prefix}/`);
			if (toolMatched && scopeMatched && pathMatched) {
				return rule;
			}
		}
		return null;
	}

	private resolvePathPrefix(targetPath: string, scope: ToolApprovalScope): string {
		if (!targetPath) {
			return "";
		}
		if (scope === "vault") {
			const normalized = normalizePath(targetPath);
			const segments = normalized.split("/");
			if (segments.length <= 1) {
				return normalized;
			}
			segments.pop();
			return segments.join("/");
		}
		return targetPath;
	}

	private normalizeTargetPath(pathValue?: string): string {
		if (!pathValue) {
			return "";
		}
		return normalizePath(pathValue.trim());
	}

	private async readStore(scopeKey: string): Promise<ToolApprovalStore> {
		const filePath = this.runtimeStateStore.getApprovalStorePath(scopeKey);
		try {
			const raw = await readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as Partial<ToolApprovalStore>;
			if (!Array.isArray(parsed.rules)) {
				return { version: STORE_VERSION, rules: [] };
			}
			const rules = parsed.rules
				.filter((item): item is ToolApprovalRule => Boolean(item && typeof item === "object"))
				.map((item) => ({
					id: String(item.id ?? this.createRuleId()),
					tool: String(item.tool ?? "*"),
					scope: this.normalizeScope(item.scope),
					pathPrefix: this.normalizeTargetPath(item.pathPrefix),
					createdAt: String(item.createdAt ?? new Date().toISOString()),
				}));
			return {
				version: Number.isFinite(parsed.version) ? Number(parsed.version) : STORE_VERSION,
				rules,
			};
		} catch {
			return { version: STORE_VERSION, rules: [] };
		}
	}

	private normalizeScope(scope: unknown): ToolApprovalScope {
		if (scope === "vault" || scope === "external" || scope === "any") {
			return scope;
		}
		return "any";
	}

	private async writeStore(scopeKey: string, store: ToolApprovalStore): Promise<void> {
		await this.runtimeStateStore.ensureBaseLayout();
		const filePath = this.runtimeStateStore.getApprovalStorePath(scopeKey);
		const payload = `${JSON.stringify(store, null, 2)}\n`;
		await writeFile(filePath, payload, "utf8");
	}

	private createRuleId(): string {
		return `rule-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
	}
}
