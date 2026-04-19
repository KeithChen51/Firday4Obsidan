export function normalizeProjectGroupIdCandidate(value: string): string {
	return value
		.trim()
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
		.replace(/-+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "");
}
