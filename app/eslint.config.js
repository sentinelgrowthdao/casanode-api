import typescriptParser from "@typescript-eslint/parser";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import promisePlugin from "eslint-plugin-promise";

export default [
	{
		ignores: ["dist/**", "node_modules/**"],
	},
	{
		files: ["**/*.ts"],
		ignores: [
			"src/test.ts",
		],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: "module",
			parser: typescriptParser,
			parserOptions: {
				project: "./tsconfig.json",
			},
		},
		plugins: {
			"@typescript-eslint": typescriptPlugin,
			promise: promisePlugin,
		},
		rules: {
			...typescriptPlugin.configs.recommended.rules,
			"arrow-body-style": ["off"],
			"no-trailing-spaces": ["error", { skipBlankLines: true }],
			"complexity": ["off"],
			"indent": [
				"error",
				"tab",
				{
					SwitchCase: 1
				},
			],
			"quotes": ["error", "single"],
			"semi": ["error", "always"],
			"no-multi-spaces": ["error"],
			"object-curly-spacing": ["error", "always"],
			"no-trailing-spaces": ["error", { "skipBlankLines": true }],
			"brace-style": ["error", "allman", { "allowSingleLine": true }],
			"arrow-parens": ["error", "always"],
			"space-infix-ops": ["error"],
			"space-before-function-paren": [
				"error",
				{
					anonymous: "never",
					named: "never",
					asyncArrow: "always",
				},
			],
			"function-paren-newline": ["off"],
			"@typescript-eslint/no-explicit-any": "off",
			"keyword-spacing": [
				"error",
				{
					before: true,
					after: true,
				},
			],
			"promise/always-return": "error",
			"promise/no-return-wrap": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
		},
	},
];
