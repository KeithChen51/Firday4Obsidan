// eslint-disable-next-line @typescript-eslint/no-explicit-any -- transitional extraction keeps using FridaySettingTab helper surface.
type SettingsSectionContext = Record<string, any>;

export function renderProjectSettingsSection(ctx: SettingsSectionContext, containerEl: HTMLElement): void {
	const shell = containerEl.createDiv({ cls: "friday-project-settings-shell" });
	void ctx.ensureLegacyFridayRootReportLoaded();
	ctx.renderActiveProjectSelector(shell);

	if (ctx.projectEditorDraft) {
		ctx.renderProjectEditorCard(shell);
	}

	ctx.renderProjectGroupSection(shell);
	ctx.renderLegacyFridayRootSection(shell);

	if (ctx.host.settings.projects.length === 0) {
		ctx.createNativeSettingsGroup(shell, {
			title: ctx.t("settings.project.empty", "尚未注册项目。"),
			description: ctx.t("settings.project.active.desc", "Agent 与工具读写将严格限制在该项目根目录下。"),
			extraClass: "friday-empty-state friday-project-settings-panel",
		});
		return;
	}

	for (const group of ctx.getProjectGroupsForDisplay()) {
		const projectsInGroup = ctx.host.settings.projects.filter(
			(item: { groupId?: string }) => (item.groupId || "default-group") === group.id,
		);
		if (projectsInGroup.length === 0) {
			continue;
		}
		ctx.renderProjectListGroup(shell, group, projectsInGroup);
	}
}
