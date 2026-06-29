# marloues 技术架构决策

> 本文档记录 marloues 项目的关键技术决策、SPI 设计、以及各模块的实现方案。
> 与 `prd/README.md`（产品需求）互补：本文档回答"怎么做"，PRD 回答"做什么"。

更新时间：2026-06-18

---

## 目录

1. [AgentRuntime SPI 设计](#1-agentruntime-spi-设计)
2. [SDK Runtime 实现方案](#2-sdk-runtime-实现方案)
3. [配置系统（API Key / Settings）](#3-配置系统)
4. [IPC 通信协议](#4-ipc-通信协议)
5. [事件流归一化方案](#5-事件流归一化方案)
6. [构建与工程化](#6-构建与工程化)
7. [待办与已知问题](#7-待办与已知问题)

---

## 1. AgentRuntime SPI 设计

### 1.1 为什么需要 SPI

marloues 的核心价值是"不锁供应商"。三种 Agent 内核：
- **WorkflowRuntime** — spawn external workflow 二进制，JSON-RPC 通信
- **SdkRuntime** — import `@vendor/agent-sdk`，调用 `query()`
- **SelfBuiltRuntime** — 自建 agent loop

三种内核的事件形状完全不同。需要一个**统一抽象接口**，让 UI 层不感知底层差异。

### 1.2 SPI TypeScript 接口

**文件**：`src/shared/agent-runtime.ts`

```ts
export type RuntimeKind = "binary" | "sdk" | "self-built";

export interface AgentRuntime {
  readonly kind: RuntimeKind;
  readonly capabilities: RuntimeCapabilities;

  // 生命周期
  initialize(opts: RuntimeConfig): Promise<void>;
  dispose(): Promise<void>;

  // 消息（核心）
  sendMessage(req: SendMessageRequest): AsyncIterable<RuntimeEvent>;

  // 中断
  interrupt(turnId: string): Promise<void>;

  // Thread 管理
  forkThread(threadId: string): Promise<Thread>;
  listThreads(): Promise<Thread[]>;
  deleteThread(threadId: string): Promise<void>;

  // 工具
  listTools(): Promise<ToolDefinition[]>;
  registerTool(def: ToolDefinition, handler: ToolHandler): void;

  // 模型 / 权限
  setModel(modelId: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;

  // 审批响应
  respondApproval(requestId: string, approved: boolean, scope: "once" | "session"): void;
}
```

### 1.3 RuntimeEvent（统一事件类型）

**文件**：`src/shared/agent-runtime.ts`

```ts
export type RuntimeEvent =
  | { kind: "turn-start"; payload: { turnId: string; timestamp: number } }
  | { kind: "text-chunk"; payload: { turnId: string; content: string } }
  | { kind: "thinking-chunk"; payload: { turnId: string; content: string } }
  | { kind: "tool-start"; payload: { turnId: string; toolId: string; toolName: string; input: unknown } }
  | { kind: "tool-progress"; payload: { turnId: string; toolId: string; toolName: string; partialInput?: string; input?: unknown; isReady?: boolean } }
  | { kind: "tool-complete"; payload: { turnId: string; toolId: string; output: unknown; isError: boolean } }
  | { kind: "turn-complete"; payload: { turnId: string; result: "success" | "error" | "aborted"; error?: string } }
  | { kind: "approval-request"; payload: { requestId: string; toolName: string; reason: string; timeout: number } }
  | { kind: "context-usage"; payload: { turnId: string; percentage: number; limit: number } }
  | { kind: "runtime-status"; payload: { turnId: string; label: string; detail?: string; status?: string } }
  | { kind: "error"; payload: { code: string; message: string; recoverable: boolean } };
```

### 1.4 设计要点

- `sendMessage()` 返回 `AsyncIterable<RuntimeEvent>` — 统一三种 Runtime 的流式输出
- `capabilities` 对象驱动 UI — UI 根据 `capabilities.forkThread` 等布尔值决定显示/隐藏功能
- `RuntimeConfig.env` — 传入 API Key / Base URL 等环境变量，SDK 子进程需要

---

## 2. SDK Runtime 实现方案

### 2.1 关键发现（从 marloues 跑通代码学习）

**不要猜 SDK API 形状，直接看跑通的代码。**

marloues 项目的 `src/main/core/sdk/sdk-loader.ts` 是跑通的，关键发现：

| 之前错误假设 | 实际跑通的（marloues） |
|---|---|
| `import * as sdk from "..."` 静态导入 | **动态 `import()`** 延迟加载（避免 Electron 预加载问题） |
| `sdk.query({ prompt, options })` | `querySDK(prompt, options)` wrapper，内部包成 `{ prompt, options }` 传给 SDK |
| 手写事件归一化（阉割版） | `SdkEventNormalizer` 处理 30+ 种 `SDKMessage` 类型 |

### 2.2 SDK 调用方式

**文件**：`src/main/core/sdk/sdk-loader.ts`

```ts
// 动态 import，避免 Electron 预加载阶段加载 SDK（会导致打包问题）
export async function loadSDKSdk(): Promise<SDKSdkModule> {
  if (sdkCache) return sdkCache;
  sdkCache = await import("@vendor/agent-sdk");
  return sdkCache;
}

export async function querySDK(
  prompt: string,
  options: SDKQueryOptions,
): Promise<SDKQuery> {
  const sdk = await loadSDKSdk();
  return sdk.query({ prompt, options });  // 注意：两个参数包成一个对象
}
```

### 2.3 事件归一化（SDKMessage → RuntimeEvent）

**文件**：`src/main/core/runtime/sdk-runtime.ts` 中的 `normalizeSdkMessage()`

| SDKMessage.type | SDKMessage.subtype / event.type | RuntimeEvent.kind |
|---|---|---|
| `system` | subtype=`init` | `turn-start` |
| `stream_event` | event.type=`content_block_delta`, delta.type=`text_delta` | `text-chunk` |
| `stream_event` | event.type=`content_block_delta`, delta.type=`thinking_delta` | `thinking-chunk` |
| `stream_event` | event.type=`content_block_start`, block.type=`tool_use` | `tool-start` |
| `stream_event` | event.type=`content_block_delta`, delta.type=`input_json_delta` | `tool-progress` |
| `user` | content[].type=`tool_result` | `tool-complete` |
| `result` | — | `turn-complete` |
| `system` | subtype=`status` | `runtime-status` |

### 2.4 当前实现状态

- [x] `sdk-loader.ts` — 动态 import wrapper
- [x] `sdk-runtime.ts` — SdkRuntime 类，实现 AgentRuntime SPI
- [x] `normalizeSdkMessage()` — SDK 事件归一化
- [x] `runtime/manager.ts` — Runtime 管理器（init/destroy/get/switch）
- [ ] 持久 query 优化（当前每次 `sendMessage` 创建新 query）
- [ ] `canUseTool` 权限回调（审批交互）

---

## 3. 配置系统

### 3.1 设计原则

**桌面应用读配置文件，不读 `.env`。**

API Key 等敏感信息通过 Electron `safeStorage` 加密后存储在配置文件中。

### 3.2 配置文件位置

```
~/.marloues-dev/config/settings.json
```

路径由 `src/main/app-paths.ts` 中的 `getSettingsPath()` 决定。

### 3.3 配置结构

```json
{
  "agentSettings": {
    "providers": [
      {
        "id": "enterprise-sdk",
        "name": "Enterprise SDK Provider",
        "type": "sdk-compatible",
        "enabled": true,
        "apiKey": "enc:safe:v1:xxxx",
        "baseUrl": "https://models.example.internal",
        "models": [
          { "id": "default-sdk-model", "label": "Default SDK Model", "enabled": true }
        ]
      }
    ],
    "defaultModel": { "providerId": "enterprise-sdk", "modelId": "default-sdk-model" },
    "maxTurns": 50,
    "permissionMode": "default",
    "thinkingEnabled": true,
    "maxThinkingTokens": 10240,
    "activeToolProfileId": "default-tool-policy",
    "toolProfiles": [],
    "mcpServers": [],
    "disabledSkills": []
  }
}
```

### 3.4 API Key 加密方案

**文件**：`src/main/services/secure-storage.service.ts`

```
明文 API Key
  → Electron safeStorage.encryptString()
  → Base64 编码
  → 加前缀 "enc:safe:v1:"
  → 存入 settings.json
```

读取时反向操作：`decryptSecret(value)` 自动识别前缀并解密。

**加密前缀说明**：
- `enc:safe:v1:` — 用 `safeStorage` 加密（推荐，硬件安全模块）
- `enc:fallback:v1:` — 回退方案（Base64 编码，无硬件加密时）

### 3.5 配置读取流程

```
settings.json
  → config-service.getAgentSettings()
  → resolveModelProvider() 解析当前 provider + model + apiKey
  → buildSdkEnv() 组装成环境变量
  → SdkRuntime.sendMessage() 传给 SDK options.env
```

**文件**：
- `src/main/services/config-service.ts` — 读写 settings.json
- `src/main/core/config/model-provider.ts` — 解析 provider 配置
- `src/main/core/runtime/sdk-runtime.ts` — 调用 `getAgentSettings()` + `buildSdkEnv()`

---

## 4. IPC 通信协议

### 4.1 架构

```
Renderer (UI) ──── IPC ────> Main (Runtime)
```

渲染进程不直接调用 AgentRuntime，通过 IPC channel 通信。

### 4.2 IPC Channel 定义

**文件**：`src/shared/types.ts` 中的 `IPC` 常量对象

| Channel | 方向 | 用途 |
|---|---|---|
| `chat:send` | Renderer → Main | 发送用户消息 |
| `chat:event` | Main → Renderer | Runtime 事件流（RuntimeEvent → UIEvent） |
| `chat:abort` | Renderer → Main | 中断当前生成 |
| `chat:list-sessions` | Renderer → Main | 获取会话列表 |
| `chat:create-session` | Renderer → Main | 创建新会话 |
| `config:get-agent-settings` | Renderer → Main | 读取配置 |
| `config:save-agent-settings` | Renderer → Main | 保存配置 |
| `workspace:select` | Renderer → Main | 选择工作区 |
| `mcp:list-servers` | Renderer → Main | 获取 MCP Server 列表 |

### 4.3 事件流传输方案

`sendMessage()` 返回 `AsyncIterable<RuntimeEvent>`，但 IPC 不支持直接传 AsyncIterable。

**方案**：Main 进程消费 AsyncIterable，逐条通过 `webContents.send("chat:event", uiEvent)` 推送到渲染进程。

```ts
// Main: ipc/handlers.ts
for await (const runtimeEvent of runtime.sendMessage(req)) {
  const uiEvent = translateEvent(runtimeEvent);  // RuntimeEvent → UIEvent
  win.webContents.send("chat:event", uiEvent);
}
```

---

## 5. 事件流归一化方案

### 5.1 问题

三种 Runtime 产生的事件形状不同：
- **厂商 SDK**：`SDKMessage`（30+ 种 subtype）
- **Workflow**：JSON-RPC 消息（待定义）
- **Self-built**：Self-built StreamEvent（待定义）

### 5.2 归一化策略

每种 Runtime 实现一个 `translateEvent()` 函数：

```
SDKMessage → translateEvent() → UIEvent → IPC → Renderer
```

**当前进度**：
- [x] SDK Runtime: `normalizeSdkMessage()` 已完成
- [ ] Workflow Runtime: 待实现
- [ ] Self-built Runtime: 待实现

### 5.3 UIEvent 类型

**文件**：`src/shared/ui-protocol.ts`

```ts
export type UIEvent =
  | { kind: "turn_start"; sessionId: string; turnId: string }
  | { kind: "text_delta"; sessionId: string; turnId: string; delta: string }
  | { kind: "thinking_delta"; sessionId: string; turnId: string; delta: string }
  | { kind: "tool_start"; sessionId: string; turnId: string; id: string; name: string }
  | { kind: "tool_result"; sessionId: string; turnId: string; id: string; output: unknown }
  | { kind: "turn_done"; sessionId: string; turnId: string; reason: string }
  | { kind: "error"; sessionId: string; turnId: string; error: string };
```

---

## 6. 构建与工程化

### 6.1 技术栈

| 类别 | 选型 | 版本 |
|---|---|---|
| 桌面框架 | Electron | ≥33 |
| 前端框架 | React | 18.x |
| 构建工具 | electron-vite | latest |
| 样式 | Tailwind CSS | 3.x |
| 语言 | TypeScript | strict |
| 包管理 | npm | 11.x |

### 6.2 项目结构

```
marloues/
├── src/
│   ├── main/               # 主进程
│   │   ├── index.ts
│   │   ├── ipc/           # IPC handlers
│   │   ├── core/
│   │   │   ├── runtime/   # AgentRuntime 实现
│   │   │   ├── sdk/      # SDK wrapper
│   │   │   ├── config/   # 配置解析
│   │   │   └── logging/  # 日志
│   │   └── services/      # 业务服务
│   ├── preload/           # 预加载脚本
│   └── renderer/         # 渲染进程
│       ├── components/
│       ├── pages/
│       └── stores/
├── docs/                  # 文档（本目录）
├── out/                   # 构建产物
└── release/              # 打包产物
```

### 6.3 构建命令

```bash
npm run dev        # 开发模式
npm run build      # 生产构建
npm run typecheck  # TypeScript 类型检查
```

### 6.4 TypeScript 配置

使用 Project References（`tsconfig.node.json` + `tsconfig.web.json`），分别检查主进程和渲染进程代码。

---

## 7. 当前实现状态

> 最后更新：2026-06-25（基于实际代码与测试运行结果）

### 7.1 已完成

- ✅ AgentRuntime SPI 定义（`src/shared/agent-runtime.ts`）
- ✅ SDK (Claude) Runtime — `claude-runtime.ts` (1169 行)，完整事件归一化
- ✅ Binary Runtime — `binary-runtime.ts` (328 行)，通过 codex 二进制 JSON-RPC 通信，含自动重连
- ✅ Self-built Runtime — `self-built-runtime.ts` (690 行)，完整 agent loop + 文件操作 + undo + sandbox
- ✅ Runtime 管理器 — `manager.ts`，支持热切换三种 Runtime
- ✅ UI 组件体系 — 93 个 TSX/TS 文件，含 Chat 页面（40+ workflow-chat 组件）、Settings（1662 行）、Onboarding
- ✅ IPC 完整框架 — 50+ channel，`ipc/handlers.ts` (1589 行) 完整连接 UI ↔ Runtime
- ✅ 配置系统 — 加密存储 API Key、企业策略锁定、多 provider
- ✅ 会话管理 — SQLite 持久化、Fork、Rewind、导出 Markdown
- ✅ 上下文管理 — Token 预算估算、自动压缩、阈值警告
- ✅ MCP Server 集成 — stdio / HTTP / SSE 三种传输，探测与状态监控
- ✅ Skill 系统 — 安装/管理/市场 + 企业策略
- ✅ 工作区快照与 Rewind — 文件变更回退
- ✅ 企业安全 — 网络白名单、敏感信息脱敏、审计日志
- ✅ HTTP Gateway — 协议转换 (Anthropic ↔ OpenAI Chat)，8080 端口
- ✅ CI/CD — lint / typecheck / 单元测试 / E2E / 三平台打包 / nightly release
- ✅ 单元测试 — 28 个文件，163 个测试，全部通过
- ✅ TypeScript 类型检查 — node + web 双 tsconfig，零错误
- ✅ E2E 关键路径测试 — 6 个 test case，覆盖 chat / 快捷键 / 主题 / 编辑重发 / 审批 / IPC 全链路
- ✅ 契约测试 — Runtime SPI 契约验证（Self-built + SDK），覆盖 tool / approval / interrupt / edit / MCP

### 7.2 测试结果 (2026-06-25)

| 测试类型 | 命令 | 结果 |
|---------|------|------|
| 单元测试 | npm run test:unit | 28 文件 / 163 测试 ✓ |
| 类型检查 | npm run typecheck | node + web 零错误 ✓ |
| Runtime 契约 | npm run test:runtime | 1 项已知失败（MCP stdio Windows 偶发超时） |
| E2E | npm run test:e2e | 6 个 critical 用例，需 Electron 环境 |

### 7.3 已知问题

1. **契约测试 mock /v1/messages 端点已修复** (2026-06-25)  已添加 mock 端点，testEndpointModel 现在通过。
2. **契约测试 stdio MCP 探测在 Windows 偶发失败**  probeStdioMcp 通过 child_process.spawn 启动子进程，在 Windows 上 stdio 管道通信偶发超时。此前被 testEndpointModel 提前退出掩盖。
3. **SDK 动态 import 在打包后可能失败**  需在 electron-builder 配置中处理 @anthropic-ai/claude-agent-sdk 原生依赖
4. **safeStorage 在 Linux 上可能不可用**  已有 fallbackEncode 回退
5. **持久 query 优化**  当前每次 sendMessage 创建新 SDK query 实例（非阻塞性问题）


---

## 附录：参考项目

| 项目 | 路径 | 说明 |
|---|---|---|
| marloues | `C:/workspace/marloues` | 厂商 SDK 接入参考（跑通） |
| workflow-web | `C:/workspace/workflow-web` | Workflow 二进制接入参考（跑通） |
| personal-claw | `C:/workspace/personal-claw` | Self-built 自建 loop 参考（跑通） |