export interface QualityLedgerEntry {
	generatedAt: string;
	status: "pass" | "fail";
	lintPassed: boolean;
	buildPassed: boolean;
	testPassed: boolean;
	toolRunCount: number;
	stepTraceCount: number;
	reviewedWarnings: string[];
}

export function appendQualityLedger(existing: string, entry: QualityLedgerEntry): string {
	const lines = [
		`- ${entry.generatedAt} status=${entry.status} lint=${flag(entry.lintPassed)} build=${flag(entry.buildPassed)} tests=${flag(entry.testPassed)} toolRuns=${entry.toolRunCount} stepTraces=${entry.stepTraceCount}`,
		...entry.reviewedWarnings.map((item) => `  - ${item}`),
	];
	const normalizedExisting = existing.trim();
	if (!normalizedExisting) {
		return ["# Quality Report Ledger", "", ...lines, ""].join("\n");
	}
	return `${normalizedExisting}\n${lines.join("\n")}\n`;
}

function flag(value: boolean): string {
	return value ? "pass" : "fail";
}
