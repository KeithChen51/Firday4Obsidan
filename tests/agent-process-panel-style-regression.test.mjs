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
		"friday-agent-process-thinking",
		"friday-agent-process-header",
		"friday-agent-process-status",
		"friday-agent-process-current",
		"friday-agent-process-step",
		"friday-agent-process-stages",
		"friday-agent-process-timeline",
		"friday-agent-process-evidence",
		"friday-agent-process-mutations",
		"friday-agent-process-actions",
		"friday-agent-process-recovery",
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

test("agent process renderer no longer requires old runtime-card classes", () => {
	const renderer = read(rendererPath);

	assert.match(renderer, /friday-agent-process/);
	assert.doesNotMatch(renderer, /friday-runtime-card/);
	assert.doesNotMatch(renderer, /friday-runtime-stage/);
	assert.doesNotMatch(renderer, /friday-runtime-entry/);
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
