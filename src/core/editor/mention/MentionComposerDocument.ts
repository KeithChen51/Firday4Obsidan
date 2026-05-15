import { Node as ProseMirrorNode, Schema, type NodeSpec } from "prosemirror-model";
import { Selection, TextSelection } from "prosemirror-state";
import type { MentionDocumentSnapshot, MentionToken, MentionTokenType } from "../../context/mention/MentionResolver";

interface MentionNodeAttrs {
	id: string;
	type: MentionTokenType;
	path: string;
}

export interface MentionComposerSnapshot extends MentionDocumentSnapshot {
	doc: Record<string, unknown> | null;
	selectionAnchor?: number;
	selectionHead?: number;
}

export type MentionComposerPart =
	| { type: "text"; text: string }
	| { type: "mention"; mention: MentionToken };

const mentionNodeSpec: NodeSpec = {
	inline: true,
	group: "inline",
	atom: true,
	selectable: true,
	attrs: {
		id: { default: "" },
		type: { default: "note" },
		path: { default: "" },
	},
	toDOM(node) {
		const attrs = node.attrs as MentionNodeAttrs;
		const label = formatMentionLabel(attrs);
		return [
			"span",
			{
				class: buildInlineTokenClassName(attrs),
				"data-mention-id": attrs.id,
				"data-mention-type": attrs.type,
				"data-mention-path": attrs.path,
				contenteditable: "false",
			},
			["span", { class: "friday-inline-mention-token-label" }, label],
			[
				"button",
				{
					type: "button",
					class: "friday-inline-mention-token-remove",
					"data-mention-remove": "true",
					"aria-label": `Remove token ${label}`,
					tabindex: "-1",
				},
				"x",
			],
		];
	},
	parseDOM: [
		{
			tag: "span[data-mention-id]",
			getAttrs(dom) {
				const element = dom as HTMLElement;
				return {
					id: element.getAttribute("data-mention-id") ?? "",
					type: (element.getAttribute("data-mention-type") ?? "note") as MentionTokenType,
					path: element.getAttribute("data-mention-path") ?? "",
				};
			},
		},
	],
};

export const mentionComposerSchema = new Schema({
	nodes: {
		doc: { content: "paragraph+" },
		paragraph: {
			content: "inline*",
			group: "block",
			parseDOM: [{ tag: "p" }],
			toDOM() {
				return ["p", 0];
			},
		},
		text: { group: "inline" },
		mention: mentionNodeSpec,
	},
});

export function createEmptyMentionComposerSnapshot(): MentionComposerSnapshot {
	const doc = createMentionComposerDoc([]);
	return serializeMentionComposerDoc(doc);
}

export function createMentionComposerDoc(parts: MentionComposerPart[]): ProseMirrorNode {
	const content = parts.flatMap((part) => {
		if (part.type === "text") {
			return part.text.length > 0 ? [mentionComposerSchema.text(part.text)] : [];
		}
		return [createMentionNode(part.mention)];
	});
	return mentionComposerSchema.node("doc", null, [
		mentionComposerSchema.node("paragraph", null, content),
	]);
}

export function restoreMentionComposerDoc(snapshot?: Partial<MentionComposerSnapshot> | null): ProseMirrorNode {
	if (snapshot?.doc && typeof snapshot.doc === "object") {
		try {
			return mentionComposerSchema.nodeFromJSON(snapshot.doc);
		} catch {
			// Fall through to reconstruction from text + tokens.
		}
	}
	const parts: MentionComposerPart[] = [];
	if (snapshot?.text) {
		parts.push({ type: "text", text: snapshot.text });
	}
	for (const token of snapshot?.tokens ?? []) {
		parts.push({ type: "mention", mention: token });
	}
	return createMentionComposerDoc(parts);
}

export function restoreMentionComposerSelection(
	snapshot: Partial<MentionComposerSnapshot> | null | undefined,
	doc: ProseMirrorNode,
): Selection | null {
	if (typeof snapshot?.selectionAnchor !== "number" || typeof snapshot?.selectionHead !== "number") {
		return null;
	}
	const maxPosition = Math.max(1, doc.content.size - 1);
	const anchor = clampSelectionPosition(snapshot.selectionAnchor, maxPosition);
	const head = clampSelectionPosition(snapshot.selectionHead, maxPosition);
	try {
		return TextSelection.create(doc, anchor, head);
	} catch {
		return TextSelection.atEnd(doc);
	}
}

export function listMentionComposerParts(doc: ProseMirrorNode): MentionComposerPart[] {
	const parts: MentionComposerPart[] = [];
	doc.descendants((node) => {
		if (node.type.name === "text") {
			const text = node.text ?? "";
			if (text) {
				parts.push({ type: "text", text });
			}
			return;
		}
		if (node.type.name === "mention") {
			const attrs = node.attrs as MentionNodeAttrs;
			const token: MentionToken = {
				id: attrs.id,
				type: attrs.type,
			};
			if (attrs.path) {
				token.path = attrs.path;
			}
			parts.push({ type: "mention", mention: token });
		}
	});
	return parts;
}

export function serializeMentionComposerDoc(doc: ProseMirrorNode): MentionComposerSnapshot {
	const tokens: MentionToken[] = [];
	const textSegments: string[] = [];
	for (const part of listMentionComposerParts(doc)) {
		if (part.type === "text") {
			textSegments.push(part.text);
			continue;
		}
		if (part.mention.type === "skill" && part.mention.path?.trim()) {
			textSegments.push(`/skill ${part.mention.path.trim()}`);
		}
		tokens.push({ ...part.mention });
	}
	return {
		text: normalizeInlineText(textSegments.join("")),
		tokens,
		doc: doc.toJSON() as Record<string, unknown>,
	};
}

export function createMentionNode(token: MentionToken): ProseMirrorNode {
	return mentionComposerSchema.node("mention", {
		id: token.id,
		type: token.type,
		path: token.path ?? "",
	});
}

export function formatMentionTokenLabel(token: MentionToken): string {
	return formatMentionLabel({
		id: token.id,
		type: token.type,
		path: token.path ?? "",
	});
}

function formatMentionLabel(attrs: MentionNodeAttrs): string {
	if (attrs.type === "skill") {
		return (attrs.path ?? "").trim().replace(/^\/+/, "") || "skill";
	}
	if (attrs.type === "active_note") {
		return "@ Active note";
	}
	const pathValue = (attrs.path ?? "").trim();
	if (!pathValue) {
		return attrs.type === "folder" ? "@ Folder/" : "@ Note";
	}
	const parts = pathValue.replace(/\\/g, "/").split("/").filter(Boolean);
	const name = parts[parts.length - 1] ?? pathValue;
	return attrs.type === "folder" ? `@ ${name}/` : `@ ${name}`;
}

function buildInlineTokenClassName(attrs: MentionNodeAttrs): string {
	const kindClass = attrs.type === "skill" ? "is-skill" : "is-context";
	return `friday-ai-message-badge friday-inline-mention-token ${kindClass} type-${attrs.type}`;
}

function normalizeInlineText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function clampSelectionPosition(value: number, maxPosition: number): number {
	if (!Number.isFinite(value)) {
		return maxPosition;
	}
	return Math.min(Math.max(1, Math.trunc(value)), maxPosition);
}
