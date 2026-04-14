export interface MemoryWriteInput {
	confidence: number;
	ephemeral: boolean;
	sourceRef?: string;
}

export interface MemoryWriteDecision {
	allow: boolean;
	confidence: number;
	ephemeral: boolean;
	reason: string;
	sourceRef?: string;
}

export function decideMemoryWrite(input: MemoryWriteInput): MemoryWriteDecision {
	const hasSourceRef = Boolean(input.sourceRef?.trim());
	const allow = input.confidence >= 0.85 && !input.ephemeral && hasSourceRef;
	return {
		allow,
		confidence: input.confidence,
		ephemeral: input.ephemeral,
		reason: allow
			? "highConfidence && nonEphemeral && hasSourceRef"
			: "memory write blocked by confidence/ephemeral/sourceRef gate",
		sourceRef: input.sourceRef?.trim() || undefined,
	};
}
