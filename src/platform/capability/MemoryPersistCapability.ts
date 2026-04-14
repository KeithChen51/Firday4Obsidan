import type { FileMemoryStore } from "../../core/memory/FileMemoryStore";
import { decideMemoryWrite } from "../../core/memory/MemoryPolicy";
import { extractMemorySignals } from "../../core/memory/MemorySignalExtractor";
import type { ProjectBoundaryService } from "../../services/ProjectBoundaryService";

export class MemoryPersistCapability {
	constructor(
		private readonly fileMemoryStore: FileMemoryStore,
		private readonly projectBoundaryService: ProjectBoundaryService,
	) {}

	async persistSignals(userPrompt: string, turnId: string): Promise<void> {
		const signals = extractMemorySignals(userPrompt);
		if (signals.length === 0) {
			return;
		}
		const activeProjectRoot = this.projectBoundaryService.getActiveProjectRoot();
		const entries = signals
			.map((signal) => {
				const decision = decideMemoryWrite({
					confidence: signal.confidence,
					ephemeral: signal.ephemeral,
					sourceRef: turnId,
				});
				if (!decision.allow) {
					return null;
				}
				return {
					text: signal.text,
					scope: signal.scope,
					sourceRef: turnId,
					projectRoot: signal.scope === "project" ? activeProjectRoot : undefined,
				};
			})
			.filter((item): item is NonNullable<typeof item> => item != null);
		if (entries.length === 0) {
			return;
		}
		await this.fileMemoryStore.persist(entries);
	}
}
