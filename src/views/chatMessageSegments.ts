import type { ChatMessageUiSegment } from "../services/AIService";
import type { MentionResolutionResult } from "../core/context/mention/MentionResolver";
import {
	formatMentionTokenLabel,
	listMentionComposerParts,
	restoreMentionComposerDoc,
	type MentionComposerSnapshot,
} from "../core/editor/mention/MentionComposerDocument";

interface BuildUserMessageSegmentsInput {
	snapshot: MentionComposerSnapshot;
	mentionResolution: MentionResolutionResult;
	resolution: { type: string; requestedSkillName?: string };
	formatSkillDisplayName: (command: string) => string;
	formatMentionBadgeLabel: (entry: MentionResolutionResult["entries"][number]) => string;
}

export function buildUserMessageSegments(input: BuildUserMessageSegmentsInput): ChatMessageUiSegment[] {
	const contextByTokenId = new Map(
		input.mentionResolution.entries.map((entry) => [entry.tokenId, entry] as const),
	);
	const parts = listMentionComposerParts(restoreMentionComposerDoc(input.snapshot));
	const segments: ChatMessageUiSegment[] = [];
	for (const part of parts) {
		if (part.type === "text") {
			if (part.text) {
				segments.push({ type: "text", text: part.text });
			}
			continue;
		}
		const mention = part.mention;
		if (mention.type === "skill") {
			const skillName = mention.path?.trim() || input.resolution.requestedSkillName?.trim() || "skill";
			segments.push({
				type: "token",
				token: {
					kind: "skill",
					label: input.formatSkillDisplayName(skillName),
					tokenType: "skill",
					target: skillName,
				},
			});
			continue;
		}
		const entry = contextByTokenId.get(mention.id);
		segments.push({
			type: "token",
			token: {
				kind: "context",
				label: entry ? input.formatMentionBadgeLabel(entry) : formatMentionTokenLabel(mention),
				tokenType: mention.type,
				target: mention.path?.trim() || entry?.target,
			},
		});
	}
	return normalizeUserMessageSegments(segments);
}

export function normalizeUserMessageSegments(segments: ChatMessageUiSegment[]): ChatMessageUiSegment[] {
	const next: ChatMessageUiSegment[] = [];
	for (const segment of segments) {
		if (segment.type === "text") {
			if (!segment.text) {
				continue;
			}
			const previous = next[next.length - 1];
			if (previous?.type === "text") {
				previous.text += segment.text;
			} else {
				next.push({ ...segment });
			}
			continue;
		}
		next.push(segment);
	}
	return next;
}
