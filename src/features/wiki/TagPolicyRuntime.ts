export type ContextZoneType = "archive_source" | "workspace_draft" | "wiki_artifact";

export interface TagPolicyRuleWhen {
	zoneIn?: ContextZoneType[];
	pathPrefixAny?: string[];
	fileNameRegex?: string;
	hasAnyTags?: string[];
	frontmatterEquals?: Array<{ key: string; value: unknown }>;
}

export interface TagPolicyRuleThen {
	addTags?: string[];
	targetZone?: ContextZoneType;
	moveTo?: string;
	renameTo?: string;
	emitSuggestionOnly?: boolean;
}

export interface TagPolicyRule {
	id: string;
	enabled: boolean;
	deterministic: boolean;
	confidenceMin?: number;
	when: TagPolicyRuleWhen;
	then: TagPolicyRuleThen;
}

export interface TagPolicyFile {
	version: string;
	policyId: string;
	description?: string;
	autoArchiveFromTagRules: boolean;
	sourcePriority: string[];
	policyStoragePath?: string;
	rules: TagPolicyRule[];
}

export interface GovernanceEvaluationInput {
	projectRelativePath: string;
	fileName: string;
	contextZone: ContextZoneType;
	frontmatter: Record<string, unknown>;
	existingTags: string[];
}

export interface GovernanceEvaluationResult {
	tags: string[];
	targetZone: ContextZoneType | "";
	moveTo: string;
	renameTo: string;
	suggestionOnly: boolean;
	matchedRuleIds: string[];
	conflict: boolean;
}

const DEFAULT_ASSETS: Record<string, string> = {
	"tag-policy.json": `{
  "version": "1.0",
  "policyId": "default-tag-policy",
  "description": "Default tag policy for deterministic tagging and archive routing.",
  "autoArchiveFromTagRules": false,
  "sourcePriority": ["manual", "rule", "ai"],
  "policyStoragePath": "wiki/_governance/tag-policy/",
  "rules": [
    {
      "id": "meeting-note-to-archive",
      "enabled": true,
      "deterministic": true,
      "confidenceMin": 1,
      "when": {
        "zoneIn": ["workspace_draft"],
        "pathPrefixAny": ["workspace/meetings/"],
        "frontmatterEquals": [{ "key": "docType", "value": "meeting_note" }]
      },
      "then": {
        "addTags": ["doc/meeting-note", "archive/candidate"],
        "targetZone": "archive_source",
        "moveTo": "raw/archive/meetings/",
        "renameTo": "{{date}}-{{slug}}.md",
        "emitSuggestionOnly": false
      }
    },
    {
      "id": "wiki-artifact-guard",
      "enabled": true,
      "deterministic": true,
      "confidenceMin": 1,
      "when": { "zoneIn": ["wiki_artifact"] },
      "then": {
        "addTags": ["wiki/artifact"],
        "targetZone": "wiki_artifact",
        "emitSuggestionOnly": true
      }
    }
  ]
}
`,
	"tag-policy.rules.md": `# Tag Policy Rules

This document is the human-editable companion to \`tag-policy.json\`.

## Current policy

- \`policyId\`: \`default-tag-policy\`
- \`autoArchiveFromTagRules\`: \`false\` (suggestion mode)
- \`sourcePriority\`: \`manual > rule > ai\`
`,
	"tag-policy.schema.json": `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://friday.local/schema/tag-policy.json",
  "title": "Friday Tag Policy",
  "type": "object"
}
`,
	"tags-catalog.md": `# Tags Catalog

| tag | category | meaning | suggested zone | owner |
|---|---|---|---|---|
| \`doc/meeting-note\` | document type | Meeting note document | \`archive_source\` | project |
| \`doc/spec\` | document type | Spec or requirement doc | \`archive_source\` | project |
| \`status/draft\` | lifecycle | Work in progress draft | \`workspace_draft\` | user |
| \`status/approved\` | lifecycle | Approved and ready to archive | \`archive_source\` | user |
| \`wiki/artifact\` | system | Generated wiki artifact | \`wiki_artifact\` | system |
| \`archive/candidate\` | workflow | Candidate for archive routing | \`archive_source\` | rule |
`,
	"README.md": `# Tag Policy Repository

Runtime target path in project wiki:

\`wiki/_governance/tag-policy/\`
`,
};

export function getDefaultTagPolicyAssets(): Record<string, string> {
	return { ...DEFAULT_ASSETS };
}

export function parseTagPolicy(raw: string): TagPolicyFile {
	const parsed = JSON.parse(raw) as Partial<TagPolicyFile>;
	return {
		version: String(parsed.version ?? "1.0"),
		policyId: String(parsed.policyId ?? "default-tag-policy"),
		description: parsed.description ? String(parsed.description) : "",
		autoArchiveFromTagRules: Boolean(parsed.autoArchiveFromTagRules),
		sourcePriority: Array.isArray(parsed.sourcePriority) ? parsed.sourcePriority.map((item) => String(item)) : ["manual", "rule", "ai"],
		policyStoragePath: parsed.policyStoragePath ? String(parsed.policyStoragePath) : "wiki/_governance/tag-policy/",
		rules: Array.isArray(parsed.rules)
			? parsed.rules
				.filter((item): item is TagPolicyRule => Boolean(item && typeof item === "object"))
				.map((item) => ({
					id: String(item.id ?? ""),
					enabled: Boolean(item.enabled),
					deterministic: Boolean(item.deterministic),
					confidenceMin: typeof item.confidenceMin === "number" ? item.confidenceMin : undefined,
					when: {
						zoneIn: Array.isArray(item.when?.zoneIn) ? item.when.zoneIn : [],
						pathPrefixAny: Array.isArray(item.when?.pathPrefixAny) ? item.when.pathPrefixAny.map((value) => String(value)) : [],
						fileNameRegex: item.when?.fileNameRegex ? String(item.when.fileNameRegex) : "",
						hasAnyTags: Array.isArray(item.when?.hasAnyTags) ? item.when.hasAnyTags.map((value) => String(value)) : [],
						frontmatterEquals: Array.isArray(item.when?.frontmatterEquals)
							? item.when.frontmatterEquals
								.filter((entry) => entry && typeof entry === "object")
								.map((entry) => ({
									key: String(entry.key ?? ""),
									value: entry.value,
								}))
							: [],
					},
					then: {
						addTags: Array.isArray(item.then?.addTags) ? item.then.addTags.map((value) => String(value)) : [],
						targetZone: item.then?.targetZone as ContextZoneType | undefined,
						moveTo: item.then?.moveTo ? String(item.then.moveTo) : "",
						renameTo: item.then?.renameTo ? String(item.then.renameTo) : "",
						emitSuggestionOnly: Boolean(item.then?.emitSuggestionOnly),
					},
				}))
				.filter((item) => item.id.length > 0)
			: [],
	};
}

export function evaluateTagPolicy(
	policy: TagPolicyFile,
	input: GovernanceEvaluationInput,
): GovernanceEvaluationResult {
	const matches = policy.rules.filter((rule) => rule.enabled && rule.deterministic && ruleMatches(rule, input));
	const tags = unique([
		...input.existingTags,
		...matches.flatMap((rule) => rule.then.addTags ?? []),
	]);
	const matchedRuleIds = matches.map((rule) => rule.id);
	const targetZones = [
		...new Set(
			matches
				.map((rule) => rule.then.targetZone)
				.filter((value): value is ContextZoneType => Boolean(value)),
		),
	];
	const moveTargets = unique(matches.map((rule) => rule.then.moveTo ?? "").filter(Boolean));
	const renameTargets = unique(matches.map((rule) => rule.then.renameTo ?? "").filter(Boolean));
	const conflict = targetZones.length > 1 || moveTargets.length > 1 || renameTargets.length > 1;
	return {
		tags,
		targetZone: conflict ? "" : (targetZones[0] ?? ""),
		moveTo: conflict ? "" : (moveTargets[0] ?? ""),
		renameTo: conflict ? "" : (renameTargets[0] ?? ""),
		suggestionOnly: conflict || matches.some((rule) => rule.then.emitSuggestionOnly === true) || !policy.autoArchiveFromTagRules,
		matchedRuleIds,
		conflict,
	};
}

export function resolveContextZone(projectRelativePath: string, contentKind: "raw" | "wiki"): ContextZoneType {
	const normalized = projectRelativePath.replace(/\\/g, "/");
	if (contentKind === "wiki") {
		return "wiki_artifact";
	}
	if (normalized.startsWith("workspace/")) {
		return "workspace_draft";
	}
	return "archive_source";
}

function ruleMatches(rule: TagPolicyRule, input: GovernanceEvaluationInput): boolean {
	const when = rule.when;
	if (when.zoneIn && when.zoneIn.length > 0 && !when.zoneIn.includes(input.contextZone)) {
		return false;
	}
	if (when.pathPrefixAny && when.pathPrefixAny.length > 0) {
		const pathMatched = when.pathPrefixAny.some((prefix) => input.projectRelativePath.startsWith(normalizePrefix(prefix)));
		if (!pathMatched) {
			return false;
		}
	}
	if (when.fileNameRegex) {
		const regex = new RegExp(when.fileNameRegex, "i");
		if (!regex.test(input.fileName)) {
			return false;
		}
	}
	if (when.hasAnyTags && when.hasAnyTags.length > 0) {
		if (!when.hasAnyTags.some((tag) => input.existingTags.includes(tag))) {
			return false;
		}
	}
	if (when.frontmatterEquals && when.frontmatterEquals.length > 0) {
		for (const requirement of when.frontmatterEquals) {
			if (input.frontmatter[requirement.key] !== requirement.value) {
				return false;
			}
		}
	}
	return true;
}

function normalizePrefix(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function unique(values: string[]): string[] {
	return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}
