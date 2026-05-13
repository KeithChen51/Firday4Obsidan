/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const stylesPath = path.join(projectRoot, "styles.css");
const dropdownPath = path.join(projectRoot, "src/views/components/MentionDropdown.ts");
const zhLocalePath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const enLocalePath = path.join(projectRoot, "src/i18n/locales/en-US.ts");
function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

function cssBlock(styles, selector) {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return styles.match(new RegExp(`^${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"))?.[1] ?? "";
}

function lastCssBlock(styles, selector) {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const matches = [...styles.matchAll(new RegExp(`^${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "gm"))];
	return matches.at(-1)?.[1] ?? "";
}

function numericPxProperty(block, property) {
	const match = block.match(new RegExp(`${property}:\\s*([0-9]+)px`));
	if (match) {
		return Number.parseInt(match[1], 10);
	}
	const tokenFallbackMatch = block.match(new RegExp(`${property}:\\s*var\\([^,]+,\\s*([0-9]+)px\\)`));
	return tokenFallbackMatch ? Number.parseInt(tokenFallbackMatch[1], 10) : null;
}

test("ordinary plugin surfaces stay flat and Obsidian-native", () => {
	const styles = read(stylesPath);
	const ordinarySelectors = [
		".friday-shell-header",
		".friday-top-nav",
		".friday-ai-chat-shell",
		".friday-ai-session-drawer",
		".friday-native-settings-group",
		".friday-project-settings-panel",
		".friday-control-center-item",
	];

	assert.doesNotMatch(styles, /radial-gradient\(/, "normal plugin UI must not use decorative radial lighting");
	for (const selector of ordinarySelectors) {
		const block = cssBlock(styles, selector);
		assert.ok(block, `${selector} should exist`);
		assert.doesNotMatch(block, /linear-gradient\(/, `${selector} should use theme surfaces instead of gradients`);
		assert.doesNotMatch(block, /box-shadow:\s*0\s+[0-9]/, `${selector} should avoid floating-card shadows`);
	}
});

test("ordinary plugin surface radii follow DESIGN.md limits", () => {
	const styles = read(stylesPath);
	const groupedSurfaces = [
		".friday-shell-header",
		".friday-top-nav",
		".friday-ai-chat-shell",
		".friday-ai-session-drawer",
		".friday-native-settings-group",
		".friday-project-settings-panel",
		".friday-control-center-item",
	];
	for (const selector of groupedSurfaces) {
		const block = cssBlock(styles, selector);
		const radius = numericPxProperty(block, "border-radius");
		assert.ok(radius != null, `${selector} should declare an explicit radius`);
		assert.ok(radius <= 12, `${selector} radius should be <= 12px, got ${radius}px`);
	}

	const controls = [
		".friday-nav-button",
		".friday-shell-icon-button",
		".friday-ai-toolbar-select-host",
		".friday-ai-toolbar-button",
		".friday-ai-send-button",
		".friday-control-center-item-note-button",
	];
	for (const selector of controls) {
		const block = cssBlock(styles, selector);
		const radius = numericPxProperty(block, "border-radius");
		assert.ok(radius != null, `${selector} should declare an explicit radius`);
		assert.ok(radius >= 6 && radius <= 8, `${selector} control radius should be 6-8px, got ${radius}px`);
	}
});

test("core design selectors have one source of truth", () => {
	const styles = read(stylesPath);
	for (const selector of [
		".friday-shell-header",
		".friday-top-nav",
		".friday-page-content",
		".friday-ai-chat-shell",
		".friday-agent-process-shell",
	]) {
		const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const matches = styles.match(new RegExp(`^${escaped}\\s*\\{`, "gm")) ?? [];
		assert.equal(matches.length, 1, `${selector} should not have duplicate top-level rules`);
	}
});

test("agent process completion indicators avoid saturated success green", () => {
	const styles = read(stylesPath);
	const completedTimelineMarker = lastCssBlock(
		styles,
		".friday-agent-process-timeline-item.is-done .friday-agent-process-timeline-marker",
	);
	const completedStatus = lastCssBlock(
		styles,
		".friday-agent-process-status.is-completed,\n.friday-agent-process-status.is-safe_stopped",
	);

	assert.ok(completedTimelineMarker, "completed timeline marker should be styled");
	assert.doesNotMatch(completedTimelineMarker, /var\(--color-green\)/);
	assert.match(completedTimelineMarker, /var\(--text-faint\)|var\(--text-muted\)|var\(--background-modifier-border\)/);
	assert.doesNotMatch(completedStatus, /var\(--color-green\)\s*(?:[4-9][0-9]|100)%/);
});

test("compact icon controls keep accessible hit areas", () => {
	const styles = read(stylesPath);
	const noteButton = cssBlock(styles, ".friday-control-center-item-note-button");
	assert.match(noteButton, /width:\s*28px;/);
	assert.match(noteButton, /height:\s*28px;/);

	const removeButton = cssBlock(styles, ".friday-ai-composer button.friday-inline-mention-token-remove");
	assert.match(removeButton, /width:\s*12px;/);
	assert.match(removeButton, /height:\s*12px;/);
	assert.match(removeButton, /min-width:\s*12px;/);
});

test("mention dropdown exposes combobox list semantics", () => {
	const source = read(dropdownPath);
	assert.match(source, /role:\s*"listbox"/);
	assert.match(source, /role:\s*"option"/);
	assert.match(source, /aria-selected/);
	assert.match(source, /aria-activedescendant/);
	assert.match(source, /friday-mention-option-\$\{index\}/);
});

test("F.R.I.D.A.Y remains visible only as a directory or official column path", () => {
	for (const source of [read(zhLocalePath), read(enLocalePath)]) {
		assert.doesNotMatch(source, /接管 F\.R\.I\.D\.A\.Y(?!\/| 目录| 栏目| 路径)/);
		assert.doesNotMatch(source, /take over F\.R\.I\.D\.A\.Y(?!\/| directory| column| path)/i);
	}
});
