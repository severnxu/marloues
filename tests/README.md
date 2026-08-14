# 测试目录约定

所有可运行测试统一放在仓库根目录 `tests/`。生产代码目录 `client/`、`site/` 和 `packages/` 中不放置 `*.test.*`、`*.spec.*` 或测试执行脚本。

| 目录        | 用途                                 | 命名约定                     | 默认联网 |
| ----------- | ------------------------------------ | ---------------------------- | -------- |
| `unit/`     | 纯函数、组件与模块级单元测试         | `*.test.ts` / `*.test.tsx`   | 否       |
| `contract/` | Runtime、IPC、配置和策略的跨模块契约 | `*.contract.ts`              | 否       |
| `e2e/`      | Electron + Playwright 关键路径       | `*.critical.spec.ts`         | 否       |
| `smoke/`    | 真实服务或打包产物冒烟               | `*.smoke.ts` / `*.smoke.mjs` | 可选     |
| `visual/`   | 页面视觉尺寸、密度与截图检查         | `*.visual.mjs`               | 否       |

## 常用命令

```bash
npm test                         # unit
npm run test:layout              # 检查源码目录中没有测试文件
npm run test:contract            # contract 全量
npm run test:e2e                 # 构建后运行 critical E2E
npm run test:smoke:runtime       # 真实 Runtime，需要 API Key 和网络
npm run package:smoke            # 构建 unpacked 应用后运行 packaged E2E
npm run test:visual              # 工作流视觉检查
npm run verify                   # lint + typecheck + unit + contract + build
```

新增测试时必须先选择所属层级；不要在源码旁新建测试。单元测试由 `client/vitest.config.ts` 限定为只发现 `tests/unit/**/*.test.ts`，E2E 由 `client/playwright.config.ts` 限定在 `tests/e2e/`，`npm run test:layout` 会阻止测试文件重新散落到源码目录。
