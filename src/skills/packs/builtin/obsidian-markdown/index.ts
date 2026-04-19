import { BUILTIN_SKILL_DEFINITIONS } from "..";

export const OBSIDIAN_MARKDOWN_SKILL = BUILTIN_SKILL_DEFINITIONS.find((item) => item.command === "obsidian-markdown") ?? null;
