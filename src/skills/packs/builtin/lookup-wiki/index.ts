import { BUILTIN_SKILL_DEFINITIONS } from "..";

export const LOOKUP_WIKI_SKILL = BUILTIN_SKILL_DEFINITIONS.find((item) => item.command === "lookup-wiki") ?? null;
