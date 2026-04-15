import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			"@typescript-eslint/no-base-to-string": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unnecessary-type-assertion": "off",
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/no-redundant-type-constituents": "off",
			"@typescript-eslint/no-deprecated": "off",
			"no-alert": "off",
			"no-undef": "off",
			"no-restricted-globals": "off",
			"obsidianmd/ui/sentence-case": "off",
			"obsidianmd/detach-leaves": "off",
			"obsidianmd/hardcoded-config-path": "off",
			"obsidianmd/prefer-file-manager-trash-file": "off",
			"obsidianmd/settings-tab/no-manual-html-headings": "off",
			"obsidianmd/no-static-styles-assignment": "off",
		},
	},
	globalIgnores([
	"node_modules",
	"dist",
	"release",
	"release/**",
	"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
