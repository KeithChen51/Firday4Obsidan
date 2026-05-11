import assert from "node:assert/strict";

export const ORDINARY_SURFACE_BANNED_TERMS = [
	"Allow once",
	"Allow session",
	"Allow always",
	"Tool approval required",
	"Waiting for user",
	"Waiting for you",
	"Waiting for approval",
	"Before snapshot mismatch",
	"file change(s) pending review",
	"Pending file changes",
	"Applied file creation",
	"Applied file update",
	"Applied file deletion",
	"checkpoint",
	"model_request",
	"model request",
	"raw reasoning",
	"debug",
	"replay",
	"View replay",
	"Cancel",
	"Continue",
	"Apply",
	"Reject",
];

export function assertNoBannedOrdinaryTerms(value, message = "ordinary surface text") {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	for (const term of ORDINARY_SURFACE_BANNED_TERMS) {
		assert.doesNotMatch(
			text,
			new RegExp(escapeRegExp(term), "i"),
			`${message} must not contain ${term}`,
		);
	}
}

export function collectLeafTextMatches(root, terms = ORDINARY_SURFACE_BANNED_TERMS) {
	return [...root.querySelectorAll("*")]
		.filter((el) => terms.some((term) => (el.textContent || "").includes(term)))
		.filter((el) => ![...el.children].some((child) =>
			terms.some((term) => (child.textContent || "").includes(term)),
		))
		.map((el) => ({
			tag: el.tagName,
			className: el.className,
			text: (el.textContent || "").replace(/\s+/g, " ").trim(),
		}));
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
