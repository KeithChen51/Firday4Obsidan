/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const stylesPath = path.join(projectRoot, "styles.css");
const rendererPath = path.join(projectRoot, "src/views/agentTrajectoryRenderer.ts");

test("agent process panel styles define the primary friday-agent-process namespace", () => {
	const styles = read(stylesPath);
	for (const className of [
		"friday-agent-process",
		"friday-agent-process-shell",
		"friday-agent-process-disclosure",
		"friday-agent-process-thinking",
		"friday-agent-process-strip",
		"friday-agent-process-header",
		"friday-agent-process-status",
		"friday-agent-process-timeline",
		"friday-agent-process-timeline-panel",
		"friday-agent-process-timeline-item",
		"friday-agent-process-timeline-rail",
		"friday-agent-process-timeline-marker",
		"friday-agent-process-timeline-content",
		"friday-agent-process-timeline-title",
		"friday-agent-process-timeline-summary",
		"friday-agent-process-timeline-meta",
		"friday-agent-process-timeline-detail",
		"friday-agent-process-actions",
		"friday-agent-process-recovery",
	]) {
		assert.match(styles, new RegExp(`\\.${className}\\b`), `${className} should be styled`);
	}
});

test("agent process timeline styles remove fixed narrow primary width caps", () => {
	const styles = read(stylesPath);
	const processBlock = extractProcessCss(styles);

	assert.doesNotMatch(processBlock, /\.friday-agent-process-shell\s*\{[\s\S]*?width:\s*min\(100%,\s*640px\)/);
	assert.doesNotMatch(processBlock, /\.friday-ai-answer-flow\s*\{[\s\S]*?width:\s*min\(100%,\s*720px\)/);
	assert.match(processBlock, /\.friday-agent-process-shell\s*\{[\s\S]*?width:\s*100%/);
	assert.match(processBlock, /\.friday-ai-answer-flow\s*\{[\s\S]*?width:\s*100%/);
	assert.match(processBlock, /\.friday-agent-process-timeline,\s*[\s\S]*?\.friday-ai-answer-content,\s*[\s\S]*?\.friday-agent-artifacts\s*\{[\s\S]*max-width:\s*min\(100%,\s*920px\)/);
});

test("expanded process shell stacks disclosure and timeline vertically", () => {
	const styles = read(stylesPath);
	const shellBlock = styles.match(/\.friday-agent-process-shell\s*\{[\s\S]*?\}/)?.[0] ?? "";

	assert.ok(shellBlock, "process shell style should exist");
	assert.match(shellBlock, /display:\s*flex/);
	assert.match(shellBlock, /flex-direction:\s*column/);
	assert.match(shellBlock, /align-items:\s*stretch/);
});

test("agent process styles do not retain stale runtime preview CSS", () => {
	const styles = read(stylesPath);

	assert.doesNotMatch(styles, /\.friday-ai-runtime-preview\b/);
	assert.doesNotMatch(styles, /\.friday-runtime-[\w-]+\b/);
});

test("agent answer and artifact styles define document-flow result surfaces", () => {
	const styles = read(stylesPath);
	for (const className of [
		"friday-ai-answer-flow",
		"friday-ai-answer-content",
		"friday-agent-artifacts",
		"friday-agent-artifacts-title",
		"friday-agent-artifact-card",
		"friday-agent-artifact-meta",
		"friday-agent-artifact-open",
		"friday-agent-artifact-diff-summary",
	]) {
		assert.match(styles, new RegExp(`\\.${className}\\b`), `${className} should be styled`);
	}
});

test("agent process panel styles use Obsidian variables and restrained operational layout", () => {
	const block = extractProcessCss(read(stylesPath));

	assert.match(block, /var\(--background-secondary\)/);
	assert.match(block, /var\(--background-modifier-border\)/);
	assert.match(block, /var\(--text-muted\)/);
	assert.match(block, /var\(--interactive-accent\)/);
	assert.doesNotMatch(block, /linear-gradient|radial-gradient|backdrop-filter|blur\(/);
	assert.doesNotMatch(block, /border-radius:\s*(?:1[3-9]|[2-9][0-9])px/);
	assert.doesNotMatch(block, /box-shadow:\s*0\s+\d{2,}px/);
});

test("agent process panel styles cover focus responsive and reduced motion states", () => {
	const styles = read(stylesPath);

	assert.match(styles, /\.friday-agent-process(?:-[\w-]+)?[^{}]*:focus-visible/);
	assert.match(styles, /@media\s*\(max-width:\s*720px\)[\s\S]*friday-agent-process/);
	assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*friday-agent-process/);
});

test("agent process motion is scoped and disabled for reduced motion", () => {
	const styles = read(stylesPath);
	const processBlock = extractProcessCss(styles);
	const reducedMotionBlock = styles.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

	assert.match(processBlock, /@keyframes\s+friday-agent-process-pulse/);
	assert.match(processBlock, /@keyframes\s+friday-agent-process-enter/);
	assert.match(processBlock, /\.friday-agent-process-shell\.is-running[\s\S]*animation:\s*friday-agent-process-enter/);
	assert.match(processBlock, /\.friday-agent-process-timeline-item\.is-running\s+\.friday-agent-process-timeline-marker[\s\S]*animation:\s*friday-agent-process-pulse/);
	assert.doesNotMatch(processBlock, /@keyframes\s+(?!friday-agent-process-)[\w-]+/);
	assert.match(reducedMotionBlock, /friday-agent-process[\s\S]*animation:\s*none/);
	assert.doesNotMatch(processBlock, /transition:\s*(?:width|height|top|left|right|bottom|margin|padding)/);
});

test("composer decision panel styles are compact and flatten nested approval cards", () => {
	const styles = read(stylesPath);
	const decisionBlock = extractDecisionCss(styles);

	for (const className of [
		"friday-composer-decision-panel",
		"friday-composer-decision-title",
		"friday-composer-decision-panel .friday-approval-card",
		"friday-composer-decision-panel .friday-approval-actions",
		"friday-composer-decision-panel .friday-mutation-review-diff",
	]) {
		assert.match(styles, new RegExp(`\\.${className.replaceAll(".", "\\.")}\\b`), `${className} should be styled`);
	}
	assert.match(decisionBlock, /overflow-wrap:\s*anywhere/);
	assert.match(decisionBlock, /min-width:\s*0/);
	assert.match(decisionBlock, /box-shadow:\s*none/);
	assert.doesNotMatch(decisionBlock, /linear-gradient|radial-gradient|backdrop-filter|blur\(/);
	assert.doesNotMatch(decisionBlock, /border-radius:\s*(?:1[3-9]|[2-9][0-9])px/);
	assert.match(styles, /@media\s*\(max-width:\s*520px\)[\s\S]*friday-composer-decision-panel/);
	assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*friday-composer-decision-panel[\s\S]*animation:\s*none/);
});

test("agent process disclosure only shows pointer cursor when it is clickable", () => {
	const styles = read(stylesPath);
	const baseBlock = styles.match(/\.friday-agent-process-disclosure\s*\{[\s\S]*?\}/)?.[0] ?? "";

	assert.ok(baseBlock, "base disclosure style should exist");
	assert.doesNotMatch(baseBlock, /cursor\s*:\s*pointer/);
	assert.match(styles, /\.friday-agent-process-disclosure\.is-clickable\s*\{[\s\S]*cursor\s*:\s*pointer/);
	assert.match(styles, /\.friday-agent-process-disclosure\s*\{[\s\S]*justify-content\s*:\s*flex-start/);
	assert.match(styles, /\.friday-agent-process-header-main\s*\{[\s\S]*flex\s*:\s*0\s+1\s+auto/);
});

test("agent process chevron toggle suppresses native button frame", () => {
	const styles = read(stylesPath);
	const toggleBlock = styles.match(/\.friday-agent-process-toggle\s*\{[\s\S]*?\}/)?.[0] ?? "";

	assert.ok(toggleBlock, "toggle style block should exist");
	assert.match(toggleBlock, /appearance\s*:\s*none/);
	assert.match(toggleBlock, /border\s*:\s*(?:0|none)/);
	assert.match(toggleBlock, /background\s*:\s*transparent/);
	assert.match(toggleBlock, /box-shadow\s*:\s*none/);
});

test("agent process disclosure is a compact single-line Native Kit event row", () => {
	const styles = read(stylesPath);
	const disclosureBlock = lastCssBlock(styles, ".friday-agent-process-disclosure");
	const titleBlock = lastCssBlock(styles, ".friday-agent-process-disclosure-title");
	const headlineBlock = lastCssBlock(styles, ".friday-agent-process-headline");
	const summaryBlock = lastCssBlock(styles, ".friday-agent-process-disclosure-summary");

	assert.ok(disclosureBlock, "process disclosure style should exist");
	assert.match(disclosureBlock, /min-height:\s*34px/);
	assert.match(disclosureBlock, /padding:\s*5px\s+8px/);
	assert.match(disclosureBlock, /overflow:\s*hidden/);
	assert.match(titleBlock, /flex-direction:\s*row/);
	for (const [label, block] of [
		["headline", headlineBlock],
		["summary", summaryBlock],
	]) {
		assert.ok(block, `${label} style should exist`);
		assert.match(block, /min-width:\s*0/);
		assert.match(block, /overflow:\s*hidden/);
		assert.match(block, /text-overflow:\s*ellipsis/);
		assert.match(block, /white-space:\s*nowrap/);
		assert.doesNotMatch(block, /overflow-wrap:\s*anywhere/);
	}
});

test("agent process timeline visuals are flattened without rail weight", () => {
	const styles = read(stylesPath);
	const panelBlock = lastCssBlock(styles, ".friday-agent-process-panel");
	const timelinePanelBlock = lastCssBlock(styles, ".friday-agent-process-timeline-panel");
	const timelineBlock = lastCssBlock(styles, ".friday-agent-process-timeline");
	const itemBlock = lastCssBlock(styles, ".friday-agent-process-timeline-item");
	const railBlock = lastCssBlock(styles, ".friday-agent-process-timeline-rail");
	const railLineBlock = lastCssBlock(styles, ".friday-agent-process-timeline-rail::before");

	assert.match(panelBlock, /padding:\s*2px\s+0\s+0/);
	assert.doesNotMatch(panelBlock, /padding:\s*[^;]*\s(?:1[2-9]|[2-9][0-9])px/);
	assert.match(timelinePanelBlock, /padding:\s*0/);
	assert.match(timelineBlock, /gap:\s*6px/);
	assert.match(itemBlock, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
	assert.match(railBlock, /display:\s*none/);
	assert.match(railLineBlock, /display:\s*none/);
	assert.doesNotMatch(railLineBlock, /background:/);
});

test("Native Kit running process animation is disabled for reduced motion", () => {
	const styles = read(stylesPath);
	const reducedMotionBlocks = [...styles.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g)]
		.map((match) => match[0])
		.join("\n");

	assert.match(styles, /\.kit-running-surface-v1::after[\s\S]*animation:\s*friday-kit-running-line/);
	assert.match(reducedMotionBlocks, /\.kit-running-surface-v1::after[\s\S]*animation:\s*none/);
	assert.match(reducedMotionBlocks, /\.kit-running-surface-v1::after[\s\S]*opacity:\s*0/);
});

test("agent process renderer no longer requires old runtime-card classes", () => {
	const renderer = read(rendererPath);

	assert.match(renderer, /friday-agent-process/);
	assert.match(renderer, /friday-agent-process-timeline-item/);
	assert.match(renderer, /friday-ai-answer-flow/);
	assert.match(renderer, /friday-agent-artifacts/);
	assert.doesNotMatch(renderer, /friday-runtime-card/);
	assert.doesNotMatch(renderer, /friday-runtime-stage/);
	assert.doesNotMatch(renderer, /friday-runtime-entry/);
	assert.doesNotMatch(renderer, /renderVisibleStepTimeline/);
	assert.doesNotMatch(renderer, /friday-agent-process-step/);
	assert.doesNotMatch(renderer, /renderStages|friday-agent-process-stages/);
	assert.doesNotMatch(renderer, /renderCurrent|friday-agent-process-current/);
});

test("agent process renderer exposes Native Kit timeline and file type hooks", () => {
	const renderer = read(rendererPath);

	for (const className of [
		"kit-event-row-v1",
		"kit-running-surface-v1",
		"kit-event-row-main-v1",
		"kit-file-type-icon-v1",
		"is-markdown",
		"is-canvas",
		"is-code",
		"is-note",
	]) {
		assert.match(renderer, new RegExp(className), `${className} should be emitted by the renderer`);
	}
});

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

function lastCssBlock(styles, selector) {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const matches = [...styles.matchAll(new RegExp(`^${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "gm"))];
	return matches.at(-1)?.[1] ?? "";
}

function extractProcessCss(styles) {
	const start = styles.indexOf("/* Agent process panel */");
	const end = styles.indexOf("/* End agent process panel */");
	if (start >= 0 && end > start) {
		return styles.slice(start, end);
	}
	return styles;
}

function extractDecisionCss(styles) {
	const start = styles.indexOf("/* Composer decision panel */");
	const end = styles.indexOf("/* End composer decision panel */");
	if (start >= 0 && end > start) {
		return styles.slice(start, end);
	}
	return styles;
}
