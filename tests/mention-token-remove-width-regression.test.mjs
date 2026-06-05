/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const stylesPath = path.join(projectRoot, "styles.css");
const composerPath = path.join(projectRoot, "src/views/components/MentionComposer.ts");
const mentionDocumentPath = path.join(projectRoot, "src/core/editor/mention/MentionComposerDocument.ts");

function readStyles() {
	return fs.readFileSync(stylesPath, "utf8").replace(/\r\n?/g, "\n");
}

function readComposer() {
	return fs.readFileSync(composerPath, "utf8").replace(/\r\n?/g, "\n");
}

function readMentionDocument() {
	return fs.readFileSync(mentionDocumentPath, "utf8").replace(/\r\n?/g, "\n");
}

function readCssBlock(styles, selector) {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+");
	const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`));
	assert.ok(match, `${selector} block should exist`);
	return match[1] ?? "";
}

function getPixelDeclaration(block, property) {
	const match = block.match(new RegExp(`${property}:\\s*(\\d+)px;`));
	assert.ok(match, `${property} should be declared in px`);
	return Number(match[1]);
}

test("inline token remove button keeps a keyboard-reachable 24px hit area", () => {
	const styles = readStyles();
	const mentionDocument = readMentionDocument();
	const tokenRemoveBlock = readCssBlock(styles, ".friday-inline-mention-token-remove");
	const composerOverrideBlock = readCssBlock(styles, ".friday-ai-composer button.friday-inline-mention-token-remove");

	assert.ok(getPixelDeclaration(tokenRemoveBlock, "width") >= 24);
	assert.ok(getPixelDeclaration(tokenRemoveBlock, "height") >= 24);
	assert.ok(getPixelDeclaration(tokenRemoveBlock, "min-width") >= 24);
	assert.match(tokenRemoveBlock, /flex:\s*0 0 24px;/);
	assert.ok(getPixelDeclaration(composerOverrideBlock, "width") >= 24);
	assert.ok(getPixelDeclaration(composerOverrideBlock, "height") >= 24);
	assert.ok(getPixelDeclaration(composerOverrideBlock, "min-width") >= 24);
	assert.doesNotMatch(mentionDocument, /tabindex:\s*"-1"/);
});

test("inline token remove button handles keyboard activation through click", () => {
	const composer = readComposer();
	const domEventsMatch = composer.match(/handleDOMEvents:\s*\{([\s\S]*?)\n\t\t\t\},/);
	const keydownMatch = composer.match(/private handleKeyDown\(event: KeyboardEvent\): boolean \{([\s\S]*?)\n\t\}\n\n\tprivate handleRemoveTokenEvent/);
	const handlerMatch = composer.match(/private handleRemoveTokenEvent\(event: Event\): boolean \{([\s\S]*?)\n\t\}\n\n\tprivate deleteAdjacentMention/);
	assert.ok(domEventsMatch, "MentionComposer DOM event wiring should exist");
	assert.ok(keydownMatch, "MentionComposer keydown handler should exist");
	assert.ok(handlerMatch, "shared token removal event handler should exist");
	const domEventsBlock = domEventsMatch[1] ?? "";
	const keydownBlock = keydownMatch[1] ?? "";
	const handlerBlock = handlerMatch[1] ?? "";
	const removeButtonGuardIndex = keydownBlock.indexOf('closest("[data-mention-remove=\'true\']")');
	const dropdownKeydownIndex = keydownBlock.indexOf("this.dropdown.handleKeydown(event)");
	const submitIndex = keydownBlock.indexOf('this.options.onSubmit?.()');

	assert.match(domEventsBlock, /mousedown: \(_view, event\) => this\.handleRemoveTokenEvent\(event\)/);
	assert.match(domEventsBlock, /click: \(_view, event\) => this\.handleRemoveTokenEvent\(event\)/);
	assert.ok(removeButtonGuardIndex >= 0, "keydown should identify focused remove buttons");
	assert.ok(dropdownKeydownIndex > removeButtonGuardIndex, "remove button guard should run before dropdown key handling");
	assert.ok(submitIndex > removeButtonGuardIndex, "remove button guard should run before Enter submit");
	assert.match(keydownBlock, /if \(target\?\.closest\("\[data-mention-remove='true'\]"\)\) \{\s*return false;\s*\}/);
	assert.match(handlerBlock, /target\?\.closest<HTMLElement>\("\[data-mention-remove='true'\]"\)/);
	assert.match(handlerBlock, /event\.preventDefault\(\)/);
	assert.match(handlerBlock, /this\.removeMentionById\(mentionId\)/);
});
