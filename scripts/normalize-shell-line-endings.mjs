import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDir, "..");

function collectShellScripts(directory) {
	if (!fs.existsSync(directory)) {
		return [];
	}
	const entries = fs.readdirSync(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectShellScripts(absolutePath));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".sh")) {
			files.push(absolutePath);
		}
	}
	return files.sort();
}

export function normalizeShellLineEndings({ projectRoot = defaultProjectRoot } = {}) {
	const scriptsRoot = path.join(projectRoot, "scripts");
	const changed = [];
	for (const filePath of collectShellScripts(scriptsRoot)) {
		const bytes = fs.readFileSync(filePath);
		if (!bytes.includes(0x0d)) {
			continue;
		}
		const normalized = bytes.toString("utf8").replace(/\r\n?/g, "\n");
		fs.writeFileSync(filePath, normalized, "utf8");
		changed.push(path.relative(projectRoot, filePath).replace(/\\/g, "/"));
	}
	return changed;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
	const changed = normalizeShellLineEndings();
	if (changed.length > 0) {
		console.log(`Normalized shell line endings: ${changed.join(", ")}`);
	}
}
