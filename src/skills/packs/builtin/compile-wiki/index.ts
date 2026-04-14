import { BUILTIN_SKILL_DEFINITIONS } from "..";

export const COMPILE_WIKI_SKILL = BUILTIN_SKILL_DEFINITIONS.find((item) => item.command === "compile-wiki") ?? null;
