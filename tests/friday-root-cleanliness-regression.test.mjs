/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

function readSource(relativePath) {
	return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("project boundary lookups are rooted in registered boundaryPath values", () => {
	const source = readSource("src/services/ProjectBoundaryService.ts");
	assert.match(source, /getProjectForVaultPath\(vaultRelativePath: string\): ProjectEntry \| null/);
	assert.match(source, /settings\.projects \?\? \[\]/);
	assert.match(source, /project\.boundaryPath\?\.trim\(\)/);
	assert.doesNotMatch(source, /PRIMARY_PATHS\.root\/\$\{PRIMARY_PATHS\.projects\}/);
});

test("sync command resolves current project via ProjectBoundaryService instead of path guessing", () => {
	const source = readSource("src/commands/syncCommands.ts");
	assert.match(source, /projectBoundaryService\.getProjectForVaultPath\(activeFile\.path\)/);
	assert.doesNotMatch(source, /dataService\.getProjectSlugFromPath\(activeFile\.path\)/);
});

test("vault modify hot path resolves projects via ProjectBoundaryService instead of legacy folder guesses", () => {
	const source = readSource("src/main.ts");
	assert.match(source, /projectBoundaryService\.getProjectForVaultPath\(file\.path\)/);
	assert.doesNotMatch(source, /dataService\.getProjectSlugFromPath\(file\.path\)/);
});

test("project members storage APIs are keyed by registered project roots", () => {
	const dataServiceSource = readSource("src/services/DataService.ts");
	const dailyBoardSource = readSource("src/views/DailyBoardView.ts");

	assert.match(
		dataServiceSource,
		/async getProjectMembers\(project: Pick<ProjectEntry, "projectId" \| "boundaryPath">\): Promise<ProjectMember\[]>/,
	);
	assert.match(
		dataServiceSource,
		/async setProjectMembers\(\s*project: Pick<ProjectEntry, "projectId" \| "boundaryPath">,\s*members: ProjectMember\[],\s*\): Promise<void>/,
	);
	assert.doesNotMatch(dataServiceSource, /resolveProjectFolder\(projectSlug: string\)/);
	assert.match(dailyBoardSource, /this\.plugin\.dataService\.getProjectMembers\(project\)/);
	assert.match(
		dailyBoardSource,
		/this\.plugin\.dataService\.setProjectMembers\(this\.memberEditorProject, this\.memberEditorMembers\)/,
	);
});
