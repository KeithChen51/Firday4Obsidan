import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const RELEASE_BRANCH = "release";
const LEGACY_BRIDGE_BRANCH = "master";
const DEFAULT_LEGACY_BRIDGE_VERSION = "0.2.10";
const LEGACY_RELEASE_DIR = "release";
const LEGACY_RELEASE_ARTIFACT_DIRNAME = "friday-obsidian-plugin";
const LEGACY_RELEASE_ARTIFACT_RELATIVE_DIR = `${LEGACY_RELEASE_DIR}/${LEGACY_RELEASE_ARTIFACT_DIRNAME}`;
const LEGACY_RELEASE_LATEST_PATH = `${LEGACY_RELEASE_DIR}/latest.json`;
const PLUGIN_ROOT_DIR = "plugin";
const PLUGIN_LATEST_PATH = `${PLUGIN_ROOT_DIR}/latest.json`;
const PLUGIN_ARTIFACT_DIRNAME = "artifacts";
const PLUGIN_ARTIFACT_RELATIVE_DIR = `${PLUGIN_ROOT_DIR}/${PLUGIN_ARTIFACT_DIRNAME}`;
const PLUGIN_ZIP_NAME = "friday-obsidian-plugin.zip";
const PLUGIN_ZIP_PATH = `${PLUGIN_ROOT_DIR}/${PLUGIN_ZIP_NAME}`;
const RELEASE_FILES = ["main.js", "manifest.json", "styles.css"];
const LEGACY_BRIDGE_FILES = [...RELEASE_FILES, "CHANGELOG.md"];
const CHANGELOG_FILE = "CHANGELOG.md";

function ensureFile(projectRoot, relativePath) {
	const absolutePath = path.join(projectRoot, relativePath);
	if (!fs.existsSync(absolutePath)) {
		throw new Error(`Missing required file: ${relativePath}`);
	}
	return absolutePath;
}

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
}

function runCommand(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: "inherit",
	});
	if (result.status !== 0) {
		const detail = result.error ? ` (${result.error.message})` : "";
		throw new Error(`Command failed: ${command} ${args.join(" ")}${detail}`);
	}
}

function runNpmScript(cwd, scriptName) {
	if (process.platform === "win32") {
		runCommand("cmd.exe", ["/d", "/s", "/c", `npm run ${scriptName}`], cwd);
		return;
	}
	runCommand("npm", ["run", scriptName], cwd);
}

function formatPublishedDate(publishedAt) {
	const directMatch = String(publishedAt).match(/^(\d{4}-\d{2}-\d{2})/);
	if (directMatch) {
		return directMatch[1];
	}
	return new Date(publishedAt).toISOString().slice(0, 10);
}

export function upsertReleaseDate(changelogText, version, publishedAt) {
	const normalized = changelogText.replace(/\r\n?/g, "\n");
	const versionPattern = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const headingPattern = new RegExp(`^##\\s+\\[?${versionPattern}\\]?(?:\\s+-.*)?$`);
	const lines = normalized.split("\n");
	const headingIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
	if (headingIndex === -1) {
		return normalized;
	}

	const dateLine = `发布日期：${formatPublishedDate(publishedAt)}`;
	let insertIndex = headingIndex + 1;
	while (lines[insertIndex] === "") {
		lines.splice(insertIndex, 1);
	}

	if (/^(发布日期：|Published on: )/.test(lines[insertIndex] ?? "")) {
		lines[insertIndex] = dateLine;
		if (lines[insertIndex + 1] !== "") {
			lines.splice(insertIndex + 1, 0, "");
		}
	} else {
		lines.splice(insertIndex, 0, dateLine, "");
	}
	return lines.join("\n");
}

export function extractReleaseNotes(changelogText, version) {
	const normalized = changelogText.replace(/\r\n?/g, "\n");
	const versionPattern = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const headingPattern = new RegExp(`^##\\s+\\[?${versionPattern}\\]?(?:\\s+-.*)?$`);
	const lines = normalized.split("\n");
	let capturing = false;
	const captured = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!capturing) {
			if (headingPattern.test(trimmed)) {
				capturing = true;
			}
			continue;
		}
		if (/^##\s+/.test(trimmed)) {
			break;
		}
		captured.push(line);
	}

	while (captured[0]?.trim() === "") {
		captured.shift();
	}
	if (/^(发布日期：|Published on: )/.test(captured[0]?.trim() ?? "")) {
		captured.shift();
	}
	while (captured[0]?.trim() === "") {
		captured.shift();
	}
	return captured.join("\n").trim();
}

function readReleaseNotes(projectRoot, version) {
	const changelogPath = path.join(projectRoot, CHANGELOG_FILE);
	if (!fs.existsSync(changelogPath)) {
		return "";
	}
	return extractReleaseNotes(fs.readFileSync(changelogPath, "utf8"), version);
}

function syncChangelogPublishDate(projectRoot, version, publishedAt) {
	const changelogPath = path.join(projectRoot, CHANGELOG_FILE);
	if (!fs.existsSync(changelogPath)) {
		return "";
	}
	const original = fs.readFileSync(changelogPath, "utf8");
	const next = upsertReleaseDate(original, version, publishedAt);
	if (next !== original) {
		fs.writeFileSync(changelogPath, next, "utf8");
	}
	return next;
}

export function buildReleaseFeed(manifest, publishedAt = new Date().toISOString(), releaseNotes = "") {
	const feed = {
		schemaVersion: 1,
		pluginId: manifest.id,
		version: manifest.version,
		minAppVersion: manifest.minAppVersion,
		branch: RELEASE_BRANCH,
		publishedAt,
		files: {
			"main.js": `${PLUGIN_ARTIFACT_RELATIVE_DIR}/main.js`,
			"manifest.json": `${PLUGIN_ARTIFACT_RELATIVE_DIR}/manifest.json`,
			"styles.css": `${PLUGIN_ARTIFACT_RELATIVE_DIR}/styles.css`,
		},
	};
	if (releaseNotes.trim()) {
		feed.releaseNotes = releaseNotes.trim();
	}
	return feed;
}

function buildLegacyBridgeFeed(manifest, publishedAt = new Date().toISOString(), releaseNotes = "") {
	const feed = {
		schemaVersion: 1,
		pluginId: manifest.id,
		version: manifest.version,
		minAppVersion: manifest.minAppVersion,
		branch: LEGACY_BRIDGE_BRANCH,
		publishedAt,
		files: {
			"main.js": `${LEGACY_RELEASE_ARTIFACT_RELATIVE_DIR}/main.js`,
			"manifest.json": `${LEGACY_RELEASE_ARTIFACT_RELATIVE_DIR}/manifest.json`,
			"styles.css": `${LEGACY_RELEASE_ARTIFACT_RELATIVE_DIR}/styles.css`,
		},
	};
	if (releaseNotes.trim()) {
		feed.releaseNotes = releaseNotes.trim();
	}
	return feed;
}

export function createZipArchive(sourceDir, zipPath) {
	if (process.platform === "win32") {
		runCommand(
			"powershell",
			[
				"-NoProfile",
				"-Command",
				`Compress-Archive -LiteralPath '${sourceDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
			],
			path.dirname(sourceDir),
		);
		return;
	}

	runCommand("zip", ["-rq", zipPath, path.basename(sourceDir)], path.dirname(sourceDir));
}

export function syncReleaseArtifacts({
	projectRoot,
	publishedAt = new Date().toISOString(),
	zipWriter = createZipArchive,
	legacyBridgeVersion = DEFAULT_LEGACY_BRIDGE_VERSION,
} = {}) {
	if (!projectRoot) {
		throw new Error("projectRoot is required");
	}

	const manifestPath = ensureFile(projectRoot, "manifest.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	if (!manifest?.id || !manifest?.version || !manifest?.minAppVersion) {
		throw new Error("manifest.json is missing required release fields");
	}

	syncChangelogPublishDate(projectRoot, manifest.version, publishedAt);

	const artifactDir = path.join(projectRoot, PLUGIN_ARTIFACT_RELATIVE_DIR);
	fs.mkdirSync(artifactDir, { recursive: true });

	for (const fileName of RELEASE_FILES) {
		const sourcePath = ensureFile(projectRoot, fileName);
		const targetPath = path.join(artifactDir, fileName);
		fs.copyFileSync(sourcePath, targetPath);
	}

	const releaseNotes = readReleaseNotes(projectRoot, manifest.version);
	const latestJson = buildReleaseFeed(manifest, publishedAt, releaseNotes);
	const latestJsonPath = path.join(projectRoot, PLUGIN_LATEST_PATH);
	writeJson(latestJsonPath, latestJson);

	const zipPath = path.join(projectRoot, PLUGIN_ZIP_PATH);
	zipWriter(artifactDir, zipPath);

	if (manifest.version === legacyBridgeVersion) {
		const legacyArtifactDir = path.join(projectRoot, LEGACY_RELEASE_ARTIFACT_RELATIVE_DIR);
		fs.mkdirSync(legacyArtifactDir, { recursive: true });
		for (const fileName of LEGACY_BRIDGE_FILES) {
			const sourcePath = ensureFile(projectRoot, fileName);
			const targetPath = path.join(legacyArtifactDir, fileName);
			fs.copyFileSync(sourcePath, targetPath);
		}
		const legacyLatestJson = buildLegacyBridgeFeed(manifest, publishedAt, releaseNotes);
		writeJson(path.join(projectRoot, LEGACY_RELEASE_LATEST_PATH), legacyLatestJson);
	}

	return {
		latestJsonPath,
		artifactDir,
		zipPath,
		manifest,
	};
}

export function runRelease({
	projectRoot = DEFAULT_PROJECT_ROOT,
	publishedAt = new Date().toISOString(),
	buildCommand = (cwd) => runNpmScript(cwd, "build"),
	zipWriter = createZipArchive,
	legacyBridgeVersion = DEFAULT_LEGACY_BRIDGE_VERSION,
} = {}) {
	buildCommand(projectRoot);
	return syncReleaseArtifacts({
		projectRoot,
		publishedAt,
		zipWriter,
		legacyBridgeVersion,
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const shouldSkipBuild = process.argv.includes("--skip-build");
		const result = shouldSkipBuild
			? syncReleaseArtifacts({ projectRoot: DEFAULT_PROJECT_ROOT })
			: runRelease();
		console.log(`Plugin artifacts updated in ${result.artifactDir}`);
		console.log(`Plugin release feed written to ${result.latestJsonPath}`);
		console.log(`Plugin zip written to ${result.zipPath}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? "Unknown release failure");
		console.error(message);
		process.exitCode = 1;
	}
}
