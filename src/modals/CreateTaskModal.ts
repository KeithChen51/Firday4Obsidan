import { App, DropdownComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
import { TaskCreateInput, TaskPriority } from "../types/task";
import { getRoleLabel } from "../utils/labels";

type TranslateFn = (
	key: string,
	params?: Record<string, string | number | boolean | null | undefined>,
) => string;

interface ProjectOption {
	value: string;
	label: string;
}

interface MemberOption {
	userId: string;
	role: string;
}

interface CreateTaskModalOptions {
	projects: ProjectOption[];
	projectMembers: Record<string, MemberOption[]>;
	defaultProject: string;
	defaultAssignee: string;
	onSubmit: (payload: TaskCreateInput) => Promise<void>;
	t?: TranslateFn;
}

export class CreateTaskModal extends Modal {
	private title = "";
	private projectId: string;
	private priority: TaskPriority = "medium";
	private dueDate = "";
	private assignee: string;
	private tags = "";
	private description = "";
	private memberDropdown: DropdownComponent | null = null;
	private assigneeText: TextComponent | null = null;

	constructor(app: App, private readonly options: CreateTaskModalOptions) {
		super(app);
		this.projectId = options.defaultProject;
		this.assignee = options.defaultAssignee;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.t("modal.task.title", "新建任务") });

		new Setting(contentEl)
			.setName(this.t("modal.task.field.title", "标题"))
			.setDesc(this.t("modal.task.field.required", "必填"))
			.addText((text) =>
				text
					.setPlaceholder(this.t("modal.task.placeholder.title", "任务标题"))
					.onChange((value) => (this.title = value)),
			);

		new Setting(contentEl)
			.setName(this.t("modal.task.field.project", "项目"))
			.addDropdown((dropdown) => {
				for (const project of this.options.projects) {
					dropdown.addOption(project.value, project.label);
				}

				dropdown.setValue(this.projectId).onChange((value) => {
					this.projectId = value;
					this.refreshMemberDropdown();
				});
			});

		new Setting(contentEl)
			.setName(this.t("modal.task.field.member", "关联成员"))
			.setDesc(this.t("modal.task.desc.member", "从项目成员文档中快速选择"))
			.addDropdown((dropdown) => {
				this.memberDropdown = dropdown;
				this.refreshMemberDropdown();
				dropdown.onChange((value) => {
					if (!value) {
						return;
					}

					this.assignee = value;
					this.assigneeText?.setValue(value);
				});
			});

		new Setting(contentEl)
			.setName(this.t("modal.task.field.priority", "优先级"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("urgent", this.t("modal.task.priority.urgent", "紧急"))
					.addOption("high", this.t("modal.task.priority.high", "高"))
					.addOption("medium", this.t("modal.task.priority.medium", "中"))
					.addOption("low", this.t("modal.task.priority.low", "低"))
					.setValue(this.priority)
					.onChange((value) => {
						this.priority = value as TaskPriority;
					}),
			);

		new Setting(contentEl)
			.setName(this.t("modal.task.field.dueDate", "截止日期"))
			.setDesc(this.t("modal.task.desc.dueDate", "格式：YYYY-MM-DD"))
			.addText((text) =>
				text
					.setPlaceholder("2026-03-17")
					.setValue(this.dueDate)
					.onChange((value) => (this.dueDate = value.trim())),
			);

		new Setting(contentEl)
			.setName(this.t("modal.task.field.assignee", "负责人"))
			.addText((text) => {
				this.assigneeText = text;
				text.setPlaceholder("keith").setValue(this.assignee).onChange((value) => {
					this.assignee = value.trim();
				});
			});

		new Setting(contentEl)
			.setName(this.t("modal.task.field.tags", "标签"))
			.setDesc(this.t("modal.task.desc.tags", "多个标签用逗号分隔"))
			.addText((text) =>
				text
					.setPlaceholder(this.t("modal.task.placeholder.tags", "后端, 架构"))
					.onChange((value) => (this.tags = value)),
			);

		new Setting(contentEl)
			.setName(this.t("modal.task.field.desc", "描述"))
			.addTextArea((text) =>
				text.setPlaceholder(this.t("modal.task.placeholder.desc", "任务描述")).onChange((value) => {
					this.description = value;
				}),
			);

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText(this.t("modal.task.button.create", "创建")).setCta().onClick(async () => {
					await this.submit();
				}),
			)
			.addButton((button) =>
				button.setButtonText(this.t("modal.task.button.cancel", "取消")).onClick(() => {
					this.close();
				}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		if (!this.title.trim()) {
			new Notice(this.t("modal.task.error.emptyTitle", "任务标题不能为空"), 3000);
			return;
		}

		if (this.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(this.dueDate)) {
			new Notice(this.t("modal.task.error.badDate", "截止日期格式错误，应为 YYYY-MM-DD"), 4000);
			return;
		}

		const payload: TaskCreateInput = {
			title: this.title.trim(),
			projectId: this.projectId,
			priority: this.priority,
			dueDate: this.dueDate,
			assignee: this.assignee,
			description: this.description.trim(),
			tags: this.tags
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean),
		};

		await this.options.onSubmit(payload);
		this.close();
	}

	private refreshMemberDropdown(): void {
		if (!this.memberDropdown) {
			return;
		}

		const dropdown = this.memberDropdown;
		while (dropdown.selectEl.options.length > 0) {
			dropdown.selectEl.remove(0);
		}
		const options = this.options.projectMembers[this.projectId] ?? [];
		if (options.length === 0) {
			dropdown.addOption("", this.t("modal.task.member.empty", "（成员文档为空）"));
			dropdown.setValue("");
			return;
		}

		dropdown.addOption("", this.t("modal.task.member.select", "选择成员"));
		for (const member of options) {
			dropdown.addOption(member.userId, `${member.userId} (${getRoleLabel(member.role, this.options.t)})`);
		}

		const matched = options.some((member) => member.userId === this.assignee);
		dropdown.setValue(matched ? this.assignee : "");
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
