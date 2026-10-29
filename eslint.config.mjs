// ESLint flat config（0.11.x retro 落地①）：窄域起步，只静态检查 tests 目录全部 .mjs 的
// no-undef 类缺陷——背景：基线 tests/market-mutation.test.mjs 存在跨 describe 悬空
// 引用（`installed`），被旧行为先抛序掩盖多版，升级解耦改动时才由全量门禁暴露。
// src/ 侧由 tsc（typecheck）覆盖，client JSX 由渲染冒烟覆盖，后续再议扩面。
// 运行：npm run lint（已接入 npm test 链首，CI 经 npm test 同步生效）。
// 注意：本文件一律用行注释——块注释里写 glob（tests 加星加斜杠加星点 mjs）会被「星斜杠」截断。
import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: ['lib/**', 'node_modules/**', 'site/**', 'coverage/**'],
  },
  {
    ...js.configs.recommended,
    files: ['tests/**/*.mjs'],
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
]
