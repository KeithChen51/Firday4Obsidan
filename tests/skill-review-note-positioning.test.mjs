/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/views/skillReviewNotePopoverPlacement.ts");

async function loadPlacementModule() {
	return jiti.import(modulePath);
}

test("prefers bottom placement when the viewport has enough room below the trigger", async () => {
	const mod = await loadPlacementModule();
	const result = mod.computeSkillReviewNotePopoverLayout(
		{ left: 100, top: 80, width: 24, height: 24 },
		{ width: 900, height: 700 },
	);

	assert.equal(result.placement, "bottom");
	assert.ok(result.top >= 112, "bottom placement should keep the popover below the trigger");
	assert.equal(result.maxHeight, 576);
	assert.ok(result.width >= 360, "bottom placement should keep a readable width when the viewport allows it");
});

test("flips to top placement when opening downward would overflow the viewport bottom edge", async () => {
	const mod = await loadPlacementModule();
	const result = mod.computeSkillReviewNotePopoverLayout(
		{ left: 180, top: 620, width: 24, height: 24 },
		{ width: 900, height: 760 },
	);

	assert.equal(result.placement, "top");
	assert.equal(result.maxHeight, 600);
	assert.ok(result.top < 620, "top placement should move the popover above the trigger");
});

test("falls back to horizontal placement when vertical space is cramped but the side area is much better", async () => {
	const mod = await loadPlacementModule();
	const result = mod.computeSkillReviewNotePopoverLayout(
		{ left: 280, top: 300, width: 24, height: 24 },
		{ width: 980, height: 420 },
	);

	assert.equal(result.placement, "right");
	assert.ok(result.left > 304, "right placement should move the popover to the trigger's side");
	assert.equal(result.maxHeight, 396);
	assert.ok(result.width >= 400, "side placement should widen the panel instead of forcing a tall narrow column");
});

test("clamps width and coordinates so the popover still stays inside the frozen viewport snapshot", async () => {
	const mod = await loadPlacementModule();
	const result = mod.computeSkillReviewNotePopoverLayout(
		{ left: 12, top: 24, width: 24, height: 24 },
		{ width: 320, height: 260 },
	);

	assert.equal(result.placement, "bottom");
	assert.equal(result.left, 12);
	assert.equal(result.width, 296);
	assert.equal(result.maxHeight, 192);
	assert.ok(result.top > 48, "bottom placement should stay below the trigger when height allows it");
	assert.ok(result.left >= 12, "left edge should be clamped inside viewport padding");
	assert.ok(result.top >= 12, "top edge should be clamped inside viewport padding");
});
