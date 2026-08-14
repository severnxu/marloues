# Marloues

Multi-kernel Agent 桌面工作台（Electron + React + TypeScript），面向内网环境的 Agent IDE：
支持 Claude SDK / Codex 二进制 / Self-built 三种 Runtime 热切换，内置企业安全策略（网络白名单、敏感信息脱敏、审计日志）。

## 目录结构

```text
client/                 # 主应用（npm 包根）
  main/                 #   主进程：runtime 管理器、IPC、配置、安全、MCP、Gateway
  preload/              #   预加载桥
  renderer/             #   渲染进程（React + Tailwind）：chat / sidebar / settings / onboarding
  shared/               #   跨进程共享：契约、归一化、工作区路径工具
  scripts/              #   构建、发布和开发辅助工具
  out/                  #   构建产物（electron-vite，gitignore）
tests/                  # 测试套件
  unit/                 #   Vitest 单元测试
  contract/             #   Runtime、企业策略等跨模块契约测试
  smoke/                #   真实 API 与打包产物冒烟测试
  e2e/                  #   Playwright Electron 冒烟（2 用例）
  visual/               #   工作流页面视觉回归检查
  README.md             #   测试目录、命名及运行约定
docs/                   # 设计文档：prd/（需求）architecture/（技术）implementation/（进度）
.github/workflows/       # GitHub Actions（CI + 三平台 release）
.husky/                 # 本地质量门（pre-commit / pre-push）
site/                   # Astro 官网
```

## 快速开始

```bash
nvm use                          # 使用 .nvmrc 固定的 Node 22.22.2
npm install                      # 安装 client + site workspace，并注册 husky
npm run dev                      # 开发模式（electron-vite dev）

npm run lint                    # ESLint（零 warning）
npm run typecheck               # node + web 双 tsconfig 类型检查
npm run test:layout             # 测试目录规范检查
npm test                        # Vitest 单元测试（当前 21 文件 / 153 用例）
npm run test:contract           # 全部离线契约测试
npm run build                   # 生产构建
npm run test:e2e                # Playwright Electron 冒烟（需显示环境）
npm run package:smoke           # 生成 unpacked 应用并直接对打包程序跑 E2E
npm run verify                  # 本地完整质量门（不含 E2E/package）
```

冒烟测试说明：

- `npm run test:smoke:runtime` 需要**真实 DeepSeek API Key 与网络**（CI 不跑）；
  首次运行可用 `DEEPSEEK_API_KEY=sk-xxx npm run test:smoke:runtime -- --bootstrap` 自动生成最小配置，
  无配置时脚本会给出中文指引（退出码 2）。
- `npm run test:e2e` 和 `npm run package:smoke` 需要显示环境（Windows 本机可直接跑）；CI 使用 xvfb。

## 质量门与 CI

- 本地：`pre-commit`（lint-staged：eslint --fix + prettier --write）、`pre-push`（lint + typecheck + test:unit）
- CI：GitHub Actions（`.github/workflows/ci.yml`）并行执行质量门与 Electron smoke；Ubuntu 运行器会先验证 xvfb，再运行 E2E 和 packaged smoke。
- Release：推送 `v*` tag 后在 Linux、Windows、macOS 官方运行器打包，上传 Actions 制品并创建 GitHub Release；签名与 macOS 公证在配置对应 secrets 后自动启用。
- 打包应用默认启用 `prod` 策略，且不能被启动时环境变量降级为 `dev`。

## 文档导航

| 文档                                         | 内容                                        |
| -------------------------------------------- | ------------------------------------------- |
| [docs/prd/](docs/prd/)                       | 产品需求（内网模型、安全合规、Agent 能力）  |
| [docs/architecture/](docs/architecture/)     | 技术设计（三层架构、Runtime SPI、安全模型） |
| [docs/implementation/](docs/implementation/) | 实现进度与测试矩阵（含当前真实状态）        |
