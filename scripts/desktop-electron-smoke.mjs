/* eslint-env node */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const mainPath = path.join(projectRoot, "dist", "desktop", "electron", "main.js");
const electronPackageRoot = path.join(projectRoot, "node_modules", "electron");
const electronPathFile = path.join(electronPackageRoot, "path.txt");
const marker = "FRIDAY_DESKTOP_ELECTRON_SMOKE ";

function emitSmokeResult(result) {
	process.stdout.write(`${marker}${JSON.stringify(result)}\n`);
}

function resolveElectronExecutable() {
	if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
		const executableName = process.platform === "win32" ? "electron.exe" : "electron";
		const overridePath = path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executableName);
		return fs.existsSync(overridePath) ? overridePath : null;
	}

	if (!fs.existsSync(electronPathFile)) {
		return null;
	}

	const executableName = fs.readFileSync(electronPathFile, "utf8").trim();
	const executablePath = path.join(electronPackageRoot, "dist", executableName);
	return fs.existsSync(executablePath) ? executablePath : null;
}

const electronPath = resolveElectronExecutable();
if (!electronPath) {
	const result = {
		skipped: true,
		reason: "Electron runtime binary is not installed in node_modules/electron/dist",
		mainPathExists: fs.existsSync(mainPath),
	};
	if (process.env.FRIDAY_DESKTOP_ELECTRON_ALLOW_SKIP === "1") {
		emitSmokeResult(result);
		process.exit(0);
	}
	process.stderr.write(`${marker}${JSON.stringify(result)}\n`);
	process.stderr.write(`${result.reason}. Set FRIDAY_DESKTOP_ELECTRON_ALLOW_SKIP=1 only for local environments that cannot install Electron.\n`);
	process.exit(1);
}

const child = execFile(
	electronPath,
	[mainPath, "--disable-gpu", "--no-sandbox"],
	{
		cwd: projectRoot,
		encoding: "utf8",
		env: {
			...process.env,
			FRIDAY_DESKTOP_ELECTRON_SMOKE: "1",
			ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
		},
		timeout: 60_000,
		windowsHide: true,
	},
	(error, stdout, stderr) => {
		if (stdout) {
			process.stdout.write(stdout);
		}
		if (stderr) {
			process.stderr.write(stderr);
		}
		if (error) {
			process.exitCode = typeof error.code === "number" ? error.code : 1;
			return;
		}
		if (!stdout.includes(marker)) {
			process.stderr.write("Electron smoke did not return the FRIDAY desktop marker.\n");
			process.exitCode = 1;
		}
	},
);

child.on("error", (error) => {
	process.stderr.write(`${error.stack ?? error.message}\n`);
	process.exitCode = 1;
});
