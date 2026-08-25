import js from '@eslint/js'
import globals from 'globals'

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
      globals: globals.node,
    },
  },
  {
    files: ['lib/client.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
]
