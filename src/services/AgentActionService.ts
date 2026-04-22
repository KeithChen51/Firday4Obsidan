import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { normalizePath, TFile, TFolder, Vault } from "obsidian";
import { CanvasService } from "./CanvasService";
import { AgentAction, AgentActionPreview } from "../types/action";
import { WorkspaceAccessService } from "./WorkspaceAccessService";
import { ProjectBoundaryService } from "./ProjectBoundaryService";
import { RuntimeStateStore } from "./RuntimeStateStore";

export class AgentActionService {
	constructor(
		private readonly vault: Vault,
		private readonly runtimeStateStore: RuntimeStateStore,
		private readonly workspaceAccessService: WorkspaceAccessService,
		private readonly canvasService: CanvasService,
		private readonly projectBoundaryService: ProjectBoundaryService,
	) {}

	preview(action: AgentAction): AgentActionPreview {
		const pathValue = normalizePath(action.path);
		let summary = "";
		if (action.type === "delete") {
			summary = action.targetType === "folder" ? `删除文件夹 ${pathValue}` : `删除文件 ${pathValue}`;
		} else if (action.type === "create") {
			summary = `新建文件 ${pathValue}`;
		} else {
			summary = `更新文件 ${pathValue}`;
		}
		return {
			path: pathValue,
			type: action.type,
			targetType: action.targetType,
			summary,
		};
	}

	async execute(action: AgentAction, soulId: string): Promise<void> {
		const targetPath = normalizePath(action.path);
		if (!this.workspaceAccessService.canWriteVaultPath(targetPath)) {
			throw new Error(this.buildScopeDeniedMessage(targetPath));
		}

		if ((action.type === "create" || action.type === "update") && action.targetType === "canvas") {
			const validation = this.canvasService.validateCanvasJson(action.content ?? "");
			if (!validation.valid) {
				throw new Error(validation.reason);
			}
		}

		await this.snapshotBeforeWrite(targetPath, soulId);
		await this.applyAction(targetPath, action);
	}

	private buildScopeDeniedMessage(targetPath: string): string {
		const activeProject = this.projectBoundaryService.getActiveProject();
		if (!activeProject) {
			return `无权写入路径：${targetPath}`;
		}
		const projectRoot = this.projectBoundaryService.getProjectRoot(activeProject);
		return `无权写入路径：${targetPath}（activeProject=${activeProject.slug}, projectRoot=${projectRoot}）`;
	}

	private async applyAction(targetPath: string, action: AgentAction): Promise<void> {
		const existing = this.vault.getAbstractFileByPath(targetPath);
		if (action.type === "delete") {
			if (!(existing instanceof TFile) && !(existing instanceof TFolder)) {
				throw new Error(`文件或文件夹不存在：${targetPath}`);
			}
			await this.vault.delete(existing);
			return;
		}

		if (existing instanceof TFolder) {
			throw new Error(`目标路径是文件夹：${targetPath}`);
		}

		await this.ensureParentFolder(targetPath);
		const content = action.content ?? "";
		if (existing instanceof TFile) {
			await this.vault.modify(existing, content);
			return;
		}
		await this.vault.create(targetPath, content);
	}

	private async ensureParentFolder(filePath: string): Promise<void> {
		const normalized = normalizePath(filePath);
		const parts = normalized.split("/");
		if (parts.length <= 1) {
			return;
		}
		parts.pop();
		const folderPath = parts.join("/");
		if (!folderPath) {
			return;
		}

		const existing = this.vault.getAbstractFileByPath(folderPath);
		if (existing instanceof TFolder) {
			return;
		}
		if (existing instanceof TFile) {
			throw new Error(`父目录被文件占用：${folderPath}`);
		}

		const segments = folderPath.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			const abstract = this.vault.getAbstractFileByPath(current);
			if (abstract instanceof TFolder) {
				continue;
			}
			if (abstract instanceof TFile) {
				throw new Error(`目录路径被文件占用：${current}`);
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

	private async snapshotBeforeWrite(targetPath: string, soulId: string): Promise<void> {
		const existing = this.vault.getAbstractFileByPath(targetPath);
		if (!(existing instanceof TFile)) {
			return;
		}
		const content = await this.vault.cachedRead(existing);
		const snapshotRoot = this.runtimeStateStore.getSoulSnapshotsRoot(soulId);
		await mkdir(snapshotRoot, { recursive: true });
		const snapshotPath = path.join(snapshotRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}.patch`);
		const payload = [
			"# Snapshot",
			`path: ${targetPath}`,
			`createdAt: ${new Date().toISOString()}`,
			"",
			content,
		].join("\n");
		await writeFile(snapshotPath, payload, "utf8");
	}
}
