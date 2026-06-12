import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const electronShellDir = path.dirname(fileURLToPath(import.meta.url));

function firstExistingPath(candidates: string[]): string {
	const fallback = candidates[0];
	if (fallback === undefined) {
		throw new Error("At least one candidate path is required.");
	}
	return candidates.find((candidate) => fs.existsSync(candidate)) ?? fallback;
}

export function resolveWorkbenchHtml(baseDir = electronShellDir): string {
	return firstExistingPath([
		path.resolve(baseDir, "../ui/workbench/workbench.html"),
		path.resolve(baseDir, "../../ui/workbench/workbench.html"),
	]);
}

export function resolvePreloadScript(baseDir = electronShellDir): string {
	return path.resolve(baseDir, "preload.js");
}
