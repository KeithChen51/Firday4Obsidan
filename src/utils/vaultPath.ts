import { App, FileSystemAdapter } from "obsidian";

export function getVaultBasePath(app: App): string {
	const adapter = app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) {
		return adapter.getBasePath();
	}

	const adapterWithBasePath = adapter as unknown as { basePath?: string };
	if (adapterWithBasePath.basePath) {
		return adapterWithBasePath.basePath;
	}

	throw new Error("该插件仅支持桌面端，且需要文件系统适配器。");
}
