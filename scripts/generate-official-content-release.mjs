import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const OFFICIAL_PROVIDER_ID = "official";
const OFFICIAL_ROOT_PATH = "F.R.I.D.A.Y";
const OFFICIAL_CHANNEL_TITLE = "Official channel";
const OUTPUT_ROOT = "official";
const OUTPUT_LATEST_PATH = path.join(OUTPUT_ROOT, "latest.json");
const OUTPUT_CHANNELS_DIR = path.join(OUTPUT_ROOT, "channels");
const OUTPUT_FILES_DIR = path.join(OUTPUT_ROOT, "files");
const SOURCE_ROOT = path.join("src", "content", "studio");
const CHANGELOG_SOURCE_PATH = "CHANGELOG.md";
const CHANGELOG_TARGET_PATH = "Changelog.md";

function normalizeLineEndings(value) {
	return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function toPosix(value) {
	return value.split(path.sep).join("/");
}

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
}

function writeText(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, value, "utf8");
}

function comparePaths(left, right) {
	return left.localeCompare(right, "zh-CN");
}

function normalizeMarkdownContent(content) {
	return `${normalizeLineEndings(content).trimEnd()}\n`;
}

function buildInjectedChangelog(raw) {
	const normalized = normalizeLineEndings(raw).trim();
	if (!normalized) {
		return "# Changelog\n";
	}
	const lines = normalized.split("\n");
	const headingIndex = lines.findIndex((line) => /^#\s+/.test(line.trim()));
	if (headingIndex >= 0) {
		lines[headingIndex] = "# Changelog";
		return `${lines.join("\n").trimEnd()}\n`;
	}
	return `# Changelog\n\n${normalized}\n`;
}

function slugifyPath(value) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "") || "column";
}

function buildColumnId(value) {
	return `${slugifyPath(value)}-${hashString(value).slice(0, 12)}`;
}

function hashString(value) {
	return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function titleFromPublishedPath(publishedPath, kind) {
	const baseName = kind === "file"
		? path.posix.basename(publishedPath, path.posix.extname(publishedPath))
		: path.posix.basename(publishedPath);
	return baseName || publishedPath;
}

function collectDirectoryMarkdownFiles(rootDir, directoryName) {
	const entries = [];
	const startDir = path.join(rootDir, directoryName);

	function walk(currentDir) {
		const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true })
			.sort((left, right) => comparePaths(left.name, right.name));
		for (const entry of dirEntries) {
			if (entry.name === ".keep" || entry.name === "generated.ts") {
				continue;
			}
			const absolutePath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				walk(absolutePath);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".md")) {
				continue;
			}
			entries.push({
				path: toPosix(path.relative(rootDir, absolutePath)),
				content: normalizeMarkdownContent(fs.readFileSync(absolutePath, "utf8")),
			});
		}
	}

	walk(startDir);
	return entries.sort((left, right) => comparePaths(left.path, right.path));
}

function discoverOfficialColumns(projectRoot) {
	const sourceRoot = path.join(projectRoot, SOURCE_ROOT);
	const topLevelEntries = fs.readdirSync(sourceRoot, { withFileTypes: true })
		.sort((left, right) => comparePaths(left.name, right.name));
	const columns = [];

	for (const entry of topLevelEntries) {
		if (entry.name === ".keep" || entry.name === "generated.ts" || entry.name === "README.md") {
			continue;
		}
		if (entry.isDirectory()) {
			const files = collectDirectoryMarkdownFiles(sourceRoot, entry.name);
			columns.push({
				id: buildColumnId(entry.name),
				title: titleFromPublishedPath(entry.name, "directory"),
				kind: "directory",
				path: entry.name,
				files,
			});
			continue;
		}
		if (!entry.isFile() || !entry.name.endsWith(".md")) {
			continue;
		}
		const filePath = path.join(sourceRoot, entry.name);
		columns.push({
			id: buildColumnId(entry.name),
			title: titleFromPublishedPath(entry.name, "file"),
			kind: "file",
			path: entry.name,
			files: [
				{
					path: entry.name,
					content: normalizeMarkdownContent(fs.readFileSync(filePath, "utf8")),
				},
			],
		});
	}

	const changelogSource = fs.readFileSync(path.join(projectRoot, CHANGELOG_SOURCE_PATH), "utf8");
	columns.push({
		id: buildColumnId(CHANGELOG_TARGET_PATH),
		title: titleFromPublishedPath(CHANGELOG_TARGET_PATH, "file"),
		kind: "file",
		path: CHANGELOG_TARGET_PATH,
		files: [
			{
				path: CHANGELOG_TARGET_PATH,
				content: buildInjectedChangelog(changelogSource),
			},
		],
	});

	return columns.sort((left, right) => comparePaths(left.path, right.path));
}

function buildColumnVersion(column) {
	const versionPayload = JSON.stringify({
		id: column.id,
		kind: column.kind,
		path: column.path,
		files: column.files.map((item) => ({
			path: item.path,
			hash: hashString(item.content),
		})),
	});
	return hashString(versionPayload).slice(0, 16);
}

export function generateOfficialContentRelease({
	projectRoot = DEFAULT_PROJECT_ROOT,
	publishedAt = new Date().toISOString(),
} = {}) {
	const outputRoot = path.join(projectRoot, OUTPUT_ROOT);
	const channelsDir = path.join(projectRoot, OUTPUT_CHANNELS_DIR);
	const filesDir = path.join(projectRoot, OUTPUT_FILES_DIR);
	const channelManifestRelativePath = toPosix(path.join(OUTPUT_CHANNELS_DIR, `${OFFICIAL_PROVIDER_ID}.json`));
	const discoveredColumns = discoverOfficialColumns(projectRoot);

	fs.rmSync(outputRoot, { recursive: true, force: true });
	fs.mkdirSync(channelsDir, { recursive: true });
	fs.mkdirSync(filesDir, { recursive: true });

	const channelColumns = discoveredColumns.map((column) => {
		const files = column.files.map((file) => {
			const hash = hashString(file.content);
			const blobRelativePath = toPosix(path.join(OUTPUT_FILES_DIR, `${hash}.md`));
			writeText(path.join(projectRoot, blobRelativePath), file.content);
			return {
				path: file.path,
				hash,
				blobPath: blobRelativePath,
			};
		});

		return {
			id: column.id,
			title: column.title,
			kind: column.kind,
			path: column.path,
			version: buildColumnVersion(column),
			manifestPath: channelManifestRelativePath,
			files,
		};
	});

	const provider = {
		id: OFFICIAL_PROVIDER_ID,
		title: OFFICIAL_CHANNEL_TITLE,
		rootPath: OFFICIAL_ROOT_PATH,
		manifestPath: channelManifestRelativePath,
		columns: channelColumns.map((column) => ({
			id: column.id,
			title: column.title,
			kind: column.kind,
			path: column.path,
			version: column.version,
			manifestPath: column.manifestPath,
		})),
	};

	const latestPayload = {
		schemaVersion: 1,
		generatedAt: publishedAt,
		providers: [provider],
	};
	const channelPayload = {
		schemaVersion: 1,
		generatedAt: publishedAt,
		id: OFFICIAL_PROVIDER_ID,
		title: OFFICIAL_CHANNEL_TITLE,
		rootPath: OFFICIAL_ROOT_PATH,
		columns: channelColumns,
	};

	const latestJsonPath = path.join(projectRoot, OUTPUT_LATEST_PATH);
	const channelManifestPath = path.join(projectRoot, channelManifestRelativePath);
	writeJson(latestJsonPath, latestPayload);
	writeJson(channelManifestPath, channelPayload);

	return {
		latestJsonPath,
		channelManifestPaths: [channelManifestPath],
		filePaths: channelColumns.flatMap((column) =>
			column.files.map((file) => path.join(projectRoot, file.blobPath))),
		latest: latestPayload,
		channel: channelPayload,
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = generateOfficialContentRelease();
	console.log(`Official content release written to ${result.latestJsonPath}`);
}
