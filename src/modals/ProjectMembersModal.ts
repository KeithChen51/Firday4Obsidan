import { App, Modal, Notice, Setting } from "obsidian";
import { DataService } from "../services/DataService";
import { ProjectMember } from "../types/project";
import { getRoleLabel } from "../utils/labels";

type TranslateFn = (
	key: string,
	params?: Record<string, string | number | boolean | null | undefined>,
) => string;

interface ProjectMembersModalOptions {
	projectSlug: string;
	dataService: DataService;
	t?: TranslateFn;
	onSaved?: () => Promise<void> | void;
}

export class ProjectMembersModal extends Modal {
	private members: ProjectMember[] = [];
	private newUserId = "";
	private newRole: ProjectMember["role"] = "editor";

	constructor(app: App, private readonly options: ProjectMembersModalOptions) {
		super(app);
	}

	async onOpen(): Promise<void> {
		await this.reloadMembers();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async reloadMembers(): Promise<void> {
		this.members = await this.options.dataService.getProjectMembers(this.options.projectSlug);
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", {
			text: this.t("modal.member.title", "成员管理：{slug}", { slug: this.options.projectSlug }),
		});
		contentEl.createEl("p", {
			text: this.t(
				"modal.member.desc",
				"成员信息会保存到项目成员文档，新建任务时可直接关联负责人。",
			),
		});

		const listContainer = contentEl.createDiv();
		if (this.members.length === 0) {
			listContainer.createEl("p", { text: this.t("modal.member.empty", "暂无成员，请先添加。") });
		} else {
			for (const member of this.members) {
				new Setting(listContainer)
					.setName(member.userId)
					.setDesc(getRoleLabel(member.role, this.options.t))
					.addDropdown((dropdown) =>
						dropdown
							.addOption("admin", this.t("modal.member.role.admin", "管理员"))
							.addOption("editor", this.t("modal.member.role.editor", "编辑者"))
							.addOption("viewer", this.t("modal.member.role.viewer", "查看者"))
							.setValue(member.role)
							.onChange((value) => {
								member.role = value as ProjectMember["role"];
								this.render();
							}),
					)
					.addButton((button) =>
						button.setButtonText(this.t("modal.member.button.remove", "移除")).onClick(() => {
							this.members = this.members.filter((item) => item.userId !== member.userId);
							this.render();
						}),
					);
			}
		}

		contentEl.createEl("h3", { text: this.t("modal.member.section.new", "新增成员") });
		new Setting(contentEl)
			.setName(this.t("modal.member.field.userId", "成员 ID"))
			.addText((text) =>
				text
					.setPlaceholder("alice")
					.setValue(this.newUserId)
					.onChange((value) => {
						this.newUserId = value.trim();
					}),
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("admin", this.t("modal.member.role.admin", "管理员"))
					.addOption("editor", this.t("modal.member.role.editor", "编辑者"))
					.addOption("viewer", this.t("modal.member.role.viewer", "查看者"))
					.setValue(this.newRole)
					.onChange((value) => {
						this.newRole = value as ProjectMember["role"];
					}),
			)
			.addButton((button) =>
				button.setButtonText(this.t("modal.member.button.add", "添加")).onClick(() => {
					this.addMember();
				}),
			);

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(this.t("modal.member.button.save", "保存"))
					.setCta()
					.onClick(async () => {
						await this.saveMembers();
					}),
			)
			.addButton((button) =>
				button.setButtonText(this.t("modal.member.button.cancel", "取消")).onClick(() => {
					this.close();
				}),
			);
	}

	private addMember(): void {
		if (!this.newUserId) {
			new Notice(this.t("modal.member.error.emptyUser", "成员 ID 不能为空"), 3000);
			return;
		}

		if (this.members.some((item) => item.userId === this.newUserId)) {
			new Notice(
				this.t("modal.member.error.exists", "成员已存在：{userId}", { userId: this.newUserId }),
				3000,
			);
			return;
		}

		this.members.push({
			userId: this.newUserId,
			role: this.newRole,
		});
		this.newUserId = "";
		this.newRole = "editor";
		this.render();
	}

	private async saveMembers(): Promise<void> {
		await this.options.dataService.setProjectMembers(this.options.projectSlug, this.members);
		new Notice(
			this.t("modal.member.saved", "成员已保存：{slug}", { slug: this.options.projectSlug }),
			3000,
		);
		await this.options.onSaved?.();
		this.close();
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
