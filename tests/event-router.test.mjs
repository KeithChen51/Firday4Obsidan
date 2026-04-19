/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/execution/EventRouter.ts");

async function loadEventRouterModule() {
	return jiti.import(modulePath);
}

test("event router maps compile requests to runtime compile-wiki skill execution", async () => {
	const mod = await loadEventRouterModule();
	const router = new mod.EventRouter();
	const route = router.route({
		type: "knowledge.compile_requested",
		source: "project_action",
		projectSlug: "demo",
	});
	assert.equal(route.kind, "runtime");
	assert.equal(route.resolution.requestedSkillName, "compile-wiki");
	assert.equal(route.resolution.invocation.request.intentType, "event");
	assert.equal(route.resolution.invocation.request.targetId, "knowledge.compile_requested");
});

test("event router maps conflict proposal requests to runtime resolve-conflict skill execution", async () => {
	const mod = await loadEventRouterModule();
	const router = new mod.EventRouter();
	const route = router.route({
		type: "sync.conflict_proposal_requested",
		source: "project_action",
		projectSlug: "demo",
		prompt: "src/main.ts",
		payload: { filePath: "src/main.ts" },
	});
	assert.equal(route.kind, "runtime");
	assert.equal(route.resolution.requestedSkillName, "resolve-conflict");
	assert.equal(route.resolution.runtimePrompt, "src/main.ts");
	assert.equal(route.resolution.invocation.request.targetId, "sync.conflict_proposal_requested");
});

test("event router rejects legacy memory extraction requests", async () => {
	const mod = await loadEventRouterModule();
	const router = new mod.EventRouter();
	assert.throws(
		() =>
			router.route({
				type: "memory.extraction_requested",
				source: "system_event",
				prompt: "remember this preference",
				payload: { turnId: "turn-123" },
			}),
		/Unsupported runtime event/,
	);
});
