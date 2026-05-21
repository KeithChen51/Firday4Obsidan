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
const RETIRED_PROCESS_STYLE_CLASSES = [
	"friday-agent-process-shell",
	"friday-agent-process-disclosure",
	"friday-agent-process-disclosure-summary",
	"friday-agent-process-thinking",
	"friday-agent-process-strip",
	"friday-agent-process-header",
	"friday-agent-process-status",
	"friday-agent-process-statusbar",
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
	"friday-agent-process-step",
	"friday-agent-process-step-card-v2",
	"friday-agent-process-recovery",
	"friday-agent-process-command-details",
	"friday-agent-process-command-summary",
	"friday-agent-process-command-list",
	"friday-agent-process-command-row",
];

test("agent process panel styles use current Native Kit process classes and retire old timeline shells", () => {
	const styles = read(stylesPath);
	for (const className of [
		"assistant-process-detail-v6",
		"assistant-process-detail-inner-v6",
		"assistant-process-step-v6",
		"assistant-process-event-v6",
		"assistant-step-toggle-v6",
		"assistant-step-detail-v6",
		"assistant-step-detail-inner-v6",
		"assistant-step-narration-v6",
		"assistant-tool-call-v5",
		"friday-agent-process-actions",
	]) {
		assert.match(styles, new RegExp(`\\.${className}\\b`), `${className} should be styled`);
	}
	for (const retiredClassName of RETIRED_PROCESS_STYLE_CLASSES) {
		assert.doesNotMatch(styles, new RegExp(`\\.${retiredClassName}\\b`), `${retiredClassName} should not keep CSS`);
	}
});

test("agent process timeline styles remove fixed narrow primary width caps", () => {
	const styles = read(stylesPath);
	const processBlock = extractProcessCss(styles);

	assert.doesNotMatch(processBlock, /\.friday-agent-process-shell\s*\{[\s\S]*?width:\s*min\(100%,\s*640px\)/);
	assert.doesNotMatch(processBlock, /\.friday-ai-answer-flow\s*\{[\s\S]*?width:\s*min\(100%,\s*720px\)/);
	assert.doesNotMatch(processBlock, /\.friday-agent-process-shell\b/);
	assert.match(processBlock, /\.friday-ai-answer-flow\s*\{[\s\S]*?width:\s*100%/);
	assert.match(processBlock, /\.friday-ai-answer-content,\s*[\s\S]*?\.friday-agent-artifacts\s*\{[\s\S]*max-width:\s*min\(100%,\s*920px\)/);
});

test("expanded process detail stacks Native Kit steps vertically", () => {
	const styles = read(stylesPath);
	const detailInnerBlock = lastCssBlock(styles, ".assistant-process-detail-inner-v6");
	const stepBlock = lastCssBlock(styles, ".assistant-process-step-v6");

	assert.ok(detailInnerBlock, "process detail inner style should exist");
	assert.match(detailInnerBlock, /display:\s*grid/);
	assert.match(detailInnerBlock, /gap:\s*var\(--friday-kit-space-1\)/);
	assert.match(stepBlock, /display:\s*grid/);
	assert.match(stepBlock, /min-width:\s*0/);
});

test("agent process styles do not retain stale runtime preview CSS", () => {
	const styles = read(stylesPath);

	assert.doesNotMatch(styles, /\.friday-ai-runtime-preview\b/);
	assert.doesNotMatch(styles, /\.friday-runtime-[\w-]+\b/);
});

test("agent answer and artifact styles define document-flow result surfaces", () => {
	const styles = read(stylesPath);
	const nativeVariableScope = lastCssBlock(styles, ".friday-daily-board");
	for (const className of [
		"assistant-turn-v2",
		"assistant-source-mark-v3",
		"assistant-turn-body-v2",
		"assistant-meta-v2",
		"assistant-result-meta-v6",
		"assistant-process-toggle-v6",
		"assistant-process-detail-v6",
		"assistant-process-detail-inner-v6",
		"assistant-process-step-v6",
		"assistant-process-event-v6",
		"assistant-step-toggle-v6",
		"assistant-step-detail-v6",
		"assistant-step-detail-inner-v6",
		"assistant-step-narration-v6",
		"assistant-output-stack-v3",
		"assistant-output-block",
		"assistant-tool-call-v5",
		"assistant-tool-name-v5",
		"assistant-tool-detail-v5",
		"assistant-block-title",
		"assistant-artifact-list-v4",
		"assistant-artifact-row-v4",
		"friday-ai-answer-flow",
		"friday-ai-answer-content",
		"friday-agent-artifacts",
		"friday-agent-artifacts-title",
		"friday-agent-artifact-card",
		"friday-agent-artifact-icon",
		"friday-agent-artifact-name",
	]) {
		assert.match(styles, new RegExp(`\\.${className}\\b`), `${className} should be styled`);
	}
	const proseBlock = lastCssBlock(styles, ".assistant-output-block.is-prose");
	const sourceMarkBlock = lastCssBlock(styles, ".assistant-source-mark-v3");
	const userBubbleBlock = lastCssBlock(styles, ".friday-shell .friday-ai-message.is-user");
	const resultMetaBlock = lastCssBlock(styles, ".assistant-result-meta-v6");
	const processChevronBlock = lastCssBlock(styles, ".assistant-process-chevron-v6");
	const artifactRowBlock = lastCssBlock(styles, ".assistant-artifact-row-v4");
	const outputBlock = lastCssBlock(styles, ".assistant-output-block");
	const artifactBlock = lastCssBlock(styles, ".assistant-output-block.is-artifact");
	const toolDetailBlock = lastCssBlock(styles, ".assistant-tool-detail-v5");
	const stepDetailBlock = lastCssBlock(styles, ".assistant-step-detail-v6");
	const narrationBlock = lastCssBlock(styles, ".assistant-step-narration-v6");

	assert.match(nativeVariableScope, /--space-1:\s*4px/);
	assert.match(nativeVariableScope, /--space-2:\s*8px/);
	assert.match(nativeVariableScope, /--space-3:\s*12px/);
	assert.match(proseBlock, /background:\s*transparent/);
	assert.match(proseBlock, /padding:\s*2px\s+0/);
	assert.match(userBubbleBlock, /border-color:\s*color-mix\(in srgb,\s*var\(--interactive-accent\)\s+30%,\s*var\(--background-modifier-border\)\)/);
	assert.match(userBubbleBlock, /background:\s*color-mix\(in srgb,\s*var\(--interactive-accent\)\s+10%,\s*var\(--background-primary\)\)/);
	assert.match(sourceMarkBlock, /margin-top:\s*3px/);
	assert.match(resultMetaBlock, /gap:\s*var\(--space-2\)(?:\s*!important)?/);
	assert.match(resultMetaBlock, /align-items:\s*center/);
	assert.match(processChevronBlock, /display:\s*inline-flex/);
	assert.match(processChevronBlock, /align-items:\s*center/);
	assert.match(processChevronBlock, /justify-content:\s*center/);
	assert.match(outputBlock, /background:\s*var\(--background-primary\)/);
	assert.match(artifactBlock, /background:\s*var\(--background-primary\)/);
	assert.match(artifactRowBlock, /grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/);
	assert.doesNotMatch(artifactRowBlock, /grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
	assert.match(artifactRowBlock, /cursor:\s*pointer/);
	assert.match(artifactRowBlock, /gap:\s*var\(--space-2\)/);
	assert.match(artifactRowBlock, /border:\s*1px\s+solid\s+var\(--background-modifier-border\)/);
	assert.match(artifactRowBlock, /border-radius:\s*var\(--radius-s\)/);
	assert.match(artifactRowBlock, /background:\s*var\(--background-primary\)/);
	assert.match(toolDetailBlock, /text-overflow:\s*ellipsis/);
	assert.match(stepDetailBlock, /grid-template-rows:\s*0fr/);
	assert.match(narrationBlock, /white-space:\s*normal/);
	assert.match(narrationBlock, /overflow:\s*visible/);
	assert.match(narrationBlock, /overflow-wrap:\s*anywhere/);
});

test("Native Kit assistant process artifact and task bar surfaces do not use non-catalog shadows", () => {
	const styles = read(stylesPath);
	const selectors = [
		".assistant-turn-v2",
		".assistant-turn-body-v2",
		".assistant-result-meta-v6",
		".assistant-process-toggle-v6",
		".assistant-process-detail-v6",
		".assistant-process-step-v6",
		".assistant-process-event-v6",
		".assistant-step-detail-v6",
		".assistant-output-stack-v3",
		".assistant-output-block",
		".assistant-tool-call-v5",
		".assistant-artifact-row-v4",
		".composer-taskbar-kit-v5",
		".composer-taskbar-summary-v5",
		".composer-taskbar-task-v5",
		".composer-taskbar-marker-v5",
		".friday-composer-task-bar",
	];

	for (const selector of selectors) {
		const blocks = cssBlocksContainingSelector(styles, selector);
		assert.ok(blocks.length > 0, `${selector} should have a CSS block`);
		for (const block of blocks) {
			assertNoNonCatalogShadow(block, selector);
		}
	}
});

test("Native Kit button surfaces reset Obsidian default button shadows", () => {
	const styles = read(stylesPath);

	for (const selector of [
		"button.assistant-result-meta-v6",
		".assistant-step-toggle-v6",
		"button.kit-event-row-v1.assistant-step-toggle-v6",
		".composer-taskbar-summary-v5",
	]) {
		const block = lastCssBlock(styles, selector);
		assert.ok(block, `${selector} should have an explicit base style`);
		assert.match(block, /box-shadow:\s*none/);
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

	assert.match(styles, /\.assistant-step-toggle-v6:focus-visible/);
	assert.match(styles, /@media\s*\(max-width:\s*760px\)[\s\S]*kit-event-row-v1/);
	assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*assistant-process-detail-v6/);
});

test("agent process motion is scoped and disabled for reduced motion", () => {
	const styles = read(stylesPath);
	const processBlock = extractProcessCss(styles);

	assert.match(processBlock, /@keyframes\s+friday-agent-process-enter/);
	assert.doesNotMatch(processBlock, /@keyframes\s+friday-agent-process-pulse/);
	assert.match(styles, /\.friday-composer-decision-panel\s*\{[\s\S]*animation:\s*friday-agent-process-enter/);
	assert.match(styles, /\.kit-running-surface-v1::after[\s\S]*animation:\s*friday-kit-running-sheen/);
	assert.doesNotMatch(processBlock, /@keyframes\s+(?!friday-agent-process-)[\w-]+/);
	assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.kit-running-surface-v1::after[\s\S]*animation:\s*none/);
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

test("assistant process toggles use Native Kit controls instead of retired disclosure rows", () => {
	const styles = read(stylesPath);
	const metaButtonBlock = lastCssBlock(styles, "button.assistant-result-meta-v6");
	const stepToggleBlock = lastCssBlock(styles, ".assistant-step-toggle-v6");

	assert.doesNotMatch(styles, /\.friday-agent-process-disclosure\b/);
	assert.match(metaButtonBlock, /cursor\s*:\s*pointer/);
	assert.match(metaButtonBlock, /box-shadow:\s*none/);
	assert.match(stepToggleBlock, /cursor:\s*pointer/);
});

test("assistant process chevron toggle suppresses native button frame", () => {
	const styles = read(stylesPath);
	const toggleBlock = lastCssBlock(styles, ".assistant-process-toggle-v6");

	assert.ok(toggleBlock, "toggle style block should exist");
	assert.match(toggleBlock, /border\s*:\s*(?:0|none)/);
	assert.match(toggleBlock, /background\s*:\s*transparent/);
	assert.match(lastCssBlock(styles, "button.assistant-result-meta-v6"), /box-shadow\s*:\s*none/);
});

test("assistant process event rows are compact Native Kit rows", () => {
	const styles = read(stylesPath);
	const eventBlock = lastCssBlock(styles, ".assistant-process-event-v6");
	const narrationBlock = lastCssBlock(styles, ".assistant-step-narration-v6");

	assert.ok(eventBlock, "process event row style should exist");
	assert.match(eventBlock, /min-height:\s*32px/);
	assert.match(eventBlock, /padding:\s*3px\s+8px/);
	assert.match(narrationBlock, /overflow-wrap:\s*anywhere/);
	assert.match(narrationBlock, /white-space:\s*normal/);
});

test("old agent process timeline rails and command drill-down styles are retired", () => {
	const styles = read(stylesPath);
	const proseAfterProcessBlock = lastCssBlock(styles, ".friday-agent-process-shell + .friday-ai-answer-content.assistant-output-block.is-prose");

	for (const retiredClassName of [
		"friday-agent-process-timeline-item",
		"friday-agent-process-timeline-rail",
		"friday-agent-process-timeline-marker",
		"friday-agent-process-timeline-content",
		"friday-agent-process-timeline-detail",
		"friday-agent-process-command-details",
		"friday-agent-process-command-summary",
		"friday-agent-process-command-list",
		"friday-agent-process-command-row",
	]) {
		assert.doesNotMatch(styles, new RegExp(`\\.${retiredClassName}\\b`), `${retiredClassName} should be retired`);
	}
	assert.equal(proseAfterProcessBlock, "");
	assert.match(styles, /\.assistant-tool-call-v5\s*\{[\s\S]*border-color:\s*color-mix/);
	assert.match(styles, /\.assistant-tool-call-v5\s+\.kit-event-row-main-v1\s*\{[\s\S]*font-size:\s*0\.74rem/);
});

test("Native Kit running process animation is disabled for reduced motion", () => {
	const styles = read(stylesPath);
	const runningBlocks = cssBlocksContainingSelector(styles, ".kit-running-surface-v1").join("\n");
	const reducedMotionBlocks = [...styles.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g)]
		.map((match) => match[0])
		.join("\n");

	assert.match(runningBlocks, /border-color:\s*color-mix\(in srgb,\s*var\(--interactive-accent\)\s+34%,\s*var\(--background-modifier-border\)\)/);
	assert.match(runningBlocks, /background:\s*color-mix\(in srgb,\s*var\(--interactive-accent\)\s+9%,\s*var\(--background-primary\)\)/);
	assert.match(styles, /\.kit-running-surface-v1::after[\s\S]*animation:\s*friday-kit-running-sheen\s+1[6-8]00ms\s+ease-in-out\s+infinite/);
	assert.match(styles, /\.kit-event-row-v1\.kit-running-surface-v1\.assistant-tool-call-v5[\s\S]*grid-template-columns:\s*18px\s+minmax\(0,\s*1fr\)\s+auto/);
	assert.match(styles, /@keyframes\s+friday-kit-running-sheen[\s\S]*translateX\(-100%\)[\s\S]*translateX\(100%\)/);
	assert.match(reducedMotionBlocks, /\.kit-running-surface-v1::after[\s\S]*animation:\s*none/);
	assert.match(reducedMotionBlocks, /\.kit-running-surface-v1::after[\s\S]*opacity:\s*0/);
	assert.doesNotMatch(styles, /\.friday-composer-task-bar\.is-running::after/);
	assert.doesNotMatch(styles, /\.composer-taskbar-kit-v5\.is-running::after/);
});

test("composer task bar styles attach to the input surface without breaking narrow or reduced-motion contracts", () => {
	const styles = read(stylesPath);
	const hostBlock = lastCssBlock(styles, ".friday-ai-composer-task-bar-host:not(:empty)");
	const attachedInputBlock = lastCssBlock(styles, ".friday-ai-composer-task-bar-host:not(:empty) + .friday-ai-composer");
	const attachedBarBlock = lastCssBlock(styles, ".friday-ai-composer-task-bar-host > .friday-composer-task-bar");
	const taskBarBlock = lastCssBlock(styles, ".friday-composer-task-bar");
	const kitTaskBarBlock = lastCssBlock(styles, ".composer-taskbar-kit-v5");
	const kitTaskBarRunningBlock = lastCssBlock(styles, ".composer-taskbar-kit-v5.is-running");
	const summaryBlock = cssBlocksContainingSelector(styles, ".composer-taskbar-summary-v5").join("\n");
	const taskBlock = cssBlocksContainingSelector(styles, ".composer-taskbar-task-v5").join("\n");
	const markerBlock = cssBlocksContainingSelector(styles, ".composer-taskbar-marker-v5").join("\n");
	const narrowBlocks = [...styles.matchAll(/@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*?\n\}/g)]
		.map((match) => match[0])
		.join("\n");
	const reducedMotionBlocks = [...styles.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g)]
		.map((match) => match[0])
		.join("\n");

	assert.match(hostBlock, /margin-bottom:\s*-1px/);
	assert.match(attachedInputBlock, /border-top-left-radius:\s*0/);
	assert.match(attachedInputBlock, /border-top-right-radius:\s*0/);
	assert.match(attachedBarBlock, /border-bottom-right-radius:\s*0/);
	assert.match(attachedBarBlock, /border-bottom-left-radius:\s*0/);
	assert.match(taskBarBlock, /margin-bottom:\s*0/);
	assert.match(narrowBlocks, /\.kit-event-row-v1[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
	assert.match(kitTaskBarBlock, /border:\s*1px\s+solid\s+var\(--background-modifier-border\)/);
	assert.match(kitTaskBarBlock, /border-radius:\s*var\(--radius-m\)/);
	assert.match(kitTaskBarBlock, /background:\s*var\(--background-primary\)/);
	assert.match(kitTaskBarRunningBlock, /background:\s*color-mix\(in srgb,\s*var\(--interactive-accent\)\s+7%,\s*var\(--background-primary\)\)/);
	assert.match(summaryBlock, /grid-template-columns:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto/);
	assert.match(summaryBlock, /gap:\s*var\(--space-2\)/);
	assert.match(summaryBlock, /min-height:\s*34px/);
	assert.match(summaryBlock, /padding:\s*6px\s+8px/);
	assert.match(summaryBlock, /background:\s*transparent(?:\s*!important)?/);
	assert.match(taskBlock, /grid-template-columns:\s*18px\s+42px\s+minmax\(0,\s*1fr\)\s+auto/);
	assert.match(taskBlock, /gap:\s*var\(--space-2\)/);
	assert.match(taskBlock, /padding:\s*7px\s+10px/);
	assert.match(taskBlock, /background:\s*color-mix\(in srgb,\s*var\(--interactive-accent\)\s+8%,\s*transparent\)/);
	assert.match(markerBlock, /width:\s*18px/);
	assert.match(markerBlock, /height:\s*18px/);
	assert.match(markerBlock, /background:\s*var\(--background-primary-alt\)/);
	assert.match(markerBlock, /color:\s*var\(--text-muted\)/);
	assert.doesNotMatch(reducedMotionBlocks, /\.friday-composer-task-bar\.is-running::after/);
	assert.doesNotMatch(reducedMotionBlocks, /\.composer-taskbar-kit-v5\.is-running::after/);
});

test("agent process renderer no longer requires old runtime-card classes", () => {
	const renderer = read(rendererPath);

	assert.match(renderer, /friday-agent-process/);
	assert.match(renderer, /assistant-process-step-v6/);
	assert.match(renderer, /assistant-process-event-v6/);
	assert.match(renderer, /friday-ai-answer-flow/);
	assert.match(renderer, /friday-agent-artifacts/);
	assert.doesNotMatch(renderer, /friday-runtime-card/);
	assert.doesNotMatch(renderer, /friday-runtime-stage/);
	assert.doesNotMatch(renderer, /friday-runtime-entry/);
	assert.doesNotMatch(renderer, /renderVisibleStepTimeline/);
	assert.doesNotMatch(renderer, /friday-agent-process-timeline-item/);
	assert.doesNotMatch(renderer, /friday-agent-process-step(?!-card-v2)/);
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

function cssBlocksContainingSelector(styles, selector) {
	const blocks = [];
	for (const match of styles.matchAll(/(?:^|\n)([^{}]+)\s*\{([\s\S]*?)\n\}/g)) {
		const selectorList = match[1]
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
		if (selectorList.some((item) => selectorMatches(item, selector))) {
			blocks.push(match[0]);
		}
	}
	return blocks;
}

function selectorMatches(item, selector) {
	return item === selector || item.startsWith(`${selector}:`) || item.startsWith(`${selector}.`) || item.includes(` ${selector}`);
}

function assertNoNonCatalogShadow(block, selector) {
	assert.doesNotMatch(block, /filter:\s*drop-shadow/i, `${selector} should not use drop shadows`);
	assert.doesNotMatch(block, /text-shadow:/i, `${selector} should not use text shadows`);
	for (const match of block.matchAll(/box-shadow:\s*([^;]+);/gi)) {
		assert.match(match[1].trim(), /^none(?:\s*!important)?$/i, `${selector} should not use box-shadow outside catalog picker examples`);
	}
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
