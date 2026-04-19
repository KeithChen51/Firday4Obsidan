import { BUILTIN_SKILL_DEFINITIONS } from "..";

export const OBSIDIAN_BASES_SKILL = BUILTIN_SKILL_DEFINITIONS.find((item) => item.command === "obsidian-bases") ?? null;
