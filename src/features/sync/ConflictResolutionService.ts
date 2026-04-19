import { buildConflictProposal } from "../../core/extensions/ConflictProposalBuilder";
import type { ProjectEntry } from "../../types/project";
import type { SyncConflictRecord, SyncConflictStrategy } from "../../types/sync";

export interface ConflictContentRecord {
	filePath: string;
	localSnippet: string;
	remoteSnippet: string;
	mergedSnippet: string;
	snapshotPath?: string;
}

interface BuildConflictRecordsInput {
	project: ProjectEntry;
	conflicts: ConflictContentRecord[];
	recordedAt?: string;
	previous?: SyncConflictRecord[];
}

export class ConflictResolutionService {
	buildRecords(input: BuildConflictRecordsInput): SyncConflictRecord[] {
		const recordedAt = input.recordedAt ?? new Date().toISOString();
		const previousByPath = new Map(
			(input.previous ?? []).map((item) => [item.filePath, item]),
		);

		return [...input.conflicts]
			.sort((left, right) => left.filePath.localeCompare(right.filePath))
			.map((conflict) => {
				const proposal = buildConflictProposal({
					filePath: conflict.filePath,
					localSnippet: conflict.localSnippet,
					remoteSnippet: conflict.remoteSnippet,
				});
				const previous = previousByPath.get(conflict.filePath);
				return {
					projectId: input.project.projectId,
					filePath: conflict.filePath,
					conflictType: "content",
					localSnippet: conflict.localSnippet,
					remoteSnippet: conflict.remoteSnippet,
					mergedSnippet: conflict.mergedSnippet,
					markdown: proposal.markdown,
					recommendedStrategy: proposal.recommendedStrategy,
					status: previous?.status === "deferred" ? "deferred" : "pending",
					recordedAt,
					snapshotPath: conflict.snapshotPath,
				};
			});
	}

	attachProposal(
		record: SyncConflictRecord,
		proposal: { markdown: string; recommendedStrategy: SyncConflictStrategy },
	): SyncConflictRecord {
		return {
			...record,
			markdown: proposal.markdown,
			recommendedStrategy: proposal.recommendedStrategy,
		};
	}
}
