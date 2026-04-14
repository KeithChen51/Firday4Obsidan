export interface QualityReportInput {
	lintPassed: boolean;
	buildPassed: boolean;
	testPassed: boolean;
	toolRunCount: number;
	stepTraceCount: number;
	reviewedWarnings: string[];
}

export function buildQualityReport(input: QualityReportInput): string {
	return [
		"# Quality Report",
		"",
		`Lint: ${input.lintPassed ? "PASS" : "FAIL"}`,
		`Build: ${input.buildPassed ? "PASS" : "FAIL"}`,
		`Tests: ${input.testPassed ? "PASS" : "FAIL"}`,
		`Tool runs: ${input.toolRunCount}`,
		`Step traces: ${input.stepTraceCount}`,
		"",
		"## Reviewed Warnings",
		...(input.reviewedWarnings.length > 0 ? input.reviewedWarnings.map((item) => `- ${item}`) : ["- None"]),
		"",
	].join("\n");
}
