import { normalizePath, TFile, Vault } from "obsidian";
import { FridaySettings } from "../types/settings";
import { AgentService } from "./AgentService";
import { KnowledgeRecord, KnowledgeSummary } from "../types/knowledge";
import { KnowledgeCuratorService } from "./KnowledgeCuratorService";

const KNOWLEDGE_INDEX_FILE = "_records.json";
const KNOWLEDGE_STATUS_FILE = "_status.json";

export class KnowledgeValidationService {
	constructor(
		private readonly vault: Vault,
		private readonly agentService: AgentService,
		private readonly curatorService: KnowledgeCuratorService,
	) {}

	async runRevalidation(settings: FridaySettings, activeAgentId: string): Promise<KnowledgeSummary> {
		const globalPath = normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/${KNOWLEDGE_INDEX_FILE}`);
		const projectPath = normalizePath(`${this.agentService.getAgentKnowledgeRoot(activeAgentId)}/${KNOWLEDGE_INDEX_FILE}`);

		const globalRecords = await this.readRecords(globalPath);
		const projectRecords = await this.readRecords(projectPath);

		const nextGlobal = this.revalidateRecords(globalRecords, settings);
		const nextProject = this.revalidateRecords(projectRecords, settings);

		await this.upsertJson(globalPath, nextGlobal);
		await this.upsertJson(projectPath, nextProject);
		await this.rewriteMarkdown(activeAgentId, nextGlobal, nextProject);

		const currentSummary = await this.curatorService.getLatestSummary();
		const summary: KnowledgeSummary = {
			lastRunAt: new Date().toISOString(),
			globalUserCount: nextGlobal.length,
			projectCount: nextProject.length,
			needsReviewCount:
				nextGlobal.filter((item) => item.status === "needs_review").length +
				nextProject.filter((item) => item.status === "needs_review").length,
			budgetHitRate: currentSummary?.budgetHitRate ?? 0,
		};
		await this.upsertJson(
			normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/${KNOWLEDGE_STATUS_FILE}`),
			summary,
		);
		return summary;
	}

	private revalidateRecords(records: KnowledgeRecord[], settings: FridaySettings): KnowledgeRecord[] {
		const now = Date.now();
		const staleMs = settings.knowledgeCurator.staleAfterDays * 24 * 60 * 60 * 1000;
		const threshold = settings.knowledgeCurator.confidenceThreshold;

		const result = records.map((record) => {
			let status = record.status;
			const updatedTime = new Date(record.updatedAt).getTime();
			const outdated = Number.isFinite(updatedTime) && now - updatedTime > staleMs;
			const lowConfidence = record.confidence < threshold;
			if (outdated || lowConfidence) {
				status = "needs_review";
			}
			return {
				...record,
				status,
			};
		});

		// Conflict detection with lightweight negation heuristic.
		const bucket = new Map<string, KnowledgeRecord[]>();
		for (const item of result) {
			const key = `${item.scope}|${item.category}|${this.normalizeConflictKey(item.content)}`;
			const list = bucket.get(key) ?? [];
			list.push(item);
			bucket.set(key, list);
		}

		for (const list of bucket.values()) {
			if (list.length < 2) {
				continue;
			}
			const hasNegation = list.some((item) => this.hasNegation(item.content));
			const hasPositive = list.some((item) => !this.hasNegation(item.content));
			if (!hasNegation || !hasPositive) {
				continue;
			}

			for (const item of list) {
				item.status = "needs_review";
			}
		}

		return result.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	private normalizeConflictKey(content: string): string {
		return content
			.toLowerCase()
			.replace(/不要|不建议|禁止|避免/g, "")
			.replace(/[^a-z0-9\u4e00-\u9fa5]/g, "")
			.slice(0, 40);
	}

	private hasNegation(content: string): boolean {
		return /(不要|不建议|禁止|避免|不做)/.test(content);
	}

	private async rewriteMarkdown(
		activeAgentId: string,
		globalRecords: KnowledgeRecord[],
		projectRecords: KnowledgeRecord[],
	): Promise<void> {
		const render = async (path: string, title: string, records: KnowledgeRecord[]): Promise<void> => {
			const lines = [`# ${title}`, "", `> 回查时间：${new Date().toISOString()}`, ""];
			if (records.length === 0) {
				lines.push("- （暂无）");
			} else {
				for (const item of records) {
					lines.push(`- ${item.content}`);
					lines.push(
						`  - 状态: ${item.status} | 置信度: ${item.confidence.toFixed(2)} | 更新时间: ${item.updatedAt}`,
					);
				}
			}
			lines.push("");
			await this.upsertText(path, lines.join("\n"));
		};

		await render(
			normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/user_profile.md`),
			"用户画像",
			globalRecords.filter((item) => item.category === "user_profile"),
		);
		await render(
			normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/user_preferences.md`),
			"用户偏好",
			globalRecords.filter((item) => item.category === "user_preferences"),
		);
		await render(
			normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/workstyle.md`),
			"工作风格",
			globalRecords.filter((item) => item.category === "workstyle"),
		);
		await render(
			normalizePath(`${this.agentService.getGlobalKnowledgeRoot()}/playbooks.md`),
			"通用方法论",
			globalRecords.filter((item) => item.category === "playbook"),
		);
		await render(
			normalizePath(`${this.agentService.getAgentKnowledgeRoot(activeAgentId)}/project_context.md`),
			"项目上下文",
			projectRecords.filter((item) => item.category === "project_context"),
		);
		await render(
			normalizePath(`${this.agentService.getAgentKnowledgeRoot(activeAgentId)}/decision_log.md`),
			"决策记录",
			projectRecords.filter((item) => item.category === "decision_log"),
		);
		await render(
			normalizePath(`${this.agentService.getAgentKnowledgeRoot(activeAgentId)}/lessons_learned.md`),
			"经验沉淀",
			projectRecords.filter((item) => item.category === "lessons_learned"),
		);
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
			return parsed;
		} catch {
			return [];
		}
	}

	private async upsertJson(filePath: string, value: unknown): Promise<void> {
		await this.upsertText(filePath, `${JSON.stringify(value, null, 2)}\n`);
	}

	private async upsertText(filePath: string, content: string): Promise<void> {
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
