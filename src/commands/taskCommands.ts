import { Notice } from "obsidian";
import { PERSONAL_SLUG } from "../constants/paths";
import { CreateTaskModal } from "../modals/CreateTaskModal";
import { FridayPluginApi } from "../types/plugin";
import { formatDate } from "../utils/dateUtils";

export function registerTaskCommands(plugin: FridayPluginApi): void {
	plugin.addCommand({
		id: "create-task",
		name: plugin.t("command.createTask"),
		callback: async () => {
			try {
				const defaultProject = resolveDefaultProject(plugin);
				const projects = getProjectOptions(plugin);
				const projectMembers = await getProjectMembers(
					plugin,
					projects.map((item) => item.value),
				);

				new CreateTaskModal(plugin.app, {
					projects,
					projectMembers,
					defaultProject,
					defaultAssignee: plugin.getPrimaryUserId(),
					t: plugin.t.bind(plugin),
					onSubmit: async (payload) => {
						const taskId = await plugin.dataService.createTask(payload.projectId, payload);
						new Notice(plugin.t("notice.taskCreated", { title: payload.title }), 3000);

						if (plugin.settings.dailyNote.autoGenerate) {
							await plugin.dataService.generateDailyNote(
								plugin.getPrimaryUserId(),
								formatDate(),
								plugin.settings.dailyNote.templatePath,
								plugin.getDetectedUserId(),
							);
						}

						console.debug("[Friday] Task created:", taskId);
					},
				}).open();
			} catch (error) {
				console.error("[Friday] Failed to open create-task modal:", error);
				new Notice(plugin.t("notice.openCreateTaskFailed", { error: String(error) }), 6000);
			}
		},
	});
}

function resolveDefaultProject(plugin: FridayPluginApi): string {
	const activeFile = plugin.app.workspace.getActiveFile();
	if (!activeFile) {
		return PERSONAL_SLUG;
	}

	return plugin.dataService.getProjectSlugFromPath(activeFile.path) ?? PERSONAL_SLUG;
}

function getProjectOptions(plugin: FridayPluginApi): Array<{ value: string; label: string }> {
	const options: Array<{ value: string; label: string }> = [
		{ value: PERSONAL_SLUG, label: plugin.t("common.personal") },
	];
	const seen = new Set<string>([PERSONAL_SLUG]);

	for (const project of plugin.settings.projects) {
		if (!project.slug || seen.has(project.slug)) {
			continue;
		}

		seen.add(project.slug);
		options.push({ value: project.slug, label: project.slug });
	}

	return options;
}

async function getProjectMembers(
	plugin: FridayPluginApi,
	projectSlugs: string[],
): Promise<Record<string, Array<{ userId: string; role: string }>>> {
	const result: Record<string, Array<{ userId: string; role: string }>> = {};
	const currentUser = plugin.getPrimaryUserId().trim();

	for (const slug of projectSlugs) {
		if (slug === PERSONAL_SLUG) {
			result[slug] = currentUser ? [{ userId: currentUser, role: "admin" }] : [];
			continue;
		}

		try {
			const members = await plugin.dataService.getProjectMembers(slug);
			result[slug] = members.map((member) => ({
				userId: member.userId,
				role: member.role,
			}));
		} catch (error) {
			console.warn("[Friday] Failed to load project members:", slug, error);
			result[slug] = [];
		}
	}

	return result;
}

