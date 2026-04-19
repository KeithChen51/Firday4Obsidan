import { BUILTIN_SKILL_DEFINITIONS } from "..";

export const OBSIDIAN_CLI_SKILL = BUILTIN_SKILL_DEFINITIONS.find((item) => item.command === "obsidian-cli") ?? null;
