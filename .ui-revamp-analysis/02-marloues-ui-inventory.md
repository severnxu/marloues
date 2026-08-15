# 02 · marloues UI 现状盘点（renderer 移植前期基线）

> 只读分析，未修改任何文件。仓库：`C:\workspace\marloues`（代码在 `client/`）。
> 对比基准：`C:\workspace\neobot`（最新版，代码在 `src/`，非 `client/`）。
> 盘点日期：本文件生成时；所有行数/文件数均为当时实测。

---

## 0. 总览（TL;DR）

| 维度 | marloues | neobot（对比基准） |
|---|---|---|
| renderer 根 | `client/renderer/src/` | `src/renderer/src/` |
| workflow-chat | **扁平 43 文件**（无子目录） | 6 个子目录（activity/ adapter/ composer/ content/ fixtures/ task-context/ turns/）约 150 文件 |
| styles | 3 个 `workbench-*.css` + 1 个巨型 `index.css`(14,825 行) | `styles/tokens.css` + `styles/components/*.css`（40+ 个按组件拆分） |
| stores | 7 个文件，`unified-chat-store.ts` 单文件 1411 行 | `chat-slices/` 10 个 slice 文件 + item-event-batcher 等 |
| preload | `window.marloues`（MarlouesAPI）13 个命名空间 | `window.neoBot`（NeoBotAPI）20 个命名空间 |
| shared | 14 文件，**无 conversation-page-contract.ts** | 50+ 文件（含 conversation-page-contract、session-core/、im/、schedule/、analytics、token-usage 等） |
| 依赖 | 22 个 dependencies，独有 `semver` | 45 个 dependencies，独有 CodeMirror/虚拟列表/SSO/IM/调度等一批 |
| 品牌残留 | marloues 全量替换，**无 neobot 残留** | — |

---

## 1. renderer 目录全树（`client/renderer/src/`）

### 1.1 完整文件清单（按目录分组，共 102 个文件）

**根（5）**：`App.tsx`、`main.tsx`、`index.css`、`types.ts`、`env.d.ts`

**components/auth（1）**
| 文件 | 职责 |
|---|---|
| `auth/AuthGate.tsx` | 认证门禁：未登录时渲染 LoginPage，已登录渲染主应用 |

**components/layout（8）**
| 文件 | 职责 |
|---|---|
| `layout/GlobalSearchOverlay.tsx` | 全局搜索浮层（跨 session/配置/skill/mcp/audit 检索） |
| `layout/PermissionRequestOverlay.tsx` | 权限请求弹层（embedded/overlay 两种形态） |
| `layout/RightSidebar.tsx` | 右侧辅助栏外壳（文件/记忆面板入口） |
| `layout/RightSidebarPanels.tsx` | 右栏面板实现（文件树、记忆读写） |
| `layout/Sidebar.tsx` | 左侧主导航栏（会话列表、工作区、品牌区） |
| `layout/SidebarParts.tsx` | 侧栏子部件（账号 dock、菜单项等） |
| `layout/TitleBar.tsx` | 平台标题栏（产品名 + 窗口控制） |
| `layout/WorkspaceLayout.tsx` | 工作区三栏布局装配（主导航/主区/右栏） |

**components/onboarding（1）**
| 文件 | 职责 |
|---|---|
| `onboarding/OnboardingDialog.tsx` | 首次启动引导对话框（选运行时/配模型/选工作区） |

**components/settings（5）**
| 文件 | 职责 |
|---|---|
| `settings/SettingsWorkbench.tsx` | 设置中心主工作台（providers/MCP/audit 管理逻辑，2200+ 行） |
| `settings/SettingsWorkbench.utils.ts` | 设置工作台工具函数 |
| `settings/shared.tsx` | 设置页共享 UI 原语（SettingsCard 等） |
| `settings/sections/BasicSettingsSections.tsx` | 基础设置分区（细节级别、通用项） |
| `settings/sections/SecuritySettings.tsx` | 安全设置（脱敏规则、企业策略） |
| `settings/sections/SkillAuditRuntimeSettings.tsx` | Skill 市场/审计/运行时设置分区 |
| `settings/sections/UpdateSettings.tsx` | 更新设置（热更新 + 完整更新） |

**components/ui（12）**：`badge.tsx`、`button.tsx`、`card.tsx`、`ConfirmDialog.tsx`（旧版）、`confirm-dialog.tsx`（新版）、`divider.tsx`、`glass-modal.tsx`、`index.ts`、`input.tsx`、`skeleton.tsx`、`spinner.tsx`、`toggle.tsx`、`tooltip.tsx` —— shadcn 风格基础组件（注：ConfirmDialog 与 confirm-dialog 两份并存）。

**components/workbench（19）**
| 文件 | 职责 |
|---|---|
| `workbench/events.ts` | 自定义事件名常量（`marloues:open-auxiliary-panel`） |
| `workbench/index.ts` | 桶导出 |
| `workbench/PlatformWindow.tsx` | 平台窗口壳（macOS/Windows 平台类名注入） |
| `workbench/WindowChrome.tsx` | 自定义窗口轨道（标题、产品名、运行状态、窗口按钮） |
| `workbench/WorkbenchRoot.tsx` | 工作台根（平台检测、布局装配） |
| `workbench/WorkbenchChatLayout.tsx` | 聊天页工作台布局（主区 + 右辅助栏 + 权限） |
| `workbench/WorkbenchRegions.tsx` | 三栏 region 组件（primary/auxiliary shell） |
| `workbench/WorkbenchViewHost.tsx` | 主视图宿主（按 page 切换页面） |
| `workbench/layout-model.ts` | 布局模型类型（platform/auxiliary mode/resize target） |
| `workbench/use-workbench-layout.ts` | 布局状态 hook（宽度/折叠/动画） |
| `workbench/use-auxiliary-transition.ts` | 辅助栏过渡 hook |
| `workbench/ResizeHandle.tsx` | 栏间拖拽调宽手柄 |
| `workbench/RuntimeStatus.tsx` | 运行时状态指示（小圆点） |
| `workbench/interaction/index.ts` | 交互区桶导出 |
| `workbench/interaction/InteractionDock.tsx` | 底部交互坞（steer 队列 + composer + 权限卡） |
| `workbench/interaction/SteerQueue.tsx` | 排队消息（steer）列表/拖拽排序 |
| `workbench/interaction/task-result.ts` | 任务结果摘要派生逻辑 |
| `workbench/interaction/TaskResultSummary.tsx` | 任务结果摘要胶囊 |
| `workbench/interaction/types.ts` | 交互区类型 |

**components/workflow-chat（43）**：见第 2 节。

**pages（3）**：`LoginPage.tsx`（登录页）、`SettingsPage.tsx`（设置页壳）、`WorkflowChatPage.tsx`（聊天主页面，1026 行，含 ModelSelector/ContextActionCard/Rewind 对话框等页面级组件）。

**stores（7）**：见第 4 节。

**hooks（2）**：`use-confirm-dialog.tsx`、`use-theme.ts`。

**lib（6）**：`hljs.ts`（highlight.js 配置）、`hljs-languages.ts`（语言注册）、`ipc-client.ts`（`export const ipc = window.marloues`）、`notifications.ts`（sonner 封装，`marloues-toast` 类）、`utils.ts`（cn 等）。

**styles（3）**：见第 3 节。

### 1.2 与 neobot 的目录结构差异

| 差异点 | marloues | neobot |
|---|---|---|
| auth | `components/auth/AuthGate.tsx`（无 index） | `components/auth/`（含 index.ts） |
| 侧栏/辅助栏 | 平铺在 `layout/` + `workbench/` | `workbench/primary-sidebar/`（14 文件）、`workbench/auxiliary-sidebar/`（含 panels/，13 文件） |
| 缺失模块 | — | `components/code-viewer/`（CodeMirror）、`components/diff/`（DiffViewer）、`components/mcp/`、`components/plugins/`、`components/replay/`（12 文件）、`components/schedule/`（15 文件）、`components/skills/`（9 文件）、`components/update/`、`components/im-channels/`（Feishu/Wecom QR 绑定） |
| pages | 3 个 | 11 个（含 PluginsPage/ReplayPage/SchedulePage/WorkflowChatHeader/WorkflowChatModelSelector/WorkflowChatCards） |
| stores | 7 个 | 20+ 个（chat-slices/、im-store、inspector-store、replay-store、runtimes-store、schedule-store、settings-dialog-store、update-store 等） |
| styles | 3 个 workbench css | `styles/components/` 40+ 个按模块拆分 css |
| 缺失 hooks/lib | `use-watermark`、`use-window-maximize`、`use-watermark`、`scrollbar-activity`、`product-brand`、`analytics/`、`codemirror*` | 同左为 neobot 有而 marloues 无 |

---

## 2. workflow-chat 现状（43 个文件，扁平结构）

### 2.1 结构说明

`components/workflow-chat/` **没有任何子目录**，43 个文件全部平铺。而 neobot 的 workflow-chat 拆成 6 个子目录（activity/ 25 文件、adapter/ 9 文件、composer/ 18 文件、content/ 4 文件、fixtures/ 2 文件、task-context/ 8 文件、turns/ 45 文件 + 顶层 ViewportCulling/conversation-icons 等）。

### 2.2 43 文件逐一职责

| 文件 | 行数 | 职责（一句话） |
|---|---|---|
| `ActivityGroup.tsx` | 118 | 把 turn 内活动条目按阶段/工具分组渲染的容器 |
| `ActivityRenderer.tsx` | 146 | 按 item 类型分发到各 Row 渲染器的总调度 |
| `ActivityRow.tsx` | 79 | 单条活动行（图标 + 摘要 + 状态徽标 + 内联点） |
| `AgentFlowSection.tsx` | 44 | agent 消息区段（wrap 活动行） |
| `AssistantAnswer.tsx` | 17 | 纯文本答案包裹器 |
| `AssistantTurn.tsx` | 463 | 助手 turn 主体：状态头、活动折叠、Markdown 正文、footer 元数据 |
| `AssistantTurnHeader.tsx` | 113 | turn 头部（状态标签、耗时、展开箭头、模型名） |
| `CodeBlock.tsx` | 78 | 代码块包装（复制按钮 + 滚动） |
| `CollabAgentToolRow.tsx` | 78 | 协作 agent 工具调用行（claude-code 风格 collabAgentToolCall） |
| `CommandExecutionRow.tsx` | 277 | 命令执行行（shell 聚合输出、退出码、展开详情） |
| `ComposerAttachmentList.tsx` | 100 | 输入框附件条（图片/文件卡片） |
| `ComposerShell.tsx` | 478 | 输入框（textarea、发送/停止、模型选择插槽、编辑横幅） |
| `EmptyChatState.tsx` | 152 | 空态页（品牌 + 就绪度检查 + `marloues:open-settings` 事件） |
| `FileChangeRow.tsx` | 448 | 文件变更行（diff 渲染、滚动条样式注入 `data-marloues-diff-scrollbar`） |
| `ImageGenerationRow.tsx` | 127 | 图片生成行（prompt/状态/结果字节） |
| `ImageLightbox.tsx` | 96 | 图片灯箱预览 |
| `index.ts` | 89 | 桶导出（全部 40+ 组件/工具） |
| `item-text.ts` | 60 | item 输入/输出文本提取工具 |
| `MarkdownContent.tsx` | 83 | **Markdown 渲染**：react-markdown + remark-gfm + rehype-highlight（highlight.js），非纯文本 |
| `MarkerRows.tsx` | 135 | 多种 marker 行：imageView、reviewMode、hookPrompt、contextCompaction、unknown raw JSON |
| `PermissionRequestRow.tsx` | 50 | 会话内权限请求行 |
| `ReadThreadTurnList.tsx` | 246 | readThread 快照 → turn 列表渲染（主页面实际使用的列表） |
| `ReasoningRow.tsx` | 34 | 推理/思考行 |
| `ResultCards.tsx` | 342 | 结果卡片（工具类 item 的紧凑卡片化展示 + diff 摘要） |
| `ScrollToBottomButton.tsx` | 22 | 回到底部按钮 |
| `ThreadView.tsx` | 31 | Thread 视图包裹（旧路径，非主用） |
| `ToolCallRow.tsx` | 64 | 工具调用行（含 cancelTool 按钮） |
| `ToolCallRowDetails.tsx` | 847 | 工具详情（ToolDetail/ToolIcon/toolLabel/itemStatus，单文件实现 neobot 的 ToolCallRowDetails/ 目录） |
| `turn-collapse-rules.ts` | 117 | turn 折叠规则（是否折叠/是否显示 item/运行状态判定） |
| `turn-collapse-state.ts` | 73 | 折叠状态机（key 生成、状态迁移） |
| `turn-layout.ts` | 607 | turn 布局模型：把 items 归类为 leadingActivity/agentFlow/trailingActivity、活动分组、摘要 |
| `turn-presentation.ts` | 76 | 呈现模型（哪些块要展示/隐藏） |
| `turn-status.ts` | 23 | 状态标签/时长的文案与色调 |
| `TurnView.tsx` | 86 | 单 turn 视图（UserMessage + AssistantTurn 装配、响应计时） |
| `use-collapse-state.ts` | 64 | 折叠状态 hook（流式期间默认展开） |
| `UserMessage.tsx` | 167 | 用户消息（文本 + 附件 + 编辑/重发/rewind 操作） |
| `use-scroll-anchor.ts` | 113 | 滚动锚定 hook（吸底判定） |
| `use-turn-expansion.ts` | 66 | turn 展开状态 hook（备用） |
| `WebSearchRow.tsx` | 108 | 网页搜索行（query/url/queries） |
| `WorkflowCodexFixturePage.tsx` | 306 | fixture 页面（`workflowFixture=codex|chatShell` 注入 `window.__MARLOUES_WORKFLOW_FIXTURE_READ_THREAD__`） |
| `workflow-consumption-model.ts` | 14 | 消费模型入口（转发 toWorkflowMessages） |
| `workflow-message-adapter.ts` | 722 | **核心适配器**：Message[] → WorkflowMessageBlock[]，含 normalize 外部数据、item 压缩/去重、读线程转换 |
| `WorkflowTurnList.tsx` | 61 | turn 列表（映射 WorkflowTurnView，管理折叠状态） |

### 2.3 相比 neobot 缺失/精简的能力

**A. 缺失的整块能力（neobot 有、marloues 完全无）**
- ❌ **task-context 固定摘要面板**：neobot `task-context/`（TaskContextPanel、TaskContextSections、ThreadSummaryPrimitives、task-presentation-model、use-task-context-layout、use-task-presentation-model）。marloues 无任何 TaskContext 字样。
- ❌ **TurnShell / TurnFlowSection / TurnFooterView / TurnProcessDisclosure / TurnPresentationBlocks / turn-presentation-model**：neobot turns/ 里 turn 外壳与过程披露的拆分组件，marloues 全部没有。
- ❌ **TurnErrorCard / MessageErrorCard / error-guidance / cancelled-turn-mapping**：错误/取消场景的专门 UI 与文案映射，marloues 只把 error 折叠成一条 dynamicToolCall。
- ❌ **ThinkingPlaceholder / SubagentWorkspace / QueuedSteersPanel**：思考占位、子代理工作区、排队消息面板（marloues 的 steer 队列在 workbench/interaction 里，不是 turn 内面板）。
- ❌ **composer 生态**：SlashCommandPopover、ComposerSuggestionPopover、ContextUsageRing、ComposerTaskProgress、SandboxInstallBanner、composer-editable、composer-contract、useComposerSuggestions、useComposerAttachments、useSandboxGate、useComposerDockSafeArea、use-conversation-scroll。marloues 只有一个 ComposerShell + ComposerAttachmentList。
- ❌ **activity 细化**：TurnItemRenderer（统一 item 渲染器）、ActivityDetail、CommandDetailCard、command-presentation、DetailCopyButton、image-lightbox-model、image-source。marloues 的 ToolCallRowDetails 是单文件 847 行，neobot 是 11 文件目录（parsers/labels/helpers/detail-sections/ToolDetail/ToolDetailFrame）。
- ❌ **adapter 拆分**：neobot `workflow-message-adapter/` 是目录（normalize.ts / streaming.ts / text-extractors.ts / shared-helpers.ts / types.ts），marloues 是单文件 722 行。
- ❌ **ViewportCulling**（视口裁剪性能优化）、**conversation-icons**、**fixtures/TaskContextFixturePage**。

**B. 能力对齐但实现形态不同**
- ⚠️ 流式渲染：**是 Markdown**（react-markdown + remark-gfm + rehype-highlight），不是纯文本；但 stream chunk 只追加到 `liveTurn.content` 字符串，靠整块重渲染，无增量/虚拟化。
- ⚠️ 折叠/布局逻辑（turn-collapse-*、turn-layout）mar loues 与 neobot 同名同思路，但 neobot 的 turn-layout 拆成 index/flow-helpers/summary-helpers/tool-helpers/turn-layout/types 5 文件。
- ⚠️ 无 `shared-rehype-highlight`（neobot 统一 hljs 高亮配置，marloues 直接内联 import highlight.js css）。

---

## 3. styles 现状（`client/renderer/src/styles/`，3 个文件）

### 3.1 workbench-tokens.css（65 行）——布局/表面 token

- **布局尺寸 token**：`--workbench-titlebar-height: 46px`、`--workbench-primary-width: 275px`、`--workbench-auxiliary-width: 319px`、min/max 边界（primary 275→480、auxiliary 319→500）、`--workbench-main-min: 400px`、`--workbench-traffic-light-safe-area: 76px`、`--workbench-workspace-inline-padding: 18px`、`--workbench-resize-hit-width: 12px`。
- **平台偏移 token**（Windows/macOS 标题轨道避让）：`--workbench-windows-*`（leading-width、title-offset、caption-width、auxiliary-control-width、safe-area 等 8 个）、`--workbench-macos-*`（collapsed-title-offset、title-divider-x、safe-area）。
- **表面色 token**：`--workbench-surface-navigation: var(--panel)`、`--workbench-surface-main: var(--bg)`、`--workbench-surface-auxiliary: var(--bg)`、`--workbench-divider`（color-mix 的 border 72%）、`--workbench-control-hover`、`--workbench-overlay-shadow`、`--workbench-motion`（260ms 曲线）。
- **平台覆盖**：`.platform-windows` 重定义 surface 为深灰 hsl（导航 9%、主区 13%），并设置 Segoe UI 字体；`data-theme="light"` 下再覆盖；`.platform-darwin` 把 traffic-light 别名暴露。
- 引用的是 `index.css` 里的语义变量（`--panel`、`--bg`、`--border`、`--text`、`--muted`、`--accent` 等），**没有 @layer**。

### 3.2 workbench-shell.css（693 行）——工作台外壳

- **窗口轨道**：`.window-chrome`（46px 高、绝对定位、pointer-events none）、`.window-chrome-leading/trailing/actions/control`、`.window-product-lockup`（产品名锁标）、`.window-runtime-status`（运行圆点）、`.window-caption-controls`（Windows 最小化/最大化/关闭，关闭 hover 红）。
- **三栏外壳**：`.primary-sidebar-shell`（open/closed/is-peeking 抽屉动画 + 1px 边界）、`.sidebar-size-lock`、`.main-workspace-shell`、`.chat-page` 背景覆盖、`.chat-header`/`.chat-session-title`。
- **辅助栏**：`.auxiliary-sidebar-shell`（含 is-primary-overlay 全屏覆盖模式）、`.inspector-tabs`、`.inspector-size-lock`、`.file-filter`、`.auxiliary-file-row`、`.auxiliary-plan`（步骤列表）、`.auxiliary-empty`。
- **调宽手柄**：`.workbench-resize-handle`（hover 高亮线，`body.resizing-columns` 状态）。
- **平台差异**：`platform-windows`（caption 按钮、标题避让、auxiliary 高度=100%-46px）、`platform-macos`（隐藏 caption controls、traffic light 避让）、collapsed 状态下标题位移（`.primary-collapsed`）。
- 底部两个媒体查询（760px 折行、prefers-reduced-motion）。

### 3.3 workbench-interaction.css（351 行）——底部交互区

- `.chat-page`（`--interaction-dock-height: 110px`）、`.messages-scroll` 底部留白。
- `.interaction-dock`：绝对定位底部坞 + 渐隐蒙版（`--workbench-interaction-fade-inset: 24px`）。
- `.input-interaction-stack`/`.permission-interaction-stack`（max-width 760px 居中）。
- `.composer` 圆角卡片、`.task-result-summary`（34px 胶囊，addition=success/deletion=danger 高亮）。
- `.steer-queue`/`.steer-row`/`.steer-grip`/`.steer-copy`/`.steer-guide`/`.steer-icon-button`/`.steer-menu`（排队消息）。
- `.permission-card.embedded`、`.composer-attachments`/`.composer-attachment-image`/`.composer-attachment-file`/`.composer-file-card`、`.scroll-to-bottom-button`。

### 3.4 类名前缀与 @layer 结论

- **无统一前缀**：三个 workbench css 用的是**描述性类名**（`window-*`、`primary-sidebar-*`、`auxiliary-*`、`interaction-*`、`steer-*`、`composer-*`、`task-result-*`），**不是 `marloues-*` 前缀**。
- `marloues-` 前缀只出现在 `index.css`：品牌色板 `--marloues-50/100/200/400/600/800/900`（紫色系）+ sonner toast 类 `.marloues-toast` 系列（20 处）。
- **@layer：完全没有**。`index.css` 只有 `@tailwind base/components/utilities` 三条 Tailwind v3 指令（外加 `@media (prefers-reduced-motion)` 等普通规则）；workbench css 全部为普通顶层规则，靠选择器特异性与 `!important`（sidebar 关闭宽度）压过 Tailwind。
- `index.css` 是 14,825 行的巨型文件（含全部主题 token、组件样式、toast、markdown prose 调整等），neobot 已拆成 `styles/components/*.css` 40+ 文件。

---

## 4. stores（`client/renderer/src/stores/`）

### 4.1 文件清单（7 个）

| 文件 | 行数 | 内容 |
|---|---|---|
| `auth-store.ts` | 62 | zustand：phase/hasAccount/session/error + restore/openLogin/openRegister/logout |
| `live-turn.ts` | 131 | **非 store**：live turn 类型与呈现派生工具（fallbackLiveBlocks、deriveLiveTurnPresentation、mergeLiveTurnRuntimeStatus、textFromBlocks、stripThinkingTags、splitMarkdownBlocks） |
| `onboarding-store.ts` | 72 | completed/selectedRuntime/configuredModel/selectedWorkspace + complete；key=`marloues.onboarding.v1` |
| `settings-store.ts` | 49 | settings/runtimeState/models + load/save/switchRuntime/setModel |
| `theme-store.ts` | 198 | isDark/mode(含 warm)/accentColor + toggle/setDark；key=`marloues.theme`、`marloues.accent` |
| `unified-chat-store.ts` | **1411** | 主聊天 store（见下） |
| `workspace-store.ts` | 51 | current/settings + load/select/switchWorkspace/renameWorkspace |

### 4.2 unified-chat-store.ts 结构（单 store、无 slice 拆分）

**state 键**：`sessions`、`activeSessionId`、`isStreaming`、`currentRequestId`、`contextActionRequest`、`liveTurns: Record<sessionId, LiveTurn>`、`readThreads: Record<sessionId, WorkflowReadThreadResponse>`、`inputDrafts`、`inputText`。

**actions**：`load`、`createSession`、`setActiveSession`、`deleteSession`、`updateSessionTitle`、`toggleSessionPinned`、`forkSession`、`rewindFiles`、`sendMessage`、`regenerateMessage`、`editAndResendMessage`、`abort`、`setInputText`、`handleItemEvent`、`handleEvent`、`clearContextActionRequest`、`continueContextAction`、`loadReadThread`、`handleReadThread`；派生：`getWorkflowMessages`、`getActiveReadThreadModel`。

**LiveTurn 形态**：`{ turnId, status(pending|running|completed|error|aborted), startedAt, content, blocks: MessageBlock[], timeline: TimelineItem[], compactionActive?, compactionSettled?, contextBlocked?, usage?, modelId?, modelName?, workspacePath?, workspaceName? }`。

### 4.3 如何消费 workflow 事件（双通道 + 快照回退）

- 接线在 `App.tsx`（AuthenticatedApp 的 useEffect）：
  - `window.marloues.chat.onEvent` → `handleEvent`（UIEvent 点号流）
  - `window.marloues.chat.onItemEvent` → `handleItemEvent`（MessageItem 增量流）
  - `window.marloues.chat.onReadThread` → `handleReadThread`（权威快照推送）
  - `onPermissionRequest` → 本地 React state（PermissionRequestOverlay）
- `handleEvent` 分支：`turn.start`、`turn.complete`（aborted 单独处理）、`context.compaction`（blocked→contextActionRequest）、`text.chunk`（追加 content + blocks）、`session.info/mcp.status/memory.recall/context.usage/context.warning/runtime.status/prompt.suggestion`（→ TimelineItem）、`thinking.chunk/tool.start/tool.progress/tool.complete`（→ blocks + timeline）、`usage`。
- `handleItemEvent` 分支：`turn.start`（创建 assistant 占位消息）、`item.updated`（mergeItem 合并 MessageItem + 重算文本）、`turn.complete`。
- **双通道合并**：`getWorkflowMessages` 用 `buildWorkflowMessages(session.messages)`（历史，来自 item 流）+ `mergeLiveTurnIntoWorkflowMessages`（live turn 覆盖为 WorkflowMessageBlock）；`getActiveReadThreadModel` 优先返回 `readThreads[sessionId]`（权威 readThread 快照），流式中或缺失时**回退**到 `workflowMessagesToWorkflowReadThreadResponse(...)` 本地适配。
- **对比 neobot**：neobot 把同一套逻辑拆成 `stores/chat-slices/` 10 个文件（session-slice/send-slice/steer-slice/readthread-slice/event-handler-slice/turn-event-handlers/runtime-event-handlers/steer-event-handlers/helpers/types）+ `item-event-batcher.ts` + `workflow-message-builders.ts`；并多出 `steer-slice`（排队消息入 store）与 `item-event-batcher`（高频 item 事件批处理）。marloues 的 steer 队列是 WorkflowChatPage 本地 useState，不在 store。

---

## 5. preload API（`client/preload/index.ts`）

- 挂载：`contextBridge.exposeInMainWorld("marloues", api)`；类型 `MarlouesAPI`（定义在 `@shared/types`）。
- **13 个一级命名空间**，各关键方法：

| 命名空间 | 关键方法 |
|---|---|
| `auth` | getStatus / openLogin / openRegister / logout / onStatusChanged |
| `app` | platform（静态）/ getVersion / getVersionInfo / markRendererReady / exportDiagnostics |
| `update` | getState / getPreferences / savePreferences / check / download / installNow / onState |
| `window` | minimize / maximize / close / isMaximized / onMaximizedChanged |
| `workspace` | select / switch / rename / remove / getCurrent / getSettings / openInExplorer |
| `fs` | listDir / readFile / stat |
| `memory` | list / read / write |
| `config` | getAgentSettings / saveAgentSettings / testEndpointProfile / testEndpointModel / listEndpointModels |
| `runtime` | getState / switch / listModels / setModel |
| `mcp` | listServers / saveServers / testServer / refreshStatus / listTools |
| `audit` | list |
| `skill` | list / importFolder / toggle / remove / getDetail / marketplaceList / marketplaceDetail / marketplaceInstall |
| `chat` | listSessions / listAllSessions / createSession / deleteSession / updateSessionTitle / toggleSessionPinned / forkSession / rewindFiles / exportSession / send / resendFromMessage / abort / cancelTool / readThread / onReadThread / onEvent / onItemEvent / onPermissionRequest / respondToPermission |

- IPC 通道名常量集中在 `shared/types.ts` 的 `IPC` 对象（`auth:get-status` 等约 60 个）。
- **对比 neobot（window.neoBot / NeoBotAPI，20 个命名空间）**：marloues 缺 `languageRuntimes`、`notification`、`schedule`、`replay`、`sandbox`、`patch`、`im` 7 个命名空间；其余 13 个与 neobot 前 13 个一一对应（chat 内 marloues 多了 readThread/onReadThread/cancelTool，少了 neobot 的 item 事件批处理封装——neobot 的 onItemEvent 经 `item-event-batcher` 后分发）。

---

## 6. shared 契约（`client/shared/`）

### 6.1 文件清单（14 个，含 adapters/ 1 个）

| 文件 | 行数 | 内容 |
|---|---|---|
| `types.ts` | 841 | 领域类型 + `MarlouesAPI` + `IPC` 常量（AgentSettings、ChatSessionRecord、MessageBlock、TimelineItem、AgentEvent、ContextActionRequest、RuntimeDescriptor、McpServerConfig、SkillInfo、AuthStatus、PermissionDialogRequest 等） |
| `ui-protocol.ts` | 185 | `UI_PROTOCOL_VERSION="1.0"`、`UIEvent`（点号流 19 种）、`UIRequest`/`UIResponse`、协议协商、`UIErrorCode`、**PRD 2.4 新增** `ContentBlock`/`MessageContent`/`UiEvent`（连字符命名） |
| `workflow-read-thread-contract.ts` | 355 | `WORKFLOW_READ_THREAD_SCHEMA_VERSION = 1`、WorkflowReadThreadResponse/ThreadInfo/Turn/Page/UserMessageContent 等 |
| `workflow-types.ts` | 129 | MessageItem/WorkflowRawEvent/UserMessageContent/Message/Session 等（与 renderer types.ts 重复定义） |
| `workflow-normalize.ts` | 486 | NormalizedItemType/NormalizedThreadItem/NormalizedTurn + normalizeWorkflowItem/normalizeWorkflowRawEvents（raw event 归一化） |
| `workflow-thread-data-source.ts` | 64 | WorkflowThreadDataSource 接口 + ThreadSnapshotPatch/TurnsPatch/StatusPatch |
| `agent-backend-adapter.ts` | 70 | AgentBackendAdapter 接口 + createAgentBackendAdapterFromDataSource |
| `agent-runtime.ts` | 119 | RuntimeEvent/RuntimeEventStream/AgentRuntime/Thread/ToolDefinition/RuntimeCapabilities 抽象 |
| `runtime-event-adapter.ts` | 149 | translateRuntimeEventToUIEvent（运行时事件→UIEvent 翻译） |
| `hot-update.ts` | 110 | HOT_UPDATE_SCHEMA_VERSION=1、UiBuildIdentity/UiUpdateArtifact/UiUpdateManifest/InstalledUiPointer |
| `update-config.ts` | 45 | `MARLOUES_UPDATE_CONFIG`（更新源配置） |
| `build-info.ts` | 6 | `UI_BUILD_VERSION` |
| `workspace-path.ts` | 9 | normalizeWorkspacePathForCompare / workspacePathsEqual |
| `adapters/workflow-messages-to-read-thread.ts` | 263 | WorkflowTurnItem 判别联合（agentMessage/dynamicToolCall/mcpToolCall/commandExecution/fileChange/reasoning/webSearch/collabAgentToolCall/imageGeneration/permissionRequest/…）+ WorkflowMessageBlock + workflowMessagesToWorkflowReadThreadResponse |

### 6.2 与 neobot shared 的差异

**marloues 缺（neobot 有）**：
- ❌ **`conversation-page-contract.ts`**（确认缺失）：neobot 的呈现契约常量——source=codex-desktop、readThreadSchemaVersion=2、userMessageMaxWidthPercent=77、activityExpandedMaxHeightPx=224、threadSummary 面板（widthPx=300、sectionAutoCollapseMs、expansionStateKeyPrefix 等）、scrollbar、composer（commandTrigger="/"、skillTrigger="$"、mentionTrigger="@"、maxAttachments=6、maxImageBytes 等）、USER_MESSAGE_VISUAL_CATEGORY_ORDER。
- ❌ `conversation-time.ts`、`token-usage.ts`、`analytics.ts`、`env.ts`、`dev-sso.ts`、`sso-types.ts`、`execution-tools.ts`、`strings.zh.ts`、`types/notification-channels.ts`。
- ❌ `session-core/`（apply-log、build-thread、cursor、fork-log、integrity、log-types、parse-jsonl——会话日志/游标/完整性体系）。
- ❌ `im/`（im-ipc、im-types）、`schedule/`（cron-parser、cron-presets、schedule-config）、`adapters/` 的 runtime-event-to-turn-item、runtime-event-types、tool-item-projection、turn-item-to-im-projection、turn-placement-index。

**marloues 独有（neobot 无）**：`update-config.ts`、`runtime-event-adapter.ts`。

**同名文件差异**：
- `workflow-read-thread-contract.ts`：**schema 版本 marloues=1 vs neobot=2**（neobot 已演进 v2，多了会话/页面/上下文等字段，需逐字段核对）。
- `types.ts`：marloues 841 行 vs neobot 1371 行；API 接口名 `MarlouesAPI` vs `NeoBotAPI`；neobot 多出 notification/schedule/replay/sandbox/im 相关类型与语言运行时、SSO 类型。
- `ui-protocol.ts`：**marloues 反而多出** `ContentBlock`/`MessageContent`/`UiEvent`（PRD 2.4 内容块契约），neobot 的 ui-protocol 只有 UIEvent/UIRequest/UIResponse/协商/错误码（neobot 的内容块契约放在 conversation-page-contract / workflow-read-thread-contract 体系里）。

---

## 7. 依赖（`client/package.json` dependencies，22 个）

```
@anthropic-ai/claude-agent-sdk ^0.3.220   @electron-toolkit/preload ^3.0.1
@electron-toolkit/utils ^2.0.0            @pierre/diffs ^1.2.10
better-sqlite3 ^13.0.2                    class-variance-authority ^0.7.1
clsx ^2.1.1                               electron-updater ^6.8.9
fflate ^0.8.3                             framer-motion ^12.40.0
highlight.js ^11.11.1                     loge ^1.0.5
lucide-react ^0.468.0                     react ^18.3.1
react-dom ^18.3.1                         react-markdown ^10.1.0
rehype-highlight ^7.0.2                   remark-gfm ^4.0.1
semver ^7.8.5                             sonner ^2.0.7
tailwind-merge ^2.6.0                     zustand ^5.0.3
```

### 7.1 marloues 有而 neobot 没有

| 包 | 用途 |
|---|---|
| `semver ^7.8.5` | 版本比较（更新/热更新判断）——**唯一独有运行时依赖** |

### 7.2 neobot 有而 marloues 没有（移植 UI 时大概率需要补装）

| 包 | 用途 | 对应 marloues 缺失能力 |
|---|---|---|
| `@codemirror/*`（commands/lang-markdown/language/language-data/state/view，6 个） | CodeMirror 编辑器 | code-viewer/、lib/codemirror* |
| `react-diff-viewer-continued ^3.4.0` | diff 查看器 | diff/DiffViewer |
| `react-virtuoso ^4.18.1` | 虚拟滚动 | 长会话/ViewportCulling 性能 |
| `react-arborist ^3.12.0` | 树组件 | 文件树/技能树 |
| `@pierre/diffs ^1.2.10` | diff 解析 | ⚠️ **两边都有**（marloues 已用） |
| `lowlight ^3.3.0` | 语法高亮 AST | 替代/增强 rehype-highlight |
| `@lezer/highlight ^1.2.3` | lezer 高亮 | CodeMirror 生态 |
| `hast-util-to-text ^4.0.2` | hast→text | 纯文本提取（neobot adapter/text-extractors） |
| `unist-util-visit ^5.1.0` | unist 遍历 | markdown 处理 |
| `marked ^17.0.1` | markdown 解析 | 预览/导出 |
| `qrcode ^1.5.4` | 二维码 | IM 绑定（Feishu/Wecom QR） |
| `adm-zip ^0.5.18`（+@types） | zip 读写 | 插件/导出归档 |
| `nodemailer ^9.0.1`（+@types） | 邮件 | 通知渠道 |
| `@larksuiteoapi/node-sdk ^1.72.0` | 飞书 SDK | im-channels |
| `@wecom/aibot-node-sdk ^1.0.7` | 企微 SDK | im-channels |
| `@anthropic-ai/sandbox-runtime ^0.0.70` | 沙箱运行时 | sandbox 能力 |
| `remend ^1.3.0` | 重试/反压 | 运行时工具 |
| `zod ^4.4.3` | schema 校验 | 表单/契约校验 |

> 注：neobot 的 `@types/adm-zip`、`@types/nodemailer` 也放在 dependencies（非常规）。

---

## 8. 品牌命名

### 8.1 marloues/Marloues 字样分布（renderer + preload + shared）

| 位置 | 出现形式 |
|---|---|
| **window API 挂载名** | `window.marloues`（preload `exposeInMainWorld("marloues", api)`）；类型 `MarlouesAPI`（shared/types.ts）；env.d.ts 声明 `window.marloues: MarlouesAPI` |
| **CSS 变量** | `--marloues-50…900` 品牌紫色板（index.css） |
| **CSS 类** | `.marloues-toast` 系列（sonner）、`shadow-marloues-lg`（ConfirmDialog）、`marlouesSkeletonShimmer` keyframes、`data-marloues-diff-scrollbar`（FileChangeRow） |
| **自定义事件** | `marloues:open-settings`（EmptyChatState）、`marloues:open-auxiliary-panel`（workbench/events.ts） |
| **localStorage key** | `marloues.onboarding.v1`、`marloues.theme`、`marloues.accent` |
| **控制台日志** | `[marloues:init] ...`（App.tsx） |
| **用户文案** | TitleBar/WindowChrome 产品名 "Marloues"、LoginPage "Marloues"、OnboardingDialog "欢迎使用 marloues"、EmptyChatState "marloues"、PermissionRequestOverlay "需要允许 Marloues …"、ComposerShell placeholder "交给 Marloues 一个本地任务…"、BasicSettingsSections/UpdateSettings/SecuritySettings 多处 "Marloues"、Sidebar "Marloues User"、WorkflowChatPage modelName fallback "Marloues" |
| **企业策略文件名** | `marloues.enterprise.json`（SecuritySettings 文案） |
| **导出文件名** | `marloues-audit-YYYY-MM-DD.json`（SettingsWorkbench 导出） |
| **fixture 全局** | `window.__MARLOUES_WORKFLOW_FIXTURE_READ_THREAD__`（WorkflowCodexFixturePage） |
| **shared 配置** | `MARLOUES_UPDATE_CONFIG`（update-config.ts） |
| **包/构建元数据** | package.json name="marloues"、appId=com.marloues.desktop、productName="Marloues"、artifacts "Marloues-*" |

### 8.2 neobot 残留检查（grep `neobot|Neobot|NEOBOT|claude-code|ClaudeCode`）

- 范围：`client/renderer`、`client/preload`、`client/shared`（ts/tsx/css/json）→ **0 匹配，无任何 neobot 残留**。
- 附带发现：shared/types.ts 里 `AgentEvent` 字段名仍沿用 claude 风格（`turn_start`/`text_delta`/`thinking_delta`/`tool_start` 等下划线事件名），这是契约名而非品牌名；`MessageItem` 的 `type` 值（`agent_message`、`command_execution`、`mcp_tool_call` 等）同样是 claude-agent-sdk 原生类型名，未重命名——仅语义残留，非品牌残留。
- neobot 侧对应物：`window.neoBot`（NeoBotAPI）、`--neobot-*` 色板、`neobot` CSS 类与文案——在 marloues 中已全部替换完毕。

---

## 9. 对移植的关键结论（缺口清单速查）

1. **workflow-chat 是"瘦身版"**：43 个扁平文件 ≈ neobot 的 1/4 文件量；**task-context 固定摘要面板、TurnShell 外壳族、composer 建议/进度生态、TurnItemRenderer/ActivityDetail、ViewportCulling、虚拟化全部缺失**；ToolCallRowDetails 单文件 847 行是 neobot 11 文件目录的压缩版。
2. **styles 体系不同代**：marloues 是 3 个 `workbench-*.css` + 1 个 14,825 行 index.css，无 @layer、无按组件拆分；neobot 是 tokens.css + components/*.css 40+ 文件。类名无统一前缀，`marloues-*` 仅用于品牌 token 与 toast。
3. **契约版本落后**：`WORKFLOW_READ_THREAD_SCHEMA_VERSION` marloues=1 vs neobot=2；`conversation-page-contract.ts` 缺失；types.ts 少 530 行；preload 少 7 个命名空间（languageRuntimes/notification/schedule/replay/sandbox/patch/im）。
4. **store 未切片**：单文件 1411 行 unified-chat-store，靠 onEvent+onItemEvent+onReadThread 三通道 + 本地适配回退；neobot 拆为 chat-slices/10 文件 + item-event-batcher + steer-slice。
5. **依赖差距明确**：唯一独有 `semver`；缺 CodeMirror 6 件套、react-virtuoso、react-arborist、react-diff-viewer-continued、lowlight、marked、qrcode、adm-zip、nodemailer、飞书/企微 SDK 等（与缺失模块一一对应）。
6. **品牌已干净**：marloues 全量替换，无 neobot 残留；剩余 claude 风格事件/类型名属于契约语义，不构成品牌问题。
