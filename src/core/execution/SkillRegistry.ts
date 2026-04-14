import { BUILTIN_SKILL_DEFINITIONS, type BuiltinSkillDefinition } from "../../skills/packs/builtin";
import type { SkillDescriptor } from "../../services/SkillCommandService";

export interface SkillRegistryGroups {
	builtinSkills: SkillDescriptor[];
	personalSkills: SkillDescriptor[];
}

export class SkillRegistry {
	private static instance: SkillRegistry | null = null;

	static getInstance(): SkillRegistry {
		if (!SkillRegistry.instance) {
			SkillRegistry.instance = new SkillRegistry();
		}
		return SkillRegistry.instance;
	}

	listBuiltinDefinitions(): BuiltinSkillDefinition[] {
		return [...BUILTIN_SKILL_DEFINITIONS];
	}

	isBuiltinDescriptor(skill: Pick<SkillDescriptor, "command" | "filePath">): boolean {
		if (skill.filePath.startsWith("builtin://")) {
			return true;
		}
		return BUILTIN_SKILL_DEFINITIONS.some((item) => item.command === skill.command);
	}

	groupDescriptors(skills: SkillDescriptor[]): SkillRegistryGroups {
		const builtinSkills: SkillDescriptor[] = [];
		const personalSkills: SkillDescriptor[] = [];
		for (const skill of skills) {
			if (this.isBuiltinDescriptor(skill)) {
				builtinSkills.push(skill);
			} else {
				personalSkills.push(skill);
			}
		}
		return { builtinSkills, personalSkills };
	}
}
