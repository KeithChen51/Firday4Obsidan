import path from "path";
import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { SyncService } from "../services/SyncService";
import { ProjectEntry, SyncResult } from "../types/project";
import { getVaultBasePath } from "../utils/vaultPath";

type TranslateFn = (
	key: string,
	params?: Record<string, string | number | boolean | null | undefined>,
) => string;

interface SyncStatusModalOptions {
	projects: ProjectEntry[];
	syncService: SyncService;
	results?: Map<string, SyncResult>;
	t?: TranslateFn;
}

export class SyncStatusModal extends Modal {
	constructor(app: App, private readonly options: SyncStatusModalOptions) {
		super(app);
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.t("sync.status.title", "同步状态") });

		for (const project of this.options.projects) {
			const section = contentEl.createDiv({ cls: "friday-sync-project" });
			section.createEl("h3", { text: project.slug });

			const result = this.options.results?.get(project.slug);
			if (result) {
				this.renderResult(section, project, result);
				continue;
			}

			const status = await this.options.syncService.getStatus(project);
			section.createEl("p", {
				text: [
					`${this.t("sync.status.connected", "连接")}: ${status.connected}`,
					`${this.t("sync.status.ahead", "领先")}: ${status.ahead}`,
					`${this.t("sync.status.behind", "落后")}: ${status.behind}`,
					`${this.t("sync.status.dirty", "本地变更")}: ${status.dirty}`,
					`${this.t("sync.status.conflicts", "冲突")}: ${status.conflicts}`,
				].join(" | "),
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderResult(containerEl: HTMLElement, project: ProjectEntry, result: SyncResult): void {
		containerEl.createEl("p", {
			text: result.success
				? this.t("sync.result.success", "同步成功。推送文件 {count} 冲突={conflicts}", {
						count: result.pushedFiles.length,
						conflicts: result.conflicts.length,
					})
				: this.t("sync.result.failed", "同步失败：{error}", {
						error: result.error ?? project.slug,
					}),
		});

		if (result.conflicts.length === 0) {
			return;
		}

		for (const conflictPath of result.conflicts) {
			const row = containerEl.createDiv({ cls: "friday-sync-conflict-row" });
			row.createSpan({ text: conflictPath });

			new Setting(row)
				.addButton((button) =>
					button.setButtonText(this.t("sync.conflict.keepOurs", "保留本地")).onClick(async () => {
						await this.resolve(project, conflictPath, "ours");
					}),
				)
				.addButton((button) =>
					button.setButtonText(this.t("sync.conflict.keepTheirs", "保留远端")).onClick(async () => {
						await this.resolve(project, conflictPath, "theirs");
					}),
				)
				.addButton((button) =>
					button
						.setButtonText(this.t("sync.conflict.openSnapshot", "打开快照"))
						.onClick(async () => {
							await this.openSnapshot(result, conflictPath);
						}),
				);
		}
	}

	private async resolve(
		project: ProjectEntry,
		filePath: string,
		strategy: "ours" | "theirs",
	): Promise<void> {
		try {
			await this.options.syncService.resolveConflict(project, filePath, strategy);
			const strategyLabel =
				strategy === "ours"
					? this.t("sync.conflict.keepOurs", "保留本地")
					: this.t("sync.conflict.keepTheirs", "保留远端");
			new Notice(
				this.t("sync.conflict.resolved", "已处理冲突：{path}（{strategy}）", {
					path: filePath,
					strategy: strategyLabel,
				}),
				3000,
			);
		} catch (error) {
			new Notice(
				this.t("sync.conflict.resolveFailed", "处理冲突失败：{path}，{error}", {
					path: filePath,
					error: String(error),
				}),
				6000,
			);
		}
	}

	private async openSnapshot(result: SyncResult, conflictPath: string): Promise<void> {
		const snapshotPath = result.conflictSnapshots?.[conflictPath];
		if (!snapshotPath) {
			new Notice(this.t("sync.conflict.snapshotMissing", "没有可用的冲突快照文件"), 3000);
			return;
		}

		const vaultBasePath = getVaultBasePath(this.app);
		const relativePath = path.relative(vaultBasePath, snapshotPath).replace(/\\/g, "/");
		if (relativePath.startsWith("..")) {
			new Notice(this.t("sync.conflict.snapshotPath", "快照路径：{path}", { path: snapshotPath }), 6000);
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(relativePath);
		if (!(file instanceof TFile)) {
			new Notice(this.t("sync.conflict.snapshotPath", "快照路径：{path}", { path: snapshotPath }), 6000);
			return;
		}

		await this.app.workspace.getLeaf(true).openFile(file);
	}

	private t(
		key: string,
		fallback: string,
		params?: Record<string, string | number | boolean | null | undefined>,
	): string {
		if (this.options.t) {
			return this.options.t(key, params);
		}
		if (!params) {
			return fallback;
		}
		return fallback.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_full, name: string) => {
			const value = params[name];
			return value == null ? "" : String(value);
		});
	}
}
