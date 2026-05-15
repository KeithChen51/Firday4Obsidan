/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/views/components/MentionDropdown.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

class FakeElement {
	constructor(tagName = "div") {
		this.tagName = tagName.toUpperCase();
		this.children = [];
		this.parentElement = null;
		this.attributes = new Map();
		this.classNames = new Set();
		this.textContent = "";
		this.type = "";
	}

	createDiv(options = {}) {
		return this.createChild("div", options);
	}

	createEl(tagName, options = {}) {
		return this.createChild(tagName, options);
	}

	createChild(tagName, options = {}) {
		const child = new FakeElement(tagName);
		if (options.cls) {
			for (const className of options.cls.split(/\s+/).filter(Boolean)) {
				child.classNames.add(className);
			}
		}
		if (options.text) {
			child.textContent = options.text;
		}
		for (const [name, value] of Object.entries(options.attr ?? {})) {
			child.setAttribute(name, value);
		}
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	addClass(className) {
		this.classNames.add(className);
	}

	removeClass(className) {
		this.classNames.delete(className);
	}

	hasClass(className) {
		return this.classNames.has(className);
	}

	setAttribute(name, value) {
		this.attributes.set(name, String(value));
	}

	getAttribute(name) {
		return this.attributes.get(name) ?? null;
	}

	empty() {
		for (const child of this.children) {
			child.parentElement = null;
		}
		this.children = [];
	}

	remove() {
		if (!this.parentElement) {
			return;
		}
		this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
		this.parentElement = null;
	}
}

function dispatchMouseDown(target) {
	const event = {
		defaultPrevented: false,
		propagationStopped: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopPropagation() {
			this.propagationStopped = true;
		},
	};
	for (let current = target; current && !event.propagationStopped; current = current.parentElement) {
		current.onmousedown?.(event);
	}
	return event;
}

test("@ category rows select when the description area receives the pointer event", async () => {
	const { MentionDropdown } = await loadModule();
	const parent = new FakeElement();
	const dropdown = new MentionDropdown(parent);
	const selected = [];

	dropdown.onSelect((item) => selected.push(item));
	dropdown.show([
		{
			label: "Notes",
			description: "Search notes in the current project",
			kind: "mention_category",
			trigger: "@",
			category: "note",
		},
	]);

	const dropdownEl = parent.children[0];
	const listEl = dropdownEl.children[0];
	const row = listEl.children[0];
	const description = row.children[1];

	assert.equal(dropdownEl.getAttribute("role"), "listbox");
	assert.equal(row.getAttribute("role"), "option");
	assert.equal(row.getAttribute("aria-selected"), "true");
	assert.equal(typeof row.onmousedown, "function");

	const event = dispatchMouseDown(description);

	assert.equal(event.defaultPrevented, true);
	assert.equal(event.propagationStopped, true);
	assert.deepEqual(selected.map((item) => item.label), ["Notes"]);
});
