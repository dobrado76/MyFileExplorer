import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'dist/**', '.dev-user-data/**', '.tmp/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts are plain ESM; enable Node globals for no-undef.
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'writable'
      }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // These compiler-powered rules reject the standard "fetch in effect" +
      // TanStack Virtual patterns this app uses deliberately.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/incompatible-library': 'off'
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  prettier
)
