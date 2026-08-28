const tseslint = require('typescript-eslint');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = tseslint.config(
	{
		ignores: ['node_modules/**', 'dist/**'],
	},
	{
		files: ['src/**/*.ts'],
		extends: [...tseslint.configs.recommendedTypeChecked],
		languageOptions: {
			parserOptions: {
				project: ['./tsconfig.json'],
				tsconfigRootDir: __dirname,
			},
		},
	},
	eslintPluginPrettierRecommended,
	{
		files: ['src/**/*.ts'],
		rules: {
			'@typescript-eslint/typedef': [
				'error',
				{
					arrowParameter: true,
					variableDeclaration: false,
					variableDeclarationIgnoreFunction: false,
					arrayDestructuring: true,
					memberVariableDeclaration: true,
					objectDestructuring: false,
					parameter: true,
					propertyDeclaration: true,
				},
			],
			'linebreak-style': 'off',
			'@typescript-eslint/no-unused-vars': ['error'],
			'@typescript-eslint/explicit-function-return-type': ['error'],
			'@typescript-eslint/explicit-module-boundary-types': ['off'],
			'@typescript-eslint/no-empty-function': ['off'],
			'@typescript-eslint/no-explicit-any': ['off'],
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'prettier/prettier': [
				'error',
				{
					endOfLine: 'auto',
				},
				{
					usePrettierrc: true,
				},
			],
			'@typescript-eslint/no-misused-promises': [
				'error',
				{
					checksVoidReturn: false,
				},
			],
			'@typescript-eslint/no-floating-promises': 'off',
			'@typescript-eslint/no-inferrable-types': 'off',
			'eqeqeq': ['error', 'smart'],
			'no-multi-spaces': 'error',
			'no-var': 'error',
			'no-console': 'error',
			'no-multiple-empty-lines': 'error',
			'no-unexpected-multiline': 'error',
			'no-self-compare': 'error',
			'no-unused-expressions': 'error',
			'no-alert': 'error',
			'prefer-const': 'warn',
			'dot-notation': 'warn',
			'dot-location': ['warn', 'property'],
			'no-use-before-define': 'off',
			'no-trailing-spaces': 'error',
			'no-plusplus': 'off',
			'comma-dangle': [
				'error',
				{
					arrays: 'always-multiline',
					objects: 'always-multiline',
					imports: 'always-multiline',
					exports: 'always-multiline',
					functions: 'always-multiline',
				},
			],
		},
	},
);
