/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/commands/SlashSuggestionService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("slash suggestions include builtin skills and system commands", async () => {
	const mod = await loadModule();
	const items = mod.buildSlashSuggestions("/", {
		skills: [
			{ command: "lookup-wiki", description: "Lookup project knowledge" },
		],
		slashCommands: [],
	});
	const values = items.map((item) => item.value);
	assert.equal(values.includes("/skills"), true);
	assert.equal(values.includes("/skill lookup-wiki "), true);
	assert.equal(values.includes("/skill maintain-memory "), false);
});

test("slash suggestions filter by typed prefix", async () => {
	const mod = await loadModule();
	const items = mod.buildSlashSuggestions("/ski", {
		skills: [{ command: "lookup-wiki", description: "Lookup project knowledge" }],
		slashCommands: [{ name: "ship", template: "ship {arg}" }],
	});
	assert.equal(items.some((item) => item.value === "/skills"), true);
	assert.equal(items.some((item) => item.value === "/ship "), false);
});

test("skill suggestions render a friendly skill label instead of raw slash syntax", async () => {
	const mod = await loadModule();
	const items = mod.buildSlashSuggestions("/skill", {
		skills: [{ command: "lookup-wiki", description: "Lookup project knowledge" }],
		slashCommands: [],
	});
	const skillItem = items.find((item) => item.value === "/skill lookup-wiki ");
	assert.equal(skillItem?.label, "lookup-wiki");
	assert.equal(skillItem?.kind, "skill");
	assert.doesNotMatch(skillItem?.label ?? "", /Skill|^\//);
});
