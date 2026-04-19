import { BUILTIN_SKILL_DEFINITIONS } from "..";

export const JSON_CANVAS_SKILL = BUILTIN_SKILL_DEFINITIONS.find((item) => item.command === "json-canvas") ?? null;
