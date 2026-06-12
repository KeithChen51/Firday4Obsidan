export type DesktopSkillScope = "project" | "global";

export interface DesktopSkillSummary {
	id: string;
	name: string;
	description?: string;
	scope: DesktopSkillScope;
	enabled: boolean;
	sourcePath?: string;
}

export interface ComposerSkillReference {
	skillId: string;
	scope: DesktopSkillScope;
	label: string;
	referenceText: string;
	sourcePath?: string;
}

export interface SkillHostPort {
	listProjectSkills(projectId: string): Promise<DesktopSkillSummary[]>;
	listGlobalSkills(): Promise<DesktopSkillSummary[]>;
	setSkillEnabled(projectId: string, skillId: string, enabled: boolean): Promise<DesktopSkillSummary>;
	buildComposerSkillReference(projectId: string, skillId: string, scope: DesktopSkillScope): Promise<ComposerSkillReference>;
}
