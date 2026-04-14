/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/features/wiki/TagPolicyRuntime.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("default governance assets include required tag-policy files", async () => {
	const mod = await loadModule();
	const assets = mod.getDefaultTagPolicyAssets();
	assert.equal(typeof assets["tag-policy.json"], "string");
	assert.equal(typeof assets["tag-policy.rules.md"], "string");
	assert.equal(typeof assets["tag-policy.schema.json"], "string");
	assert.equal(typeof assets["tags-catalog.md"], "string");
});

test("tag policy applies deterministic archive rule from runtime file", async () => {
	const mod = await loadModule();
	const policy = mod.parseTagPolicy(JSON.stringify({
		version: "1.0",
		policyId: "test-policy",
		autoArchiveFromTagRules: false,
		sourcePriority: ["manual", "rule", "ai"],
		rules: [
			{
				id: "spec-tag",
				enabled: true,
				deterministic: true,
				when: {
					zoneIn: ["archive_source"],
					pathPrefixAny: ["raw/specs/"],
				},
				then: {
					addTags: ["doc/spec", "archive/candidate"],
					targetZone: "archive_source",
					moveTo: "raw/archive/specs/",
					renameTo: "{{slug}}.md",
					emitSuggestionOnly: true,
				},
			},
		],
	}));
	const result = mod.evaluateTagPolicy(policy, {
		projectRelativePath: "raw/specs/api.md",
		fileName: "api.md",
		contextZone: "archive_source",
		frontmatter: {},
		existingTags: [],
	});
	assert.deepEqual(result.tags, ["doc/spec", "archive/candidate"]);
	assert.equal(result.targetZone, "archive_source");
	assert.equal(result.matchedRuleIds[0], "spec-tag");
	assert.equal(result.suggestionOnly, true);
});

test("tag policy detects incompatible deterministic targets as conflict", async () => {
	const mod = await loadModule();
	const policy = mod.parseTagPolicy(JSON.stringify({
		version: "1.0",
		policyId: "conflict-policy",
		autoArchiveFromTagRules: false,
		sourcePriority: ["manual", "rule", "ai"],
		rules: [
			{
				id: "r1",
				enabled: true,
				deterministic: true,
				when: { zoneIn: ["archive_source"] },
				then: { addTags: ["doc/spec"], targetZone: "archive_source", moveTo: "raw/a/", emitSuggestionOnly: false },
			},
			{
				id: "r2",
				enabled: true,
				deterministic: true,
				when: { zoneIn: ["archive_source"] },
				then: { addTags: ["doc/spec"], targetZone: "workspace_draft", moveTo: "raw/b/", emitSuggestionOnly: false },
			},
		],
	}));
	const result = mod.evaluateTagPolicy(policy, {
		projectRelativePath: "raw/specs/api.md",
		fileName: "api.md",
		contextZone: "archive_source",
		frontmatter: {},
		existingTags: [],
	});
	assert.equal(result.conflict, true);
	assert.equal(result.suggestionOnly, true);
	assert.equal(result.targetZone, "");
});
