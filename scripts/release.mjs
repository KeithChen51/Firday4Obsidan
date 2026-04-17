import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const RELEASE_BRANCH = "master";
const RELEASE_DIR = "release";
const RELEASE_ARTIFACT_DIRNAME = "friday-obsidian-plugin";
const RELEASE_ARTIFACT_RELATIVE_DIR = `${RELEASE_DIR}/${RELEASE_ARTIFACT_DIRNAME}`;
const RELEASE_FILES = ["main.js", "manifest.json", "styles.css"];

function ensureFile(projectRoot, relativePath) {
	const absolutePath = path.join(projectRoot, relativePath);
	if (!fs.existsSync(absolutePath)) {
		throw new Error(`Missing required file: ${relativePath}`);
	}
	return absolutePath;
}

function writeJson(filePath, value) {
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

export function buildReleaseFeed(manifest, publishedAt = new Date().toISOString()) {
	return {
		schemaVersion: 1,
		pluginId: manifest.id,
		version: manifest.version,
		minAppVersion: manifest.minAppVersion,
		branch: RELEASE_BRANCH,
		publishedAt,
		files: {
			"main.js": `${RELEASE_ARTIFACT_RELATIVE_DIR}/main.js`,
			"manifest.json": `${RELEASE_ARTIFACT_RELATIVE_DIR}/manifest.json`,
			"styles.css": `${RELEASE_ARTIFACT_RELATIVE_DIR}/styles.css`,
		},
	};
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
} = {}) {
	if (!projectRoot) {
		throw new Error("projectRoot is required");
	}

	const manifestPath = ensureFile(projectRoot, "manifest.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	if (!manifest?.id || !manifest?.version || !manifest?.minAppVersion) {
		throw new Error("manifest.json is missing required release fields");
	}

	const releaseRoot = path.join(projectRoot, RELEASE_DIR);
	const artifactDir = path.join(releaseRoot, RELEASE_ARTIFACT_DIRNAME);
	fs.mkdirSync(artifactDir, { recursive: true });

	for (const fileName of RELEASE_FILES) {
		const sourcePath = ensureFile(projectRoot, fileName);
		const targetPath = path.join(artifactDir, fileName);
		fs.copyFileSync(sourcePath, targetPath);
	}

	const latestJson = buildReleaseFeed(manifest, publishedAt);
	const latestJsonPath = path.join(releaseRoot, "latest.json");
	writeJson(latestJsonPath, latestJson);

	const zipPath = path.join(releaseRoot, `${RELEASE_ARTIFACT_DIRNAME}.zip`);
	zipWriter(artifactDir, zipPath);

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
} = {}) {
	buildCommand(projectRoot);
	return syncReleaseArtifacts({
		projectRoot,
		publishedAt,
		zipWriter,
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const result = runRelease();
		console.log(`Release artifacts updated in ${result.artifactDir}`);
		console.log(`Release feed written to ${result.latestJsonPath}`);
		console.log(`Release zip written to ${result.zipPath}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? "Unknown release failure");
		console.error(message);
		process.exitCode = 1;
	}
}
