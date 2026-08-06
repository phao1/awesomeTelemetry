import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'server-dist', 'dist-binary', 'src/generated', 'node_modules', 'coverage', '.codex'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Node 侧：纯 JS 入口与脚本
  {
    files: ['bin/**/*.js', 'scripts/**/*.{js,mjs}', 'perf-diag/**/*.{js,mjs}', '*.config.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Node 侧：TS
  {
    files: ['server/**/*.ts', 'local-sessions/**/*.ts', 'scripts/**/*.ts', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // 浏览器侧
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // 全局规则
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',

      // 下划线前缀的参数/变量视为有意未使用，避免满地 void _x
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // AGENTS.md 禁令 4：同步子进程
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name=/^(spawnSync|execSync|execFileSync)$/]",
          message: 'AGENTS.md 禁令 4：禁止同步子进程，用 spawn/execFile + Promise',
        },
        {
          selector: "CallExpression[callee.property.name=/^(spawnSync|execSync|execFileSync)$/]",
          message: 'AGENTS.md 禁令 4：禁止同步子进程，用 spawn/execFile + Promise',
        },
      ],
    },
  },
);
