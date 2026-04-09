import { promises as fs } from "fs";
import path from "path";
import { App, Modal, Notice, Setting, TFolder, normalizePath } from "obsidian";
import { LEGACY_PATHS, PRIMARY_PATHS } from "../constants/paths";
import { SyncService } from "../services/SyncService";
import { ProjectEntry, ProjectGroupEntry } from "../types/project";
import { getVaultBasePath } from "../utils/vaultPath";

type TranslateFn = (
	key: string,
	params?: Record<string, string | number | boolean | null | undefined>,
) => string;

interface RegisterProjectModalOptions {
	initial?: ProjectEntry;
	existingSlugs: Set<string>;
	projectGroups: ProjectGroupEntry[];
	fridayRoot: string;
	currentUserId: string;
	syncService: SyncService;
	onSubmit: (entry: ProjectEntry) => Promise<void>;
	t?: TranslateFn;
}

export class RegisterProjectModal extends Modal {
	private groupId = "default-group";
	private slug = "";
	private projectRootPath = "";
	private projectRootPathTouched = false;
	private localPath = "";
	private gitRemote = "";
	private gitUsername = "";
	private gitUserEmail = "";
	private gitToken = "";
	private autoSync = true;

	constructor(app: App, private readonly options: RegisterProjectModalOptions) {
		super(app);
		if (options.initial) {
			this.groupId = options.initial.groupId || "default-group";
			this.slug = options.initial.slug;
			this.projectRootPath = normalizePath(
				options.initial.projectRootPath || this.buildDefaultProjectRootPath(options.initial.slug),
			);
			this.projectRootPathTouched = true;
			this.localPath = options.initial.localPath ?? "";
			this.gitRemote = options.initial.gitRemote;
			this.gitUsername = options.initial.gitUsername;
			this.gitUserEmail = options.initial.gitUserEmail ?? "";
			this.gitToken = options.initial.gitToken;
			this.autoSync = options.initial.autoSync;
		} else if (options.projectGroups.length > 0) {
			const firstGroupId = options.projectGroups[0]?.id?.trim();
			if (firstGroupId) {
				this.groupId = firstGroupId;
			}
		}
		if (!this.projectRootPath) {
			this.projectRootPath = this.buildDefaultProjectRootPath(this.slug);
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", {
			text: this.options.initial
				? this.t("modal.project.title.edit", "编辑项目")
				: this.t("modal.project.title.create", "注册项目"),
		});

		new Setting(contentEl)
			.setName(this.t("modal.project.field.group", "项目组"))
			.setDesc(this.t("modal.project.desc.group", "项目归属分组，用于管理与切换。"))
			.addDropdown((dropdown) => {
				const groups = this.options.projectGroups.length
					? this.options.projectGroups
					: [
							{
								id: "default-group",
								name: "Default Group",
								description: "",
								projectSlugs: [],
								createdAt: "",
								updatedAt: "",
							},
					  ];
				if (this.groupId && !groups.some((item) => item.id === this.groupId)) {
					groups.push({
						id: this.groupId,
						name: this.groupId,
						description: "",
						projectSlugs: [],
						createdAt: "",
						updatedAt: "",
					});
				}
				for (const group of groups) {
					dropdown.addOption(group.id, `${group.name} (${group.id})`);
				}
				const fallback = groups[0]?.id ?? "default-group";
				dropdown.setValue(this.groupId || fallback);
				dropdown.onChange((value) => {
					this.groupId = value;
				});
			});

		new Setting(contentEl)
			.setName(this.t("modal.project.field.slug", "项目标识（Slug）"))
			.setDesc(this.t("modal.project.desc.slug", "仅支持小写字母、数字和连字符"))
			.addText((text) =>
				text
					.setPlaceholder("payment-refactor")
					.setValue(this.slug)
					.onChange((value) => {
						const nextSlug = value.trim().toLowerCase();
						const previousDefaultRoot = this.buildDefaultProjectRootPath(this.slug);
						this.slug = nextSlug;
						const nextDefaultRoot = this.buildDefaultProjectRootPath(this.slug);
						if (!this.projectRootPathTouched || this.projectRootPath === previousDefaultRoot) {
							this.projectRootPath = nextDefaultRoot;
						}
					}),
			);

		new Setting(contentEl)
			.setName(this.t("modal.project.field.projectRoot", "项目根目录（Vault 内）"))
			.setDesc(
				this.t(
					"modal.project.desc.projectRoot",
					"用于定义项目边界。填写 Vault 相对路径，如 F.R.I.D.A.Y/项目/my-project",
				),
			)
			.addText((text) =>
				text
					.setPlaceholder(`${this.options.fridayRoot}/${PRIMARY_PATHS.projects}/my-project`)
					.setValue(this.projectRootPath)
					.onChange((value) => {
						this.projectRootPathTouched = true;
						this.projectRootPath = normalizePath(value.trim());
					}),
			);

		new Setting(contentEl)
			.setName(this.t("modal.project.field.vaultFolder", "从 Vault 选择文件夹"))
			.setDesc(this.t("modal.project.desc.vaultFolder", "直接选择已有 Vault 文件夹作为项目根目录。"))
			.addDropdown((dropdown) => {
				const options = this.listVaultFolderOptions();
				dropdown.addOption("", this.t("modal.project.option.vaultFolder.placeholder", "请选择文件夹..."));
				for (const folderPath of options) {
					dropdown.addOption(folderPath, folderPath);
				}
				if (this.projectRootPath && options.includes(this.projectRootPath)) {
					dropdown.setValue(this.projectRootPath);
				}
				dropdown.onChange((value) => {
					if (!value) {
						return;
					}
					this.projectRootPathTouched = true;
					this.projectRootPath = normalizePath(value);
				});
			});

		new Setting(contentEl)
			.setName(this.t("modal.project.field.localPath", "本地路径"))
			.setDesc(
				this.t(
					"modal.project.desc.localPathWithDefault",
					"可填写已有项目目录；留空则使用 <vault>/{root}/{projects}/<slug>",
					{
						root: this.options.fridayRoot,
						projects: PRIMARY_PATHS.projects,
					},
				),
			)
			.addText((text) =>
				text
					.setPlaceholder("D:\\work\\payment-refactor")
					.setValue(this.localPath)
					.onChange((value) => {
						this.localPath = value.trim();
					}),
			);

		new Setting(contentEl)
			.setName(this.t("modal.project.field.gitRemote", "Git 远程地址"))
			.setDesc(this.t("modal.project.desc.gitRemote", "可选，后续可在编辑项目时补充"))
			.addText((text) =>
				text
					.setPlaceholder("https://gitee.com/team/payment-refactor.git")
					.setValue(this.gitRemote)
					.onChange((value) => {
						this.gitRemote = value.trim();
					}),
			);

		new Setting(contentEl)
			.setName(this.t("modal.project.field.gitUser", "Git 用户名"))
			.setDesc(this.t("modal.project.desc.gitUser", "可选；用于认证，也可作为提交用户名默认值"))
			.addText((text) =>
				text
					.setPlaceholder("username")
					.setValue(this.gitUsername)
					.onChange((value) => {
						this.gitUsername = value.trim();
					}),
			);

		new Setting(contentEl)
			.setName(this.t("modal.project.field.gitEmail", "Git 提交邮箱"))
			.setDesc(this.t("modal.project.desc.gitEmail", "可选；当全局 user.email 缺失时会用此值自动写入"))
			.addText((text) =>
				text
					.setPlaceholder("you@example.com")
					.setValue(this.gitUserEmail)
					.onChange((value) => {
						this.gitUserEmail = value.trim();
					}),
			);

		new Setting(contentEl)
			.setName(this.t("modal.project.field.gitToken", "Git 令牌"))
			.setDesc(this.t("modal.project.desc.gitToken", "可选，与用户名配套使用"))
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(this.gitToken).onChange((value) => {
					this.gitToken = value.trim();
				});
			});

		new Setting(contentEl)
			.setName(this.t("modal.project.field.autoSync", "自动同步"))
			.addToggle((toggle) =>
				toggle.setValue(this.autoSync).onChange((value) => {
					this.autoSync = value;
				}),
			);

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(
						this.options.initial
							? this.t("modal.project.button.save", "保存")
							: this.t("modal.project.button.register", "注册"),
					)
					.setCta()
					.onClick(async () => {
						await this.submit();
					}),
			)
			.addButton((button) =>
				button.setButtonText(this.t("modal.project.button.cancel", "取消")).onClick(() => {
					this.close();
				}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		try {
			this.validateFields();
			const resolvedPath = await this.resolveProjectPath();
			await this.ensureProjectScaffold(resolvedPath);
			await this.ensureVaultLinkIfNeeded(resolvedPath);

			const hasRemote = Boolean(this.gitRemote.trim());
			const effectiveAutoSync = hasRemote ? this.autoSync : false;
			if (!hasRemote && this.autoSync) {
				new Notice(this.t("modal.project.warn.disableAutoSync", "未配置 Git 远程地址，已自动关闭“自动同步”。"), 4000);
			}

			const entry: ProjectEntry = {
				groupId: this.groupId,
				slug: this.slug,
				projectRootPath: this.resolveVaultProjectRootPath(),
				localPath: this.localPath.trim(),
				gitRemote: this.gitRemote,
				gitUsername: this.gitUsername,
				gitUserEmail: this.gitUserEmail,
				gitToken: this.gitToken,
				autoSync: effectiveAutoSync,
				lastSyncAt: this.options.initial?.lastSyncAt ?? "",
			};

			await this.options.syncService.prepareRepository(entry);
			await this.options.onSubmit(entry);
			this.close();
		} catch (error) {
			new Notice(String(error), 6000);
		}
	}

	private validateFields(): void {
		if (!this.slug || !/^[a-z0-9-]+$/.test(this.slug)) {
			throw new Error(
				this.t(
					"modal.project.error.invalidSlug",
					"项目标识不合法：仅支持小写字母、数字和连字符。",
				),
			);
		}

		const isEditingSameSlug = this.options.initial && this.options.initial.slug === this.slug;
		if (this.options.existingSlugs.has(this.slug) && !isEditingSameSlug) {
			throw new Error(this.t("modal.project.error.slugExists", "项目已存在：{slug}", { slug: this.slug }));
		}

		const username = this.gitUsername.trim();
		const token = this.gitToken.trim();
		if ((username && !token) || (!username && token)) {
			throw new Error(
				this.t(
					"modal.project.error.userTokenPair",
					"Git 用户名和令牌需同时填写，或同时留空。",
				),
			);
		}

		this.resolveVaultProjectRootPath();
	}

	private async resolveProjectPath(): Promise<string> {
		const expectedPath = this.getVaultProjectAbsolutePath();
		if (!this.localPath) {
			await fs.mkdir(expectedPath, { recursive: true });
			return expectedPath;
		}

		const target = path.normalize(this.localPath);
		const stat = await fs.stat(target).catch(() => null);
		if (!stat?.isDirectory()) {
			throw new Error(this.t("modal.project.error.localPathMissing", "本地路径不存在：{path}", { path: target }));
		}

		return target;
	}

	private async ensureProjectScaffold(localProjectPath: string): Promise<void> {
		await fs.mkdir(path.join(localProjectPath, "raw"), { recursive: true });
		await fs.mkdir(path.join(localProjectPath, "wiki"), { recursive: true });
		await fs.mkdir(path.join(localProjectPath, ".friday"), { recursive: true });

		const metaPath = await this.resolveProjectMetaPath(localProjectPath);
		const existingMeta = await fs.stat(metaPath).catch(() => null);
		if (!existingMeta) {
			const now = new Date().toISOString();
			const content = `---
color: "#6366F1"
createdAt: ${now}
description: ""
endDate: ""
members:
  - role: admin
    userId: "${this.slug}"
name: "${this.slug}"
owner: "${this.options.currentUserId || this.slug}"
priority: medium
projectId: "${this.slug}"
startDate: ""
status: active
tags: []
type: project
updatedAt: ${now}
---

## 项目背景

`;
			await fs.writeFile(metaPath, content, "utf8");
		}

		const membersPath = await this.resolveProjectMembersPath(localProjectPath);
		const existingMembers = await fs.stat(membersPath).catch(() => null);
		if (!existingMembers) {
			const memberId = this.options.currentUserId || this.slug;
			const content = `---
type: project_members
projectId: "${this.slug}"
members:
  - userId: "${memberId}"
    role: admin
---

## 项目成员

- ${memberId} (admin)`;
			await fs.writeFile(membersPath, content, "utf8");
		}
	}

	private buildDefaultProjectRootPath(slug: string): string {
		const safeSlug = slug.trim().toLowerCase() || "new-project";
		return normalizePath(`${this.options.fridayRoot}/${PRIMARY_PATHS.projects}/${safeSlug}`);
	}

	private resolveVaultProjectRootPath(): string {
		const raw = (this.projectRootPath || this.buildDefaultProjectRootPath(this.slug)).trim();
		if (!raw) {
			throw new Error(this.t("modal.project.error.projectRootEmpty", "项目根目录不能为空。"));
		}
		const normalized = normalizePath(raw);
		if (!normalized || normalized === "." || normalized.startsWith("/")) {
			throw new Error(
				this.t(
					"modal.project.error.projectRootInvalid",
					"项目根目录必须是 Vault 相对路径，例如 F.R.I.D.A.Y/项目/my-project。",
				),
			);
		}
		return normalized;
	}

	private getVaultProjectAbsolutePath(): string {
		const vaultBasePath = getVaultBasePath(this.app);
		const projectRootPath = this.resolveVaultProjectRootPath();
		return path.join(vaultBasePath, ...projectRootPath.split("/"));
	}

	private async ensureVaultLinkIfNeeded(localProjectPath: string): Promise<void> {
		const expectedPath = this.getVaultProjectAbsolutePath();
		const localNormalized = path.normalize(localProjectPath);
		const expectedNormalized = path.normalize(expectedPath);

		if (localNormalized === expectedNormalized) {
			return;
		}

		await fs.mkdir(path.dirname(expectedNormalized), { recursive: true });
		const stat = await fs.lstat(expectedNormalized).catch(() => null);
		if (stat) {
			const linkedTarget = await fs.readlink(expectedNormalized).catch(() => "");
			if (linkedTarget && path.normalize(linkedTarget) === localNormalized) {
				return;
			}

			if (stat.isSymbolicLink()) {
				throw new Error(
					this.t("modal.project.error.linkExistsOther", "项目链接已存在且指向其他位置：{path}", {
						path: expectedNormalized,
					}),
				);
			}

			throw new Error(
				this.t("modal.project.error.vaultPathExists", "Vault 中已存在同名项目路径：{path}", {
					path: expectedNormalized,
				}),
			);
		}

		const isWindows = process.platform === "win32";
		if (isWindows) {
			const targetForLink = localNormalized.endsWith("\\") ? localNormalized : `${localNormalized}\\`;
			await fs.symlink(targetForLink, expectedNormalized, "junction");
		} else {
			await fs.symlink(localNormalized, expectedNormalized, "dir");
		}
	}

	private async resolveProjectMetaPath(localProjectPath: string): Promise<string> {
		const candidates = [PRIMARY_PATHS.projectMetaFile, LEGACY_PATHS.projectMetaFile];
		for (const filename of candidates) {
			const candidatePath = path.join(localProjectPath, filename);
			const stat = await fs.stat(candidatePath).catch(() => null);
			if (stat?.isFile()) {
				return candidatePath;
			}
		}

		return path.join(localProjectPath, PRIMARY_PATHS.projectMetaFile);
	}

	private async resolveProjectMembersPath(localProjectPath: string): Promise<string> {
		const candidates = [PRIMARY_PATHS.projectMembersFile, LEGACY_PATHS.projectMembersFile];
		for (const filename of candidates) {
			const candidatePath = path.join(localProjectPath, filename);
			const stat = await fs.stat(candidatePath).catch(() => null);
			if (stat?.isFile()) {
				return candidatePath;
			}
		}

		return path.join(localProjectPath, PRIMARY_PATHS.projectMembersFile);
	}

	private listVaultFolderOptions(): string[] {
		const folders = this.app.vault
			.getAllLoadedFiles()
			.filter((item): item is TFolder => item instanceof TFolder)
			.map((item) => normalizePath(item.path))
			.filter((item) => item.length > 0 && !item.startsWith(".obsidian"));
		const unique = [...new Set(folders)];
		const normalizedCurrent = normalizePath(this.projectRootPath);
		if (normalizedCurrent && !unique.includes(normalizedCurrent)) {
			unique.push(normalizedCurrent);
		}
		return unique.sort((a, b) => a.localeCompare(b, "zh-CN"));
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


