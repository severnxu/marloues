# marloues — 产品需求文档 v1

## 专项 PRD

- [双平台工作台外骨架 PRD](./cross-platform-workbench-shell.md)：定义 macOS/Windows 窗口框架、统一三栏布局、平台交互和验收标准。

## 目录

1. [产品定义](#1-产品定义)
2. [系统架构](#2-系统架构)
3. [功能规划](#3-功能规划)
4. [页面与交互设计](#4-页面与交互设计)
5. [UI/UX 视觉语言](#5-uiux-视觉语言)
6. [组件库与设计系统](#6-组件库与设计系统)
7. [工程化规范](#7-工程化规范)
8. [CI / CD](#8-ci--cd)
9. [品牌与官网](#9-品牌与官网)

---

## 1. 产品定义

### 1.1 一句话

**marloues 是一个可切换 Agent 内核的 AI 桌面工作台。**

不绑定任何单一 AI 供应商。同一套界面、同一套交互、同一套工作流，底层可以跑外部二进制 Runtime、厂商 SDK Runtime、或自建 agent loop。

### 1.2 为什么做

现有三个实验项目验证了三条路线都走得通：

| 项目 | 内核 | 优点 | 缺点 |
|------|------|------|------|
| binary-runtime prototype | spawn 外部 Agent 二进制 | Agent 能力最强 | 内核黑盒、不可修改 |
| marloues | import 厂商 Agent SDK | 合规友好、企业交付 | 受 SDK 版本限制 |
| personal-claw | 自建 agent loop | 完全可控 | 维护成本高 |

marloues 把三条路合成一个产品：**一个桌面壳 + 一个 AgentRuntime SPI + 三个可插拔 Runtime**。

### 1.3 目标用户

- **个人开发者**：日常 coding、debug、写文档、查资料。需要 Agent 能操作本地文件、执行命令、调用工具。
- **技术团队**：共享 MCP 配置、Skills 仓库、项目工作区。需要一致性体验和可控成本。
- **企业内网用户**：组织级模型端点、合规护栏、审计日志。禁止公网隧道和未授权模型。

### 1.4 核心价值主张

1. **不锁供应商**。今天用厂商 SDK，明天用外部二进制，后天用自己的模型。AgentRuntime SPI 保证切换成本为零。
2. **内外网一体**。同一份代码，配置驱动：外网版开所有 Runtime，内网版只开企业模型端点 + 合规护栏。
3. **工具生态**。MCP + Skills 是唯一扩展通道。不内置任何不可替换的工具。
4. **桌面原生体验**。Electron + React 18，不是浏览器换皮。IPC 直通本地文件系统和 shell。

### 1.5 非目标

- 不做 Web 版 / 移动端（v1 只管桌面）
- 不做模型训练 / 微调（只做消费端）
- 不做 Agent marketplace（优先完善内置体验）
- 不做远程团队协作（先做好单人 + 共享配置）

---

## 2. 系统架构

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────┐
│                     Renderer Process                     │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐ │
│  │ Chat UI  │ │ Settings │ │ Tool Panel│ │ Sidebar  │ │ │
│  │  (主视图) │ │  (设置)   │ │ (工具面板) │ │ (侧边栏)  │ │
│  └────┬─────┘ └────┬─────┘ └─────┬─────┘ └────┬─────┘ │
│       └────────────┴─────────────┴────────────┘        │
│                         │                               │
│               UI Protocol Layer                         │
│        (统一事件形状：message / tool / thinking / done)   │
├─────────────────────────┬───────────────────────────────┤
│                  IPC Bridge                             │
├─────────────────────────┴───────────────────────────────┤
│                     Main Process                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │              AgentRuntime SPI                     │  │
│  │  start / send / interrupt / fork / listTools      │  │
│  ├─────────────┬──────────────┬─────────────────────┤  │
│  │ Binary      │ SDK          │ Self-built           │  │
│  │ Runtime     │ Runtime      │ Runtime             │  │
│  │ Runtime     │              │                     │  │
│  ├─────────────┴──────────────┴─────────────────────┤  │
│  │           Shell Services                         │  │
│  │  MCP · Skills · File · Shell · Config · Auth     │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 AgentRuntime SPI

这是 marloues 最关键的设计决策——Agent 内核的抽象接口。

```ts
interface AgentRuntime {
  // 身份
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: RuntimeCapabilities;

  // 生命周期
  initialize(config: RuntimeConfig): Promise<void>;
  shutdown(): Promise<void>;

  // 会话
  createThread(opts?: CreateThreadOptions): Promise<ThreadHandle>;
  readThread(threadId: string): Promise<ThreadState>;
  forkThread(threadId: string, opts?: ForkOptions): Promise<ThreadHandle>;
  listThreads(): Promise<ThreadSummary[]>;
  deleteThread(threadId: string): Promise<void>;

  // 交互
  sendMessage(
    threadId: string,
    message: UserMessage
  ): AsyncIterable<AgentEvent>;

  interrupt(threadId: string): Promise<void>;

  // 工具
  listTools(): Promise<ToolDefinition[]>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
  cancelTool(toolCallId: string): Promise<void>;

  // 模型
  setModel(modelId: string): Promise<void>;
  getAvailableModels(): Promise<ModelInfo[]>;

  // 权限
  setPermissionMode(mode: PermissionMode): Promise<void>;

  // 事件监听（用于非请求范围的事件）
  onEvent(handler: (event: AgentEvent) => void): Unsubscribe;
}

interface RuntimeCapabilities {
  supportsFork: boolean;
  supportsInterrupt: boolean;
  supportsModelSwitch: boolean;
  supportsPermissionMode: boolean;
  supportsStreaming: boolean;
  supportsMultipleThreads: boolean;
  maxContextTokens?: number;
  builtinTools: string[]; // 内核自带的 tool 名称列表
}

type PermissionMode = "auto" | "always-ask" | "strict";

interface RuntimeConfig {
  workspacePath: string;
  model?: string;
  permissionMode?: PermissionMode;
  mcpServers?: McpServerConfig[];
  env?: Record<string, string>;
}
```

### 2.3 三种 Runtime 实现

| 实现 | 包名 | 核心依赖 | 启动方式 | 特点 |
|------|------|---------|---------|------|
| BinaryRuntime | `@marloues/runtime-binary` | `child_process.spawn(...)` | JSON-RPC over WebSocket | 能力最强、内核黑盒 |
| SdkRuntime | `@marloues/runtime-sdk` | `@vendor/agent-sdk` | `query()` async iterable | 合规友好、企业交付 |
| SelfBuiltRuntime | `@marloues/runtime-self-built` | `@self-built/agent-loop` | `graph.stream()` | 完全可控、自建 loop |

**Runtime 选择策略**：

1. 外网版：启动时自动检测安装了什么内核 → 加载对应 Runtime → 用户可在 Settings 里切换
2. 内网版：仅加载 SdkRuntime → 通过 `RuntimeConfig` 强制指定企业端点 Profile → 不暴露切换选项

### 2.4 UI 协议层

三种 Runtime 产生不同形状的事件流。在 IPC 桥接到 Renderer 之前，统一翻译成 UI 协议：

```ts
type UiEvent =
  | { kind: "agent-message"; content: MessageContent; messageId: string }
  | { kind: "tool-call"; toolName: string; toolCallId: string; input: unknown }
  | { kind: "tool-result"; toolCallId: string; output: unknown; isError?: boolean }
  | { kind: "thinking"; content: string }
  | { kind: "approval-request"; toolCallId: string; toolName: string; description: string }
  | { kind: "status"; status: "idle" | "generating" | "executing" | "paused" }
  | { kind: "done"; threadId: string; usage?: TokenUsage }
  | { kind: "error"; code: string; message: string; recoverable: boolean };

interface MessageContent {
  text?: string;
  blocks: ContentBlock[];
  // blocks 顺序就是渲染顺序：text | code | image | file-attachment
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "code"; language: string; code: string }
  | { type: "image"; src: string; alt?: string }
  | { type: "tool-card"; toolCallId: string; toolName: string; status: "pending" | "running" | "done"; result?: unknown }
  | { type: "diff"; filePath: string; patch: string }
  | { type: "file-link"; path: string; action: "read" | "write" | "create" | "delete" };
```

**Renderer 只认 UiEvent**。每个 Runtime 实现配一个 `adapter()` 函数把 native 事件流转成 `AsyncIterable<UiEvent>`。

### 2.5 目录结构

```
marloues/
├── package.json
├── turbo.json
├── .github/
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   │   ├── main/
│   │   │   │   ├── runtime/
│   │   │   │   ├── services/
│   │   │   │   ├── ipc/
│   │   │   │   └── index.ts
│   │   │   ├── preload/
│   │   │   └── renderer/
│   │   │       ├── components/
│   │   │       ├── pages/
│   │   │       ├── hooks/
│   │   │       ├── stores/
│   │   │       └── lib/
│   │   └── electron-builder.yml
│   └── website/
├── packages/
│   ├── ui/
│   ├── runtime-spi/
│   ├── runtime-binary/
│   ├── runtime-sdk/
│   ├── runtime-self-built/
│   ├── protocol/
│   ├── mcp/
│   ├── skills/
│   └── shared/
├── configs/
│   ├── eslint/
│   ├── typescript/
│   └── tailwind/
└── docs/
    └── prd/
```

---

## 3. 功能规划

### 3.1 v1 — "来去自由"

**目标**：三个 Runtime 都能跑，可以切换。基本 Agent 体验完备。

| 模块 | 功能 | 优先级 |
|------|------|--------|
| **Chat** | 发送消息、流式渲染 Agent 回复 | P0 |
| **Chat** | 渲染 code block（语法高亮）、diff、图片、文件链接 | P0 |
| **Chat** | 渲染 tool call 卡片（pending → running → done） | P0 |
| **Chat** | 中断生成、重新生成、编辑上一条消息 | P1 |
| **Thread** | 创建/切换/删除/重命名 Thread | P0 |
| **Thread** | Fork Thread | P1 |
| **Tool** | 展示 tool 调用详情（input / output） | P0 |
| **Tool** | Approval 模式（tool 执行前需要用户确认） | P0 |
| **Tool** | 取消正在执行的 tool | P1 |
| **Workspace** | 选择/切换本地工作目录 | P0 |
| **Workspace** | 在文件管理器中打开工作区 | P1 |
| **MCP** | 配置 MCP Server（stdio / SSE） | P0 |
| **MCP** | MCP Server 状态监控（running / error / disconnected） | P1 |
| **Skills** | 加载本地 Skill 目录 | P1 |
| **Model** | 选择模型（列出可用模型） | P0 |
| **Model** | 显示 Token 用量 | P1 |
| **Settings** | Runtime 切换 | P0 |
| **Settings** | 模型端点配置 | P0 |
| **Settings** | 主题（light / dark / system） | P0 |
| **Settings** | 快捷键 | P2 |

### 3.2 v2 — "各取所长"

**目标**：多 Agent 协作、工作流编排、内网版落地。

| 模块 | 功能 |
|------|------|
| **Multi-Agent** | 主 Agent 派发任务给专业 Agent |
| **Workflow** | 预设工作流（Code Review / Bug Fix / Research Report） |
| **Context** | 自动上下文压缩、长对话摘要 |
| **Intranet** | 企业端点 Profile、合规护栏、审计日志 |
| **Intranet** | `navigation-policy` 网络访问控制 |
| **Intranet** | 敏感信息脱敏 |
| **Diagnostics** | 运行时诊断面板（CPU、内存、上下文长度） |

### 3.3 v3 — "自建内核"

**目标**：Self-built Runtime 达到外部二进制 Runtime 80% 的能力，内网环境完全摆脱外部 SDK。

| 模块 | 功能 |
|------|------|
| **Self-built** | Sandbox（文件隔离、命令白名单） |
| **Self-built** | apply_patch / undo（代码编辑原语） |
| **Self-built** | 自定义 Agent loop（plan → execute → verify 循环） |
| **Self-built** | 子 Agent 动态创建与回收 |
| **Observability** | OpenTelemetry trace + span 级细粒度监控 |

---

## 4. 页面与交互设计

### 4.1 全局布局

```
┌───────────────────────────────────────────────────────┐
│  Title Bar (marloues · 当前 Thread 名)         ─  □  ×  │
├──────────┬────────────────────────────────────────────┤
│          │                                            │
│ Sidebar  │          Chat Area (主视图)                 │
│          │                                            │
│ · Thread │  ┌────────────────────────────────────┐    │
│   列表   │  │  Message 1 (User)                   │    │
│          │  ├────────────────────────────────────┤    │
│ · 新建   │  │  Message 2 (Agent)                  │    │
│          │  │  ├─ 文字回复                        │    │
│ · 搜索   │  │  ├─ Code Block                      │    │
│          │  │  ├─ Tool Call Card                  │    │
│ · 设置   │  │  └─ 文件链接                        │    │
│          │  ├────────────────────────────────────┤    │
│          │  │  Input Area                         │    │
│          │  │  ┌──────────────────────────────┐   │    │
│          │  │  │ 输入框                        │   │    │
│          │  │  │                               │   │    │
│          │  │  └──────────────────────────────┘   │    │
│          │  │  [附件] [工作区] [模型选择]  [发送]  │    │
│          │  └────────────────────────────────────┘    │
│          │               │                            │
│          │          Tool Panel                        │
│          │     (tool 调用详情 / 可收起)               │
├──────────┴────────────────────────────────────────────┤
│  Status Bar · Runtime: Binary | Model: gpt-5 | 1.2K tokens │
└───────────────────────────────────────────────────────┘
```

### 4.2 页面清单

#### A. 主聊天页 (`/chat`)

**状态**：
- **空态**（无 Thread）：显示欢迎语 + 快速开始（选择 Runtime、选择工作区、发送第一条消息）
- **加载态**：顶栏 skeleton，消息区显示历史消息，最后一条有 loading 动画
- **生成中**：Agent 回复逐字流式渲染，tool card 实时更新状态
- **中断中**：用户点了 stop 后，tool 如果正在执行显示 "正在取消..."

**交互细节**：
- 消息气泡：user 右对齐，agent 左对齐
- Code block：语法高亮（highlight.js），右上角 copy 按钮，语言标签
- Diff block：统一 diff 格式，+ 绿色底色，- 红色底色
- Tool card：可折叠，展开看 input / output JSON
- 长消息自动「继续生成」vs 一次性渲染完（由 Runtime capability 决定）
- 滚动：新消息自动滚到底，但如果用户手动往上滚了则不强制（保留阅读位置）
- 发送按钮状态：disabled（空输入 / 正在生成中）→ 可发送 → 变为 stop 按钮（生成中）

**快捷键**：
- `Enter`：发送
- `Shift+Enter`：换行
- `Ctrl+Enter`：换行（Windows）；`Cmd+Enter`：发送
- `Ctrl+K`：清空输入
- `Escape`：中断生成

#### B. 侧边栏 — Thread 列表

**状态**：
- **空态**：暂无会话，点击新会话开始
- **列表态**：Thread 按时间倒序，显示标题 + 最后一条消息摘要 + 时间
- **右键菜单**：重命名 / Fork / 删除 / 导出

**交互细节**：
- 当前 Thread 高亮
- 点击切换到该 Thread → 加载历史消息 → 输入框聚焦
- 新建 Thread：sidebar 顶部按钮，创建后自动切换并命名 "Untitled"
- Thread 标题自动生成：首条用户消息的前 50 个字符
- 搜索：sidebar 顶部搜索框，过滤 Thread 标题

#### C. 设置页 (`/settings`)

分四个 Tab：

**通用**
- 主题：Light / Dark / System（即时切换，不刷新）
- 语言：自动 / 中文 / English
- 启动行为：恢复上次 Thread / 新建空 Thread
- 数据目录：显示路径 + 打开文件夹按钮

**Runtime**
- Runtime 选择（外网版三个都展示、内网版仅展示 SDK）
- Runtime 状态指示（绿色圆点 = running，灰色 = stopped，红色 = error）
- 点击 Runtime 卡片展开详细配置（路径、端口、连接状态）
- Model 列表（从 Runtime 的 `getAvailableModels()` 拉取）
- 切换 Runtime 后自动刷新 Model 列表

**MCP**
- MCP Server 列表（名称、传输类型、状态、最近错误）
- 添加 MCP Server（表单：名称、命令/URL、参数、环境变量）
- 启用/禁用开关
- 重新连接按钮

**Skills**
- Skill 目录列表（路径 + 状态）
- 添加目录
- 刷新按钮

**内网版额外 Tab — 安全**
- 网络策略（允许的域名白名单）
- 敏感信息脱敏规则
- 审计日志导出

#### D. Tool Panel（可收起面板）

默认在聊天区右侧（可拖动宽度），也可以收起到右下角变成浮窗。

- **展开态**：当前 Thread 的 tool 调用历史，每条显示 tool name、状态图标、执行时间
- **详情态**：点击某条 → 展示完整 input / output JSON（带格式化 + copy 按钮）
- **空态**：暂无 tool 调用
- **可拖动**：面板宽度 280px - 480px

#### E. 状态栏

- 左：当前 Runtime 名称 + 图标
- 中：当前 Model 名称
- 右：Token 用量（需 Runtime 支持）

### 4.3 交互原则

1. **键盘优先**。所有核心操作都有快捷键，不用鼠标也能完整使用。
2. **即时反馈**。任何操作（发送、切换、加载）都有明确的 loading / success / error 状态。
3. **优雅降级**。Runtime 不支持的能力（如 fork、interrupt），UI 上对应的按钮直接隐藏，不给用户错误的预期。
4. **内容优先**。Chat 区的消息渲染是核心体验，不允许任何 UI 元素遮挡消息内容。
5. **不打断阅读**。滚动行为尊重用户意图，不强制跳到最新消息。

---

## 5. UI/UX 视觉语言

### 5.1 设计理念

**遵循 Apple Human Interface Guidelines 的核心精神：清晰、顺从、深度。**

marloues 是 macOS 一等公民（同时优雅降级到 Windows / Linux）。不是"跨平台写一次到处跑"，而是"每个平台用各自的系统语言说话"。Apple 设计的三条支柱贯穿整个产品：

1. **清晰（Clarity）。** 文字在任何尺寸下清晰易读。图标精确、表意明确。装饰让位于内容。负空间（留白）和材料（毛玻璃、半透明）共同传递层级关系，而非依赖边框和阴影。
2. **顺从（Deference）。** UI 从来不是主角。Agent 产出的代码、diff、思考过程——这些才是核心。界面退后、变轻、变透，让内容浮到最前面。色彩只用于标识状态，不做装饰性铺底。
3. **深度（Depth）。** 通过 z 轴分层制造空间感：底层是毛玻璃 Sidebar（模糊后方内容），中层是 Chat 滚动区，顶层是浮窗 ToolPanel 和 Dialog。每一层都有清晰的视觉权重，用户凭直觉就知道"我在哪里"。

**视觉参考**：Xcode 的毛玻璃侧栏 + Messages 的气泡节奏 + Terminal 的克制配色 = marloues 的视觉 DNA。

**三种色彩模式**：亮色（白天专注）、暗色（深夜低光）、暖色（长时间阅读 / 低蓝光）。三种模式不是颜色的简单反相——各自有独立的材料语义和对比度调校。

### 5.2 色彩系统

**设计原则**：三套独立调色板，不是反色。每种模式有独立的材料语义——亮色是冷调白、暗色是深空黑、暖色是纸感米。品牌色在三套模式下都保持可读性。

#### 5.2.0 品牌色（三模式共用）

深紫。在三套背景下都清晰：

```
┌────────────┬──────────┬──────────────────────────────┐
│  Token      │  HEX      │  用途                         │
├────────────┼──────────┼──────────────────────────────┤
│  brand-50   │ #F0EEFF  │  Light/Warm 模式选中背景      │
│  brand-100  │ #DDD8FC  │  hover 底色                   │
│  brand-200  │ #C4BCF9 │  次级边框                     │
│  brand-400  │ #7F77DD  │  link / 次要按钮                │
│  brand-600  │ #534AB7  │  **主品牌色** / 主按钮 / focus │
│  brand-800  │ #3C3489  │  Dark 模式下的品牌元素         │
│  brand-900  │ #26215C  │  Dark 模式强调色               │
└────────────┴──────────┴──────────────────────────────┘
```

**使用规则**：品牌色永远只做点缀。主按钮、链接、选中态高亮、focus ring、Status Bar 指示灯。禁止大面积铺底。

#### 5.2.1 亮色模式（Light）

冷调白基底——Apple 风格，不是纯白。所有灰度带极淡蓝调（#F5F5F7 而不是 #F0F0F0），长期使用不累眼。

```
┌────────────────┬──────────┬─────────────────────────────────┐
│  Token          │  HEX      │  用途                            │
├────────────────┼──────────┼─────────────────────────────────┤
│  bg-primary    │ #FAFAFB  │  页面底色（冷调白）               │
│  bg-secondary  │ #F5F5F7  │  Chat 区底色                    │
│  bg-tertiary  │ #FFFFFF  │  Sidebar / 浮层面板底色（毛玻璃层）│
│  bg-elevated  │ #FFFFFE  │  浮层 / Dialog 底色              │
│  border-primary│ #E5E5EA  │  主分隔线（极淡蓝灰）             │
│  border-subtle │ #F0F0F5  │  次级分隔（几乎不可见）            │
│  fill-quarternary│ #F2F2F7│  输入框 / 按钮底色               │
│  text-primary  │ #1D1D1F  │  heading / 正文（Apple Label）   │
│  text-secondary│ #86868B  │  secondary 文字（Apple Secondary） │
│  text-tertiary│ #AEAEB2  │  placeholder / disabled          │
│  text-link     │ #534AB7  │  链接文字（品牌 600）             │
└────────────────┴──────────┴─────────────────────────────────┘
```

**材料效果**：Sidebar 和 ToolPanel 使用 `backdrop-filter: blur(20px) saturate(180%)`，背景是半透明白（`rgba(255,255,255,0.72)`），透过它看到 Chat 区的模糊内容。这是 Apple 的 Vibrancy 风格。

#### 5.2.2 暗色模式（Dark）

深空黑基底——OLED 友好，纯黑（`#000000`）做页面底色，上层面板用三档深灰制造层级。不做"深灰代替黑"——暗色模式就该是黑色的。

```
┌────────────────┬──────────┬─────────────────────────────────┐
│  Token          │  HEX      │  用途                            │
├────────────────┼──────────┼─────────────────────────────────┤
│  bg-primary    │ #000000  │  页面底色（纯黑，OLED 省电）     │
│  bg-secondary  │ #1C1C1E  │  Chat 区底色（Apple secondary）   │
│  bg-tertiary  │ #2C2C2E  │  Sidebar 底色（Apple tertiary）   │
│  bg-elevated  │ #3A3A3C  │  浮层 / Dialog 底色              │
│  border-primary│ #38383A  │  主分隔线（深灰，非白）           │
│  border-subtle │ #2C2C2E  │  次级分隔                       │
│  fill-quarternary│ #3A3A3C│  输入框 / 按钮底色               │
│  text-primary  │ #F5F5F7  │  heading / 正文（Apple Label）   │
│  text-secondary│ #98989D  │  secondary 文字（Apple Secondary） │
│  text-tertiary│ #636366  │  placeholder / disabled          │
│  text-link     │ #9588EE  │  链接文字（品牌 400 提亮）        │
└────────────────┴──────────┴─────────────────────────────────┘
```

**材料效果**：暗色模式下的 `backdrop-filter: blur(20px) saturate(150%) brightness(0.8)`——模糊的同时变暗，这是 macOS 暗色 Vibrancy 的模拟。

#### 5.2.3 暖色模式（Warm）

米纸基底——长时间阅读、深夜低光场景。降低蓝光谱、提升黄/红色温，模拟纸张。不是复古滤镜，是精确校准的暖色温（~3400K）。

```
┌────────────────┬──────────┬─────────────────────────────────┐
│  Token          │  HEX      │  用途                            │
├────────────────┼──────────┼─────────────────────────────────┤
│  bg-primary    │ #F5F0E6  │  页面底色（暖米白）               │
│  bg-secondary  │ #FAF6ED  │  Chat 区底色（更亮的米）          │
│  bg-tertiary  │ #EDE6D8  │  Sidebar 底色                   │
│  bg-elevated  │ #FFFCF2  │  浮层 / Dialog 底色              │
│  border-primary│ #D8D0C4  │  主分隔线（暖灰，非蓝调）          │
│  border-subtle │ #E8E0D4  │  次级分隔                       │
│  fill-quarternary│ #F0EBE0│  输入框 / 按钮底色               │
│  text-primary  │ #3D3028  │  heading / 正文（暖黑棕）         │
│  text-secondary│ #6B5E52  │  secondary 文字（暖中棕）         │
│  text-tertiary│ #A09080  │  placeholder / disabled          │
│  text-link     │ #5B4FC4  │  链接文字（品牌色偏暖调）          │
└────────────────┴──────────┴─────────────────────────────────┘
```

**适用场景**：22:00 后自动建议、阅读长文档、代码审查（暖色减少蓝光刺激）。可在 Settings 里手动切换，或设置为"日落到日出自动暖色"。

#### 5.2.4 语义色（三模式映射）

```
┌──────────┬────────────┬────────────┬────────────┬─────────────────────┐
│  语义     │  Light       │  Dark        │  Warm        │  用途                │
├──────────┼────────────┼────────────┼────────────┼─────────────────────┤
│  success │ #34C759    │ #30D158     │ #5DBB63     │  tool 成功 / MCP on  │
│  warning │ #FF9F0A    │ #FFD60A     │ #E8A832     │  需审批 / 高风险      │
│  danger  │ #FF3B30    │ #FF453A     │ #E85C4A     │  tool 失败 / 错误    │
│  info    │ #5AC8FA    │ #64D2FF     │ #56B8E6     │  中性提示 / idle     │
└──────────┴────────────┴────────────┴────────────┴─────────────────────┘
```

> 语义色来自 Apple 系统色——Light/Dark 直接用 Apple 标准值，Warm 模式微调色温匹配米纸基底。

**语义色使用规则**：
- 不用于大面积背景。只用于：状态圆点 `8px`、`1px` border、小图标、`2em` 宽的左边框（错误卡片）
- Toast 只用 `info` 色文字 + 无背景条
- 成功不打断：绿色圆点 + check 图标，无文字提示

#### 5.2.5 材质与透明度

Apple 风格的关键在于**层与层之间的材质**，不是纯色块。

```
┌──────────────────┬──────────────────────────────────────────────┐
│  材质             │  CSS 实现                                    │
├──────────────────┼──────────────────────────────────────────────┤
│  Sidebar 毛玻璃  │  background: rgba(255,255,255,0.72)        │
│                   │  backdrop-filter: blur(20px) saturate(180%)│
│  ToolPanel 浮窗  │  background: rgba(255,255,255,0.85)        │
│                   │  backdrop-filter: blur(24px)                 │
│  Dialog 遮罩     │  background: rgba(0,0,0,0.18)              │
│  Selection       │  background: rgba(83,74,183,0.20)          │
│  （选中文字）     │  （品牌 600 的 20% 透明度）                  │
│  Dark 模式       │  所有 rgba 背景的 alpha 值降低 10-15%        │
│  毛玻璃           │  （暗色下更透，显示后方内容更多）             │
│  Warm 模式       │  rgba 背景用暖色温调整                       │
│  毛玻璃           │  （blur 色温偏暖）                          │
└──────────────────┴──────────────────────────────────────────────┘
```

**`prefers-color-scheme` 行为**：
- 默认 = 跟随系统
- 用户在 Settings → 通用 里手动选择后，覆盖系统设置
- 新增"暖色"选项：可设置为"跟随系统日/夜"或"定时（日落到日出）"或"始终"

### 5.3 字体系统

**设计原则**：「像 Apple 一样排字」——两种字体、SF Pro 比例、较大字号、较宽松行高。

Apple 用 SF Pro（系统内置，不可分发）。跨平台最佳替代：

```
┌──────────────┬──────────────────────────────────────────────┐
│  角色         │  字体选择                                    │
├──────────────┼──────────────────────────────────────────────┤
│  UI / 正文    │  Inter — 与 SF Pro 比例最接近的开源字体       │
│  UI (macOS)  │  `-apple-system` 系统字体（SF Pro 回退）     │
│  代码         │  JetBrains Mono — 与 SF Mono 等宽比例最匹配    │
│  代码 (macOS)│  `Menlo` / `Monaco` 系统等宽（SF Mono 回退） │
└──────────────┴──────────────────────────────────────────────┘
```

**字号阶梯**（Apple HIG 比例，从 11px 起，较大）：

```
┌──────────────┬──────┬─────────────────────────────┐
│  Token        │  px  │  用途                           │
├──────────────┼──────┼─────────────────────────────┤
│  text-2xs    │ 10   │  Status Bar / badge / 角标   │
│  text-xs     │ 11   │  caption / timestamp / footnote│
│  text-sm     │ 12   │  secondary / label / hint     │
│  text-base   │ 13   │  body 默认（Chat 消息正文）    │
│  text-md     │ 14   │  输入框 / 按钮文字              │
│  text-lg     │ 16   │  heading h3 / section 标题    │
│  text-xl     │ 20   │  heading h2 / Thread 标题     │
│  text-2xl    │ 24   │  heading h1 / 页面标题        │
│  text-3xl    │ 30   │  Hero / 空态大标题            │
│  text-code   │ 12.5 │  代码块（JetBrains Mono 基准） │
└──────────────┴──────┴─────────────────────────────┘
```

**字重使用**（Apple 规范：5 档字重，但产品中只用 3 档）：

- `font-normal` (400)：正文、代码块、placeholder
- `font-medium` (500)：heading h2-h3、按钮、标签、导航项
- `font-semibold` (600)：heading h1、Logo、tab 激活态
- `font-bold` (700)：**禁用**——在 13-14px 下与 600 无感知差异，且破坏 Apple 的轻量感

**行高**（Apple 标准）：

- 正文（Chat 消息）：`line-height: 1.5`——Apple 的默认行高，比 1.6 更紧凑舒适
- UI 元素：`line-height: 1.4`——按钮、标签、输入框
- 代码：`line-height: 1.5`——与 Xcode 一致
- 大标题（≥20px）：`line-height: 1.2`——紧凑有力

**字距（Letter Spacing）**：
- ≥20px 的大标题：`letter-spacing: -0.02em`——Apple 风格紧凑感
- ≤12px 的小字：`letter-spacing: 0.01em`——提升可读性
- 代码块：`letter-spacing: 0`——等宽字体不变形

### 5.4 间距、圆角与阴影

**间距**：8px 基准（Apple 用 8px 而非 4px）。间距取 8 的整数倍为主，4px 仅用于 icon-text 微距。

```
┌──────────┬──────┬──────────────────────────┐
│  Token    │  值   │  用途                     │
├──────────┼──────┼──────────────────────────┤
│  space-05 │  4px  │  最小间距 / icon-text gap │
│  space-1  │  8px  │  组件内微距              │
│  space-2  │ 16px  │  组件内间距 / 小 padding  │
│  space-3  │ 24px  │  组件间距 / 默认 padding   │
│  space-4  │ 32px  │  区块间距                  │
│  space-5  │ 40px  │  面板间距 / section 间距   │
│  space-6  │ 48px  │  大区块间距                │
│  space-8  │ 64px  │  页面级间距                │
└──────────┴──────┴──────────────────────────┘
```

**圆角**（Apple 风格，较大）：

```
┌────────────┬────────┬────────────────────────────┐
│  组件          │  radius │  说明                       │
├────────────┼────────┼────────────────────────────┤
│  Button（sm）  │  8px   │  小按钮：圆角矩形             │
│  Button（md）  │ 10px   │  中按钮                      │
│  Button（lg）  │ 12px   │  大按钮                      │
│  Input / Select │ 10px   │  输入框圆角                  │
│  Card / Panel  │ 16px   │  卡片 / 面板                  │
│  Dialog         │ 20px   │  对话框（Apple alert 风格）     │
│  Toast          │ 14px   │  提示条                      │
│  Badge          │ 6px    │  标签（小圆角）               │
│  Tooltip        │ 8px    │  提示浮层                    │
│  CodeBlock      │ 12px   │  代码块                      │
│  MessageBubble │ 18px   │  消息气泡（Apple Messages 风格）│
└────────────┴────────┴────────────────────────────┘
```

**阴影**（Apple 风格，两层叠加、极淡）：

```
:root {
  /* 轻阴影 — 悬停态、次级浮层 */
  --shadow-subtle: 0px 1px 3px rgba(0, 0, 0, 0.04),
                  0px 0.5px 1px rgba(0, 0, 0, 0.02);

  /* 标准阴影 — Dialog、浮层面板 */
  --shadow-medium: 0px 4px 16px rgba(0, 0, 0, 0.08),
                   0px 1px 4px rgba(0, 0, 0, 0.04);

  /* 重阴影 — Command Palette、全局浮层 */
  --shadow-elevated: 0px 12px 40px rgba(0, 0, 0, 0.12),
                     0px 4px 12px rgba(0, 0, 0, 0.06);

  /* 焦点的阴影 — focus ring（不用 box-shadow） */
  --shadow-focus: 0 0 0 3px rgba(83, 74, 183, 0.35);
}
```

> Light 模式下直接用上述值。Dark 模式下 `rgba(0,0,0,...)` 改为 `rgba(0,0,0,0.3~0.5)`（暗色下阴影更深才可见）。Warm 模式不变（阴影不带色温）。

**面板宽度**（与之前一致，但圆角更新为 16px）：

```
┌───────────┬──────────┬──────────┬───────────────────┐
│  面板      │  默认     │  范围     │  行为              │
├───────────┼──────────┼──────────┼───────────────────┤
│  Sidebar  │ 260px    │ 200-360  │  可拖动、可收起     │
│  Chat     │ 剩余宽度  │ ≥400px   │  弹性占满、不设最大  │
│  ToolPanel│ 320px    │ 280-480  │  可拖动、可收起为浮窗│
│  最小窗口  │ 780×520  │ —        │  低于此尺寸提示用户  │
└───────────┴──────────┴──────────┴───────────────────┘
```

**窗口 < 1100px 宽时的响应策略**：
- `<1100px`：Sidebar 锁 220px，ToolPanel 折叠为浮窗
- `<900px`：Sidebar 锁 200px，ToolPanel 浮窗（隐藏触发按钮）
- `<780px`：不允许，窗口拒绝缩小到此宽度以下

### 5.5 图标系统

**设计原则**：向 Apple SF Symbols 的视觉语言对齐——2px 均匀描边、圆角终端、视觉大小一致。跨平台实现用 **lucide-react**（最贴近 SF Symbols 描边风格的开源库）。

**图标尺寸映射**（与 SF Symbols 3 档对应）：

```
┌──────────┬────────┬─────────────────────────────────┐
│  场景     │  框大小 │  stroke        │  对应 SF Symbols │
├──────────┼────────┼─────────────────────────────────┤
│  行内     │ 14px   │  2px          │  Small (16pt)       │
│  sm      │ 16px   │  2px          │  Small (16pt)       │
│  md      │ 20px   │  1.75px     │  Medium (20pt)       │
│  lg      │ 24px   │  1.5px      │  Large (24pt)        │
│  xl      │ 32px   │  1.5px      │  Extra Large (32pt)    │
└──────────┴────────┴─────────────────────────────────┘
```

**图标容器**：所有图标外包 `24×24`（md 及以下）或 `32×32`（lg/xl）的透明容器，图标在容器内视觉居中（不依赖 `viewBox` 机械居中）。这防止不同图标因设计差异导致视觉大小不一致。

**Lucide 定制规则**：
- 行内图标：`strokeWidth={2}`、无 `fill`
- 按钮内图标：与文字 `gap: 6px`、垂直居中
- 状态图标（success/warning/danger）：可选择性加 `fill="currentColor"`（仅实心变体，加大关注度）
- 禁用量：`opacity: 0.4`（统一处理，不单独设计禁用图标）

**图标命名**：组件内用 `import { SomeIcon } from "lucide-react"` 全量引入，Tree-shaking 由 bundler 处理。不做图标按需加载优化（图标不是性能瓶颈）。

### 5.6 动效系统

**设计原则（Apple HIG Animation）**：动效是空间中的运动，不是装饰。每一种动效都有物理直觉——按钮按下去是「弹簧压缩」，Dialog 出现是「从背后浮上来」，不是「淡入」。

#### 5.6.1 弹簧参数（framer-motion spring）

所有 JS 驱动的动效用 `framer-motion` 的 `spring` 过渡，不用 `tween`。

```
┌──────────────┬─────────┬──────────┬───────────┬──────────────────────┐
│  动效类型       │  stifness│  damping │  mass     │  用途                         │
├──────────────┼─────────┼──────────┼───────────┼──────────────────────┤
│  snappy（敏捷）│  400     │  30      │  1.0      │  按钮按动、Tab 切换、开关       │
│  smoth（平滑） │  300     │  25      │  1.2      │  面板展开/收起、Dialog 进出    │
│  gentle（轻柔） │  200     │  20      │  1.5      │  空态入场、元素交错出现        │
│  bouncy（弹跳）│  500     │  15      │  1.0      │  特殊强调（完成态、徽章获取）  │
└──────────────┴─────────┴──────────┴───────────┴──────────────────────┘
```

**framer-motion 配置示例**：
```ts
const snappy = {
  type: "spring",
  stifness: 400,
  damping: 30,
  mass: 1,
};

<motion.div
  initial={{ opacity: 0, scale: 0.96 }}
  animate={{ opacity: 1, scale: 1 }}
  transition={snappy}
/>
```

#### 5.6.2 CSS 过渡（非 JS 动效）

Hover、focus、颜色变化等微交互用 CSS `transition`，easing 取 Apple 风格：

```css
:root {
  /* 微交互 — hover、focus ring、颜色变化 */
  --ease-snappy: cubic-bezier(0.2, 0.8, 0.3, 1);
  
  /* 退场 — 面板收起、元素消失 */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  
  /* 对称过渡 — Tab 切换、布局变化 */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  
  /* 入场 — 浮层出现 */
  --ease-entry: cubic-bezier(0.25, 0.1, 0.25, 1);
}
```

**时长映射**：

```
┌────────────┬──────────┬─────────────────────────────┐
│  场景          │  duration │  说明                            │
├────────────┼──────────┼─────────────────────────────┤
│  微交互        │  120ms    │  hover 变色、focus ring         │
│  标准过渡       │  200ms    │  面板展开/收起                   │
│  浮层进出       │  280ms    │  Dialog、Toast、Dropdown       │
│  大动作         │  400ms    │  空态入场、引导流程过渡          │
│  流式文字       │  —        │  不用动画，直接逐字渲染（JS 控制）│
└────────────┴──────────┴─────────────────────────────┘
```

#### 5.6.3 白名单（什么能动、什么禁止）

**✅ 允许动效**：
- 按钮按动（`scale: 0.97`，spring snappy）
- 面板展开/收起（`width` 过渡 + `opacity`，spring smooth）
- Dialog/Toast 进出（`opacity + scale(0.95→1)` 或 `y: 8→0`，spring smooth）
- hover 状态变化（`background` / `border-color`，120ms CSS）
- focus ring 出现（`box-shadow` 从 0 到 `--shadow-focus`，120ms CSS）
- 空态元素交错入场（staggered `opacity + y: 8→0`，spring gentle）
- ToolPanel 浮窗弹出（`scale: 0.92→1 + opacity`，spring smooth）

**❌ 禁止动效**：
- 页面路由切换（破坏专注，Chat 页面是 SPA 不切换路由）
- 消息气泡弹跳入场（干扰阅读流畅性）
- ToolCard 弹跳（生产工具不该有玩具感）
- 滚动驱动动效（parallax 等，桌面应用不需要）
- 背景粒子/渐变动画（纯装饰，违反「内容即界面」）

#### 5.6.4 `prefers-reduced-motion`

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  
  /* 弹簧动效退化为即时切换 */
  [data-framer-motion] {
    transition-duration: 0ms !important;
  }
}
```

**代码层处理**：framer-motion 自动尊重 `prefers-reduced-motion`，无需额外代码。

### 5.7 材质与层级规范

**设计原则**（Apple 材质语言）：每一层都有物理直觉——底层是固定的「桌面」，上层是浮动的「玻璃片」。毛玻璃模糊后方内容，产生深度感。

#### 5.7.1 层级（z-index 系统）

```
┌──────────┬─────────┬──────────────────────────────┐
│  层级     │  z-index │  元素                        │
├──────────┼─────────┼──────────────────────────────┤
│  Base    │  0       │  页面底色（bg-primary）        │
│  Sidebar │  10      │  侧边栏（毛玻璃）             │
│  Chat    │  20      │  主内容区（独立滚动）          │
│  ToolPanel│  30     │  工具面板（可收起浮窗）        │
│  Overlay │  100     │  Dialog 遮罩                 │
│  Dialog  │  110     │  对话框                       │
│  Command │  200     │  Command Palette（全局浮层）    │
│  Toast   │  210     │  提示条（自动消失）             │
└──────────┴─────────┴──────────────────────────────┘
```

所有 `z-index` 取值仅从上述表中选取。`9999` / `99999` 等极大值一律禁用。

#### 5.7.2 毛玻璃材质

marloues 不是"扁平色块"，是「层叠的半透明片」。

|  面板     |  Light 模式材质                                 |  Dark 模式材质                                    |  Warm 模式材质                                |
|----------|-----------------------------------------------|--------------------------------------------------|---------------------------------------------|
|  Sidebar |  `bg: rgba(250,250,251,0.82)` + `blur(24px) saturate(180%)`  |  `bg: rgba(44,44,46,0.78)` + `blur(24px) saturate(150%) brightness(0.85)`  |  `bg: rgba(237,230,216,0.80)` + `blur(24px) saturate(160%)`  |
|  ToolPanel（展开）|  同上 Sidebar  |  同上  |  同上  |
|  ToolPanel（浮窗）|  `bg: rgba(255,255,255,0.92)` + `blur(32px)`  |  `bg: rgba(58,58,60,0.92)` + `blur(32px)`  |  `bg: rgba(255,252,242,0.90)` + `blur(32px)`  |
|  Dialog  |  `bg: rgba(255,255,255,0.96)` + `shadow-medium`  |  `bg: rgba(58,58,60,0.96)` + `shadow-medium`  |  `bg: rgba(255,252,242,0.96)` + `shadow-medium`  |
|  Overlay |  `bg: rgba(0,0,0,0.18)`                    |  `bg: rgba(0,0,0,0.35)`                     |  `bg: rgba(0,0,0,0.12)`（暖色下遮罩更淡）  |

> `backdrop-filter` 在 Electron 的 `BrowserWindow` 里需要开启 `vibrancy`（macOS）或 `backgroundMaterial`（Windows）配合。Linux 用 CSS `backdrop-filter`（需开启 GPU 加速），不支持时回退为纯色 + `shadow-medium`。

#### 5.7.3 选择（Selection）与焦点

```
┌────────────────┬────────────────────────────────────┬─────────────────────────────────┐
│  状态          │  Light / Warm                     │  Dark                               │
├────────────────┼────────────────────────────────────┼─────────────────────────────────┤
│  Text Selection│  `bg: rgba(83,74,183,0.20)`      │  `bg: rgba(120,110,240,0.30)`        │
│  Focus Ring   │  `shadow-focus`（品牌 600 的 35% alpha）│  `shadow-focus`（品牌 400 的 40% alpha） │
│  Hover        │  `bg: var(--fill-quaternary)`     │  `bg: rgba(255,255,255,0.04)`        │
│  Active       │  `bg` 变深 5%（按钮按下态）       │  `bg` 变亮 8%                        │
└────────────────┴────────────────────────────────────┴─────────────────────────────────┘
```

#### 5.7.4 分隔线哲学

Apple 风格的分隔不用 `border`，用「背景色差」——上下两个区域的背景色稍有不同，自然的色差就是分隔。

当必须使用显式分隔线时：
- Light/Warm：`1px solid var(--border-primary)`——极淡，几乎不可见
- Dark：`1px solid var(--border-primary)`——深灰，非白色

禁止用 `box-shadow` 做分隔（阴影是深度，不是分隔）。

### 5.8 窗口响应行为

桌面应用不像网页，不存在"N 个断点"。只有三种窗口状态：

```
┌────────────────────┬──────────────┬──────────────────────────────┐
│  窗口宽度           │  Sidebar      │  ToolPanel                   │
├────────────────────┼──────────────┼──────────────────────────────┤
│  ≥1100px           │  默认 260px   │  展开，默认 320px             │
│  900–1100px        │  锁 200px     │  折叠为浮窗                   │
│  780–900px         │  锁 200px     │  浮窗（隐藏触发按钮）          │
│  <780px            │  不允许       │  （窗口拒绝缩小到此宽度以下）   │
└────────────────────┴──────────────┴──────────────────────────────┘
```

**浮窗模式**：ToolPanel 收起后在右下角显示一个小圆点，点击弹出 360×400 的浮层覆盖在 Chat 区右下角。点击浮层外部或再次点击圆点关闭。

**全屏模式**：macOS 全屏 / Windows 最大化时，Sidebar 保持默认宽度，Chat 区撑满剩余，ToolPanel 显示。

### 5.9 状态设计规范

**四个核心状态，贯穿所有页面**：

#### 5.8.1 空态 (Empty)

不是空白。空态要告诉用户"这里能做什么"。

| 页面 | 空态设计 |
|------|---------|
| **Chat（无 Thread）** | 居中大标题 "marloues" + 口号 + 两个行动按钮卡：① 选择 Runtime → 开始对话 ② 打开工作区 → 浏览文件。下方 3 个特性要点（多内核 / MCP 工具 / 本地优先），纯文字，不用图标。 |
| **Thread 列表（空）** | "还没有会话" + "点击 + 创建第一个" + 新建按钮（有颜色，吸引点击） |
| **ToolPanel（无调用）** | "暂无工具调用" + 说明文字"Agent 调用工具时将在这里展示详情" |
| **Settings → MCP（空）** | "还没有 MCP Server" + "添加 MCP Server 来扩展 Agent 能力" |

**空态插图**：不用。不用插图。纯文字 + 间距，安静专业。开发者不需要被"插画"安抚。

#### 5.8.2 加载态 (Loading)

| 场景 | 视觉表现 |
|------|---------|
| **页面首次加载** | Skeleton：灰色条块模拟内容布局，2 秒内出现。不使用全屏 spinner。 |
| **Thread 历史消息加载** | 消息列表末尾灰色骨架气泡（三条脉冲条） |
| **Agent 生成中** | 最后一条消息底部闪烁光标 `▌`（CSS `blink` animation，1s interval） |
| **Tool 执行中** | ToolCard 右侧 spinner（16px）+ "执行中..." |
| **Model 切换** | Status Bar 上的模型名短暂变灰 + 小 spinner，不阻塞操作 |

**Spinner 使用规则**：最多同时出现 2 个 spinner。超过 2 个说明你的状态设计有问题。

#### 5.8.3 错误态 (Error)

| 场景 | 视觉表现 |
|------|---------|
| **Agent 回复失败** | 内联错误卡片：红色左边框 + 错误信息文字 + "重试"按钮。不覆盖整条消息，只在失败的那条位置显示。 |
| **Runtime 连接断开** | Status Bar 上的 Runtime 指示灯变红 + 点击弹出详情（错误原因、最近一次连接时间、重试按钮）。不弹 modal。 |
| **MCP Server 异常** | Settings → MCP 列表里该 Server 行变红 + 错误信息 + "重新连接"按钮 |
| **文件操作失败** | ToolCard 的 result 区域变红色底色 + error 信息 + 不阻塞后续操作 |
| **致命错误（App 级）** | 单独的错误页面（不是弹窗）：`"出错了"` + 错误描述 + "重启 Runtime" / "重置设置" / "查看日志" 三个按钮 |

**Toast 使用规则**：仅用于非阻塞信息提示（"已复制到剪贴板""MCP Server 已连接"）。错误信息不用 toast——用户可能在专注阅读，3 秒后 toast 消失他们没看到。

#### 5.8.4 成功态 (Success)

成功态不打断用户。三种静默形式：
- **Tool 执行成功**：绿色圆点 + check 图标，无文字、无弹窗
- **复制代码**：copy 按钮短暂变成 check 图标，1.5s 后恢复
- **设置保存**：保存按钮短暂变 green + "已保存"，1.5s 后恢复默认

### 5.10 引导流程 (Onboarding)

**第一次启动 marloues 时的四步引导**（不是新手指南，是最小必要配置）：

```
┌─────────────────────────────────────────────┐
│                                             │
│         欢迎使用 marloues                       │
│                                             │
│   Step 1: 选择 Agent 内核                    │
│   ┌─────────────────────────────────────┐   │
│   │ ○ Binary    (外部二进制)              │   │
│   │ ○ SDK    (厂商 SDK)          │   │
│   │ ○ 自建       (Self-built)              │   │
│   └─────────────────────────────────────┘   │
│                                             │
│   Step 2: 配置模型连接                       │
│   [API Key / 端点 URL]                       │
│                                             │
│   Step 3: 选择工作区                         │
│   [打开文件夹]                               │
│                                             │
│   [跳过，以后再说]       [开始使用]           │
└─────────────────────────────────────────────┘
```

**设计要点**：
- 每一步可跳过，不影响后续使用
- "跳过"不等于关闭引导——下次启动时显示未完成的步骤
- 三步是一个长页面（滚动），不是分页 wizard（避免"还有几步"的焦虑）
- 引导完成后不再弹出。在 Settings 里可以重新触发

### 5.11 可访问性 (A11y)

**目标**：WCAG 2.1 AA 级。

| 维度 | 具体要求 |
|------|---------|
| **颜色对比度** | 正文文字 vs 背景 ≥ 4.5:1；大号文字（≥18px bold）≥ 3:1；UI 组件和图形 ≥ 3:1 |
| **键盘导航** | 所有交互元素可 Tab 到达；焦点环清晰可见（2px brand-400 solid，无 box-shadow）；Tab 顺序与视觉顺序一致 |
| **屏幕阅读器** | 所有图标有 `aria-label`；状态变化用 `aria-live` 区域播报（polite / assertive）；Dialog 打开时焦点移入、关闭时焦点返回触发元素 |
| **`prefers-reduced-motion`** | 见 5.6 节——全局关闭动画 |
| **`prefers-color-scheme`** | 默认跟随系统；用户在 Settings 里手动选择后覆盖系统设置 |
| **文字缩放** | 支持 `Ctrl+/-` 缩放，最小不限制、最大 200%（布局不破裂） |
| **键盘快捷键** | 所有快捷键显示在对应 UI 元素的 tooltip 里；快捷键在 Settings 可见、可自定义（v2） |

**不支持的场景**（坦诚说明）：
- 不支持语音输入（v1 不做）
- 不支持高对比度模式（Windows High Contrast Mode）
- 不支持屏幕放大器（Windows Magnifier）

---

## 6. 组件库与设计系统

### 6.1 组件分层

```
@marloues/ui
├── primitives/       ← 基础原子组件（无业务语义）
│   ├── Button        (variant: primary/secondary/ghost/danger, size: sm/md/lg)
│   ├── Input         (text, password, search, number)
│   ├── Textarea      (可伸缩、字符计数)
│   ├── Select        (下拉选择，支持搜索)
│   ├── Checkbox
│   ├── Toggle        (开关)
│   ├── RadioGroup
│   ├── Dialog        (Modal / Sheet)
│   ├── Toast         (success / error / warning / info, 自动消失)
│   ├── Tooltip
│   ├── DropdownMenu
│   ├── ContextMenu
│   ├── Tabs
│   ├── Badge
│   ├── Spinner
│   ├── Skeleton
│   ├── Icon          (lucide-react 封装)
│   ├── Divider
│   ├── ScrollArea
│   └── ResizablePanel
├── composite/        ← 复合组件（由 primitives 组合）
│   ├── FilePicker    (文件选择器)
│   ├── CodeEditor    (简易代码输入)
│   ├── JsonViewer    (JSON 格式化展示)
│   ├── SearchInput   (带搜索图标的输入框)
│   ├── ConfirmDialog (确认弹窗)
│   └── StatusDot     (状态圆点：green/yellow/red/gray)
└── business/         ← 业务组件（有 marloues 领域语义）
    ├── MessageBubble
    ├── CodeBlock
    ├── DiffBlock
    ├── ToolCard
    ├── ToolDetail
    ├── ThreadItem
    ├── ThreadList
    ├── RuntimeSelector
    ├── ModelSelector
    ├── McpServerCard
    ├── SkillCard
    ├── WorkspacePicker
    ├── TokenUsage
    └── StatusBar
```

### 6.2 设计令牌（Design Tokens）

```css
:root {
  /* 颜色 — 品牌色 */
  --marloues-50:  #EEEDFE;
  --marloues-100: #CECBF6;
  --marloues-200: #AFA9EC;
  --marloues-400: #7F77DD;
  --marloues-600: #534AB7;  /* 主品牌色 */
  --marloues-800: #3C3489;
  --marloues-900: #26215C;

  /* 颜色 — 语义色 */
  --success: #1D9E75;
  --warning: #EF9F27;
  --danger:  #E24B4A;
  --info:    #378ADD;

  /* 间距 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;

  /* 圆角 */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  /* 阴影（仅在 light 模式使用、dark 模式用 border 替代） */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
  --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.1);

  /* 字体 */
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Code", "Fira Code", monospace;

  /* 字号（1.25 比例递增） */
  --text-xs:  11px;
  --text-sm:  12px;
  --text-base: 13px;
  --text-md: 14px;
  --text-lg: 16px;
  --text-xl: 20px;
  --text-2xl: 24px;
}
```

### 6.3 组件规范

每个组件遵循统一接口规范：

```ts
// 每个组件导出一个 Component + 一个 Props 类型
export interface ButtonProps {
  variant: "primary" | "secondary" | "ghost" | "danger";
  size: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
  children: React.ReactNode;
  onClick?: () => void;
}

export const Button: React.FC<ButtonProps>;

// 同时导出 className 映射（方便外部用 cn() 覆盖）
export const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md font-medium transition-colors",
  {
    variants: { /* ... */ }
  }
);
```

技术选型：
- `class-variance-authority` (cva)：变体管理
- `clsx` + `tailwind-merge`：className 合并
- `lucide-react`：图标
- `framer-motion`：交互动画（仅在需要的地方引入）
- `@dnd-kit`：拖拽

### 6.4 设计原则

1. **组件即文档**。每个组件文件同级有 Storybook story（`*.stories.tsx`）。
2. **可访问性**。所有交互组件支持键盘导航、ARIA 标签、`prefers-reduced-motion`。
3. **暗色模式**。所有组件在 light / dark 下都可正常使用，不用 `dark:` class 写两遍样式。
4. **最小依赖**。除 lucide-react 外不引入外部 UI 库。自己写，自己控。

---

## 7. 工程化规范

### 7.1 Monorepo

| 工具 | 选型 | 理由 |
|------|------|------|
| 包管理 | npm (workspaces) | 原生支持、零额外安装 |
| 构建编排 | Turborepo | 并行构建、缓存、增量 |
| 版本管理 | Changesets | 语义化发布、changelog 自动生成 |

### 7.2 代码规范

**TypeScript**：
- 严格模式 (`strict: true`)
- 禁止 `any`（eslint `@typescript-eslint/no-explicit-any: error`）
- 导出类型优先用 `interface` 而非 `type`（除非需要 union / intersection）
- 文件命名：kebab-case（`agent-runtime.ts`、`message-bubble.tsx`）

**ESLint**：
- 基于 `@typescript-eslint/recommended-type-checked`
- 额外规则：
  - `no-console: warn`（仅允许 `console.error`）
  - `import/order`：native → external → internal → relative
  - `unused-imports/no-unused-imports: error`

**Prettier**：
- `semi: true`、`singleQuote: false`、`trailingComma: "all"`、`printWidth: 100`

**Commit 规范**：
- Conventional Commits：`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` / `test:`
- 禁止 `wip:` / `tmp:` / `fixup:`
- PR title 必须匹配 conventional commit 格式

### 7.3 测试策略

```
优先级：E2E > 集成测试 > 单元测试
```

| 层级 | 工具 | 覆盖目标 |
|------|------|---------|
| 单元 | Vitest | 工具函数、状态管理、组件逻辑 |
| 组件 | Vitest + @testing-library/react | Button、Input、MessageBubble 等核心组件 |
| 集成 | Vitest | AgentRuntime SPI 三种实现的契约测试 |
| E2E | Playwright | 完整用户流程：发送消息 → tool 调用 → 结果展示 |

**核心测试场景（E2E）**：
1. 启动 app → 选择 Runtime → 创建 Thread → 发送消息 → 收到回复
2. Agent 调用 tool → tool card 展示 → 用户 approve → tool 执行完成
3. 中断生成 → 确认中断 → 输入框恢复可用
4. 切换 Runtime → Thread 列表保持 → 发送消息使用新 Runtime
5. 添加 MCP Server → 状态变 green → tool 列表包含 MCP tool
6. 暗色模式切换 → 所有页面正确渲染

### 7.4 Git 工作流

- `main`：始终可发布
- `feat/*`：功能分支，从 main 出，PR 合并回 main
- 每个 PR 必须通过：lint + typecheck + test + E2E（关键路径）
- 拒绝 force push 到 main
- Squash merge 到 main

---

## 8. CI / CD

### 8.1 流水线

```
Push / PR
  │
  ├── Install (npm ci)
  ├── Lint (eslint)
  ├── Typecheck (tsc --noEmit)
  ├── Test (vitest run)
  ├── E2E (playwright test --project=critical)
  │
  ├── [PR] → PR Comment (test result + coverage diff)
  │
  └── [main push] → Build (electron-builder)
       │
       ├── macOS (dmg + zip, x64 + arm64)
       ├── Windows (exe + nsis installer, x64)
       └── Linux (AppImage + deb, x64)
            │
            └── 内测 Release (GitHub Release)
                 │
                 ├── 外网 → auto-update (electron-updater)
                 └── 内网 → 手动分发 (企业内网下载页)
```

### 8.2 环境

| 环境 | 触发 | 分发方式 |
|------|------|---------|
| 开发 | `npm run dev` | 本地 electron |
| PR 预览 | PR 打开 | CI 构建产物（E2E 截图对比） |
| 内测 | main push | GitHub Release pre-release |
| 正式 | tag `v1.0.0` | GitHub Release stable + auto-update |

### 8.3 代码签名

- **macOS**：Apple Developer ID + notarization（外网版必须，否则无法运行）
- **Windows**：EV Code Signing Certificate（外网版建议，否则 SmartScreen 报警）

---

## 9. 品牌与官网

### 9.1 品牌

**Logo**：

```
███╗   ██╗███████╗ ██████╗ 
████╗  ██║██╔════╝██╔═══██╗
██╔██╗ ██║█████╗  ██║   ██║
██║╚██╗██║██╔══╝  ██║   ██║
██║ ╚████║███████╗╚██████╔╝
╚═╝  ╚═══╝╚══════╝ ╚═════╝ 
```

设计方向：技术感文字标，几何线条 + 品牌紫。主色 #534AB7（深紫），辅助色 #26215C（近黑紫）。

**口号**：*One workbench, any agent.*

**中文口号**：*一个工作台，任意 Agent。*

### 9.2 官网 (`marloues.dev`)

**单页结构**：

```
┌──────────────────────────────────┐
│  Nav: Logo | 下载 | 文档 | GitHub │
├──────────────────────────────────┤
│  Hero                            │
│  marloues — AI 桌面工作台           │
│  One workbench, any agent.       │
│  [免费下载] [查看源码]             │
├──────────────────────────────────┤
│  Feature 1: 多内核切换            │
│  Binary · SDK · 自建               │
│  同一界面，自由切换，不锁供应商      │
├──────────────────────────────────┤
│  Feature 2: 工具生态              │
│  MCP · Skills · Shell · 文件      │
│  你的工具，由你掌控               │
├──────────────────────────────────┤
│  Feature 3: 内外网一体            │
│  同一份代码，配置决定一切           │
│  外网开所有，内网加护栏             │
├──────────────────────────────────┤
│  Feature 4: 本地优先              │
│  数据在你电脑上，不经过我们服务器    │
│  隐私不是承诺，是架构               │
├──────────────────────────────────┤
│  下载区域                         │
│  macOS · Windows · Linux          │
├──────────────────────────────────┤
│  Footer: marloues © 2026 | 隐私 | 条款│
└──────────────────────────────────┘
```

**技术选型**：
- 框架：Astro（纯静态、零 JS 交互、SEO 友好）
- 部署：Cloudflare Pages（或 Vercel）
- 域名：`marloues.dev`
- 分析：不装（隐私承诺）

### 9.3 文档站 (`docs.marloues.dev`)

- 快速开始（安装 → 选择 Runtime → 发送第一条消息）
- Runtime 配置详解
- MCP Server 配置示例
- Skills 编写指南
- FAQ
- 内网部署指南

---

## 附录 A：技术选型总表

| 类别 | 选型 | 版本要求 |
|------|------|---------|
| 桌面框架 | Electron | ≥33 |
| 前端框架 | React | 18.x |
| 构建工具 | Vite (via electron-vite) | 6.x |
| 样式 | Tailwind CSS | 3.x |
| 状态管理 | Zustand | 5.x |
| 语言 | TypeScript | 5.6+ strict |
| 包管理 | npm | 11.x |
| Monorepo | Turborepo | 2.x |
| 测试 | Vitest + Playwright | latest |
| 图标 | lucide-react | latest |
| 代码高亮 | highlight.js | 11.x |
| Markdown | react-markdown + remark-gfm | latest |
| CI/CD | GitHub Actions | — |
| 官网 | Astro | 5.x |
| 版本管理 | Changesets | latest |

## 附录 B：内网版差异化清单

| 维度 | 外网版 | 内网版 |
|------|--------|--------|
| Runtime | Binary + SDK + Self-built | 仅 SDK Runtime |
| 模型来源 | 用户自配、公网 API | 企业端点 Profile（预置在配置文件中） |
| MCP Server | 任意来源 | 仅批准列表内的 MCP Server |
| Skills | 任意目录 | 仅企业指定目录 |
| 网络 | 无限制 | `navigation-policy` 白名单 |
| 审计 | 无 | 所有 tool 调用 + 文件操作写审计日志 |
| 更新 | electron-updater 自动 | 手动分发 |
| 配置 | 用户自主修改 | 部分字段由企业策略文件锁定 |
| 遥测 | 可选开关（默认关） | 强制关闭 |

## 附录 C：下一步行动

PRD 定稿后，按以下顺序推进：

1. **起 scaffolding**：npm workspaces + Turbo + electron-vite + React 18 + Tailwind
2. **抽 AgentRuntime SPI**：`@marloues/runtime-spi` 包 + 三种 Runtime 的 stub 实现
3. **搭 UI 组件库**：`@marloues/ui` primitives → composite → business
4. **做 Chat 页面**：MessageBubble + CodeBlock + ToolCard + 流式渲染
5. **接 Runtime**：分别串 Binary / SDK / Self-built
6. **完善周边**：Settings / MCP / Skills / Status Bar
7. **品牌官网**：Astro 静态站
8. **CI/CD**：GitHub Actions + electron-builder + auto-update
