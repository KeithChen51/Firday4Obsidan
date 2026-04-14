import { BUILTIN_SKILL_DEFINITIONS } from "..";

export const MAINTAIN_MEMORY_SKILL = BUILTIN_SKILL_DEFINITIONS.find((item) => item.command === "maintain-memory") ?? null;
