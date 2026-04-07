import { Notice } from "obsidian";
import { FridayPluginApi } from "../types/plugin";

export function registerKnowledgeCommands(plugin: FridayPluginApi): void {
	plugin.addCommand({
		id: "curate-knowledge",
		name: plugin.t("command.curateKnowledge"),
		callback: async () => {
			try {
				const summary = await plugin.runKnowledgeCuration();
				new Notice(
					plugin.t("notice.knowledgeCurationDone", {
						global: summary.globalUserCount,
						project: summary.projectCount,
						review: summary.needsReviewCount,
					}),
					5000,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error ?? "");
				new Notice(plugin.t("notice.knowledgeCurationFailed", { error: message }), 7000);
			}
		},
	});

	plugin.addCommand({
		id: "revalidate-knowledge",
		name: plugin.t("command.revalidateKnowledge"),
		callback: async () => {
			try {
				const summary = await plugin.runKnowledgeRevalidation();
				new Notice(plugin.t("notice.knowledgeRevalidateDone", { review: summary.needsReviewCount }), 5000);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error ?? "");
				new Notice(plugin.t("notice.knowledgeRevalidateFailed", { error: message }), 7000);
			}
		},
	});
}
