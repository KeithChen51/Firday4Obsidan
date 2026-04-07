import { FileManager, TFile } from "obsidian";

export type FrontmatterObject = Record<string, unknown>;

export function sortFrontmatterKeys<T extends FrontmatterObject>(frontmatter: T): T {
	const sortedKeys = Object.keys(frontmatter).sort((left, right) => left.localeCompare(right));
	const sorted: FrontmatterObject = {};

	for (const key of sortedKeys) {
		sorted[key] = frontmatter[key];
	}

	return sorted as T;
}

export async function updateFrontmatter(
	fileManager: FileManager,
	file: TFile,
	updater: (frontmatter: FrontmatterObject) => void,
): Promise<void> {
	await fileManager.processFrontMatter(file, (frontmatter) => {
		const current = (frontmatter as FrontmatterObject) ?? {};
		updater(current);
		const sorted = sortFrontmatterKeys(current);

		for (const key of Object.keys(frontmatter)) {
			delete frontmatter[key];
		}

		Object.assign(frontmatter, sorted);
	});
}
