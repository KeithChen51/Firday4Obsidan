import { FridayPluginApi } from "../types/plugin";

export function registerProjectCommands(plugin: FridayPluginApi): void {
	plugin.addCommand({
		id: "open-daily-board",
		name: plugin.t("command.openBoard"),
		callback: () => {
			void plugin.openWorkspaceView();
		},
	});

	plugin.addCommand({
		id: "manage-projects",
		name: plugin.t("command.manageProjects"),
		callback: () => {
			plugin.openSettingsTab();
		},
	});
}
