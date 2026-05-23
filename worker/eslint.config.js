import js from '@eslint/js';
import globals from 'globals';

const sharedRules = {
	'no-unused-vars': ['warn', {
		argsIgnorePattern: '^_',
		varsIgnorePattern: '^_',
		caughtErrorsIgnorePattern: '^(_|e|err|error)$',
	}],
	'no-empty': ['error', { allowEmptyCatch: true }],
	'no-useless-escape': 'warn',
	'no-control-regex': 'off',
};

export default [
	js.configs.recommended,
	{
		files: ['src/**/*.js', 'scripts/**/*.{js,mjs}'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: { ...globals.browser, ...globals.worker, ...globals.node },
		},
		rules: sharedRules,
	},
	{
		files: ['test/**/*.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: { ...globals.node, ...globals.browser },
		},
		rules: sharedRules,
	},
];
