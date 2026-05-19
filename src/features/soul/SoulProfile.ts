export type SoulSituationId =
	| "task_work"
	| "identity_question"
	| "style_disclosure_question"
	| "emotional_support"
	| "critical_feedback";

export interface SoulIdentityPolicy {
	anchor: "FRIDAY";
	principles: string[];
	avoid: string[];
	examples: string[];
}

export interface SoulStylePolicy {
	label: string;
	posture: string[];
	cadence: string;
	structure: string;
	feedback: string;
	boundaries: string[];
	disclosure: {
		onlyWhenAsked: boolean;
		principles: string[];
		examples: string[];
	};
}

export interface SoulSituationPolicy {
	id: SoulSituationId;
	objective: string;
	method: string[];
	avoid: string[];
	examples?: string[];
}

export interface SoulProfile {
	id: string;
	identityPolicy: SoulIdentityPolicy;
	stylePolicy: SoulStylePolicy;
	situationPolicies: SoulSituationPolicy[];
}

export function createMbtiSoulProfile(input: {
	id: string;
	label: string;
	cadence: string;
	structure: string;
	feedback: string;
	boundaries: string[];
	identityExamples: string[];
	disclosureExamples: string[];
	posture: string[];
}): SoulProfile {
	return {
		id: input.id,
		identityPolicy: {
			anchor: "FRIDAY",
			principles: [
				"Answer as FRIDAY with the current Soul's living posture.",
				"Keep the identity stable while letting the style shape rhythm, imagery, and emphasis.",
				"Do not explain settings unless the user asks about style, Soul, or MBTI.",
			],
			avoid: [
				"Do not claim to be an MBTI type.",
				"Do not answer with only the bare identity name.",
				"Do not translate or define FRIDAY as an ordinary English word.",
			],
			examples: input.identityExamples,
		},
		stylePolicy: {
			label: input.label,
			posture: input.posture,
			cadence: input.cadence,
			structure: input.structure,
			feedback: input.feedback,
			boundaries: input.boundaries,
			disclosure: {
				onlyWhenAsked: true,
				principles: [
					"Name the active style only when the user asks about current style, Soul, or MBTI.",
					"Keep the explanation short and connected to how the conversation will feel.",
				],
				examples: input.disclosureExamples,
			},
		},
		situationPolicies: [
			{
				id: "identity_question",
				objective: "Answer naturally as FRIDAY while revealing the current Soul through phrasing, not settings exposition.",
				method: [
					"Use one short self-description shaped by the active style.",
					"Keep the answer conversational, not contractual.",
				],
				avoid: [
					"Do not recite setup rules.",
					"Do not include the MBTI label unless the user also asks about style.",
				],
				examples: input.identityExamples,
			},
			{
				id: "style_disclosure_question",
				objective: "Explain the active communication style without turning it into a diagnosis.",
				method: [
					"Name the style label.",
					"Describe how it changes pacing, structure, and feedback.",
				],
				avoid: [
					"Do not say the user is this type.",
					"Do not frame the style as psychological truth.",
				],
				examples: input.disclosureExamples,
			},
			{
				id: "task_work",
				objective: "Finish the user's actual task through the active style.",
				method: [
					input.structure,
					input.feedback,
				],
				avoid: [
					"Do not perform the Soul instead of helping.",
				],
			},
			{
				id: "emotional_support",
				objective: "Adjust warmth and pacing through the style while staying grounded.",
				method: [
					"Name the felt tension briefly.",
					"Offer one realistic next step.",
				],
				avoid: [
					"Do not diagnose personality, trauma, or mental health.",
				],
			},
			{
				id: "critical_feedback",
				objective: "Give useful challenge in the active style.",
				method: [
					"Separate judgment from evidence.",
					"End with a concrete revision or test.",
				],
				avoid: [
					"Do not use style as an excuse for harshness.",
				],
			},
		],
	};
}

const IDENTITY_QUESTION_PATTERNS = [
	/你是誰|你是谁|你叫什麼|你叫什么|介紹一下你|介绍一下你/u,
	/who are you|what are you|your name|introduce yourself/i,
];

const STYLE_DISCLOSURE_PATTERNS = [
	/当前.*(风格|Soul|MBTI)|現在.*(風格|Soul|MBTI)|什么.*(风格|Soul|MBTI)|什麼.*(風格|Soul|MBTI)/u,
	/current.*(style|soul|mbti)|what.*(style|soul|mbti)/i,
];

const EMOTIONAL_SUPPORT_PATTERNS = [
	/难受|焦虑|沮丧|崩溃|压力|害怕|委屈|失落/u,
	/anxious|stressed|upset|overwhelmed|sad|afraid/i,
];

const CRITICAL_FEEDBACK_PATTERNS = [
	/质疑|挑战|反驳|指出问题|哪里不对|review|critique|challenge/i,
];

export function detectSoulSituation(userPrompt: string): SoulSituationId {
	const prompt = userPrompt.trim();
	if (!prompt) {
		return "task_work";
	}
	if (STYLE_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(prompt))) {
		return "style_disclosure_question";
	}
	if (IDENTITY_QUESTION_PATTERNS.some((pattern) => pattern.test(prompt))) {
		return "identity_question";
	}
	if (EMOTIONAL_SUPPORT_PATTERNS.some((pattern) => pattern.test(prompt))) {
		return "emotional_support";
	}
	if (CRITICAL_FEEDBACK_PATTERNS.some((pattern) => pattern.test(prompt))) {
		return "critical_feedback";
	}
	return "task_work";
}

export function compileSoulProfileForPrompt(profile: SoulProfile | undefined, userPrompt: string): string {
	if (!profile) {
		return "";
	}
	const situationId = detectSoulSituation(userPrompt);
	const situationPolicy =
		profile.situationPolicies.find((policy) => policy.id === situationId) ??
		profile.situationPolicies.find((policy) => policy.id === "task_work");
	const lines = [
		"Soul profile v2:",
		`identity anchor: ${profile.identityPolicy.anchor}`,
		`active style: ${profile.stylePolicy.label}`,
		"active Soul changes behavior, not identity.",
		"FRIDAY is a proper noun; use it as-is.",
		"Use examples as variation references, not scripts to recite.",
		`detected situation: ${situationId}`,
		...formatSection("identity principles", profile.identityPolicy.principles),
		...formatSection("identity avoid", profile.identityPolicy.avoid),
		...(situationId === "identity_question"
			? formatSection("identity answer examples", profile.identityPolicy.examples)
			: []),
		...formatSection("style posture", profile.stylePolicy.posture),
		`style cadence: ${profile.stylePolicy.cadence}`,
		`style structure: ${profile.stylePolicy.structure}`,
		`style feedback: ${profile.stylePolicy.feedback}`,
		...formatSection("style boundaries", profile.stylePolicy.boundaries),
		...(situationId === "style_disclosure_question"
			? [
				"style disclosure: only when asked",
				...formatSection("style disclosure principles", profile.stylePolicy.disclosure.principles),
				...formatSection("style disclosure examples", profile.stylePolicy.disclosure.examples),
			]
			: []),
		...(situationPolicy
			? [
				`situation objective: ${situationPolicy.objective}`,
				...formatSection("situation method", situationPolicy.method),
				...formatSection("situation avoid", situationPolicy.avoid),
				...formatSection("situation examples", situationPolicy.examples ?? []),
			]
			: []),
	];
	return lines.filter(Boolean).join("\n");
}

function formatSection(title: string, items: string[]): string[] {
	const cleaned = items.map((item) => item.trim()).filter(Boolean);
	if (!cleaned.length) {
		return [];
	}
	return [`${title}:`, ...cleaned.map((item) => `- ${item}`)];
}
