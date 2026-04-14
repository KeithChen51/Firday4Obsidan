export interface CapabilityIndexInput {
	id: string;
	title: string;
	summary: string;
	keywords: string[];
	links: number;
}

export interface CapabilityIndexEntry {
	id: string;
	title: string;
	score: number;
	scoreBreakdown: {
		businessImpact: number;
		recurrence: number;
		dependencyWeight: number;
	};
}

export function buildCapabilityIndex(entries: CapabilityIndexInput[]): CapabilityIndexEntry[] {
	return entries
		.map((entry) => {
			const businessImpact = clampScore(Math.max(1, Math.ceil(entry.summary.length / 40)));
			const recurrence = clampScore(Math.max(1, Math.ceil(entry.keywords.length / 2)));
			const dependencyWeight = clampScore(Math.max(1, entry.links));
			const score = roundScore(0.5 * businessImpact + 0.3 * recurrence + 0.2 * dependencyWeight);
			return {
				id: entry.id,
				title: entry.title,
				score,
				scoreBreakdown: {
					businessImpact,
					recurrence,
					dependencyWeight,
				},
			};
		})
		.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"));
}

function clampScore(value: number): number {
	return Math.max(1, Math.min(5, value));
}

function roundScore(value: number): number {
	return Math.round(value * 100) / 100;
}
