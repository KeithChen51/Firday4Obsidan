import { BUILTIN_SKILL_DEFINITIONS } from "..";

export const INTENT_FRAMING_SKILL = BUILTIN_SKILL_DEFINITIONS.find((item) => item.command === "intent-framing") ?? null;
