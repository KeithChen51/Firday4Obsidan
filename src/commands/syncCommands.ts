import { Notice } from "obsidian";
import { PERSONAL_SLUG } from "../constants/paths";
import { FridayPluginApi } from "../types/plugin";

export function registerSyncCommands(plugin: FridayPluginApi): void {
	plugin.addCommand({
		id: "sync-all",
		name: plugin.t("command.syncAll"),
		callback: async () => {
			if (plugin.settings.projects.length === 0) {
				new Notice(plugin.t("notice.noProjectsConfigured"), 3000);
				return;
			}

			const results = await plugin.syncService.syncAll(plugin.settings.projects);
			updateProjectSyncTimestamps(plugin, results);
			await plugin.saveSettings();
			const recordedAt = new Date().toISOString();
			plugin.workbenchStateStore.setSyncReports(
				plugin.settings.projects.map((project) => ({
					projectId: project.projectId,
					result: results.get(project.projectId) ?? {
						success: false,
						projectId: project.projectId,
						pulledFiles: [],
						pushedFiles: [],
						conflicts: [],
						error: "No sync result",
					},
					recordedAt,
				})),
			);
			await plugin.openWorkspaceView();
		},
	});

	plugin.addCommand({
		id: "sync-current",
		name: plugin.t("command.syncCurrent"),
		callback: async () => {
			const currentProject = getCurrentProject(plugin);
			if (!currentProject) {
				new Notice(plugin.t("notice.currentFileNotInProject"), 4000);
				return;
			}

			const result = await plugin.syncService.sync(currentProject);
			const projectLabel = currentProject.projectName || currentProject.projectId || currentProject.slug;
			if (result.success) {
				currentProject.lastSyncAt = new Date().toISOString();
				await plugin.saveSettings();
				new Notice(plugin.t("notice.syncSuccess", { slug: projectLabel }), 3000);
			} else {
				new Notice(plugin.t("notice.syncFailed", { error: result.error ?? projectLabel }), 6000);
			}

			plugin.workbenchStateStore.recordSyncReport({
				projectId: currentProject.projectId,
				result,
				recordedAt: new Date().toISOString(),
			});
			await plugin.openWorkspaceView();
		},
	});

	plugin.addCommand({
		id: "sync-status",
		name: plugin.t("command.syncStatus"),
		callback: async () => {
			if (plugin.settings.projects.length === 0) {
				new Notice(plugin.t("notice.noProjectsConfigured"), 3000);
				return;
			}
			await plugin.openWorkspaceView();
		},
	});
}

function getCurrentProject(plugin: FridayPluginApi) {
	const activeFile = plugin.app.workspace.getActiveFile();
	if (!activeFile) {
		return null;
	}

	const projectId = plugin.dataService.getProjectIdFromPath(activeFile.path);
	if (!projectId || projectId === PERSONAL_SLUG) {
		return null;
	}

	return plugin.settings.projects.find((project) => project.projectId === projectId) ?? null;
}

function updateProjectSyncTimestamps(
	plugin: FridayPluginApi,
	results: Map<string, { success: boolean }>,
): void {
	for (const project of plugin.settings.projects) {
		const result = results.get(project.projectId);
		if (result?.success) {
			project.lastSyncAt = new Date().toISOString();
		}
	}
}
