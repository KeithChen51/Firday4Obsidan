export interface SlashSuggestionInput {
	skills: Array<{ command: string; description: string }>;
	slashCommands: Array<{ name: string; template: string }>;
}

export interface SlashSuggestionItem {
	value: string;
	label: string;
	description: string;
	kind: "system" | "skill" | "slash_command";
	command?: string;
}

export function buildSlashSuggestions(
	rawInput: string,
	input: SlashSuggestionInput,
): SlashSuggestionItem[] {
	const query = rawInput.trim().toLowerCase();
	if (!query.startsWith("/")) {
		return [];
	}

	const items: SlashSuggestionItem[] = [
		{
			value: "/skills",
			label: "/skills",
			description: "List available skills",
			kind: "system",
		},
	];

	for (const skill of input.skills) {
		items.push({
			value: `/skill ${skill.command} `,
			label: `Skill · /${skill.command}`,
			description: skill.description,
			kind: "skill",
			command: skill.command,
		});
	}

	for (const command of input.slashCommands) {
		items.push({
			value: `/${command.name} `,
			label: `/${command.name}`,
			description: command.template,
			kind: "slash_command",
			command: command.name,
		});
	}

	return items.filter((item) => item.value.toLowerCase().startsWith(query) || item.label.toLowerCase().startsWith(query));
}
