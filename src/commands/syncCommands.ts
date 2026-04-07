import { Notice } from "obsidian";
import { PERSONAL_SLUG } from "../constants/paths";
import { SyncStatusModal } from "../modals/SyncStatusModal";
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

			new SyncStatusModal(plugin.app, {
				projects: plugin.settings.projects,
				syncService: plugin.syncService,
				results,
				t: plugin.t.bind(plugin),
			}).open();
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
			if (result.success) {
				currentProject.lastSyncAt = new Date().toISOString();
				await plugin.saveSettings();
				new Notice(plugin.t("notice.syncSuccess", { slug: currentProject.slug }), 3000);
			} else {
				new Notice(plugin.t("notice.syncFailed", { error: result.error ?? currentProject.slug }), 6000);
			}

			const one = new Map<string, typeof result>();
			one.set(currentProject.slug, result);
			new SyncStatusModal(plugin.app, {
				projects: [currentProject],
				syncService: plugin.syncService,
				results: one,
				t: plugin.t.bind(plugin),
			}).open();
		},
	});

	plugin.addCommand({
		id: "sync-status",
		name: plugin.t("command.syncStatus"),
		callback: () => {
			if (plugin.settings.projects.length === 0) {
				new Notice(plugin.t("notice.noProjectsConfigured"), 3000);
				return;
			}

			new SyncStatusModal(plugin.app, {
				projects: plugin.settings.projects,
				syncService: plugin.syncService,
				t: plugin.t.bind(plugin),
			}).open();
		},
	});
}

function getCurrentProject(plugin: FridayPluginApi) {
	const activeFile = plugin.app.workspace.getActiveFile();
	if (!activeFile) {
		return null;
	}

	const slug = plugin.dataService.getProjectSlugFromPath(activeFile.path);
	if (!slug || slug === PERSONAL_SLUG) {
		return null;
	}

	return plugin.settings.projects.find((project) => project.slug === slug) ?? null;
}

function updateProjectSyncTimestamps(
	plugin: FridayPluginApi,
	results: Map<string, { success: boolean }>,
): void {
	for (const project of plugin.settings.projects) {
		const result = results.get(project.slug);
		if (result?.success) {
			project.lastSyncAt = new Date().toISOString();
		}
	}
}
