/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const adapterPath = path.join(projectRoot, "src/services/ToolExecutionAdapter.ts");

test("ToolExecutionAdapter delegates tool listing execution and mutation recording", async () => {
	const { ToolExecutionAdapter } = await jiti.import(adapterPath);
	const calls = [];
	const adapter = new ToolExecutionAdapter({
		async listNativeTools(input) {
			calls.push(["list", input.allowedTools]);
			return [{ name: "read", description: "Read", parameters: { type: "object" } }];
		},
		async executeTool(input) {
			calls.push(["execute", input.step, input.tool.name]);
			return {
				trace: {
					runId: "read-1",
					step: input.step,
					tool: input.tool.name,
					scope: "vault",
					targetPath: "Project/a.md",
					approved: true,
					approvalReason: "No approval required",
					persistedRule: false,
					viaRule: false,
					status: "ok",
					ok: true,
					summary: "Read Project/a.md",
				},
				payload: { ok: true, tool: "read", data: { content: "alpha" } },
				modelResultText: "TOOL_RESULT alpha",
				loadedSkillContext: "",
			};
		},
		recordMutationPlans(envelope, source) {
			calls.push(["mutations", source]);
			return envelope.mutations ?? [];
		},
	});

	const tools = await adapter.listNativeTools({ allowedTools: ["read"] });
	const result = await adapter.executeTool({
		step: 1,
		tool: { name: "read", args: { path: "Project/a.md" } },
	});
	const mutations = adapter.recordMutationPlans({ mutations: [{ id: "m1" }] }, "model_envelope");

	assert.deepEqual(tools.map((tool) => tool.name), ["read"]);
	assert.equal(result.trace.tool, "read");
	assert.equal(result.modelResultText, "TOOL_RESULT alpha");
	assert.deepEqual(mutations, [{ id: "m1" }]);
	assert.deepEqual(calls, [
		["list", ["read"]],
		["execute", 1, "read"],
		["mutations", "model_envelope"],
	]);
});
