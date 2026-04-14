export class SemanticCompactor {
	compact(value: string, targetLength: number): string {
		const normalized = value.trim();
		if (normalized.length <= targetLength) {
			return normalized;
		}
		if (targetLength <= 3) {
			return normalized.slice(0, Math.max(0, targetLength));
		}
		return `${normalized.slice(0, targetLength - 3)}...`;
	}
}
