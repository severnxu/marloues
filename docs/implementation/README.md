# marloues 实现计划与进度

> 本文档跟踪 marloues 项目的实现进度，按优先级排列。
> 与 `../prd/README.md`（产品需求）和 `../architecture/README.md`（技术设计）互补。

更新时间：2026-06-25（基于实际代码与测试运行结果）

---

## 当前状态

| 模块 | 状态 | 说明 |
|---|---|---|
| AgentRuntime SPI 定义 | ✅ 完成 | `src/shared/agent-runtime.ts` |
| SDK Runtime 实现 | ✅ 完成（可跑） | `src/main/core/runtime/claude-runtime.ts` + `claude-sdk.ts` |
| Binary Runtime 实现 | ✅ 完成（可跑） | `src/main/core/runtime/binary-runtime.ts` + `src/main/codex/**` |
| Self-built Runtime 实现 | ✅ 完成（可跑） | `src/main/core/runtime/self-built-runtime.ts`（plan→execute→verify loop） |
| Runtime 管理器 | ✅ 完成 | `src/main/core/runtime/manager.ts` |
| 配置系统（API Key） | ✅ 完成 | `services/config-service.ts` + `secure-storage.service.ts` |
| IPC handlers | ✅ 完成 | `src/main/ipc/handlers.ts` |
| UI 渲染进程 — Chat | ✅ 完成 | `src/renderer/src/components/workflow-chat/**` |
| UI 渲染进程 — Sidebar | ✅ 完成 | `src/renderer/src/components/layout/Sidebar.tsx` |
| UI 渲染进程 — Settings | ✅ 完成 | `src/renderer/src/components/settings/**` |
| UI 渲染进程 — Tool Panel | ✅ 完成 | RightSidebar 含 tool 调用历史 + JSON 详情 |
| UI 渲染进程 — Onboarding | ✅ 完成 | `src/renderer/src/components/onboarding/**` |
| 主题系统 | ✅ 完成 | light/dark/warm + system，品牌色深紫 #534AB7 |
| 模型选择 | ✅ 完成 | `runtime:list-models` + `runtime:set-model` + ModelSelector |
| MCP probe | ✅ 完成 | `services/mcp-probe.ts`（stdio/http/sse） |
| Token 用量 | ✅ 完成 | Runtime 契约 + UI badge + StatusBar |
| E2E 测试 | ✅ 完成 | 6 个关键路径（chat/快捷键/主题/编辑/审批/IPC） |
| 契约测试 | ✅ 完成 | `scripts/test-runtime-contract.ts` |
| CI/CD | ✅ 完成 | `.github/workflows/ci.yml` + `release.yml` |
| 自动更新 | ✅ 完成 | electron-updater + auto-update service |

---

## Phase 1：MVP（来去自由）— ✅ 完成

三个 Runtime 都能跑，可切换，基本 Agent 体验完备。

### 核心能力

- [x] AgentRuntime SPI（`src/shared/agent-runtime.ts`）
- [x] 三种 Runtime 实现（SDK / Binary / Self-built）
- [x] Runtime 切换（`runtime:switch` IPC + settings store）
- [x] Chat 流式渲染（MessageBubble / CodeBlock / ToolCard）
- [x] Thread CRUD + Fork + 导出 + 搜索
- [x] Settings 四 Tab（通用 / Runtime / MCP / Skills）
- [x] 主题三模式（light / dark / warm + system 跟随）
- [x] Model 选择 + Token 用量展示
- [x] Onboarding 四步引导

---

## Phase 2：完善（进行中）

### 2.1 工程化

- [x] TypeScript strict
- [x] Tailwind CSS 3.x
- [x] ESLint + Prettier
- [x] Conventional Commits 强制（`.commitlintrc.json` + CI 校验）
- [x] Changesets 版本管理（`.changeset/` + `npm run changeset`）

### 2.2 安全与合规（内网版）

- [x] 网络策略白名单（`navigation-policy.ts` + `NetworkPolicy` 类型）
- [x] 敏感信息脱敏规则（`redaction.ts` + `RedactionRule` 类型 + 单元测试）
- [x] 审计日志（`listAuditEvents` + `recordAuditEvent` + IPC `audit:list`）
- [x] 企业端点 Profile 预置（`EnterprisePolicy` + `enterpriseControlledSettings` 锁定字段）

### 2.3 Agent 能力增强

- [ ] Self-built Runtime 的模型驱动自主规划（当前为基于正则的规则匹配）
- [ ] 子 Agent（sub-agent）支持
- [ ] 命令白名单沙箱（当前 Self-built sandbox 为路径边界控制）
- [x] 完整 apply_patch / undo 语义（Self-built `/patch` + `/undo` + undo 栈，契约测试已验证）

### 2.4 品牌与官网

- [x] Astro 官网基础页面（`apps/website/` — 主页 + 4 个文档页）
- [ ] 完整单页官网（按 PRD 第 9 节规划）
- [ ] 独立文档站（`docs.marloues.dev`）

### 2.5 打包与签名

- [x] electron-builder 配置（mac/win/linux + nightly release）
- [x] macOS 公证脚本（`scripts/notarize.cjs`）
- [ ] 代码签名证书（需 Apple Developer ID / EV Code Signing）
