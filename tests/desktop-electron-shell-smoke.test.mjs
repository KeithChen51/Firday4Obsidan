/* eslint-env node */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const electronRoot = path.join(projectRoot, "src/desktop/shell/electron");
const mainPath = path.join(electronRoot, "main.ts");
const navigationPath = path.join(electronRoot, "navigation.ts");
const preloadPath = path.join(electronRoot, "preload.ts");
const bridgePath = path.join(electronRoot, "bridge.ts");
const shellPathsPath = path.join(electronRoot, "paths.ts");
const packagePath = path.join(projectRoot, "package.json");
const distElectronRoot = path.join(projectRoot, "dist/desktop/electron");
const desktopBuildScriptPath = path.join(projectRoot, "scripts/build-desktop-electron.mjs");
const desktopSmokeScriptPath = path.join(projectRoot, "scripts/desktop-electron-smoke.mjs");
const jiti = createJiti(import.meta.url);

function readRequiredFile(filePath) {
	assert.equal(fs.existsSync(filePath), true, `${path.relative(projectRoot, filePath)} should exist`);
	return fs.readFileSync(filePath, "utf8");
}

function listFiles(root, predicate, output = []) {
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const fullPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			listFiles(fullPath, predicate, output);
		} else if (predicate(fullPath)) {
			output.push(fullPath);
		}
	}
	return output;
}

function assertContainsAll(source, tokens, label) {
	for (const token of tokens) {
		assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${label} should include ${token}`);
	}
}

function parseSmokeResult(output) {
	const marker = "FRIDAY_DESKTOP_ELECTRON_SMOKE ";
	const line = output.split(/\r?\n/).find((entry) => entry.startsWith(marker));
	assert.notEqual(line, undefined, "desktop smoke output should include a JSON result marker");
	return JSON.parse(line.slice(marker.length));
}

function resolveInstalledElectronExecutable() {
	const electronPackageRoot = path.join(projectRoot, "node_modules", "electron");
	const electronPathFile = path.join(electronPackageRoot, "path.txt");
	if (!fs.existsSync(electronPathFile)) {
		return null;
	}
	const executableName = fs.readFileSync(electronPathFile, "utf8").trim();
	const executablePath = path.join(electronPackageRoot, "dist", executableName);
	return fs.existsSync(executablePath) ? executablePath : null;
}

test("desktop Electron shell files and dependency are present but outside the plugin entry", () => {
	const packageJson = JSON.parse(readRequiredFile(packagePath));
	const packageLock = JSON.parse(readRequiredFile(path.join(projectRoot, "package-lock.json")));
	const pluginEntry = readRequiredFile(path.join(projectRoot, "src/main.ts"));
	const esbuildConfig = readRequiredFile(path.join(projectRoot, "esbuild.config.mjs"));

	assert.equal(typeof packageJson.devDependencies?.electron, "string", "electron should be a devDependency");
	assert.match(packageJson.devDependencies.electron, /^\^(31|32)\./, "Electron devDependency should stay compatible with Node 20 CI");
	assert.match(packageLock.packages?.["node_modules/electron"]?.version ?? "", /^(31|32)\./);
	assert.doesNotMatch(packageLock.packages?.["node_modules/electron"]?.engines?.node ?? "", />=\s*22/);
	assert.equal(packageJson.dependencies?.electron, undefined, "electron should not be a runtime plugin dependency");
	assert.equal(packageJson.scripts?.["desktop:build"], "node scripts/build-desktop-electron.mjs");
	assert.equal(packageJson.scripts?.["desktop:smoke"], "npm run desktop:build && node scripts/desktop-electron-smoke.mjs");
	assert.equal(packageJson.scripts?.["desktop:run"], "npm run desktop:build && electron dist/desktop/electron/main.js");
	assert.equal(fs.existsSync(desktopBuildScriptPath), true, "desktop build script should exist");
	assert.equal(fs.existsSync(desktopSmokeScriptPath), true, "desktop smoke script should exist");
	assert.doesNotMatch(pluginEntry, /desktop\/shell\/electron|from\s+["']electron["']|require\(["']electron["']\)/);
	assert.match(esbuildConfig, /"electron"/, "plugin bundle should continue to externalize electron if it ever sees it");
	assert.equal(fs.existsSync(path.join(projectRoot, "src/desktop/ui/workbench/workbench.html")), true);
});

test("desktop Electron main process creates a hardened BrowserWindow for the local workbench", () => {
	const main = readRequiredFile(mainPath);

	assertContainsAll(
		main,
		[
			"BrowserWindow",
			"registerFridayDesktopBridgeIpc",
			"resolveWorkbenchHtml",
			"resolvePreloadScript",
			"runElectronSmoke",
			"loadFile",
			"contextIsolation: true",
			"nodeIntegration: false",
			"sandbox: true",
			"setWindowOpenHandler",
			"action: \"deny\"",
			"will-navigate",
			"preventDefault",
		],
		"src/desktop/shell/electron/main.ts",
	);
	assertContainsAll(readRequiredFile(shellPathsPath), ["workbench.html", "preload.js"], "paths.ts");
});

test("desktop Electron navigation guard allows only the resolved workbench file URL", async () => {
	const navigation = await jiti.import(navigationPath);
	const workbenchPath = path.join(projectRoot, "dist/desktop/ui/workbench/workbench.html");
	const allowedUrl = pathToFileURL(workbenchPath).toString();

	assert.equal(navigation.isAllowedWorkbenchNavigation(allowedUrl, allowedUrl), true);
	assert.equal(navigation.isAllowedWorkbenchNavigation(`${allowedUrl}#hash`, allowedUrl), false);
	assert.equal(navigation.isAllowedWorkbenchNavigation("https://example.com/", allowedUrl), false);
	assert.equal(navigation.isAllowedWorkbenchNavigation("file:///C:/tmp/other.html", allowedUrl), false);
});

test("desktop build emits real Electron main, preload, and renderer files resolved by shell paths", async () => {
	execFileSync(process.execPath, [desktopBuildScriptPath], {
		cwd: projectRoot,
		encoding: "utf8",
		timeout: 60_000,
		windowsHide: true,
	});

	const paths = await jiti.import(shellPathsPath);
	const resolvedPreload = paths.resolvePreloadScript(distElectronRoot);
	const resolvedWorkbench = paths.resolveWorkbenchHtml(distElectronRoot);

	assert.equal(resolvedPreload, path.join(distElectronRoot, "preload.js"));
	assert.equal(resolvedWorkbench, path.join(projectRoot, "dist/desktop/ui/workbench/workbench.html"));
	assert.equal(fs.existsSync(path.join(distElectronRoot, "main.js")), true, "built Electron main should exist");
	assert.equal(fs.existsSync(resolvedPreload), true, "resolved preload JS should exist after desktop build");
	assert.equal(fs.existsSync(resolvedWorkbench), true, "resolved workbench HTML should exist after desktop build");
	assert.match(fs.readFileSync(resolvedPreload, "utf8"), /fridayDesktop/);
});

test("desktop smoke fails by default when the Electron runtime binary is missing", () => {
	const emptyElectronDist = fs.mkdtempSync(path.join(os.tmpdir(), "friday-electron-missing-"));
	execFileSync(process.execPath, [desktopBuildScriptPath], {
		cwd: projectRoot,
		encoding: "utf8",
		timeout: 60_000,
		windowsHide: true,
	});

	let error;
	try {
		execFileSync(process.execPath, [desktopSmokeScriptPath], {
			cwd: projectRoot,
			encoding: "utf8",
			env: {
				...process.env,
				ELECTRON_OVERRIDE_DIST_PATH: emptyElectronDist,
				FRIDAY_DESKTOP_ELECTRON_ALLOW_SKIP: "",
			},
			timeout: 30_000,
			windowsHide: true,
		});
	} catch (caught) {
		error = caught;
	}

	assert.notEqual(error, undefined, "desktop smoke should fail when Electron is missing and skip is not explicit");
	assert.equal(error.status, 1);
	const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
	assert.match(output, /Electron runtime binary is not installed/);
});

test("desktop smoke can explicitly skip a missing Electron runtime only with allow-skip set", () => {
	const emptyElectronDist = fs.mkdtempSync(path.join(os.tmpdir(), "friday-electron-allow-skip-"));
	const stdout = execFileSync(process.execPath, [desktopSmokeScriptPath], {
		cwd: projectRoot,
		encoding: "utf8",
		env: {
			...process.env,
			ELECTRON_OVERRIDE_DIST_PATH: emptyElectronDist,
			FRIDAY_DESKTOP_ELECTRON_ALLOW_SKIP: "1",
		},
		timeout: 30_000,
		windowsHide: true,
	});
	const result = parseSmokeResult(stdout);

	assert.equal(result.skipped, true);
	assert.match(result.reason, /Electron runtime binary is not installed/);
	assert.equal(result.mainPathExists, true);
});

test("desktop Electron smoke verifies the preload bridge when an Electron runtime binary is available", (t) => {
	if (!resolveInstalledElectronExecutable()) {
		t.skip("Electron runtime binary is not installed in node_modules/electron/dist");
		return;
	}

	const stdout = execFileSync(process.execPath, [desktopSmokeScriptPath], {
		cwd: projectRoot,
		encoding: "utf8",
		timeout: 90_000,
		windowsHide: true,
	});
	const result = parseSmokeResult(stdout);

	assert.equal(result.ping.ok, true);
	assert.equal(result.ping.appName, "FRIDAY Desktop");
	assert.equal(result.stateAppName, "FRIDAY Desktop");
	assert.equal(result.hasFridayDesktopBridge, true);
	assert.equal(result.hasCanvasResourceWindow, true);
	assert.equal(result.canvasResourcePanels.includes("library"), true);
	assert.equal(result.canvasResourcePanels.includes("fileTree"), true);
	assert.equal(result.canvasResourcePanels.includes("skills"), true);
	assert.equal(result.canvasResourcePanels.includes("artifacts"), true);
});

test("desktop preload exposes only the controlled fridayDesktop bridge", () => {
	const preload = readRequiredFile(preloadPath);
	const bridge = readRequiredFile(bridgePath);

	assertContainsAll(preload, ["contextBridge", "ipcRenderer", "fridayDesktop", "ping", "getSmokeState"], "preload.ts");
	assert.doesNotMatch(preload, /exposeInMainWorld\(["']ipcRenderer["']/);
	assert.doesNotMatch(preload, /sendSync|remote|require\(["']fs["']\)|child_process/);
	assertContainsAll(bridge, ["FRIDAY_DESKTOP_BRIDGE_CHANNELS", "createFridayDesktopSmokeState", "WorkbenchSmokeState"], "bridge.ts");
});

test("Electron imports stay isolated to src/desktop/shell/electron", () => {
	const sourceFiles = listFiles(
		path.join(projectRoot, "src"),
		(filePath) => /\.(?:ts|js|mjs)$/.test(filePath),
	);
	const offenders = [];
	for (const filePath of sourceFiles) {
		const source = fs.readFileSync(filePath, "utf8");
		const hasStaticElectronImport = /from\s+["']electron["']|import\s+["']electron["']/.test(source);
		if (hasStaticElectronImport && !filePath.startsWith(electronRoot)) {
			offenders.push(path.relative(projectRoot, filePath));
		}
	}

	assert.deepEqual(offenders, []);
});
