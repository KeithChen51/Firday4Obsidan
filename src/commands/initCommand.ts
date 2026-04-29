import { Notice, normalizePath, TFile, TFolder, Vault } from "obsidian";
import { FridayPluginApi } from "../types/plugin";

export interface InitCommandOptions {
	confirmOverwrite?: boolean;
	openFile?: boolean;
}

export interface InitCommandResult {
	status: "created" | "updated" | "unchanged" | "cancelled";
	path: string;
}

export function registerInitCommand(plugin: FridayPluginApi): void {
	plugin.addCommand({
		id: "init-friday-md",
		name: plugin.t("command.initFriday"),
		callback: async () => {
			try {
				const result = await runInitCommand(plugin, {
					confirmOverwrite: false,
					openFile: true,
				});
				if (result.status === "created") {
					new Notice(plugin.t("notice.initCreated", { path: result.path }), 4000);
					return;
				}
				if (result.status === "updated") {
					new Notice(plugin.t("notice.initUpdated", { path: result.path }), 4000);
					return;
				}
				if (result.status === "unchanged") {
					new Notice(plugin.t("notice.initUnchanged", { path: result.path }), 3500);
					return;
				}
				new Notice(plugin.t("notice.initCancelled"), 3000);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error ?? "");
				new Notice(plugin.t("notice.initFailed", { error: message }), 7000);
			}
		},
	});
}

export async function runInitCommand(
	plugin: FridayPluginApi,
	options: InitCommandOptions = {},
): Promise<InitCommandResult> {
	const confirmOverwrite = options.confirmOverwrite ?? true;
	const openFile = options.openFile ?? true;
	const targetPath = normalizePath(`${plugin.dataService.getFridayRoot()}/Agents/_global/FRIDAY.md`);

	await ensureParentFolders(plugin, plugin.app.vault, targetPath);

	const markdown = buildFridayMarkdown(plugin);
	const existing = plugin.app.vault.getAbstractFileByPath(targetPath);

	if (existing && !(existing instanceof TFile)) {
		throw new Error(`路径已存在但不是文件：${targetPath}`);
	}

	if (existing instanceof TFile) {
		const current = await plugin.app.vault.cachedRead(existing);
		if (normalizeText(current) === normalizeText(markdown)) {
			if (openFile) {
				await plugin.app.workspace.getLeaf(true).openFile(existing);
			}
			return { status: "unchanged", path: targetPath };
		}

		if (confirmOverwrite) {
			await backupExistingFile(plugin.app.vault, existing);
		}

		await plugin.app.vault.modify(existing, markdown);
		if (openFile) {
			await plugin.app.workspace.getLeaf(true).openFile(existing);
		}
		return { status: "updated", path: targetPath };
	}

	const created = await plugin.app.vault.create(targetPath, markdown);
	if (openFile) {
		await plugin.app.workspace.getLeaf(true).openFile(created);
	}
	return { status: "created", path: targetPath };
}

async function backupExistingFile(vault: Vault, file: TFile): Promise<void> {
	const backupPath = normalizePath(`${file.path}.bak-${Date.now()}`);
	await vault.copy(file, backupPath);
}

function buildFridayMarkdown(plugin: FridayPluginApi): string {
	const now = new Date().toISOString();
	const vaultName = plugin.app.vault.getName();
	const focusPaths = (plugin.settings.agentRuntime.vaultFocusPaths ?? [])
		.map((item) => normalizePath(item))
		.filter((item) => item.length > 0);
	const readOnlyExternal = (plugin.settings.agentRuntime.externalReadOnlyPaths ?? [])
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	const skillExternal = (plugin.settings.agentRuntime.externalSkillPaths ?? [])
		.map((item) => item.trim())
		.filter((item) => item.length > 0);

	const vaultFiles = plugin.app.vault
		.getFiles()
		.filter((file) => plugin.workspaceAccessService.canReadVaultPath(file.path));
	const topFolders = summarizeTopFolders(vaultFiles.map((file) => normalizePath(file.path)));
	const extStats = summarizeExtensions(vaultFiles.map((file) => file.extension.toLowerCase()));
	const sampleFiles = vaultFiles
		.map((file) => normalizePath(file.path))
		.sort((left, right) => left.localeCompare(right))
		.slice(0, 25);

	const lines: string[] = [];
	lines.push("# FRIDAY 全局指令");
	lines.push("");
	lines.push("> 由 `/init` 自动生成。可按团队规范继续编辑。");
	lines.push("");
	lines.push("## 角色与目标");
	lines.push("- 你是运行在 Obsidian 插件中的 FRIDAY Agent。");
	lines.push("- 优先完成可执行、可验证、可追踪的任务推进。");
	lines.push("- 在写入/删除文件前，先说明变更范围和风险。");
	lines.push("");
	lines.push("## 工作边界");
	lines.push("- 默认仅在许可范围内读取与修改文件。");
	lines.push("- 外部路径默认只读，除非用户显式批准。");
	lines.push("- 当需求不明确时，先给出最小可行方案，再增量迭代。");
	lines.push("");
	lines.push("## Vault 快照");
	lines.push(`- 生成时间: ${now}`);
	lines.push(`- Vault: ${vaultName}`);
	lines.push(`- 可读文件数量: ${vaultFiles.length}`);
	lines.push(`- 聚焦路径: ${focusPaths.length > 0 ? focusPaths.join(", ") : "(未配置，默认全 Vault)"}`);
	lines.push(`- 外部只读路径: ${readOnlyExternal.length > 0 ? readOnlyExternal.join(", ") : "(无)"}`);
	lines.push(`- 外部 Skill 路径: ${skillExternal.length > 0 ? skillExternal.join(", ") : "(无)"}`);
	lines.push("");
	lines.push("### 顶层目录分布（按文件数）");
	if (topFolders.length === 0) {
		lines.push("- (无)");
	} else {
		for (const item of topFolders) {
			lines.push(`- ${item.folder}: ${item.count}`);
		}
	}
	lines.push("");
	lines.push("### 文件类型分布");
	if (extStats.length === 0) {
		lines.push("- (无)");
	} else {
		for (const item of extStats) {
			lines.push(`- .${item.ext}: ${item.count}`);
		}
	}
	lines.push("");
	lines.push("### 文件样例（前 25）");
	if (sampleFiles.length === 0) {
		lines.push("- (无)");
	} else {
		for (const filePath of sampleFiles) {
			lines.push(`- ${filePath}`);
		}
	}
	lines.push("");
	lines.push("## 建议执行流程");
	lines.push("1. 先读取当前任务涉及文件与上下文，再给出执行计划。");
	lines.push("2. 需要改写内容时，先展示变更摘要，再执行写入。");
	lines.push("3. 每轮操作后记录结果与下一步，保持可回溯。");
	lines.push("");
	lines.push("## 团队可自定义项");
	lines.push("- 编码规范与文档格式");
	lines.push("- 项目领域术语和命名约定");
	lines.push("- 审批规则（哪些操作必须人工确认）");
	lines.push("");

	return `${lines.join("\n")}\n`;
}

function summarizeTopFolders(paths: string[]): Array<{ folder: string; count: number }> {
	const map = new Map<string, number>();
	for (const filePath of paths) {
		const normalized = normalizePath(filePath);
		const top = normalized.split("/")[0] || "(root)";
		map.set(top, (map.get(top) ?? 0) + 1);
	}
	return [...map.entries()]
		.map(([folder, count]) => ({ folder, count }))
		.sort((left, right) => {
			if (right.count !== left.count) {
				return right.count - left.count;
			}
			return left.folder.localeCompare(right.folder);
		})
		.slice(0, 12);
}

function summarizeExtensions(exts: string[]): Array<{ ext: string; count: number }> {
	const map = new Map<string, number>();
	for (const ext of exts) {
		const normalized = ext.trim() || "unknown";
		map.set(normalized, (map.get(normalized) ?? 0) + 1);
	}
	return [...map.entries()]
		.map(([ext, count]) => ({ ext, count }))
		.sort((left, right) => {
			if (right.count !== left.count) {
				return right.count - left.count;
			}
			return left.ext.localeCompare(right.ext);
		})
		.slice(0, 12);
}

async function ensureParentFolders(plugin: FridayPluginApi, vault: Vault, targetPath: string): Promise<void> {
	const segments = normalizePath(targetPath).split("/");
	segments.pop();
	let current = "";
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		const existing = vault.getAbstractFileByPath(current);
		if (!existing) {
			await vault.createFolder(current);
			continue;
		}
		if (!(existing instanceof TFolder)) {
			throw new Error(`父路径不是文件夹：${current}`);
		}
	}
}

function normalizeText(content: string): string {
	return content.replace(/\r/g, "").trim();
}
