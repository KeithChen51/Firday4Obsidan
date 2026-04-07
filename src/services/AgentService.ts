import { normalizePath, TFile, TFolder, Vault } from "obsidian";
import { AgentProfile } from "../types/agent";
import { FridaySettings } from "../types/settings";

const AGENTS_FOLDER = "Agents";
const GLOBAL_FOLDER = "_global";
const PRESETS_FOLDER = "_presets";
const KNOWLEDGE_FOLDER = "knowledge";
const MEMORY_FOLDER = "memory";
const SESSIONS_FOLDER = "sessions";
const SNAPSHOTS_FOLDER = "snapshots";
const TOOL_APPROVAL_FILE = "tool-approval-rules.json";
const DEFAULT_AGENT_ID = "default";

const DEFAULT_AGENT_TEMPLATE = `# 默认 Agent

你是 F.R.I.D.A.Y 的默认协作助手。

## 行为规范
- 优先给出可执行建议。
- 输出简洁、清晰、可落地。
- 写入和删除文件前先生成变更摘要，等待用户确认。
`;

const DEFAULT_USER_PROFILE_TEMPLATE = `# 用户画像

> 由全局知识提炼 Agent 生成。仅记录跨项目稳定偏好。
`;

const DEFAULT_USER_PREFERENCES_TEMPLATE = `# 用户偏好

> 由全局知识提炼 Agent 生成。记录可复用偏好与禁忌。
`;

const DEFAULT_WORKSTYLE_TEMPLATE = `# 工作风格

> 由全局知识提炼 Agent 生成。记录协作节奏、表达偏好、决策习惯。
`;

const DEFAULT_PLAYBOOK_TEMPLATE = `# 通用方法论

> 可跨项目复用的流程、模板与检查清单。
`;

const DEFAULT_PROJECT_CONTEXT_TEMPLATE = `# 项目上下文

> 当前 Agent 对应项目的背景、目标、约束。
`;

const DEFAULT_DECISION_LOG_TEMPLATE = `# 决策记录

> 记录关键决策、取舍原因与影响范围。
`;

const DEFAULT_LESSONS_TEMPLATE = `# 经验沉淀

> 记录可复用经验、失败教训与后续建议。
`;

const DEFAULT_CURATOR_CONFIG = {
	enabledManualOnly: true,
	maxSessionsPerRun: 30,
	maxCharsPerSession: 4000,
	maxModelInputChars: 32000,
	staleAfterDays: 30,
	confidenceThreshold: 0.6,
};

const DEFAULT_TOOL_APPROVAL_STORE = {
	version: 1,
	rules: [],
};

export class AgentService {
	constructor(
		private readonly vault: Vault,
		private readonly fridayRoot: string,
	) {}

	getAgentsRoot(): string {
		return normalizePath(`${this.fridayRoot}/${AGENTS_FOLDER}`);
	}

	getGlobalRoot(): string {
		return normalizePath(`${this.getAgentsRoot()}/${GLOBAL_FOLDER}`);
	}

	getGlobalKnowledgeRoot(): string {
		return normalizePath(`${this.getGlobalRoot()}/${KNOWLEDGE_FOLDER}`);
	}

	getPresetsRoot(): string {
		return normalizePath(`${this.getAgentsRoot()}/${PRESETS_FOLDER}`);
	}

	getAgentRoot(agentId: string): string {
		return normalizePath(`${this.getAgentsRoot()}/${agentId}`);
	}

	getAgentKnowledgeRoot(agentId: string): string {
		return normalizePath(`${this.getAgentRoot(agentId)}/${KNOWLEDGE_FOLDER}`);
	}

	getAgentMemoryRoot(agentId: string): string {
		return normalizePath(`${this.getAgentRoot(agentId)}/${MEMORY_FOLDER}`);
	}

	getAgentSessionsRoot(agentId: string): string {
		return normalizePath(`${this.getAgentRoot(agentId)}/${SESSIONS_FOLDER}`);
	}

	getAgentSnapshotsRoot(agentId: string): string {
		return normalizePath(`${this.getAgentRoot(agentId)}/${SNAPSHOTS_FOLDER}`);
	}

	getAgentToolApprovalPath(agentId: string): string {
		return normalizePath(`${this.getAgentMemoryRoot(agentId)}/${TOOL_APPROVAL_FILE}`);
	}

	getAgentFilePath(agentId: string): string {
		return normalizePath(`${this.getAgentRoot(agentId)}/agent.md`);
	}

	getAgentProfilePath(agentId: string): string {
		return normalizePath(`${this.getAgentRoot(agentId)}/profile.json`);
	}

	getCuratorConfigPath(): string {
		return normalizePath(`${this.getGlobalRoot()}/curator-config.json`);
	}

	async bootstrap(settings: FridaySettings): Promise<boolean> {
		await this.ensureBaseFolders();
		await this.ensurePresetFiles();
		await this.ensureGlobalKnowledgeFiles();
		await this.ensureCuratorConfig();

		let changed = false;

		if (!settings.agents || settings.agents.length === 0) {
			const created = await this.createAgent({
				id: DEFAULT_AGENT_ID,
				name: "默认 Agent",
				description: "系统默认通用助手",
				model: settings.llm.model,
			});
			settings.agents = [created];
			settings.activeAgentId = created.id;
			changed = true;
		}

		for (const agent of settings.agents) {
			await this.ensureAgentStorage(agent);
		}

		if (!settings.activeAgentId || !settings.agents.some((item) => item.id === settings.activeAgentId)) {
			settings.activeAgentId = settings.agents[0]?.id ?? DEFAULT_AGENT_ID;
			changed = true;
		}

		return changed;
	}

	async createAgent(input: {
		id?: string;
		name: string;
		description: string;
		model?: string;
	}): Promise<AgentProfile> {
		const now = new Date().toISOString();
		const id = this.ensureUniqueAgentId(this.normalizeAgentId(input.id || input.name));
		const profile: AgentProfile = {
			id,
			name: input.name.trim() || "未命名 Agent",
			description: input.description.trim(),
			model: input.model?.trim() ?? "",
			agentFilePath: this.getAgentFilePath(id),
			createdAt: now,
			updatedAt: now,
		};

		await this.ensureAgentStorage(profile);
		await this.writeAgentProfile(profile);
		return profile;
	}

	async ensureAgentStorage(agent: AgentProfile): Promise<void> {
		await this.ensureFolderRecursive(this.getAgentRoot(agent.id));
		await this.ensureFolderRecursive(this.getAgentKnowledgeRoot(agent.id));
		await this.ensureFolderRecursive(this.getAgentMemoryRoot(agent.id));
		await this.ensureFolderRecursive(this.getAgentSessionsRoot(agent.id));
		await this.ensureFolderRecursive(this.getAgentSnapshotsRoot(agent.id));

		await this.upsertTextFile(this.getAgentFilePath(agent.id), DEFAULT_AGENT_TEMPLATE);
		await this.upsertTextFile(
			normalizePath(`${this.getAgentKnowledgeRoot(agent.id)}/project_context.md`),
			DEFAULT_PROJECT_CONTEXT_TEMPLATE,
		);
		await this.upsertTextFile(
			normalizePath(`${this.getAgentKnowledgeRoot(agent.id)}/decision_log.md`),
			DEFAULT_DECISION_LOG_TEMPLATE,
		);
		await this.upsertTextFile(
			normalizePath(`${this.getAgentKnowledgeRoot(agent.id)}/lessons_learned.md`),
			DEFAULT_LESSONS_TEMPLATE,
		);
		await this.upsertTextFile(
			normalizePath(`${this.getAgentMemoryRoot(agent.id)}/facts.md`),
			"# 事实记忆\n",
		);
		await this.upsertTextFile(
			normalizePath(`${this.getAgentMemoryRoot(agent.id)}/preferences.md`),
			"# 偏好记忆\n",
		);
		await this.upsertTextFile(
			this.getAgentToolApprovalPath(agent.id),
			`${JSON.stringify(DEFAULT_TOOL_APPROVAL_STORE, null, 2)}\n`,
		);
	}

	async writeAgentProfile(profile: AgentProfile): Promise<void> {
		const payload = {
			...profile,
			updatedAt: new Date().toISOString(),
		};
		await this.upsertTextFile(
			this.getAgentProfilePath(profile.id),
			`${JSON.stringify(payload, null, 2)}\n`,
		);
	}

	private async ensureBaseFolders(): Promise<void> {
		await this.ensureFolderRecursive(this.getAgentsRoot());
		await this.ensureFolderRecursive(this.getPresetsRoot());
		await this.ensureFolderRecursive(this.getGlobalRoot());
		await this.ensureFolderRecursive(this.getGlobalKnowledgeRoot());
	}

	private async ensurePresetFiles(): Promise<void> {
		await this.upsertTextFile(
			normalizePath(`${this.getPresetsRoot()}/default-agent.md`),
			DEFAULT_AGENT_TEMPLATE,
		);
		await this.upsertTextFile(
			normalizePath(`${this.getPresetsRoot()}/writing-agent.md`),
			"# 写作 Agent\n\n你专注于写作、润色、结构化表达。\n",
		);
		await this.upsertTextFile(
			normalizePath(`${this.getPresetsRoot()}/pm-agent.md`),
			"# PM Agent\n\n你专注于任务拆解、排期、风险识别与项目推进。\n",
		);
	}

	private async ensureGlobalKnowledgeFiles(): Promise<void> {
		await this.upsertTextFile(
			normalizePath(`${this.getGlobalKnowledgeRoot()}/user_profile.md`),
			DEFAULT_USER_PROFILE_TEMPLATE,
		);
		await this.upsertTextFile(
			normalizePath(`${this.getGlobalKnowledgeRoot()}/user_preferences.md`),
			DEFAULT_USER_PREFERENCES_TEMPLATE,
		);
		await this.upsertTextFile(
			normalizePath(`${this.getGlobalKnowledgeRoot()}/workstyle.md`),
			DEFAULT_WORKSTYLE_TEMPLATE,
		);
		await this.upsertTextFile(
			normalizePath(`${this.getGlobalKnowledgeRoot()}/playbooks.md`),
			DEFAULT_PLAYBOOK_TEMPLATE,
		);
	}

	private async ensureCuratorConfig(): Promise<void> {
		await this.upsertTextFile(
			this.getCuratorConfigPath(),
			`${JSON.stringify(DEFAULT_CURATOR_CONFIG, null, 2)}\n`,
		);
	}

	private normalizeAgentId(rawValue: string): string {
		const trimmed = rawValue.trim().toLowerCase();
		const normalized = trimmed
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9_-]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
		return normalized || `agent-${Date.now()}`;
	}

	private ensureUniqueAgentId(baseId: string): string {
		let candidate = baseId;
		let counter = 2;
		while (this.vault.getAbstractFileByPath(this.getAgentRoot(candidate))) {
			candidate = `${baseId}-${counter}`;
			counter += 1;
		}
		return candidate;
	}

	private async ensureFolderRecursive(pathValue: string): Promise<void> {
		const normalizedPath = normalizePath(pathValue);
		const exists = this.vault.getAbstractFileByPath(normalizedPath);
		if (exists instanceof TFolder) {
			return;
		}
		if (exists instanceof TFile) {
			throw new Error(`Path occupied by file: ${normalizedPath}`);
		}

		const segments = normalizedPath.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			const abstractFile = this.vault.getAbstractFileByPath(current);
			if (abstractFile instanceof TFolder) {
				continue;
			}
			if (abstractFile instanceof TFile) {
				throw new Error(`Path occupied by file: ${current}`);
			}
			try {
				await this.vault.createFolder(current);
			} catch (error) {
				const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
				if (!message.includes("already exists")) {
					throw error;
				}
			}
		}
	}

	private async upsertTextFile(filePath: string, content: string): Promise<void> {
		const normalized = normalizePath(filePath);
		const abstractFile = this.vault.getAbstractFileByPath(normalized);
		if (abstractFile instanceof TFile) {
			return;
		}
		if (abstractFile instanceof TFolder) {
			throw new Error(`File path occupied by folder: ${normalized}`);
		}

		try {
			await this.vault.create(normalized, content);
		} catch (error) {
			const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
			if (!message.includes("already exists")) {
				throw error;
			}
		}
	}
}
