/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

const retirementDocs = [
	"docs/plans/agent-kernel-v2-retirement-checklist.md",
	"docs/plans/agent-kernel-v2-retirement-checklist.zh.md",
];

test("legacy runtime retirement checklist exists in both locales with the same gate anchors", () => {
	for (const relativePath of retirementDocs) {
		const absolutePath = path.join(projectRoot, relativePath);
		assert.ok(fs.existsSync(absolutePath), `${relativePath} must exist`);
		const source = fs.readFileSync(absolutePath, "utf8");
		for (const requiredText of [
			"Allowed legacy runtime references",
			"Default execution path",
			"AgentRuntimeService",
			"LegacyAgentRuntimeAdapter",
			"taskId",
			"traceId",
			"budget",
		]) {
			assert.ok(source.includes(requiredText), `${relativePath} is missing ${requiredText}`);
		}
	}
});

test("kernel and production default path do not depend on legacy runtime entry points", () => {
	for (const filePath of listFiles(path.join(projectRoot, "src/core/agent-kernel"), ".ts")) {
		const source = fs.readFileSync(filePath, "utf8");
		assert.doesNotMatch(source, /AgentRuntimeService/, `${relative(filePath)} must not reference AgentRuntimeService`);
	}

	const mainSource = read("src/main.ts");
	assert.doesNotMatch(mainSource, /LegacyAgentRuntimeAdapter/, "main must not wire the legacy adapter");
	assert.doesNotMatch(mainSource, /agentRuntimeService\.runTurn\(/, "main must not call the legacy service runTurn");
	assert.match(mainSource, /createFridayPiRuntime\(\)/);
	assert.match(mainSource, /new AgentRuntimeFacade\(\s*new AgentKernel\(fridayPiRuntime\)/);
	assert.doesNotMatch(mainSource, /const agentLoopController: AgentLoopController = this\.agentRuntimeService\.createAgentLoopController\(\);/);

	const orchestratorSource = read("src/core/execution/ExecutionOrchestrator.ts");
	assert.match(orchestratorSource, /AgentRuntimeFacade/);
	assert.doesNotMatch(orchestratorSource, /AgentRuntimeService|LegacyAgentRuntimeAdapter/);
	assert.match(orchestratorSource, /this\.agentRuntimeFacade\.runTurn\(/);
});

test("remaining legacy runtime shells are explicitly marked and whitelisted", () => {
	const runtimeSource = read("src/services/AgentRuntimeService.ts");
	const legacyAdapterSource = read("src/services/LegacyAgentRuntimeAdapter.ts");
	assert.match(runtimeSource, /LEGACY_RUNTIME_RETIREMENT_ALLOWED/);
	assert.match(runtimeSource, /@deprecated Use AgentRuntimeFacade backed by AgentKernel for supported turns\./);
	assert.match(legacyAdapterSource, /LEGACY_RUNTIME_RETIREMENT_ALLOWED/);

	const unexpectedLegacyAdapterUsers = listFiles(path.join(projectRoot, "src"), ".ts")
		.filter((filePath) => !relative(filePath).replace(/\\/g, "/").endsWith("src/services/LegacyAgentRuntimeAdapter.ts"))
		.filter((filePath) => /new LegacyAgentRuntimeAdapter|from "\.\/services\/LegacyAgentRuntimeAdapter"|from "\.\.\/services\/LegacyAgentRuntimeAdapter"/.test(fs.readFileSync(filePath, "utf8")))
		.map(relative);
	assert.deepEqual(unexpectedLegacyAdapterUsers, []);
});

function read(relativePath) {
	return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function listFiles(root, extension) {
	const files = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const filePath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...listFiles(filePath, extension));
			continue;
		}
		if (entry.isFile() && filePath.endsWith(extension)) {
			files.push(filePath);
		}
	}
	return files;
}

function relative(filePath) {
	return path.relative(projectRoot, filePath);
}
