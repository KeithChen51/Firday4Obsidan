import { enUSMessages } from "./locales/en-US";
import { zhCNMessages } from "./locales/zh-CN";
import { I18nMessages, I18nParams, LocaleCode } from "./types";

const localeCatalog: Record<LocaleCode, I18nMessages> = {
	"zh-CN": zhCNMessages,
	"en-US": enUSMessages,
};

const placeholderPattern = /\{([a-zA-Z0-9_.-]+)\}/g;

function applyParams(template: string, params?: I18nParams): string {
	if (!params) {
		return template;
	}
	return template.replace(placeholderPattern, (_full, key: string) => {
		const value = params[key];
		if (value == null) {
			return "";
		}
		return String(value);
	});
}

export function resolveLocale(value?: string): LocaleCode {
	return value === "en-US" ? "en-US" : "zh-CN";
}

export function translate(locale: LocaleCode, key: string, params?: I18nParams): string {
	const localTable = localeCatalog[locale] ?? zhCNMessages;
	const fallbackTable = zhCNMessages;
	const entry = localTable[key] ?? fallbackTable[key];
	if (!entry) {
		return key;
	}
	if (typeof entry === "function") {
		return entry(params);
	}
	return applyParams(entry, params);
}

