import { Notice, TFile } from "obsidian";
import { FridayPluginApi } from "../types/plugin";
import { formatDate } from "../utils/dateUtils";

export function registerDailyCommands(plugin: FridayPluginApi): void {
	plugin.addCommand({
		id: "open-daily-board",
		name: plugin.t("command.openBoard"),
		callback: async () => {
			await plugin.activateDailyBoardView();
		},
	});

	plugin.addCommand({
		id: "generate-daily",
		name: plugin.t("command.generateDaily"),
		callback: async () => {
			try {
				const today = formatDate();
				const dailyPath = await plugin.dataService.generateDailyNote(
					plugin.getPrimaryUserId(),
					today,
					plugin.settings.dailyNote.templatePath,
					plugin.getDetectedUserId(),
				);

				const file = plugin.app.vault.getAbstractFileByPath(dailyPath);
				if (file instanceof TFile) {
					await plugin.app.workspace.getLeaf(true).openFile(file);
				}

				new Notice(plugin.t("notice.dailyGenerated"), 3000);
			} catch (error) {
				console.error("[Friday] Failed to generate daily note:", error);
				new Notice(plugin.t("notice.dailyGenerateFailed"), 5000);
			}
		},
	});
}
