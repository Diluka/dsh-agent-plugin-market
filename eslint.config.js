import js from '@eslint/js'

export default [
  {
    ignores: ['node_modules/**', 'test-repos/**'],
  },
  {
    ...js.configs.recommended,
    files: ['lib/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['lib/client.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
      },
    },
  },
]
