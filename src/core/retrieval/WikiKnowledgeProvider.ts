import { WikiLookupInput, WikiLookupService } from "./WikiLookupService";

export class WikiKnowledgeProvider {
	private readonly lookupService = new WikiLookupService();

	buildContext(query: string, input: WikiLookupInput): string {
		const result = this.lookupService.lookup({
			...input,
			query,
		});
		return [
			"[wiki-knowledge]",
			`summary=${result.summary}`,
			`hitStep=${result.sourceMap.hitStep}`,
			`sourcePath=${result.sourceMap.sourcePath}`,
			`sourceSection=${result.sourceMap.sourceSection}`,
			result.sourceMap.relationPath ? `relationPath=${result.sourceMap.relationPath}` : "",
			"[/wiki-knowledge]",
		]
			.filter((item) => item.length > 0)
			.join("\n");
	}
}
