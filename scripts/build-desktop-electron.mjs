/* eslint-env node */
import esbuild from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distRoot = path.join(projectRoot, "dist", "desktop");
const electronOutDir = path.join(distRoot, "electron");
const uiOutDir = path.join(distRoot, "ui", "workbench");
const uiSourceDir = path.join(projectRoot, "src", "desktop", "ui", "workbench");

function assertInsideProject(targetPath) {
	const relative = path.relative(projectRoot, targetPath);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`Refusing to write outside project root: ${targetPath}`);
	}
}

for (const target of [distRoot, electronOutDir, uiOutDir]) {
	assertInsideProject(target);
}

await fs.rm(distRoot, { recursive: true, force: true });
await fs.mkdir(electronOutDir, { recursive: true });
await fs.mkdir(uiOutDir, { recursive: true });

const commonBuildOptions = {
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node20",
	external: ["electron"],
	logLevel: "silent",
	sourcemap: false,
};

await esbuild.build({
	...commonBuildOptions,
	entryPoints: [path.join(projectRoot, "src", "desktop", "shell", "electron", "main.ts")],
	outfile: path.join(electronOutDir, "main.js"),
});

await esbuild.build({
	...commonBuildOptions,
	entryPoints: [path.join(projectRoot, "src", "desktop", "shell", "electron", "preload.ts")],
	outfile: path.join(electronOutDir, "preload.js"),
});

await fs.writeFile(
	path.join(electronOutDir, "package.json"),
	`${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
	"utf8",
);

for (const fileName of ["workbench.html", "workbench.css", "workbench.js"]) {
	await fs.copyFile(path.join(uiSourceDir, fileName), path.join(uiOutDir, fileName));
}

console.log(`FRIDAY desktop Electron build written to ${path.relative(projectRoot, distRoot)}`);
