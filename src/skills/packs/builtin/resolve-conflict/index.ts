import { BUILTIN_SKILL_DEFINITIONS } from "..";

export const RESOLVE_CONFLICT_SKILL = BUILTIN_SKILL_DEFINITIONS.find((item) => item.command === "resolve-conflict") ?? null;
