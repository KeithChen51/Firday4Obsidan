import type { RuntimeWikiCompileSummary } from "../../services/AgentRuntimeService";

export class WikiCompileCapability {
	constructor(
		private readonly compileWikiForActiveProject: (
			rawPaths?: string[],
			forceRebuild?: boolean,
		) => Promise<RuntimeWikiCompileSummary>,
	) {}

	async execute(rawPaths?: string[], forceRebuild = true): Promise<RuntimeWikiCompileSummary> {
		return this.compileWikiForActiveProject(rawPaths, forceRebuild);
	}
}
