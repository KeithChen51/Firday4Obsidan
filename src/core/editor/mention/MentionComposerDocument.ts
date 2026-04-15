import { Node as ProseMirrorNode, Schema, type NodeSpec } from "prosemirror-model";
import type { MentionDocumentSnapshot, MentionToken, MentionTokenType } from "../../context/mention/MentionResolver";

interface MentionNodeAttrs {
	id: string;
	type: MentionTokenType;
	path: string;
}

export interface MentionComposerSnapshot extends MentionDocumentSnapshot {
	doc: Record<string, unknown> | null;
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
		return [
			"span",
			{
				class: "friday-inline-mention-token",
				"data-mention-id": attrs.id,
				"data-mention-type": attrs.type,
				"data-mention-path": attrs.path,
				contenteditable: "false",
			},
			["span", { class: "friday-inline-mention-token-label" }, formatMentionLabel(attrs)],
			[
				"button",
				{
					type: "button",
					class: "friday-inline-mention-token-remove",
					"data-mention-remove": "true",
					"aria-label": `Remove mention ${formatMentionLabel(attrs)}`,
					tabindex: "-1",
				},
				"×",
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

export function serializeMentionComposerDoc(doc: ProseMirrorNode): MentionComposerSnapshot {
	const tokens: MentionToken[] = [];
	const textSegments: string[] = [];
	doc.descendants((node) => {
		if (node.type.name === "text") {
			textSegments.push(node.text ?? "");
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
			tokens.push(token);
		}
	});
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

function formatMentionLabel(attrs: MentionNodeAttrs): string {
	if (attrs.type === "active_note") {
		return "Active Note";
	}
	const pathValue = (attrs.path ?? "").trim();
	if (!pathValue) {
		return attrs.type === "folder" ? "Folder" : "Note";
	}
	const parts = pathValue.replace(/\\/g, "/").split("/").filter(Boolean);
	return parts[parts.length - 1] ?? pathValue;
}

function normalizeInlineText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
