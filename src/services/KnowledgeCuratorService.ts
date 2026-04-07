import { normalizePath, Notice, TFile, Vault } from "obsidian";
import { AgentProfile } from "../types/agent";
import { KnowledgeRecord, KnowledgeSummary } from "../types/knowledge";
import { FridaySettings } from "../types/settings";
import { AgentService } from "./AgentService";
import { ConversationService, ConversationSession } from "./ConversationService";

type Category =
	| "user_profile"
	| "user_preferences"
	| "workstyle"
	| "playbook"
	| "project_context"
	| "decision_log"
	| "lessons_learned";

interface KnowledgeIndexes {
	global: KnowledgeRecord[];
	project: KnowledgeRecord[];
}

const KNOWLEDGE_STATUS_FILE = "_status.json";
const KNOWLEDGE_INDEX_FILE = "_records.json";

export class KnowledgeCuratorService {
	constructor(
		private readonly vault: Vault,
		private readonly agentService: AgentService,
		private readonly conversationService: ConversationService,
	) {}

	async runCuration(
		settings: FridaySettings,
		agents: AgentProfile[],
		activeAgentId: string,
	): Promise<KnowledgeSummary> {
		if (agents.length === 0) {
			throw new Error("当前没有可用 Agent。");
		}

		const config = settings.knowledgeCurator;
		const sessions = await this.conversationService.collectRecentSessionsAcrossAgents(
			agents.map((item) => item.id),
			config.maxSessionsPerRun,
			config.maxCharsPerSession,
		);

		const fresh = this.extractKnowledgeFromSessions(sessions, activeAgentId);
		const existing = await this.loadIndexes(activeAgentId);
		const mergedGlobal = this.mergeRecords(existing.global, fresh.global);
		const mergedProject = this.mergeRecords(existing.project, fresh.project);

		await this.writeIndexes(activeAgentId, mergedGlobal, mergedProject);
		await this.writeKnowledgeMarkdown(activeAgentId, mergedGlobal, mergedProject);

		const summary: KnowledgeSummary = {
			lastRunAt: new Date().toISOString(),
			globalUserCount: mergedGlobal.length,
			projectCount: mergedProject.length,
			needsReviewCount:
				mergedGlobal.filter((item) => item.status === "needs_review").length +
				mergedProject.filter((item) => item.status === "needs_review").length,
			budgetHitRate: this.calculateBudgetHitRate(sessions, config.maxSessionsPerRun),
		};
		await this.writeSummary(summary);

		return summary;
	}

	async getLatestSummary(): Promise<KnowledgeSummary | null> {
		const path = normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/${KNOWLEDGE_STATUS_FILE}`);
		const file = this.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return null;
		}
		const raw = await this.vault.cachedRead(file);
		try {
			return JSON.parse(raw) as KnowledgeSummary;
		} catch {
			return null;
		}
	}

	private extractKnowledgeFromSessions(
		sessions: ConversationSession[],
		activeAgentId: string,
	): KnowledgeIndexes {
		const global: KnowledgeRecord[] = [];
		const project: KnowledgeRecord[] = [];
		let counter = 0;

		for (const session of sessions) {
			for (const message of session.messages) {
				if (message.role !== "user" && message.role !== "assistant") {
					continue;
				}

				const text = this.normalizeLine(message.content);
				if (!text) {
					continue;
				}

				const sourceSessionIds = [session.sessionId];

				this.pushByRule({
					target: global,
					condition: /(我是|我在|我的岗位|我的角色|我们团队|公司)/.test(text),
					record: this.buildRecord(
						`knowledge-${Date.now()}-${counter += 1}`,
						"global_user",
						"user_profile",
						text,
						sourceSessionIds,
						0.72,
					),
				});
				this.pushByRule({
					target: global,
					condition: /(喜欢|偏好|希望|请用|请不要|不要|尽量|优先)/.test(text),
					record: this.buildRecord(
						`knowledge-${Date.now()}-${counter += 1}`,
						"global_user",
						"user_preferences",
						text,
						sourceSessionIds,
						0.78,
					),
				});
				this.pushByRule({
					target: global,
					condition: /(步骤|流程|先|再|最后|简洁|详细|结构化|列表)/.test(text),
					record: this.buildRecord(
						`knowledge-${Date.now()}-${counter += 1}`,
						"global_user",
						"workstyle",
						text,
						sourceSessionIds,
						0.66,
					),
				});
				this.pushByRule({
					target: global,
					condition: message.role === "assistant" && /^(\d+\.|-\s|\*)/.test(text),
					record: this.buildRecord(
						`knowledge-${Date.now()}-${counter += 1}`,
						"global_playbook",
						"playbook",
						text,
						sourceSessionIds,
						0.62,
					),
				});
				this.pushByRule({
					target: project,
					condition: /(项目|里程碑|需求|任务|风险|上线|发布|同步|仓库|代码)/.test(text),
					record: this.buildRecord(
						`knowledge-${Date.now()}-${counter += 1}`,
						"project_agent",
						"project_context",
						text,
						sourceSessionIds,
						0.71,
					),
				});
				this.pushByRule({
					target: project,
					condition: /(决定|选择|采用|改成|不做|优先|取舍)/.test(text),
					record: this.buildRecord(
						`knowledge-${Date.now()}-${counter += 1}`,
						"project_agent",
						"decision_log",
						text,
						sourceSessionIds,
						0.68,
					),
				});
				this.pushByRule({
					target: project,
					condition: /(经验|教训|复盘|下次|避免|最佳实践|建议)/.test(text),
					record: this.buildRecord(
						`knowledge-${Date.now()}-${counter += 1}`,
						"project_agent",
						"lessons_learned",
						text,
						sourceSessionIds,
						0.74,
					),
				});
			}
		}

		if (project.length === 0) {
			project.push(
				this.buildRecord(
					`knowledge-${Date.now()}-${counter += 1}`,
					"project_agent",
					"project_context",
					`当前 Agent ${activeAgentId} 尚未形成稳定项目知识。`,
					[],
					0.5,
				),
			);
		}

		return { global, project };
	}

	private mergeRecords(existing: KnowledgeRecord[], incoming: KnowledgeRecord[]): KnowledgeRecord[] {
		const map = new Map<string, KnowledgeRecord>();
		for (const item of existing) {
			map.set(this.recordKey(item), item);
		}

		for (const item of incoming) {
			const key = this.recordKey(item);
			const hit = map.get(key);
			if (!hit) {
				map.set(key, item);
				continue;
			}

			map.set(key, {
				...hit,
				sourceSessionIds: [...new Set([...hit.sourceSessionIds, ...item.sourceSessionIds])],
				confidence: Math.max(hit.confidence, item.confidence),
				updatedAt: new Date().toISOString(),
				status: "active",
			});
		}

		return Array.from(map.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	private async loadIndexes(activeAgentId: string): Promise<KnowledgeIndexes> {
		return {
			global: await this.readRecords(normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/${KNOWLEDGE_INDEX_FILE}`)),
			project: await this.readRecords(normalizePath(`${this.agentService.getAgentKnowledgeRoot(activeAgentId)}/${KNOWLEDGE_INDEX_FILE}`)),
		};
	}

	private async writeIndexes(activeAgentId: string, global: KnowledgeRecord[], project: KnowledgeRecord[]): Promise<void> {
		await this.upsertTextFile(
			normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/${KNOWLEDGE_INDEX_FILE}`),
			`${JSON.stringify(global, null, 2)}\n`,
		);
		await this.upsertTextFile(
			normalizePath(`${this.agentService.getAgentKnowledgeRoot(activeAgentId)}/${KNOWLEDGE_INDEX_FILE}`),
			`${JSON.stringify(project, null, 2)}\n`,
		);
	}

	private async writeSummary(summary: KnowledgeSummary): Promise<void> {
		await this.upsertTextFile(
			normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/${KNOWLEDGE_STATUS_FILE}`),
			`${JSON.stringify(summary, null, 2)}\n`,
		);
	}

	private async writeKnowledgeMarkdown(
		activeAgentId: string,
		globalRecords: KnowledgeRecord[],
		projectRecords: KnowledgeRecord[],
	): Promise<void> {
		await this.writeCategoryMarkdown(
			normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/user_profile.md`),
			"用户画像",
			globalRecords.filter((item) => item.category === "user_profile"),
		);
		await this.writeCategoryMarkdown(
			normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/user_preferences.md`),
			"用户偏好",
			globalRecords.filter((item) => item.category === "user_preferences"),
		);
		await this.writeCategoryMarkdown(
			normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/workstyle.md`),
			"工作风格",
			globalRecords.filter((item) => item.category === "workstyle"),
		);
		await this.writeCategoryMarkdown(
			normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/playbooks.md`),
			"通用方法论",
			globalRecords.filter((item) => item.category === "playbook"),
		);

		await this.writeCategoryMarkdown(
			normalizePath(`${this.agentService.getAgentKnowledgeRoot(activeAgentId)}/project_context.md`),
			"项目上下文",
			projectRecords.filter((item) => item.category === "project_context"),
		);
		await this.writeCategoryMarkdown(
			normalizePath(`${this.agentService.getAgentKnowledgeRoot(activeAgentId)}/decision_log.md`),
			"决策记录",
			projectRecords.filter((item) => item.category === "decision_log"),
		);
		await this.writeCategoryMarkdown(
			normalizePath(`${this.agentService.getAgentKnowledgeRoot(activeAgentId)}/lessons_learned.md`),
			"经验沉淀",
			projectRecords.filter((item) => item.category === "lessons_learned"),
		);
	}

	private async writeCategoryMarkdown(filePath: string, title: string, records: KnowledgeRecord[]): Promise<void> {
		const lines = [
			`# ${title}`,
			"",
			`> 自动提炼时间：${new Date().toISOString()}`,
			"",
		];
		if (records.length === 0) {
			lines.push("- （暂无）");
		} else {
			for (const item of records) {
				lines.push(`- ${item.content}`);
				lines.push(
					`  - 状态: ${item.status} | 置信度: ${item.confidence.toFixed(2)} | 来源: ${item.sourceSessionIds.join(", ") || "N/A"} | 更新时间: ${item.updatedAt}`,
				);
			}
		}
		lines.push("");
		await this.upsertTextFile(filePath, lines.join("\n"));
	}

	private calculateBudgetHitRate(sessions: ConversationSession[], maxSessions: number): number {
		if (maxSessions <= 0) {
			return 0;
		}
		const ratio = sessions.length / maxSessions;
		return Number.parseFloat(Math.min(1, ratio).toFixed(2));
	}

	private pushByRule(input: {
		target: KnowledgeRecord[];
		condition: boolean;
		record: KnowledgeRecord;
	}): void {
		if (input.condition) {
			input.target.push(input.record);
		}
	}

	private buildRecord(
		id: string,
		scope: KnowledgeRecord["scope"],
		category: Category,
		content: string,
		sourceSessionIds: string[],
		confidence: number,
	): KnowledgeRecord {
		return {
			id,
			scope,
			category,
			content: content.trim(),
			sourceSessionIds,
			confidence,
			status: "active",
			updatedAt: new Date().toISOString(),
		};
	}

	private normalizeLine(input: string): string {
		const firstLine = input
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line.length > 0);
		if (!firstLine) {
			return "";
		}
		return firstLine.slice(0, 180);
	}

	private recordKey(item: KnowledgeRecord): string {
		return `${item.scope}|${item.category}|${item.content.toLowerCase()}`;
	}

	private async readRecords(filePath: string): Promise<KnowledgeRecord[]> {
		const file = this.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return [];
		}
		try {
			const raw = await this.vault.cachedRead(file);
			const parsed = JSON.parse(raw) as KnowledgeRecord[];
			if (!Array.isArray(parsed)) {
				return [];
			}
			return parsed.filter((item): item is KnowledgeRecord => Boolean(item && typeof item === "object"));
		} catch {
			return [];
		}
	}

	private async upsertTextFile(filePath: string, content: string): Promise<void> {
		const file = this.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			await this.vault.modify(file, content);
			return;
		}
		try {
			await this.vault.create(filePath, content);
		} catch (error) {
			const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
			if (!message.includes("already exists")) {
				throw error;
			}
			const latest = this.vault.getAbstractFileByPath(filePath);
			if (latest instanceof TFile) {
				await this.vault.modify(latest, content);
			}
		}
	}
}

