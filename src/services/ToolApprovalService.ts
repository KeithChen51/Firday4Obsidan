import { normalizePath, TFile, Vault } from "obsidian";
import { AgentService } from "./AgentService";

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
const READ_ONLY_TOOLS = new Set(["ls", "read", "grep", "glob"]);

export class ToolApprovalService {
	private promptFn: ApprovalPromptFn | null = null;
	private sessionRules = new Map<string, true>();

	constructor(
		private readonly vault: Vault,
		private readonly agentService: AgentService,
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

		// 1. 全自动模式：所有工具自动通过
		if (mode === "auto") {
			return {
				allowed: true,
				persisted: false,
				viaRule: false,
				reason: "全自动模式",
			};
		}

		// 2. 标准模式：只读工具自动通过
		if (mode === "standard" && READ_ONLY_TOOLS.has(input.tool)) {
			return {
				allowed: true,
				persisted: false,
				viaRule: false,
				reason: "只读工具自动通过",
			};
		}

		// 3. 检查持久化规则
		const normalizedTarget = this.normalizeTargetPath(input.targetPath);
		const store = await this.readStore(input.agentId);
		const matchedRule = this.findMatchedRule(store.rules, input.tool, input.scope, normalizedTarget);
		if (matchedRule) {
			return {
				allowed: true,
				persisted: true,
				viaRule: true,
				reason: `命中持久化规则：${matchedRule.tool} ${matchedRule.pathPrefix || "(全部路径)"}`,
			};
		}

		// 4. 检查会话级规则
		const sessionKey = this.buildSessionKey(input.tool, normalizedTarget);
		if (this.sessionRules.has(sessionKey)) {
			return {
				allowed: true,
				persisted: false,
				viaRule: false,
				reason: "本次会话已授权",
			};
		}

		// 5. 通过 UI 回调显示审批卡片
		if (this.promptFn) {
			const decision = await this.promptFn(input);
			return this.handleDecision(decision, input, normalizedTarget, sessionKey);
		}

		// 6. 降级 fallback：无 UI 回调时使用 window.confirm
		return this.fallbackConfirm(input, normalizedTarget, sessionKey);
	}

	private async handleDecision(
		decision: ApprovalDecision,
		input: ToolApprovalRequest,
		normalizedTarget: string,
		sessionKey: string,
	): Promise<ToolApprovalResult> {
		if (decision === "deny") {
			return { allowed: false, persisted: false, viaRule: false, reason: "用户拒绝工具调用" };
		}
		if (decision === "allow_session") {
			this.sessionRules.set(sessionKey, true);
			return { allowed: true, persisted: false, viaRule: false, reason: "本次会话允许" };
		}
		if (decision === "allow_always") {
			const rule = await this.persistAllowAlwaysRule({
				agentId: input.agentId,
				tool: input.tool,
				scope: input.scope,
				targetPath: normalizedTarget,
			});
			return {
				allowed: true,
				persisted: true,
				viaRule: false,
				reason: `已保存规则：${rule.tool} ${rule.pathPrefix || "(全部路径)"}`,
			};
		}
		// allow_once
		return { allowed: true, persisted: false, viaRule: false, reason: "允许一次" };
	}

	private fallbackConfirm(
		input: ToolApprovalRequest,
		normalizedTarget: string,
		sessionKey: string,
	): ToolApprovalResult {
		const detail = [
			"F.R.I.D.A.Y 工具调用审批",
			`工具: ${input.tool}`,
			`目标: ${normalizedTarget || "(无路径参数)"}`,
			`说明: ${input.description}`,
		].join("\n");
		const allowed = window.confirm(`${detail}\n\n点击"确定"=允许；点击"取消"=拒绝`);
		if (!allowed) {
			return { allowed: false, persisted: false, viaRule: false, reason: "用户拒绝工具调用" };
		}
		return { allowed: true, persisted: false, viaRule: false, reason: "允许一次（降级弹窗）" };
	}

	private buildSessionKey(tool: string, targetPath: string): string {
		// Use tool + path directory as session key for prefix matching
		if (!targetPath) return `${tool}:*`;
		const parts = targetPath.split("/");
		parts.pop();
		return `${tool}:${parts.join("/")}`;
	}

	async listRules(agentId: string): Promise<ToolApprovalRule[]> {
		const store = await this.readStore(agentId);
		return store.rules;
	}

	private async persistAllowAlwaysRule(input: {
		agentId: string;
		tool: string;
		scope: ToolApprovalScope;
		targetPath: string;
	}): Promise<ToolApprovalRule> {
		const store = await this.readStore(input.agentId);
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
		await this.writeStore(input.agentId, { version: STORE_VERSION, rules: deduped });
		return rule;
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

	private async readStore(agentId: string): Promise<ToolApprovalStore> {
		const filePath = this.agentService.getAgentToolApprovalPath(agentId);
		const abstractFile = this.vault.getAbstractFileByPath(filePath);
		if (!(abstractFile instanceof TFile)) {
			return {
				version: STORE_VERSION,
				rules: [],
			};
		}

		try {
			const raw = await this.vault.cachedRead(abstractFile);
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

	private async writeStore(agentId: string, store: ToolApprovalStore): Promise<void> {
		const filePath = this.agentService.getAgentToolApprovalPath(agentId);
		const payload = `${JSON.stringify(store, null, 2)}\n`;
		const abstractFile = this.vault.getAbstractFileByPath(filePath);
		if (abstractFile instanceof TFile) {
			await this.vault.modify(abstractFile, payload);
			return;
		}
		await this.vault.create(filePath, payload);
	}

	private createRuleId(): string {
		return `rule-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
	}
}
