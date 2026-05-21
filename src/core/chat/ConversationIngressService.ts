import type { ChatMessage } from "../../services/AIService";
import type { ToolPermissionMode } from "../../types/agent";
import type { ProjectEntry } from "../../types/project";
import {
	resolveActiveFileContextPolicy,
	type ActiveFileContext,
} from "../context/ActiveFileContext";
import type { MentionDocumentSnapshot, MentionResolutionResult } from "../context/mention/MentionResolver";
import type { PromptMentionContext } from "../context/PromptContextEngine";
import { parseLegacyMentionMarkup } from "../context/mention/MentionResolver";
import type { MentionComposerSnapshot } from "../editor/mention/MentionComposerDocument";

interface ConversationIngressInput {
	sessionId: string;
	history: ChatMessage[];
	snapshot: MentionComposerSnapshot;
	activeProject: Pick<ProjectEntry, "projectId" | "boundaryPath"> | null | undefined;
	currentFilePath: string;
	mentionResolution: MentionResolutionResult;
	selectedModel: string;
	selectedPermissionMode: ToolPermissionMode;
	userFacingPromptFallback?: string;
}

export interface ConversationIngressPayload {
	rawPrompt: string;
	userFacingPrompt: string;
	document: MentionDocumentSnapshot;
	activeFileContext: ActiveFileContext;
	mentionResolutionCurrentFilePath: string;
	activeProjectBoundaryPath: string;
	turnTarget: {
		sessionId: string;
		projectId?: string;
		conversation: ChatMessage[];
	};
	runtimePayload: {
		modelOverride?: string;
		activeFileContext: ActiveFileContext;
		mentionContext?: PromptMentionContext;
	};
	metadata: {
		selectedPermissionMode: ToolPermissionMode;
		activeProjectId?: string;
	};
}

export type ConversationIngressResult =
	| ({ ok: true } & ConversationIngressPayload)
	| { ok: false; reason: "empty_prompt" | "mention_resolution_failed"; message?: string };

export function createConversationIngressPayload(input: ConversationIngressInput): ConversationIngressResult {
	const document = getStructuredPromptDocument(input.snapshot);
	const rawPrompt = document.text.trim();
	if (isPromptDocumentEmpty(document)) {
		return { ok: false, reason: "empty_prompt" };
	}
	if (input.mentionResolution.errors.length > 0) {
		return {
			ok: false,
			reason: "mention_resolution_failed",
			message: input.mentionResolution.errors.map((item) => item.message).join(" "),
		};
	}

	const activeFileContext = createActiveFileContext(document, rawPrompt, input.currentFilePath);
	const mentionContext = buildPromptMentionContext(input.mentionResolution);
	const modelOverride = input.selectedModel.trim() || undefined;
	const activeProjectId = input.activeProject?.projectId || undefined;
	const payload: ConversationIngressPayload = {
		rawPrompt,
		userFacingPrompt: rawPrompt || input.userFacingPromptFallback || "Please continue with the referenced context.",
		document,
		activeFileContext,
		mentionResolutionCurrentFilePath: activeFileContext.mode === "explicit_mention" ? activeFileContext.path ?? "" : "",
		activeProjectBoundaryPath: input.activeProject?.boundaryPath ?? "",
		turnTarget: {
			sessionId: input.sessionId,
			...(activeProjectId ? { projectId: activeProjectId } : {}),
			conversation: [...input.history],
		},
		runtimePayload: {
			...(modelOverride ? { modelOverride } : {}),
			activeFileContext,
			...(mentionContext ? { mentionContext } : {}),
		},
		metadata: {
			selectedPermissionMode: input.selectedPermissionMode,
			...(activeProjectId ? { activeProjectId } : {}),
		},
	};
	return { ok: true, ...payload };
}

export function getStructuredPromptDocument(snapshot: MentionComposerSnapshot): MentionDocumentSnapshot {
	if (snapshot.tokens.length > 0 || snapshot.doc) {
		return {
			text: snapshot.text,
			tokens: snapshot.tokens,
		};
	}
	return parseLegacyMentionMarkup(snapshot.text);
}

export function isPromptDocumentEmpty(document: MentionDocumentSnapshot): boolean {
	return document.text.trim().length === 0 && document.tokens.length === 0;
}

export function createActiveFileContext(
	document: MentionDocumentSnapshot,
	rawPrompt: string,
	currentFilePath: string,
): ActiveFileContext {
	const hasExplicitActiveNoteMention = document.tokens.some((token) => token.type === "active_note");
	return resolveActiveFileContextPolicy({
		userPrompt: rawPrompt,
		activeFilePath: currentFilePath,
		hasExplicitActiveNoteMention,
	});
}

export function buildPromptMentionContext(
	mentionResolution: MentionResolutionResult,
): PromptMentionContext | undefined {
	if (mentionResolution.entries.length === 0) {
		return undefined;
	}
	return {
		...mentionResolution.summary,
		entries: mentionResolution.entries,
	};
}
