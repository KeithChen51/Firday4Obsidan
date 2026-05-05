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
		"friday-agent-process-disclosure",
		"friday-agent-process-thinking",
		"friday-agent-process-strip",
		"friday-agent-process-header",
		"friday-agent-process-status",
		"friday-agent-process-step",
		"friday-agent-process-timeline",
		"friday-agent-process-step-actions",
		"friday-agent-process-actions",
		"friday-agent-process-recovery",
	]) {
		assert.match(styles, new RegExp(`\\.${className}\\b`), `${className} should be styled`);
	}
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

test("agent process renderer no longer requires old runtime-card classes", () => {
	const renderer = read(rendererPath);

	assert.match(renderer, /friday-agent-process/);
	assert.match(renderer, /friday-ai-answer-flow/);
	assert.match(renderer, /friday-agent-artifacts/);
	assert.doesNotMatch(renderer, /friday-runtime-card/);
	assert.doesNotMatch(renderer, /friday-runtime-stage/);
	assert.doesNotMatch(renderer, /friday-runtime-entry/);
	assert.doesNotMatch(renderer, /renderStages|friday-agent-process-stages/);
	assert.doesNotMatch(renderer, /renderCurrent|friday-agent-process-current/);
});

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

function extractProcessCss(styles) {
	const start = styles.indexOf("/* Agent process panel */");
	const end = styles.indexOf("/* End agent process panel */");
	if (start >= 0 && end > start) {
		return styles.slice(start, end);
	}
	return styles;
}
