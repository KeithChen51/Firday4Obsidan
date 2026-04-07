import path from "path";
import {
	FileManager,
	normalizePath,
	parseYaml,
	stringifyYaml,
	TFile,
	TFolder,
	Vault,
} from "obsidian";
import {
	getDailyFileNameCandidates,
	getPathPresets,
	getPrimaryDailyFileName,
	getRootCandidates,
	PathPreset,
	PERSONAL_SLUG,
	PRIMARY_PATHS,
} from "../constants/paths";
import { ProjectMember } from "../types/project";
import { FridaySettings } from "../types/settings";
import {
	DailyNoteData,
	TaskCreateInput,
	TaskData,
	TaskFilter,
	TaskFrontmatter,
	TaskPriority,
} from "../types/task";
import { formatDate } from "../utils/dateUtils";
import { sortFrontmatterKeys, updateFrontmatter } from "../utils/frontmatter";
import { generateTaskId } from "../utils/idGenerator";
import { getRoleLabel } from "../utils/labels";

const PRIORITY_ORDER: Record<TaskPriority, number> = {
	urgent: 4,
	high: 3,
	medium: 2,
	low: 1,
};

const DEFAULT_TASK_BODY = `## 任务背景

（补充上下文）

## 执行步骤

- [ ] TODO

## 备注
`;

const DAILY_BLOCK_START = "<!-- F.R.I.D.A.Y:DAILY-TASKS:START -->";
const DAILY_BLOCK_END = "<!-- F.R.I.D.A.Y:DAILY-TASKS:END -->";

export class DataService {
	constructor(
		private readonly vault: Vault,
		private readonly fileManager: FileManager,
		private readonly fridayRoot: string = PRIMARY_PATHS.root,
	) {}

	async ensureDirectoryStructure(): Promise<void> {
		const folders = [
			this.fridayRoot,
			`${this.fridayRoot}/${PRIMARY_PATHS.projects}`,
			`${this.fridayRoot}/${PRIMARY_PATHS.personal}`,
			`${this.fridayRoot}/${PRIMARY_PATHS.personal}/${PRIMARY_PATHS.tasks}`,
			`${this.fridayRoot}/${PRIMARY_PATHS.dailyNotes}`,
		];

		for (const folder of folders) {
			await this.ensureFolderRecursive(folder);
		}
	}

	async createTask(projectSlug: string, data: TaskCreateInput): Promise<string> {
		const projectId = projectSlug || data.projectId || PERSONAL_SLUG;
		const now = new Date();
		const nowIso = now.toISOString();
		const taskId = generateTaskId(now, PRIMARY_PATHS.taskIdPrefix);
		const taskFolder = this.getTaskFolderByProject(projectId);

		await this.ensureFolderRecursive(taskFolder);

		const frontmatter: TaskFrontmatter = {
			type: "task",
			taskId,
			projectId,
			parentTaskId: data.parentTaskId ?? "",
			title: data.title.trim(),
			status: data.status ?? "todo",
			priority: data.priority ?? "medium",
			dueDate: data.dueDate ?? "",
			tags: data.tags ?? [],
			assignee: data.assignee ?? "",
			aiGenerated: data.aiGenerated ?? false,
			description: data.description ?? "",
			createdAt: nowIso,
			updatedAt: nowIso,
			completedAt: "",
		};

		const content = this.renderMarkdownWithFrontmatter(
			frontmatter as unknown as Record<string, unknown>,
			data.body?.trim() ? data.body : this.renderDefaultTaskBody(now),
		);

		const taskPath = normalizePath(`${taskFolder}/${taskId}.md`);
		await this.vault.create(taskPath, content);
		return taskId;
	}

	async updateTaskFrontmatter(
		taskId: string,
		updates: Partial<TaskFrontmatter>,
	): Promise<void> {
		const file = await this.findTaskFileById(taskId);
		if (!file) {
			throw new Error(`Task not found: ${taskId}`);
		}

		await updateFrontmatter(this.fileManager, file, (frontmatter) => {
			const patch = updates as Record<string, unknown>;
			for (const [key, value] of Object.entries(patch)) {
				if (value !== undefined) {
					frontmatter[key] = value;
				}
			}

			if (updates.status === "completed" && !updates.completedAt) {
				frontmatter.completedAt = new Date().toISOString();
			}

			frontmatter.updatedAt = new Date().toISOString();
		});
	}

	async deleteTask(taskId: string): Promise<void> {
		const file = await this.findTaskFileById(taskId);
		if (!file) {
			throw new Error(`Task not found: ${taskId}`);
		}

		await this.vault.delete(file);
	}

	async getTask(taskId: string): Promise<TaskData | null> {
		const file = await this.findTaskFileById(taskId);
		if (!file) {
			return null;
		}

		return this.readTaskFromFile(file);
	}

	async getTasksByProject(projectSlug: string, filter?: TaskFilter): Promise<TaskData[]> {
		const files = this.getAllTaskFiles().filter((file) =>
			this.getProjectSlugFromPath(file.path) === projectSlug,
		);
		const tasks = await this.readTasksFromFiles(files);
		return tasks.filter((task) => this.matchTaskFilter(task, filter));
	}

	async getDailyTasks(
		userId: string,
		today: string,
		fallbackAssignee?: string,
	): Promise<TaskData[]> {
		const tasks = await this.readTasksFromFiles(this.getAllTaskFiles());
		const assignees = new Set(
			[userId, fallbackAssignee].filter((value): value is string => Boolean(value)),
		);

		return tasks
			.filter((task) => {
				const assigneeMatched = assignees.size === 0 || assignees.has(task.assignee);
				const activeTask = task.status !== "completed";
				const dueOk = !task.dueDate || task.dueDate >= today;

				return assigneeMatched && activeTask && dueOk;
			})
			.sort((left, right) => this.compareDailyTaskPriority(left, right));
	}

	async getAllTasks(): Promise<TaskData[]> {
		return this.readTasksFromFiles(this.getAllTaskFiles());
	}

	/**
	 * Get completed tasks for a specific date assigned to the given users.
	 * More efficient than getAllTasks + filter since it avoids loading tasks
	 * that don't match. (#12)
	 */
	async getCompletedTasksByDate(
		date: string,
		userId: string,
		fallbackAssignee?: string,
	): Promise<TaskData[]> {
		const tasks = await this.readTasksFromFiles(this.getAllTaskFiles());
		const assignees = new Set(
			[userId, fallbackAssignee].filter((value): value is string => Boolean(value)),
		);

		return tasks
			.filter((task) => {
				if (task.status !== "completed") return false;
				if (!task.completedAt.startsWith(date)) return false;
				if (assignees.size > 0 && !assignees.has(task.assignee)) return false;
				return true;
			})
			.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
	}

	async generateDailyNote(
		userId: string,
		today: string,
		templatePath = "",
		fallbackAssignee?: string,
	): Promise<string> {
		const tasks = await this.getDailyTasks(userId, today, fallbackAssignee);
		const notePath = this.resolveDailyNotePath(today);
		const generatedBlock = this.renderGeneratedDailyBlock(tasks, notePath);
		const noteFrontmatter = {
			type: "daily_note",
			date: today,
			generatedAt: new Date().toISOString(),
		};
		const existing = this.getFileByPathRelaxed(notePath);

		if (existing) {
			const rawContent = await this.readTextFileBestEffort(notePath);
			const parsed = this.splitFrontmatter(rawContent);
			const currentBody = parsed?.body ?? rawContent;
			const mergedBody = this.mergeDailyNoteBody(currentBody, generatedBlock);
			const nextContent = this.renderMarkdownWithFrontmatter(noteFrontmatter, mergedBody);
			await this.writeTextFileBestEffort(notePath, nextContent);
		} else {
			const template = await this.readTemplate(templatePath);
			const initialBody = this.renderInitialDailyNoteBody(template, generatedBlock);
			const noteContent = this.renderMarkdownWithFrontmatter(noteFrontmatter, initialBody);
			try {
				await this.vault.create(notePath, noteContent);
			} catch (error) {
				if (!this.isFileAlreadyExistsError(error)) {
					throw error;
				}

				const rawContent = await this.readTextFileBestEffort(notePath, noteContent);
				const parsed = this.splitFrontmatter(rawContent);
				const currentBody = parsed?.body ?? rawContent;
				const mergedBody = this.mergeDailyNoteBody(currentBody, generatedBlock);
				const nextContent = this.renderMarkdownWithFrontmatter(noteFrontmatter, mergedBody);
				await this.writeTextFileBestEffort(notePath, nextContent);
			}
		}

		return notePath;
	}

	async parseDailyNote(date: string): Promise<DailyNoteData> {
		const dailyPath = this.resolveDailyNotePath(date);
		const existing = this.vault.getAbstractFileByPath(dailyPath);

		if (!(existing instanceof TFile)) {
			return {
				date,
				filePath: dailyPath,
				taskReferences: [],
				rawContent: "",
			};
		}

		const rawContent = await this.vault.cachedRead(existing);
		const taskReferences: DailyNoteData["taskReferences"] = [];
		const pattern = /- \[( |x|X)\] \[([^\]]+)\]\(([^)]+)\)/g;
		let match: RegExpExecArray | null = null;

		while ((match = pattern.exec(rawContent)) !== null) {
			const checkedToken = match[1] ?? " ";
			const title = match[2] ?? "";
			const linkPath = match[3] ?? "";
			const checked = checkedToken.toLowerCase() === "x";
			const taskId = this.extractTaskIdFromLinkPath(linkPath);
			if (!taskId) {
				continue;
			}

			taskReferences.push({
				taskId,
				title,
				filePath: this.resolveDailyLinkPath(linkPath, dailyPath),
				checked,
			});
		}

		return {
			date,
			filePath: dailyPath,
			taskReferences,
			rawContent,
		};
	}

	async writeConfigMirror(settings: FridaySettings): Promise<void> {
		const filePath = this.resolveConfigMirrorPath();
		const safeLlm = {
			mode: settings.llm.mode,
			apiUrl: settings.llm.apiUrl,
			// apiKey intentionally excluded — never write secrets to vault files
			model: settings.llm.model,
			temperature: settings.llm.temperature,
			maxTokens: settings.llm.maxTokens,
			enableStreaming: settings.llm.enableStreaming,
		};
		const frontmatter = sortFrontmatterKeys({
			type: "config",
			version: settings.version,
			llm: safeLlm,
			sync: settings.sync,
			user: {
				displayName: settings.user.displayName,
				userId: settings.user.userId,
			},
			dailyNote: settings.dailyNote,
		});
		const content = this.renderMarkdownWithFrontmatter(frontmatter, "");
		await this.upsertTextFile(filePath, content);
	}

	getProjectSlugFromPath(filePath: string): string | null {
		const normalizedPath = normalizePath(filePath);

		for (const root of getRootCandidates(this.fridayRoot)) {
			for (const preset of getPathPresets()) {
				const projectPrefix = normalizePath(`${root}/${preset.projects}/`);
				if (normalizedPath.startsWith(projectPrefix)) {
					const remainder = normalizedPath.slice(projectPrefix.length);
					return remainder.split("/")[0] ?? null;
				}

				const personalPrefix = normalizePath(`${root}/${preset.personal}/`);
				if (normalizedPath.startsWith(personalPrefix)) {
					return PERSONAL_SLUG;
				}
			}
		}

		return null;
	}

	getFridayRoot(): string {
		return this.fridayRoot;
	}

	resolveDailyNotePath(date: string): string {
		const candidates = this.getDailyNotePathCandidates(date);
		const existing = candidates.find((item) => this.vault.getAbstractFileByPath(item) instanceof TFile);
		return (
			existing ??
			normalizePath(
				`${this.fridayRoot}/${PRIMARY_PATHS.dailyNotes}/${getPrimaryDailyFileName(date)}`,
			)
		);
	}

	isManagedTaskPath(filePath: string): boolean {
		return this.isTaskFilePath(filePath);
	}

	async getProjectMembers(projectSlug: string): Promise<ProjectMember[]> {
		if (!projectSlug || projectSlug === PERSONAL_SLUG) {
			return [];
		}

		const projectFolder = this.resolveProjectFolder(projectSlug);
		if (!projectFolder) {
			return [];
		}

		const membersFromMembersFile = await this.readMembersFromFiles(
			projectFolder,
			(preset) => preset.projectMembersFile,
		);
		if (membersFromMembersFile.length > 0) {
			return membersFromMembersFile;
		}

		return this.readMembersFromFiles(projectFolder, (preset) => preset.projectMetaFile);
	}

	async setProjectMembers(projectSlug: string, members: ProjectMember[]): Promise<void> {
		if (!projectSlug || projectSlug === PERSONAL_SLUG) {
			throw new Error("个人任务不支持项目成员管理。");
		}

		const projectFolder = this.resolveProjectFolder(projectSlug);
		if (!projectFolder) {
			throw new Error(`未找到项目目录：${projectSlug}`);
		}

		const filePath = this.resolveMembersFilePath(projectFolder);
		const normalizedMembers = this.normalizeMembers(members);
		const frontmatter = {
			type: "project_members",
			projectId: projectSlug,
			updatedAt: new Date().toISOString(),
			members: normalizedMembers,
		};
		const body =
			normalizedMembers.length === 0
				? "## 项目成员\n\n（暂无成员）\n"
				: [
						"## 项目成员",
						"",
						...normalizedMembers.map(
							(item) => `- ${item.userId}（${getRoleLabel(item.role)}）`,
						),
						"",
					].join("\n");
		const content = this.renderMarkdownWithFrontmatter(frontmatter, body);
		await this.upsertTextFile(filePath, content);
	}

	private async ensureFolderRecursive(pathValue: string): Promise<void> {
		const normalizedPath = normalizePath(pathValue);
		if (this.vault.getAbstractFileByPath(normalizedPath)) {
			return;
		}

		const segments = normalizedPath.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.vault.getAbstractFileByPath(current)) {
				try {
					await this.vault.createFolder(current);
				} catch (error) {
					if (this.isFolderAlreadyExistsError(error)) {
						continue;
					}

					const existing = this.vault.getAbstractFileByPath(current);
					if (existing instanceof TFolder) {
						continue;
					}

					throw error;
				}
			}
		}
	}

	private async upsertTextFile(filePath: string, content: string): Promise<void> {
		const normalized = normalizePath(filePath);
		const existing = this.getFileByPathRelaxed(normalized);
		if (existing) {
			await this.vault.modify(existing, content);
			return;
		}

		try {
			await this.vault.create(normalized, content);
			return;
		} catch (error) {
			if (!this.isFileAlreadyExistsError(error)) {
				throw error;
			}
		}

		await this.writeTextFileBestEffort(normalized, content);
	}

	private getFileByPathRelaxed(filePath: string): TFile | null {
		const normalized = normalizePath(filePath);
		const directHit = this.vault.getAbstractFileByPath(normalized);
		if (directHit instanceof TFile) {
			return directHit;
		}

		const normalizedLower = normalized.toLowerCase();
		return (
			this.vault
				.getFiles()
				.find((item) => normalizePath(item.path).toLowerCase() === normalizedLower) ?? null
		);
	}

	private async readTextFileBestEffort(filePath: string, fallback = ""): Promise<string> {
		const normalized = normalizePath(filePath);
		const existing = this.getFileByPathRelaxed(normalized);
		if (existing) {
			return this.vault.cachedRead(existing);
		}

		try {
			return await this.vault.adapter.read(normalized);
		} catch {
			return fallback;
		}
	}

	private async writeTextFileBestEffort(filePath: string, content: string): Promise<void> {
		const normalized = normalizePath(filePath);
		const existing = this.getFileByPathRelaxed(normalized);
		if (existing) {
			await this.vault.modify(existing, content);
			return;
		}

		const parentPath = normalizePath(path.posix.dirname(normalized));
		if (parentPath && parentPath !== "." && !this.vault.getAbstractFileByPath(parentPath)) {
			await this.ensureFolderRecursive(parentPath);
		}

		await this.vault.adapter.write(normalized, content);
	}

	private isFolderAlreadyExistsError(error: unknown): boolean {
		const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
		return message.includes("folder already exists") || message.includes("already exists");
	}

	private isFileAlreadyExistsError(error: unknown): boolean {
		const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
		return message.includes("file already exists") || message.includes("already exists");
	}

	private getTaskFolderByProject(projectSlug: string): string {
		if (projectSlug === PERSONAL_SLUG) {
			return `${this.fridayRoot}/${PRIMARY_PATHS.personal}/${PRIMARY_PATHS.tasks}`;
		}
		return `${this.fridayRoot}/${PRIMARY_PATHS.projects}/${projectSlug}/${PRIMARY_PATHS.tasks}`;
	}

	private resolveProjectFolder(projectSlug: string): string | null {
		for (const root of getRootCandidates(this.fridayRoot)) {
			for (const preset of getPathPresets()) {
				const candidate = normalizePath(`${root}/${preset.projects}/${projectSlug}`);
				if (this.vault.getAbstractFileByPath(candidate)) {
					return candidate;
				}
			}
		}

		const fallback = normalizePath(
			`${this.fridayRoot}/${PRIMARY_PATHS.projects}/${projectSlug}`,
		);
		return this.vault.getAbstractFileByPath(fallback) ? fallback : null;
	}

	private resolveMembersFilePath(projectFolder: string): string {
		for (const preset of getPathPresets()) {
			const candidatePath = normalizePath(`${projectFolder}/${preset.projectMembersFile}`);
			const abstractFile = this.vault.getAbstractFileByPath(candidatePath);
			if (abstractFile instanceof TFile) {
				return candidatePath;
			}
		}

		return normalizePath(`${projectFolder}/${PRIMARY_PATHS.projectMembersFile}`);
	}

	private getAllTaskFiles(): TFile[] {
		return this.vault.getMarkdownFiles().filter((file) => this.isTaskFilePath(file.path));
	}

	private isTaskFilePath(pathValue: string): boolean {
		const normalizedPath = normalizePath(pathValue);
		if (!normalizedPath.endsWith(".md")) {
			return false;
		}

		for (const root of getRootCandidates(this.fridayRoot)) {
			for (const preset of getPathPresets()) {
				const projectPrefix = normalizePath(`${root}/${preset.projects}/`);
				const personalPrefix = normalizePath(
					`${root}/${preset.personal}/${preset.tasks}/`,
				);
				if (
					normalizedPath.startsWith(projectPrefix) &&
					normalizedPath.includes(`/${preset.tasks}/`)
				) {
					return true;
				}

				if (normalizedPath.startsWith(personalPrefix)) {
					return true;
				}
			}
		}

		return false;
	}

	private async readTasksFromFiles(files: TFile[]): Promise<TaskData[]> {
		const tasks: TaskData[] = [];
		for (const file of files) {
			const task = await this.readTaskFromFile(file);
			if (task) {
				tasks.push(task);
			}
		}
		return tasks;
	}

	private async readTaskFromFile(file: TFile): Promise<TaskData | null> {
		const content = await this.vault.cachedRead(file);
		const parsed = this.splitFrontmatter(content);
		if (!parsed) {
			return null;
		}

		try {
			const data = parseYaml(parsed.frontmatter) as Partial<TaskFrontmatter>;
			if (!data || data.type !== "task" || !data.taskId || !data.title) {
				return null;
			}

			return {
				type: "task",
				taskId: String(data.taskId),
				projectId: String(
					data.projectId ?? this.getProjectSlugFromPath(file.path) ?? PERSONAL_SLUG,
				),
				parentTaskId: String(data.parentTaskId ?? ""),
				title: String(data.title),
				status: (data.status as TaskData["status"]) ?? "todo",
				priority: (data.priority as TaskData["priority"]) ?? "medium",
				dueDate: String(data.dueDate ?? ""),
				tags: Array.isArray(data.tags) ? data.tags.map((tag) => String(tag)) : [],
				assignee: String(data.assignee ?? ""),
				aiGenerated: Boolean(data.aiGenerated),
				description: String(data.description ?? ""),
				createdAt: String(data.createdAt ?? ""),
				updatedAt: String(data.updatedAt ?? ""),
				completedAt: String(data.completedAt ?? ""),
				filePath: file.path,
				body: parsed.body,
			};
		} catch (error) {
			console.warn("[Friday] Failed to parse task frontmatter:", file.path, error);
			return null;
		}
	}

	private splitFrontmatter(content: string): { frontmatter: string; body: string } | null {
		const matched = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
		if (!matched) {
			return null;
		}

		const frontmatter = matched[1] ?? "";
		const body = content.slice(matched[0].length);
		return { frontmatter, body };
	}

	private renderMarkdownWithFrontmatter(
		frontmatter: Record<string, unknown>,
		body: string,
	): string {
		const yaml = stringifyYaml(sortFrontmatterKeys(frontmatter)).trimEnd();
		if (!body) {
			return `---\n${yaml}\n---\n`;
		}
		return `---\n${yaml}\n---\n\n${body}`;
	}

	private renderDefaultTaskBody(now: Date): string {
		return `${DEFAULT_TASK_BODY}
### ${formatDate(now)}
（手动记录）
`;
	}

	private compareDailyTaskPriority(left: TaskData, right: TaskData): number {
		const priorityGap = PRIORITY_ORDER[right.priority] - PRIORITY_ORDER[left.priority];
		if (priorityGap !== 0) {
			return priorityGap;
		}

		if (!left.dueDate && !right.dueDate) {
			return 0;
		}

		if (!left.dueDate) {
			return 1;
		}

		if (!right.dueDate) {
			return -1;
		}

		return left.dueDate.localeCompare(right.dueDate);
	}

	private matchTaskFilter(task: TaskData, filter?: TaskFilter): boolean {
		if (!filter) {
			return true;
		}

		if (filter.status && !filter.status.includes(task.status)) {
			return false;
		}

		if (filter.priority && !filter.priority.includes(task.priority)) {
			return false;
		}

		if (filter.assignee && filter.assignee !== task.assignee) {
			return false;
		}

		if (filter.dueBefore && task.dueDate && task.dueDate > filter.dueBefore) {
			return false;
		}

		if (filter.dueAfter && task.dueDate && task.dueDate < filter.dueAfter) {
			return false;
		}

		return true;
	}

	private async findTaskFileById(taskId: string): Promise<TFile | null> {
		for (const file of this.getAllTaskFiles()) {
			if (file.basename === taskId) {
				return file;
			}

			const task = await this.readTaskFromFile(file);
			if (task?.taskId === taskId) {
				return file;
			}
		}
		return null;
	}

	private renderGeneratedDailyBlock(tasks: TaskData[], notePath: string): string {
		const groups: Record<TaskPriority, TaskData[]> = {
			urgent: [],
			high: [],
			medium: [],
			low: [],
		};

		for (const task of tasks) {
			groups[task.priority].push(task);
		}

		const block = [
			"## 今日任务",
			"",
			"### 紧急",
			this.renderDailyTaskList(groups.urgent, notePath),
			"",
			"### 高优先级",
			this.renderDailyTaskList(groups.high, notePath),
			"",
			"### 中优先级",
			this.renderDailyTaskList(groups.medium, notePath),
			"",
			"### 低优先级",
			this.renderDailyTaskList(groups.low, notePath),
			"",
			"### 今日已完成",
			"（完成的任务会移动到这里）",
		].join("\n");

		return `${DAILY_BLOCK_START}\n${block}\n${DAILY_BLOCK_END}`;
	}

	private renderInitialDailyNoteBody(template: string, generatedBlock: string): string {
		if (!template) {
			return generatedBlock;
		}

		if (template.includes("{{today_tasks}}")) {
			return template.replace(/\{\{today_tasks\}\}/g, generatedBlock);
		}

		return `${template.trim()}\n\n${generatedBlock}`;
	}

	private mergeDailyNoteBody(existingBody: string, generatedBlock: string): string {
		const startIndex = existingBody.indexOf(DAILY_BLOCK_START);
		const endIndex = existingBody.indexOf(DAILY_BLOCK_END);
		if (startIndex >= 0 && endIndex > startIndex) {
			const tail = endIndex + DAILY_BLOCK_END.length;
			return `${existingBody.slice(0, startIndex)}${generatedBlock}${existingBody.slice(tail)}`.trim();
		}

		const legacySectionPattern = /## (?:今日任务|Today Tasks)[\s\S]*?(?=\n##\s|\s*$)/m;
		if (legacySectionPattern.test(existingBody)) {
			return existingBody.replace(legacySectionPattern, generatedBlock).trim();
		}

		const trimmed = existingBody.trim();
		if (!trimmed) {
			return generatedBlock;
		}

		return `${trimmed}\n\n${generatedBlock}`;
	}

	private renderDailyTaskList(tasks: TaskData[], notePath: string): string {
		if (tasks.length === 0) {
			return "（无）";
		}

		return tasks
			.map((task) => {
				const relativePath = this.buildRelativeLink(notePath, task.filePath);
				const due = task.dueDate ? `截止 ${task.dueDate}` : "无截止日期";
				return `- [ ] [${task.title}](${relativePath}) - ${due} \`${task.projectId}\``;
			})
			.join("\n");
	}

	private buildRelativeLink(fromFilePath: string, toFilePath: string): string {
		const fromDir = path.posix.dirname(normalizePath(fromFilePath));
		const toPath = normalizePath(toFilePath);
		const relative = path.posix.relative(fromDir, toPath);
		return normalizePath(relative || path.posix.basename(toPath));
	}

	private async readTemplate(templatePath: string): Promise<string> {
		if (!templatePath.trim()) {
			return "";
		}

		const normalizedPath = normalizePath(templatePath.trim());
		const file = this.vault.getAbstractFileByPath(normalizedPath);
		if (!(file instanceof TFile)) {
			return "";
		}

		return this.vault.cachedRead(file);
	}

	private async readMembersFromFiles(
		projectFolder: string,
		fileSelector: (preset: PathPreset) => string,
	): Promise<ProjectMember[]> {
		for (const preset of getPathPresets()) {
			const filePath = normalizePath(`${projectFolder}/${fileSelector(preset)}`);
			const abstractFile = this.vault.getAbstractFileByPath(filePath);
			if (!(abstractFile instanceof TFile)) {
				continue;
			}

			const content = await this.vault.cachedRead(abstractFile);
			const parsed = this.splitFrontmatter(content);
			if (!parsed) {
				continue;
			}

			try {
				const frontmatter = parseYaml(parsed.frontmatter) as {
					members?: unknown;
				};
				return this.normalizeMembers(frontmatter.members);
			} catch (error) {
				console.warn("[Friday] Failed to parse project members:", filePath, error);
			}
		}

		return [];
	}

	private normalizeMembers(value: unknown): ProjectMember[] {
		if (!Array.isArray(value)) {
			return [];
		}

		const result: ProjectMember[] = [];
		for (const item of value) {
			const record = item as { userId?: unknown; role?: unknown };
			const userId = typeof record.userId === "string" ? record.userId.trim() : "";
			const role = typeof record.role === "string" ? record.role.trim() : "";
			if (!userId || !role || !["admin", "editor", "viewer"].includes(role)) {
				continue;
			}

			result.push({
				userId,
				role: role as ProjectMember["role"],
			});
		}

		return result;
	}

	private resolveDailyLinkPath(linkPath: string, dailyNotePath: string): string {
		const normalized = normalizePath(linkPath);
		if (normalized.startsWith("../") || normalized.startsWith("./")) {
			const baseDir = path.posix.dirname(normalizePath(dailyNotePath));
			return normalizePath(path.posix.join(baseDir, normalized));
		}
		return normalized;
	}

	private getDailyNotePathCandidates(date: string): string[] {
		const candidates: string[] = [];
		for (const root of getRootCandidates(this.fridayRoot)) {
			for (const preset of getPathPresets()) {
				for (const filename of getDailyFileNameCandidates(date)) {
					candidates.push(
						normalizePath(`${root}/${preset.dailyNotes}/${filename}`),
					);
				}
			}
		}
		return [...new Set(candidates)];
	}

	private resolveConfigMirrorPath(): string {
		const candidates: string[] = [];
		for (const root of getRootCandidates(this.fridayRoot)) {
			for (const preset of getPathPresets()) {
				candidates.push(normalizePath(`${root}/${preset.configFile}`));
			}
		}

		const existing = candidates.find((item) => this.vault.getAbstractFileByPath(item) instanceof TFile);
		return existing ?? normalizePath(`${this.fridayRoot}/${PRIMARY_PATHS.configFile}`);
	}

	private extractTaskIdFromLinkPath(linkPath: string): string | null {
		const filename = normalizePath(linkPath).split("/").pop() ?? "";
		if (!filename.toLowerCase().endsWith(".md")) {
			return null;
		}

		const taskId = filename.slice(0, -3);
		if (!/^[^/-]+-\d{8}-[0-9a-f]{6}$/i.test(taskId)) {
			return null;
		}

		return taskId;
	}
}
