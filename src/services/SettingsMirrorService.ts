import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { stringifyYaml } from "obsidian";
import { FridaySettings } from "../types/settings";
import { sortFrontmatterKeys } from "../utils/frontmatter";
import { LocalStateRootService } from "./LocalStateRootService";

export class SettingsMirrorService {
	constructor(private readonly localStateRootService: LocalStateRootService) {}

	getMirrorPath(): string {
		return this.localStateRootService.resolveVault("settings.mirror.yaml");
	}

	async write(settings: FridaySettings): Promise<void> {
		const safeLlm = {
			mode: settings.llm.mode,
			apiUrl: settings.llm.apiUrl,
			model: settings.llm.model,
			temperature: settings.llm.temperature,
			maxTokens: settings.llm.maxTokens,
			enableStreaming: settings.llm.enableStreaming,
		};
		const payload = sortFrontmatterKeys({
			type: "settings_mirror",
			version: settings.version,
			llm: safeLlm,
			sync: settings.sync,
			user: {
				displayName: settings.user.displayName,
				userId: settings.user.userId,
			},
		});
		const targetPath = this.getMirrorPath();
		await mkdir(path.dirname(targetPath), { recursive: true });
		await writeFile(targetPath, `${stringifyYaml(payload).trimEnd()}\n`, "utf8");
	}
}
