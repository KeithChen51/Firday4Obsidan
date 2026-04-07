export type LocaleCode = "zh-CN" | "en-US";

export type I18nParams = Record<string, string | number | boolean | null | undefined>;

export type I18nMessageValue = string | ((params?: I18nParams) => string);

export type I18nMessages = Record<string, I18nMessageValue>;

