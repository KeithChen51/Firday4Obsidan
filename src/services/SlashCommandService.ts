import { FridaySettings, SlashCommandTemplate } from "../types/settings";

export type SlashCommandExpandResult =
	| { type: "none" }
	| { type: "invalid"; error: string }
	| {
			type: "expanded";
			command: SlashCommandTemplate;
			prompt: string;
			allowedTools: string[];
			allowedModels: string[];
	  };

export class SlashCommandService {
	constructor(private readonly getSettings: () => FridaySettings) {}

	expand(rawPrompt: string): SlashCommandExpandResult {
		const prompt = rawPrompt.trim();
		if (!prompt.startsWith("/")) {
			return { type: "none" };
		}

		const match = prompt.match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/);
		if (!match) {
			return { type: "none" };
		}

		const commandName = (match[1] ?? "").trim().toLowerCase();
		const argsText = (match[2] ?? "").trim();
		if (!commandName) {
			return { type: "none" };
		}

		// 内置命令由其他逻辑处理
		if (["skill", "skills", "todo", "project", "projects", "friday", "f.r.i.d.a.y"].includes(commandName)) {
			return { type: "none" };
		}

		const command = this.findEnabledCommand(commandName);
		if (!command) {
			return { type: "none" };
		}

		const args = this.tokenizeArgs(argsText);
		const expansion = this.expandTemplate(command.template, args);
		if (!expansion.ok) {
			return { type: "invalid", error: expansion.error };
		}

		const normalizedPrompt = expansion.prompt.trim();
		if (!normalizedPrompt) {
			return { type: "invalid", error: `命令 /${command.name} 展开后为空，请检查模板。` };
		}

		return {
			type: "expanded",
			command,
			prompt: normalizedPrompt,
			allowedTools: command.allowedTools.map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0),
			allowedModels: command.allowedModels.map((item) => item.trim()).filter((item) => item.length > 0),
		};
	}

	isModelAllowed(command: SlashCommandTemplate, model: string): boolean {
		const allowlist = command.allowedModels.map((item) => item.trim()).filter((item) => item.length > 0);
		if (allowlist.length === 0) {
			return true;
		}
		return allowlist.includes(model.trim());
	}

	private findEnabledCommand(commandName: string): SlashCommandTemplate | null {
		const commands = this.getSettings().slashCommands ?? [];
		const matched = commands.find(
			(item) => item.enabled && item.name.trim().toLowerCase() === commandName,
		);
		return matched ?? null;
	}

	private tokenizeArgs(raw: string): string[] {
		const text = raw.trim();
		if (!text) {
			return [];
		}

		const tokens: string[] = [];
		let current = "";
		let inQuote = false;
		let quoteChar = "";
		for (let i = 0; i < text.length; i += 1) {
			const char = text[i]!;
			if ((char === "\"" || char === "'") && (!inQuote || quoteChar === char)) {
				if (!inQuote) {
					inQuote = true;
					quoteChar = char;
					continue;
				}
				inQuote = false;
				quoteChar = "";
				continue;
			}
			if (!inQuote && /\s/.test(char)) {
				if (current) {
					tokens.push(current);
					current = "";
				}
				continue;
			}
			current += char;
		}
		if (current) {
			tokens.push(current);
		}
		return tokens;
	}

	private expandTemplate(
		template: string,
		args: string[],
	): { ok: true; prompt: string } | { ok: false; error: string } {
		const keyToArgIndex = new Map<string, number>();
		const placeholders = [...template.matchAll(/\{([a-zA-Z0-9_]+)(\?)?\}/g)];

		let argCursor = 0;
		for (const placeholder of placeholders) {
			const key = placeholder[1]!;
			if (keyToArgIndex.has(key)) {
				continue;
			}
			keyToArgIndex.set(key, argCursor);
			argCursor += 1;
		}

		let prompt = template;
		for (const placeholder of placeholders) {
			const full = placeholder[0]!;
			const key = placeholder[1]!;
			const optional = placeholder[2] === "?";
			const argIndex = keyToArgIndex.get(key) ?? -1;
			const value = argIndex >= 0 ? (args[argIndex] ?? "") : "";

			if (!value && !optional) {
				return {
					ok: false,
					error: `命令参数不足：缺少 {${key}}。请补充必填参数。`,
				};
			}

			prompt = prompt.replace(full, value);
		}

		// 如果模板没有占位符，但用户输入了参数，则拼接到末尾
		if (placeholders.length === 0 && args.length > 0) {
			prompt = `${prompt} ${args.join(" ")}`;
		}

		// 清理因可选参数为空导致的多余空格
		prompt = prompt.replace(/[ \t]{2,}/g, " ").trim();
		return { ok: true, prompt };
	}
}
