# Marloues

Multi-kernel Agent desktop workspace —— 多内核 Agent 桌面工作台。

一个桌面应用，四个 Agent 内核。不绑定任何单一厂商 SDK，内核可插拔，模型接入走协议网关。

## 为什么是多内核

| 内核                   | 实现                                                 | 定位                                                       |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| **SDK Runtime**        | Claude Agent SDK                                     | 厂商 SDK，合规友好、企业交付                               |
| **Binary Runtime**     | 外部 Agent 二进制（Bundled Codex / PATH 中的 codex） | 复用最强的现成 Agent 能力                                  |
| **Self-built Runtime** | 自建 agent loop                                      | 最高可控性与可审计性，支持注册自定义工具                   |
| **协议网关 Gateway**   | 本机 HTTP 网关                                       | anthropic ↔ openai-chat ↔ responses 协议翻译，任意模型接入 |

统一 `AgentRuntime` SPI + `RuntimeCapabilities` 能力矩阵，UI 按内核能力渲染，而不是假设所有内核行为一致。

## 功能

- 多内核会话：同一 UI 下切换 SDK / Binary / Self-built 内核，fork / interrupt / 权限模式按能力可用
- 协议网关：本地 HTTP 服务把内部请求翻译为 OpenAI 兼容协议，实时读取 provider 配置，任意 baseUrl 接入
- 线程（Thread）工作流：fork / rewind / 中断续跑
- 工具权限引擎：审批超时、企业策略、危险结构检测
- 安全：输出/工具结果脱敏（正则规则）、导航策略、认证服务、自动更新
- 记忆 / Skills / MCP 服务
- 工作区与检查点（workspace-checkpoint）
- 上下文治理：context-policy、token-economy、自动压缩

## 快速开始

要求：Node ≥ 22.22，npm ≥ 10。

```bash
npm install
npm run dev          # electron-vite dev
```

打包与发布：

```bash
npm run package:dir  # 本地未签名目录包
npm run package:smoke# 打包 + 打包产物冒烟测试
npm run release      # 构建 + electron-builder 发布
```

## 测试

```bash
npm run typecheck        # node + web 双 tsconfig
npm run test:unit        # Vitest 单元测试
npm run test:contract    # Runtime + 企业脱敏规则契约测试
npm run test:smoke:runtime
npm run test:e2e         # Playwright critical 项目（构建后）
npm run test:visual      # 工作流视觉检查
npm run lint
```

## 目录结构

```
main/
  core/runtime/       内核注册表 + 三种 runtime 实现（manager / claude / binary / self-built）
  core/context/       上下文治理（context-policy、token-economy）
  core/permissions/   工具权限引擎
  core/security/      脱敏（redaction）、导航策略
  core/sdk/           Claude SDK 封装 + 端点诊断
  codex/              Codex 内核（JSON-RPC transport、会话、回放）
  gateway/            协议网关（server / pipeline / stream formatter）
  ipc/                通道常量 + handlers
  services/           auth / config / mcp / memory / skill / workspace / session-store…
shared/               AgentRuntime SPI、RuntimeEvent、workflow 契约（main/preload/renderer 共用）
renderer/             React UI（zustand 状态）
scripts/              契约测试 / 冒烟 / 打包验证
```

## 许可

<!-- TODO: 选择开源许可证（建议 AGPL-3.0 或 MIT，按商业化策略决定） -->

## 贡献

<!-- TODO: 贡献指南、开发环境说明、PR 流程 -->
