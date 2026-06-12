/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const contractsDir = path.join(projectRoot, "src/desktop/contracts");
const barrelPath = path.join(contractsDir, "DesktopHostAdapter.ts");

const requiredPorts = [
	"project",
	"fileSystem",
	"runtimeState",
	"permissions",
	"trace",
	"tools",
	"artifacts",
	"library",
	"skills",
];

const contractFiles = [
	"DesktopHostAdapter.ts",
	"ProjectHostPort.ts",
	"FileSystemHostPort.ts",
	"RuntimeStateHostPort.ts",
	"PermissionHostPort.ts",
	"TraceHostPort.ts",
	"ToolExecutionHostPort.ts",
	"ArtifactHostPort.ts",
	"ProjectLibraryHostPort.ts",
	"SkillHostPort.ts",
];

function readContract(fileName) {
	return fs.readFileSync(path.join(contractsDir, fileName), "utf8");
}

test("DesktopHostAdapter barrel compiles as a host-neutral type-only contract", async () => {
	await assert.doesNotReject(() => jiti.import(barrelPath));

	const allContracts = contractFiles.map(readContract).join("\n");

	assert.doesNotMatch(allContracts, /from ["'](?:electron|@tauri-apps\/api|node:|fs|path|child_process|obsidian)["']/);
	assert.doesNotMatch(allContracts, /\bclass\s+|new\s+BrowserWindow|invoke\(|execFile\(|readFile\(|writeFile\(/);
	assert.doesNotMatch(allContracts, /\benum\s+/);
	assert.match(readContract("DesktopHostAdapter.ts"), /export interface DesktopHostAdapter/);
	assert.match(readContract("DesktopHostAdapter.ts"), /export type DesktopPermissionMode\s*=\s*"safe"\s*\|\s*"standard"\s*\|\s*"autonomous"/);
	assert.match(readContract("DesktopHostAdapter.ts"), /export interface DesktopTurnContext/);
});

test("DesktopHostAdapter exposes every M1 host port", () => {
	const source = readContract("DesktopHostAdapter.ts");

	for (const portName of requiredPorts) {
		assert.match(source, new RegExp(`\\b${portName}:\\s*\\w+HostPort\\b`));
	}

	for (const fileName of contractFiles.slice(1)) {
		const interfaceName = fileName.replace(".ts", "");
		assert.match(readContract(fileName), new RegExp(`export interface ${interfaceName}`));
		assert.match(source, new RegExp(`export type \\{ ${interfaceName} \\}`));
	}
});

test("desktop host ports declare the M1 method surface without real IO behavior", () => {
	const expectations = {
		"ProjectHostPort.ts": [
			"getActiveProject",
			"getProjectRoot",
			"initializeProject",
			"initializeFridayLayout",
			"getGitProfile",
		],
		"FileSystemHostPort.ts": [
			"readProjectFile",
			"writeProjectFile",
			"importExternalFileSnapshot",
			"normalizeProjectPath",
			"writeManagedFile",
		],
		"RuntimeStateHostPort.ts": [
			"saveConversation",
			"saveTurn",
			"saveTrace",
			"saveReference",
			"saveArtifact",
			"saveWorkspaceState",
			"restoreWorkspaceState",
		],
		"PermissionHostPort.ts": [
			"getPermissionMode",
			"snapshotTurnPermissions",
			"requestApproval",
			"cancelTurn",
			"isTurnCancelled",
		],
		"TraceHostPort.ts": [
			"appendTraceEvent",
			"queryTraceEvents",
			"replayTraceEvents",
		],
		"ToolExecutionHostPort.ts": [
			"executeToolInvocation",
		],
		"ArtifactHostPort.ts": [
			"createArtifact",
			"listArtifacts",
			"openArtifact",
			"updateArtifactManifest",
			"writeArtifactVersionFile",
			"readArtifactVersionFile",
			"listArtifactVersionFiles",
			"createProjectFileArtifactWrapper",
			"openProjectFileArtifactWrapper",
		],
		"ProjectLibraryHostPort.ts": [
			"registerContextItem",
			"listContextItems",
			"updateContextItem",
			"readProjectFileTree",
		],
		"SkillHostPort.ts": [
			"listProjectSkills",
			"listGlobalSkills",
			"setSkillEnabled",
			"buildComposerSkillReference",
		],
	};

	for (const [fileName, methodNames] of Object.entries(expectations)) {
		const source = readContract(fileName);
		for (const methodName of methodNames) {
			assert.match(source, new RegExp(`\\b${methodName}\\(`));
		}
	}
});

test("desktop project and workspace contracts expose M3 project session state", () => {
	const projectSource = readContract("ProjectHostPort.ts");
	const runtimeStateSource = readContract("RuntimeStateHostPort.ts");

	assert.match(projectSource, /export interface DesktopProjectManifest/);
	assert.match(projectSource, /export interface DesktopProjectSession/);
	assert.match(projectSource, /project: DesktopProject/);
	assert.match(projectSource, /manifest: DesktopProjectManifest/);
	assert.match(projectSource, /workspaceState: DesktopWorkspaceState \| null/);
	assert.match(projectSource, /initializeProject\(/);
	assert.match(runtimeStateSource, /resourcePanelState\?: Record<string, unknown>/);
});

test("artifact and skill contracts cover reviewer-required M1 wrapper surfaces", () => {
	const artifactSource = readContract("ArtifactHostPort.ts");
	const skillSource = readContract("SkillHostPort.ts");

	assert.match(artifactSource, /export interface DesktopArtifactManifest/);
	assert.match(artifactSource, /export interface ArtifactVersionFile/);
	assert.match(artifactSource, /export interface ArtifactVersionFileReadResult extends ArtifactVersionFile/);
	assert.match(artifactSource, /content: string/);
	assert.match(artifactSource, /export interface ProjectFileArtifactWrapperInput/);
	assert.match(artifactSource, /storageMode\?: "managed_file" \| "project_file_reference"/);
	assert.match(artifactSource, /writeArtifactVersionFile\(/);
	assert.match(artifactSource, /readArtifactVersionFile\([^)]*\): Promise<ArtifactVersionFileReadResult>/);
	assert.match(artifactSource, /listArtifactVersionFiles\(/);
	assert.match(artifactSource, /createProjectFileArtifactWrapper\(/);
	assert.match(artifactSource, /openProjectFileArtifactWrapper\(/);

	assert.match(skillSource, /export interface ComposerSkillReference/);
	assert.match(skillSource, /buildComposerSkillReference\(/);
	assert.match(skillSource, /skillId: string/);
	assert.match(skillSource, /scope: DesktopSkillScope/);
});
