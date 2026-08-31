# NeoBot UI 全貌清单（移植前期盘点）

> 分析对象：`C:\workspace\neobot`（只读分析，未修改任何文件）
> 分支：`codex/conversation-page-contract`，HEAD `91c917a`（feat: harden Windows sandbox install, bundle standalone Node runtime, refine chat turn layout）
> 目的：为 marloues（开源裁剪版）组件级移植提供精确的 neobot renderer UI 事实清单。
> 路径别名：renderer 内 `@/*` → `src/renderer/src/*`，`@shared/*` → `src/shared/*`（见 `tsconfig.web.json`）。

---

## 0. 顶层结构速览

| 目录 | 角色 | 规模 |
|---|---|---|
| `src/main` | Electron 主进程（业务后端，非移植目标） | — |
| `src/preload` | contextBridge 暴露 `window.neoBot`（单文件 `index.ts`） | 1 文件 |
| `src/renderer` | 全部 UI（React 18 + Vite + Tailwind + CSS @layer） | — |
| `src/shared` | 前后端共享契约（类型/常量/适配器），**移植核心依赖** | 22 文件 + 5 子目录 |

renderer 根文件：`App.tsx`（入口，AuthGate + Onboarding + WorkbenchRoot + SettingsDialog + fixture 页路由）、`main.tsx`、`index.css`（`@layer tailwind, neobot-components, neobot-workbench, neobot-overlays;`）、`env.d.ts`、`types.ts`、`replay-visual.tsx` + `replay-visual.html`（视觉回归独立页）。

---

## 1. renderer 目录全树（`src/renderer/src/`）

### 1.1 components/（共 16 个一级子目录，约 300 文件）

#### auth/（2）
| 文件 | 职责 |
|---|---|
| `AuthGate.tsx` | 登录态门禁：未认证时渲染登录界面，认证后放行 children |
| `index.ts` | barrel |

#### code-viewer/（2）
| 文件 | 职责 |
|---|---|
| `CodeMirrorEditor.tsx` | CodeMirror 6 只读编辑器封装（宿主类 `cm-neobot-host`） |
| `index.ts` | barrel |

#### diff/（3）
| 文件 | 职责 |
|---|---|
| `DiffViewer.tsx` | 基于 react-diff-viewer-continued 的 diff 查看器 |
| `patch-helpers.ts` | patch/diff 文本辅助 |
| `index.ts` | barrel |

#### mcp/（3）
| 文件 | 职责 |
|---|---|
| `McpAddDialog.tsx` | 添加 MCP server 对话框 |
| `McpServersPanel.tsx` | MCP server 列表/状态面板 |
| `index.ts` | barrel |

#### onboarding/（2）
| 文件 | 职责 |
|---|---|
| `OnboardingView.tsx` | 首次引导视图（工作区选择等） |
| `index.ts` | barrel |

#### plugins/（2）
| 文件 | 职责 |
|---|---|
| `PluginsView.tsx` | 插件市场/管理视图 |
| `index.ts` | barrel |

#### replay/（9）
`ConversationReplayView.tsx`（回放主视图）、`ReplayDropzone.tsx`（拖放导入）、`ReplayExportResultDialog.tsx`（导出结果）、`ReplayImportList.tsx`（导入清单）、`ReplayPasswordDialog.tsx`（密码）、`ReplayPreviewPane.tsx`（预览）、`replayValidation.ts`（校验）、`ReplayWorkspaceDialog.tsx`（工作区）、`useReplayPlayback.ts`（回放播放 hook）、`index.ts`

#### schedule/（16）
`format.ts`（时间格式）、`schedule-form-model.ts`（表单模型）、`ScheduleDatePicker.tsx`、`ScheduleFormDialog.tsx`、`ScheduleFrequencyFields.tsx`、`ScheduleListView.tsx`、`ScheduleMultiSelect.tsx`、`SchedulePage.module.css`（页面 CSS Module）、`ScheduleRecordsView.tsx`、`ScheduleRunHistoryView.tsx`、`ScheduleSelect.tsx`、`ScheduleTagInput.tsx`、`ScheduleTimePicker.tsx`、`index.ts`

#### settings/（17 + im-channels/ + sections/）
- 根：`AddEndpointDialog.tsx`/`.module.css`、`ProviderModelCard.tsx`、`ProviderRow.tsx`、`ProviderSection.tsx`、`SettingsDialog.tsx`/`.module.css`、`SettingsWorkbench.tsx`、`SettingsWorkbench.utils.ts`、`shared.tsx`、`types.ts`、`use-provider-management.ts`、`index.ts`
- `im-channels/`：`FeishuQrBindDialog.tsx`、`ImChannelsSettings.tsx`、`WecomQrBindDialog.tsx`（企业 IM 渠道绑定）
- `sections/`：`AuditSettings.tsx`、`BasicSettingsSections.tsx`、`RuntimeSettings.tsx`、`RuntimesSettings.tsx`、`SkillDetailModals.tsx`、`SkillSettingsCards.tsx`、`SkillsSettings.tsx`、`VersionSettings.tsx`(+test)、`skill-audit-formatters.ts`、`skill-audit-helpers.ts`、`index.ts`

#### skills/（10）
`skill-constants.ts`、`skill-formatters.ts`、`skill-normalizers.ts`、`SkillCard.tsx`、`SkillDetailModal.tsx`、`SkillFileTree.tsx`、`SkillLocalImportDialog.tsx`、`SkillMarketplaceView.tsx`、`index.ts`

#### ui/（基础原子组件，11）
`badge.tsx`、`button.tsx`（用 class-variance-authority）、`card.tsx`、`ConfirmDialog.tsx`、`divider.tsx`、`input.tsx`、`skeleton.tsx`、`spinner.tsx`、`toggle.tsx`、`tooltip.tsx`、`index.ts`

#### update/（4）
`release-notes.tsx`(+test)、`UpdatePopover.tsx`(+test)、`index.ts`

#### workbench/（应用壳，约 50 文件）
- 根：`PlatformWindow.tsx`、`ResizeHandle.tsx`、`RuntimeStatus.tsx`、`WindowChrome.tsx`、`WorkbenchAuxiliaryHost.tsx`、`WorkbenchRegions.tsx`(+test)、`WorkbenchRoot.tsx`（壳根）、`WorkbenchViewHost.tsx`、`auxiliary-visibility.ts`(+test)、`events.ts`、`layout-model.ts`(+test)、`resolve-platform.ts`(+test)、`types.ts`、`use-auxiliary-transition.ts`、`use-workbench-layout.ts`、`use-workbench-transitions.ts`、`index.ts`
- `auxiliary-sidebar/`：`AuxiliaryHeader.tsx`、`AuxiliarySidebar.tsx`(+test)、`AuxiliaryViewHost.tsx`、`catalog.ts`、`types.ts`、`index.ts`；`panels/`：`FileExplorer.tsx`（hljs 高亮）、`MemoryPanel.tsx`、`ReviewPanel.tsx`、`panels.tsx`、`helpers.ts`、`review-plan.ts`(+test)、`timeline-builders.ts`(+test)、`workflow-items-to-timeline.ts`、`types.ts`、`index.ts`
- `interaction/`：`PermissionFilePreview.tsx`、`PermissionRequestPanel.tsx`(+test)、`permission-request-format.ts`(+test)、`index.ts`
- `overlays/`：`GlobalSearchOverlay.tsx`
- `primary-sidebar/`：`DailyProjectTree.tsx`、`PrimarySidebar.tsx`、`QuickAccessZone.tsx`(+test)、`SettingsSidebar.tsx`、`SidebarActivityIndicator.tsx`、`SidebarMenus.tsx`、`SidebarParts.tsx`、`SidebarUpdateBadge.tsx`(+test)、`SidebarUserDock.tsx`、`WorkAreaPrimitives.tsx`、`WorkAreaZone.tsx`、`sidebar-activity.ts`(+test)、`sidebar-session-window.ts`(+test)、`sidebar-work-areas.ts`(+test)、`index.ts`

#### workflow-chat/（移植核心，145 文件）→ 见第 2 节

> ⚠️ `components/im-space/` 目录存在但**为空**（无任何文件）。

### 1.2 pages/（12）

| 文件 | 职责 |
|---|---|
| `LoginPage.tsx` | 登录页 |
| `PluginsPage.tsx` | 插件页 |
| `ReplayPage.tsx` | 会话回放页 |
| `SchedulePage.tsx` | 定时任务页 |
| `SettingsPage.tsx` | 设置页 |
| `WorkflowChatPage.tsx` | **统一 workflow-chat 会话页主组件**（read-thread 模式 + composer + task-context） |
| `WorkflowChatHeader.tsx`(+test) | 会话页头部（标题/模型/操作） |
| `WorkflowChatCards.tsx` | 会话卡片（列表展示） |
| `WorkflowChatModelSelector.tsx` | 模型选择器 |
| `workflow-chat-helpers.ts` | workflow-chat 页辅助函数 |
| `use-model-change-tracking.ts` | 模型切换追踪 hook |
| `use-slash-commands.ts` | 斜杠命令加载 hook |

### 1.3 stores/（22）

- 根 store：`auth-store.ts`、`im-store.ts`、`inspector-store.ts`、`onboarding-store.ts`、`replay-store.ts`（含 sonner toast）、`runtimes-store.ts`、`schedule-store.ts`、`schedule-view-store.ts`、`settings-dialog-store.ts`、`settings-store.ts`、`theme-store.ts`、`unified-chat-store.ts`（**统一聊天 store 组合入口**，+performance.test）、`update-store.ts`(+test)、`workspace-store.ts`
- 辅助：`workflow-message-builders.ts`(+test)（WorkflowMessageBlock 构建）、`item-event-batcher.ts`(+test)（item 事件批处理）、`execution-task-state.test.ts`
- **chat-slices/**（10）：
  | 文件 | 职责 |
  |---|---|
  | `types.ts` | 统一 store 全部类型（UnifiedChatStore 接口、ItemEvent、ExecutionTask/SubagentRecord、PendingSteerPreview、SendResult 等） |
  | `session-slice.ts` | 会话列表状态 + CRUD + 输入草稿 |
  | `send-slice.ts` | 消息发送、context action、abort、compact |
  | `readthread-slice.ts` | read-thread 缓存、分页、派生模型（getActiveReadThreadModel） |
  | `steer-slice.ts` | 排队 steer 队列管理 |
  | `event-handler-slice.ts` | context usage、session init info、事件分发 |
  | `runtime-event-handlers.ts` | 从 handleEvent 提取的运行时事件处理 |
  | `turn-event-handlers.ts` | 回合生命周期事件处理 |
  | `steer-event-handlers.ts` | steer/会话事件处理 |
  | `helpers.ts` | 模块级共享辅助 |

### 1.4 hooks/（4）
`use-confirm-dialog.tsx`（确认对话框 hook）、`use-theme.ts`（主题）、`use-watermark.ts`（水印）、`use-window-maximize.ts`（最大化状态）

### 1.5 lib/（15）
| 文件 | 职责 |
|---|---|
| `ipc-client.ts` | `export const ipc = window.neoBot`（preload 访问入口） |
| `codemirror.ts` | createEditorState/baseExtensions 再导出 |
| `codemirror-setup.ts` | CodeMirror 扩展装配（commands/language/lang-markdown/language-data） |
| `codemirror-theme.ts` | CodeMirror 主题接线到 neobot CSS tokens |
| `hljs.ts` | highlight.js core + 全部语言注册 |
| `hljs-languages.ts` | 语言清单（LanguageFn 列表） |
| `notifications.ts` | sonner toast 封装（去重） |
| `product-brand.ts` | PRODUCT_NAME="Neobot"、PRODUCT_MARK、RUNTIME_NAME="Codex" |
| `scrollbar-activity.ts` | 自定义滚动条"滚动中"状态标记 |
| `utils.ts` | `cn()` 类名合并 |
| `watermark.ts` | 自建 canvas 水印 |
| `analytics/` | 埋点：`index.ts`、`console-analytics.ts`、`noop-analytics.ts`、`wa-analytics.ts` |

---

## 2. workflow-chat 重点（145 文件）

结构：7 个顶层子目录 + 3 个嵌套子目录（`activity/ToolCallRowDetails/`、`adapter/workflow-message-adapter/`、`turns/turn-layout/`）= **10 个子目录**。公共 barrel `index.ts` 提供 `WorkflowXxx` 原名 + 短别名双导出（如 `WorkflowTurnView as TurnView`）。

### 2.1 根文件（5）
| 文件 | 职责 |
|---|---|
| `conversation-icon-contract.ts` | 会话语义图标映射 `CONVERSATION_ICONS = { composer, summary }`（lucide） |
| `conversation-icons.tsx` | 图标组件实现（pinned-summary 切换为精确 Codex SVG） |
| `index.ts` | 领域 barrel（全量再导出 + 短别名） |
| `ScrollToBottomButton.tsx` | 滚动到底按钮 |
| `ViewportCulling.tsx` | 视口裁剪（长列表性能） |

### 2.2 turns/（52 文件，核心渲染）
| 文件 | 职责 |
|---|---|
| `TurnView.tsx` | **回合视图根**：UserMessage + AssistantTurn 组合，消费 buildTurnPresentationModel |
| `TurnShell.tsx` | **回合外壳**：布局容器 + 状态 header + thinking 占位（从 AssistantTurn 提取的 Phase 4） |
| `AssistantTurn.tsx` | 助理回合主组件：TurnShell + TurnPresentationBlocks + TurnFooterView |
| `AssistantTurnHeader.tsx` | 回合头：状态/活动摘要/时长/模型名/折叠开关 |
| `AssistantAnswer.tsx` | 助理纯文本答案块 |
| `UserMessage.tsx` | 用户消息（按 visual category 分区展示附件） |
| `user-message-contract.ts` | 用户消息展示契约（分类顺序等） |
| `ThreadView.tsx` | 线程视图容器 |
| `WorkflowTurnList.tsx` | 回合列表：workflowMessages → TurnView 序列（折叠状态 scope） |
| `ReadThreadTurnList.tsx` | **read-thread 数据源回合列表**（react-virtuoso 虚拟滚动） |
| `QueuedSteersPanel.tsx` | 排队 steer 队列面板 |
| `SubagentWorkspace.tsx` | 子代理执行工作区（任务/子代理详情） |
| `ThinkingPlaceholder.tsx` | thinking 占位 |
| `TurnPresentationBlocks.tsx` | 按展示模型渲染内容块/活动块 |
| `TurnProcessDisclosure.tsx` | 过程披露（展开详情） |
| `TurnFooterView.tsx` | 回合底部元数据（时间/模型/复制/fork/删除） |
| `TurnFlowSection.tsx` | 流程区段容器 |
| `TurnErrorCard.tsx` / `MessageErrorCard.tsx` | 回合级/消息级错误卡片 |
| `turn-presentation-model.ts` | **buildTurnPresentationModel**：WorkflowMessageBlock → 展示模型（chrome/process/runtime/metadata） |
| `turn-presentation-model-types.ts` / `-helpers.ts` | 展示模型类型/辅助 |
| `turn-presentation.ts` | 回合展示逻辑 |
| `turn-status.ts` | 状态标签/语气/时长格式化（workflowTurnStatusLabel/Tone/DurationLabel） |
| `turn-collapse-rules.ts` | 折叠规则（默认折叠、运行时后折叠、shouldShow* 判定） |
| `turn-collapse-state.ts` | 折叠状态机（nextTurnCollapseState） |
| `use-collapse-state.ts` | 折叠状态 hook |
| `use-turn-expansion.ts` | 展开状态 hook |
| `use-scroll-anchor.ts` | 滚动锚点 hook |
| `error-guidance.ts` | 错误 → 用户指引映射 |
| `cancelled-turn-mapping.test.ts` 等 9 个 `.test` 文件 | 上述各模块单测 |
| `turn-layout/`（6） | 见下 |

**turns/turn-layout/**：
| 文件 | 职责 |
|---|---|
| `turn-layout.ts` | **workflowTurnLayout**：把 turn items 分组为内容/活动/结果（核心布局算法） |
| `types.ts` | WorkflowTurnLayout、WorkflowActivityGroup、WorkflowFlowEntry 等类型 |
| `flow-helpers.ts` | 流程条目辅助 |
| `summary-helpers.ts` | 活动摘要（workflowActivitySummaryLabel） |
| `tool-helpers.ts` | 工具名/布局辅助（workflowLayoutToolName） |
| `index.ts` | barrel |

### 2.3 adapter/（9 文件，数据适配核心）
| 文件 | 职责 |
|---|---|
| `workflow-message-adapter/index.ts` | 适配器 barrel（再导出 shared 适配器 + normalize + 文本提取器） |
| `workflow-message-adapter/normalize.ts` | `messagesToWorkflowReadThreadResponse` / `toWorkflowMessages`（消息数组 → read-thread 响应/消息块） |
| `workflow-message-adapter/types.ts` | WorkflowMessageBlock、WorkflowActivity、WorkflowTurnStatus 等类型 |
| `workflow-message-adapter/streaming.ts` | 流式增量适配逻辑 |
| `workflow-message-adapter/text-extractors.ts` | `finalAssistantText` / `itemOutputText` / `itemInputText` |
| `workflow-message-adapter/shared-helpers.ts` | 共享辅助 |
| `workflow-consumption-model.ts` | `buildWorkflowMessages`（UI 消费模型构建） |
| `item-text.ts` | item 输入/输出文本提取（旧接口兼容） |
| `shared-rehype-highlight.ts` | **共享 lowlight 高亮 rehype 插件**（替代 rehype-highlight，防重复注册；30k 字符上限） |

> 注意：真正的核心适配 `workflowMessagesToWorkflowReadThreadResponse` 在 `src/shared/adapters/workflow-messages-to-read-thread.ts`，由 adapter/index.ts 直接再导出。

### 2.4 composer/（23 文件，输入区）
| 文件 | 职责 |
|---|---|
| `ComposerShell.tsx` | **输入框外壳**（673 行）：textarea、附件、图片灯箱、steer 队列、ContextUsageRing、SlashCommandPopover、模型选择、权限面板、SandboxGatePrompt 全集成 |
| `composer-types.ts` | WorkflowComposerShellProps、textarea 高度常量、accessOptions |
| `composer-contract.ts` | 建议触发/替换逻辑 |
| `composer-attachments.ts` | 附件规范（MAX_ATTACHMENTS、skillAttachment） |
| `composer-editable.ts` | 草稿/可编辑逻辑 |
| `ComposerAttachmentChips.tsx` | 附件 chip 行 |
| `ComposerSuggestionPopover.tsx` | 建议弹层（/命令、$技能、@提及） |
| `SlashCommandPopover.tsx` | 斜杠命令弹层 |
| `ComposerTaskProgress.tsx` | 任务进度指示 |
| `ContextUsageRing.tsx` | 上下文使用率圆环 |
| `SandboxInstallBanner.tsx` | 沙箱安装横幅（SandboxGatePrompt） |
| `useComposerAttachments.ts` / `useComposerSuggestions.ts` / `useSandboxGate.ts` / `useComposerDockSafeArea.ts` / `use-conversation-scroll.ts` | 附件/建议/沙箱门禁/安全区/会话滚动 hooks |
| 6 个 `.test` 文件 | 上述模块单测 |

### 2.5 activity/（41 文件，过程活动渲染）
| 文件 | 职责 |
|---|---|
| `ActivityRenderer.tsx` | **按 item 类型分发渲染活动**（核心分发器） |
| `TurnItemRenderer.tsx` | turn item 渲染器 |
| `ActivityGroup.tsx` | 活动分组（可折叠组） |
| `ActivityRow.tsx` | 活动行（状态徽标 + 内联点） |
| `ActivityDetail.tsx` | 活动详情展开 |
| `activity-presentation-contract.ts` / `codex-activity-contract.ts` | 活动展示/来源契约 |
| `ReasoningRow.tsx` | 推理行（可展开） |
| `CommandExecutionRow.tsx` / `CommandDetailCard.tsx` / `command-presentation.ts` | 命令执行行/详情卡片/展示逻辑 |
| `ToolCallRow.tsx` | 工具调用行（通用） |
| `CollabAgentToolRow.tsx` | 协作者代理工具行 |
| `WebSearchRow.tsx` | 网络搜索行 |
| `FileChangeRow.tsx` | 文件变更行 |
| `ImageGenerationRow.tsx` / `ImageLightbox.tsx` / `image-source.ts` / `image-lightbox-model.ts` | 图片生成行/灯箱/来源解析/状态模型 |
| `PermissionRequestRow.tsx` | 权限请求行 |
| `ResultCards.tsx` | 结果卡片（文件变更/图片/搜索） |
| `MarkerRows.tsx` | 标记行：ContextCompactionMarker、HookPromptBlock、ImageViewRow、ReviewModeMarker、UnknownRawJson |
| `AgentFlowSection.tsx` | 代理流程区段 |
| `DetailCopyButton.tsx` | 详情复制按钮 |
| 8 个 `.test` 文件 | 上述模块单测 |
| `ToolCallRowDetails/`（9） | **工具调用详情子目录**：`ToolDetail.tsx`（详情主体）、`ToolDetailFrame.tsx`（详情框架）、`detail-sections.tsx`（区块）、`parsers.ts`（输出解析）、`labels.ts`（字段标签）、`helpers.ts`、`types.ts`、`index.ts`、2 test |

### 2.6 content/（3）
| 文件 | 职责 |
|---|---|
| `MarkdownContent.tsx` | markdown 渲染（react-markdown + marked Lexer 提取 + 自定义 rehype 高亮） |
| `CodeBlock.tsx` | 代码块（复制、语言标签） |
| `MarkdownContent.test.tsx` | 单测 |

### 2.7 fixtures/（2，独立视觉验证页）
| 文件 | 职责 |
|---|---|
| `WorkflowCodexFixturePage.tsx` | workflow/codex 渲染 fixture 页（导出 WorkflowCodexFixturePage、WorkflowChatShellFixturePage） |
| `TaskContextFixturePage.tsx` | 任务上下文面板 fixture 页 |

### 2.8 task-context/（10，固定摘要面板）
| 文件 | 职责 |
|---|---|
| `TaskContextPanel.tsx` | **固定摘要面板**（docked/floating/hidden 三模式，浮层 Esc/外点关闭，`thread-summary-panel`） |
| `TaskContextSections.tsx` | 面板区段：BackgroundProcessesSection、SourcesSection、TaskProgressSection、WorkspaceContextSection |
| `ThreadSummaryPrimitives.tsx` | 摘要原子组件（可折叠区段） |
| `task-presentation-model.ts` | 任务展示模型（hasData、workspace、状态） |
| `use-task-presentation-model.ts` | 展示模型 hook |
| `use-task-context-layout.ts` | 面板布局 hook（模式/宽度/自动折叠 30s） |
| `index.ts` | barrel |
| 3 个 `.test` 文件 | 单测 |

---

## 3. styles 结构（`src/renderer/src/styles/`）

### 3.1 文件清单
| 文件 | 职责 |
|---|---|
| `tokens.css` | **语义设计系统唯一来源**（dark 默认 + `[data-theme="light"]` + `[data-theme="warm"]`） |
| `README.md` | CSS 架构规范（见下） |
| `components/index.css` | 全局组件样式 manifest：声明 ~150 个 `neobot-components.cascade-XXXX` 层 + 按依赖顺序 @import 全部 52 个组件 css |

### 3.2 tokens.css 语义 token 分类

- **@layer 体系**（`src/index.css`）：`@layer tailwind, neobot-components, neobot-workbench, neobot-overlays;`（优先级 tailwind < components < workbench < overlays）。`neobot-components.cascade-XXXX` 是迁移期保留的旧级联序号层（每个 @layer 块一个编号，层序在 manifest 中声明）；`neobot-workbench` 层被 4 个壳文件使用（auxiliary-shell、sidebar-shell、title-bar、workspace-shell）。
- **主题**：`:root`（dark，`color-scheme: dark`）、`:root[data-theme="light"]`、`:root[data-theme="warm"]`（羊皮纸浅色）。dark/light 为冻结基线，warm 仅兼容。
- **颜色**：
  - 品牌/强调：`--neobot-50/100/200/400/600/800/900`、`--accent`、`--accent-soft`、`--info`、`--gradient-primary`
  - 语义：`--text-1/2/3`、`--border-subtle/border/border-strong`、`--surface-navigation/workspace/elevated/popover`、`--raised-1/2/3`、`--overlay`、`--success(-soft)`、`--danger(-soft)`、`--warning(-soft)`、`--focus-ring`
  - 别名层：`--bg`/`--bg-main`/`--bg-sidebar`、`--panel(-2)/--panel-soft`、`--shell`、`--surface`、`--line`、`--hover`、`--text`、`--muted`、`--popover`、`--active`、`--accent-2`
  - 域前缀组：`--settings-*`（对话框）、`--mcp-*`（MCP 面板）、`--tw-*`（Tailwind 主题变量）、`--chat-*`、`--sidebar-*`、`--product-*`（warm 主题品牌）、`--window-*`、`--composer-*`
- **尺寸**：`--space-1..10`（4px..40px）、`--radius-sm/md/lg/xl`（6/8/10/12px）、`--control-radius`(8)、`--card-radius`(10)、`--select-control-*`、`--text-xs..2xl`（11..24px）、`--sidebar-row-height`(34)、`--auxiliary-sidebar-width`(319)、`--primary-sidebar-width`(275)、`--titlebar-height`(46)、`--chat-max-width`(736)、`--task-context-width`(300)、`--composer-attachment-size`(54)
- **圆角/阴影**：`--rad-window`(12)、`--rad-card`、`--rad-ctl`；`--shadow-sm/md/lg/sidebar/card/glow`、`--modal-shadow`、`--popover-shadow`
- **动效**：`--ease`、`--motion-fast`(140ms)、`--motion-normal`(260ms)、`--motion-shell/--motion-primary`(580ms)、`--conversation-collapse-duration`(220ms)
- **布局常量**：`--conversation-user-max-width`(77%)、`--conversation-activity-max-height`(224px)、`--conversation-bottom-lock-threshold`(24px)、`--task-context-max-height`、`--windows-*`/`--macos-*`（平台安全区）
- **滚动条**：`--neobot-scrollbar-thumb-shadow(-visible)`（隐藏式滚动条方案）
- **字体**：`--font-ui`（含 PingFang SC）、`--font-code`（SF Mono/Menlo）

### 3.3 components/*.css → 组件映射（52 文件，按 index.css 导入顺序）

| CSS 文件 | 对应组件/区域 | 代表选择器 |
|---|---|---|
| `base.css` | 基础 reset/通用 | `.auxiliary-sidebar` 等 |
| `shared-ui.css` | 共享 UI 原子（滚动条、按钮等） | `.scrollbar-thin::-webkit-scrollbar` |
| `auth.css` | auth | `.auth-loading-screen` |
| `workspace-shell.css` | Workbench 壳（neobot-workbench 层） | `.app-shell` |
| `title-bar.css` | 标题栏（neobot-workbench 层） | `.title-bar` |
| `global-search.css` | 全局搜索 | `.title-workspace-switcher` |
| `sidebar-shell.css` | 主侧栏（neobot-workbench 层） | `.primary-sidebar` |
| `sidebar-tree.css` | 侧栏树 | `.work-area-list` |
| `sidebar-account.css` | 侧栏账户 | `.sidebar-command-list` |
| `chat.css` | 会话区 | `.chat-region` |
| `task-context.css` | **固定摘要面板** | `.thread-summary-panel` |
| `subagent-workspace.css` | 子代理工作区 | `.subagent-workspace` |
| `markdown.css` | markdown 内容 | `.workflow-markdown` |
| `workflow-message-turn.css` | **回合/消息** | `.workflow-turn` |
| `workflow-activity.css` | 活动行 | `.workflow-think-row` |
| `workflow-activity-details.css` | 活动详情 | `.workflow-agent-flow-buffer` |
| `workflow-results.css` | 结果卡片 | `.workflow-result-stack` |
| `workflow-diff.css` | 文件变更 diff | `.workflow-file-change-details` |
| `workflow-command.css` | 命令详情 | `.workflow-command-detail` |
| `workflow-tool-detail.css` | 工具调用详情 | `.workflow-tool-detail` |
| `workflow-errors.css` | 错误卡片 | `.message-error-card` |
| `workflow-media.css` | 图片灯箱 | `.image-lightbox-overlay` |
| `composer.css` | **输入区** | `.composer-wrap` |
| `model-picker.css` | 模型选择 | `.model-change-divider` |
| `slash-commands.css` | 斜杠命令弹层 | `.slash-command-popover` |
| `permission.css` | 权限面板 | `.permission-request-panel` |
| `context-actions.css` | 上下文操作 | `.context-action-card` |
| `auxiliary-shell.css` | 辅助侧栏（neobot-workbench 层） | `.auxiliary-sidebar` |
| `auxiliary-files.css` / `auxiliary-memory.css` / `auxiliary-outputs.css` | 辅助面板（文件/记忆/输出） | `.file-panel` / `.memory-panel` / `.outputs-list` |
| `settings-shell.css` | 设置壳 | `.workspace.settings-paper-workspace` |
| `settings-controls.css` / `settings-appearance.css` / `settings-providers.css` / `settings-security.css` | 设置分区 | `.settings-stat-grid` / `.appearance-settings` / `.provider-list` / `.security-settings` |
| `runtimes.css` | 语言运行时 | `.runtime-panel` |
| `skills-shell.css` / `skills-market.css` / `skills-detail.css` | 技能 | `.skill-page-panel` / `.skill-market-card.list` / `.skill-import-state` |
| `mcp-shell.css` / `mcp-list.css` / `mcp-detail.css` / `mcp-create.css` / `mcp-inspector.css` | MCP | `.mcp-ops-layout` / `.mcp-provider-summary` / `.mcp-health-matrix` / `.mcp-quick-create` / `.mcp-command-deck` |
| `plugins-redesign.css` | 插件 | `.plugins-page` |
| `audit.css` | 审计 | `.audit-event-list` |
| `update.css` | 更新 | `.sidebar-update-badge` |
| `replay.css` | 回放 | `.replay-page` |
| `notifications.css` | 通知 | `.model-change-divider` |

**类名前缀约定**：全局组件类多为语义短名（`.workflow-turn`、`.thread-summary-panel`、`.composer-wrap`），**无统一 `neobot-*` 强制前缀**（仅 token 变量用 `--neobot-*` / `--tw-*`）。CodeMirror 宿主类 `cm-neobot-host` 在 `CodeMirrorEditor.tsx` 动态拼接。`data-kind` / `data-mode` 属性（如 `data-kind="workflow-turn"`、`data-kind="assistant-turn"`、`data-kind="thread-summary-panel"`）被用于结构定位。另有少量 CSS Module（`SchedulePage.module.css`、`SettingsDialog.module.css`、`AddEndpointDialog.module.css`）。架构约束：`npm run check:css` 校验每个选择器只有一个 owner 文件。

---

## 4. shared 契约（`src/shared/`）

### 4.1 conversation-page-contract.ts（会话页 UI 契约，80 行）
| 导出 | 说明 |
|---|---|
| `CONVERSATION_PAGE_CONTRACT` | **核心常量对象**：source="codex-desktop"、sourceVersion、readThreadSchemaVersion=2、userMessageMaxWidthPercent=77、userMessageCollapsedLines=20、activityExpandedMaxHeightPx=224、bottomLockThresholdPx=24、collapse 时长；内嵌 `threadSummary`（widthPx=300、surfaceRadiusPx=24、sectionAutoCollapseMs=30_000、initialVisibleItems=6、revealBatchSize=50）、`scrollbar`（widthPx=8、revealOnHover 等）、`composer`（commandTrigger="/"、skillTrigger="$"、mentionTrigger="@"、placeholder="随心输入"、maxAttachments=6、maxImageBytes=8MB 等） |
| `USER_MESSAGE_VISUAL_CATEGORY_ORDER` | 用户消息视觉分类渲染顺序（images→parent-context→…→metadata-actions，13 类） |
| `ComposerSuggestionKind` | "command" \| "skill" \| "mention" \| null |
| `composerSuggestionKind()` | 从光标前文本判断触发类型（$ / @ / /） |
| `directScrollInputBreaksBottomLock()` | 判定何种滚动输入打破底部锁定 |

### 4.2 workflow-read-thread-contract.ts（**read-thread 数据契约，477 行，移植必读**）
| 导出 | 说明 |
|---|---|
| `WORKFLOW_READ_THREAD_SCHEMA_VERSION = 2` | 契约版本（v2：items 统一 WorkflowTurnItem 主路径，无 streaming 双路径） |
| `WorkflowReadThreadResponse` | 响应体：schemaVersion + thread + page + execution? + turns[] |
| `WorkflowTurn` | 回合：id/zone/status/error/时长/model/usage/contextUsage + **items[]** + UI 标记 continuationFragment/continuesPreviousTurn |
| `WorkflowTurnItem` | **18 变体联合**：userMessage/agentMessage/plan/reasoning/commandExecution/fileChange/mcpToolCall/dynamicToolCall/collabAgentToolCall/webSearch/imageView/imageGeneration/enteredReviewMode/exitedReviewMode/hookPrompt/permissionRequest/contextCompaction/unknown |
| `WorkflowTurnItemBase.settled` | **流式/终态不变量**：settled===false 仍可能更新，===true 终态（UI/IM/持久化统一按此解释） |
| `AppZone` / `TurnPlacement` | 数据归属区（workspace/wecom/feishu/scheduledTask）与挂载索引（primary/mirrored） |
| `WorkflowUserMessageContent` | 用户消息内容变体：text/image/localImage/file/url/skill/mention |
| `WorkflowTextOutput` / `WorkflowContextEconomyMeta` | 截断文本输出 / 上下文压缩元数据 |
| `WorkflowActivityItem` / `WorkflowContentItem` / `WorkflowResultItem` / `WorkflowToolLikeItem` | 按用途提取的子类型（渲染分区依据） |
| `WORKFLOW_CANONICAL_TURN_ITEM_TYPES` + `isWorkflow*Item()` | 规范类型常量表 + 类型守卫 |

### 4.3 workflow-types.ts（旧消息模型，103 行）
`WorkflowRawEvent`（原始事件）、`UserMessageContent`（7 变体）、`Message`（id/role/content/userContent/status/items/rawEvents）、`Session`、`Skill`、`Toast`、`Provider`、`Settings`（theme/accentColor/sandboxMode/approvalPolicy 等）、`ContextMenuState`、`Page`、`ExtTab`、`SkillTab`、`SettingsTab`

### 4.4 ui-protocol.ts（稳定 UI 事件协议，366 行）
| 导出 | 说明 |
|---|---|
| `UI_PROTOCOL_VERSION = "1.0"` | 协议版本 |
| `UIEvent` | **30+ 事件变体**：turn.start/complete、text.chunk、plan.delta/item、steer.message、thinking.chunk、tool.start/progress/complete、approval.request/decision、context.usage/warning/compaction、session.info、mcp.status、memory.recall、runtime.status、execution.subagent.start/event/complete、execution.task.update、prompt.suggestion、usage、error、user.message、compact.boundary、session.titleUpdated |
| `UIRequest` | 请求：chat.send/abort/fork、session.*、approval.respond、settings.* |
| `UIResponse` | 响应：success/error/stream.start/event/end |
| `ProtocolNegotiateRequest/Response` | 版本协商 |
| `UIErrorCode` | 错误码常量（UNKNOWN/THREAD_NOT_FOUND/PERMISSION_DENIED 等） |

### 4.5 types.ts（最大共享类型中枢，38KB，~140 导出）
关键：`IPC`（IPC 通道名常量，preload 使用）、`NeoBotAPI`（preload API 接口）、`TokenUsage`、`ContextUsageRecord`、`MemoryRecallRecord`、`ChatSessionRecord`、`ChatSendRequest/ChatSendReceipt`、`PendingStateSnapshot`、`OutboxMessageRecord/OutboxSnapshot`、`ChatForkRequest`、`ContextActionRequest`、`AgentSettings/AgentWorkMode/AgentPermissionMode`、`ModelProviderConfig/ModelSelection/ModelOption`、`SandboxStatus/SandboxInstallResult`、`PatchRevertRequest/Result`、`ScheduledTask*`（定时任务全套）、`McpServerConfig`、`SkillInfo/SkillDetail/SkillMarketplace*`、`AuditEventRecord`、`AuthSession/AuthStatus`、`PermissionDialogRequest`、`WorkspaceInfo/WorkspaceSettings/WorkspaceGitContext`、`DirEntry/FileStat/MemoryFileRecord`、`AgentEvent`

### 4.6 其他 shared 文件
| 文件 | 说明 |
|---|---|
| `workflow-normalize.ts` | `normalizeWorkflowItem` / `normalizeWorkflowRawEvents`（原始事件 → NormalizedTurn） |
| `workflow-thread-data-source.ts` | `WorkflowThreadDataSource` 接口 + `createStaticWorkflowThreadDataSource`（读线程数据源抽象） |
| `adapters/workflow-messages-to-read-thread.ts` | **核心适配器**：`workflowMessagesToWorkflowReadThreadResponse`（WorkflowMessageBlock → read-thread 响应） |
| `adapters/runtime-event-to-turn-item.ts` | 运行时事件 → turn item 投影 |
| `adapters/turn-placement-index.ts` | 回合挂载索引 |
| `adapters/tool-item-projection.ts` | 工具 item 投影 |
| `adapters/turn-item-to-im-projection.ts` | turn item → IM 消息投影 |
| `adapters/runtime-event-types.ts` | 运行时事件类型 |
| `conversation-time.ts` | 会话时间工具（被 2 个文件 import） |
| `token-usage.ts` | token 用量计算 |
| `strings.zh.ts` | **中文字符串资源（13KB，被 22 个 renderer 文件 import）** |
| `env.ts` / `hot-update.ts` / `build-info.ts` / `analytics.ts` | 环境/热更新/构建信息/埋点 |
| `dev-sso.ts` / `sso-types.ts` / `agent-backend-adapter.ts` / `agent-runtime.ts` / `execution-tools.ts` / `workspace-path.ts` | 后端侧共享（企业 SSO/agent 运行时） |
| `im/` | IM 渠道（im-ipc、im-types、通道配置） |
| `schedule/` | 定时任务共享 |
| `session-core/` | 会话核心 |
| `types/` | 类型分组 |

**renderer → shared 依赖热度**（import 次数）：`types`(91) > `strings.zh`(22) > `workflow-read-thread-contract`(20) > `ui-protocol`(9) > `conversation-page-contract`(5) > `im/im-types`(5) > `workspace-path`(5) > `analytics`(4) > `adapters/*`(3+1) > 其余(1-3)

---

## 5. 第三方依赖（package.json dependencies 核对）

版本（package.json）：react 18.3.1 / react-dom 18.3.1、zustand ^5.0.3、lucide-react ^0.468.0、sonner ^2.0.7、class-variance-authority ^0.7.1、clsx ^2.1.1、tailwind-merge ^2.6.0、react-virtuoso ^4.18.1、react-markdown ^10.1.0、remark-gfm ^4.0.1、marked ^17.0.1、lowlight ^3.3.0、highlight.js ^11.11.1、hast-util-to-text ^4.0.2、unist-util-visit ^5.1.0、@pierre/diffs ^1.2.10、react-diff-viewer-continued ^3.4.0、@codemirror/*（commands ^6.10.4、lang-markdown ^6.5.0、language ^6.12.4、language-data ^6.5.2、state ^6.7.0、view ^6.43.4）、framer-motion ^12.40.0、react-arborist ^3.12.0、qrcode ^1.5.4、zod ^4.4.3、@lezer/highlight ^1.2.3

### 按区域分类（基于 renderer 实际 import 扫描）

**workflow-chat 用了**：
- `react-virtuoso`（仅 `turns/ReadThreadTurnList.tsx` 的 Virtuoso）
- `react-markdown` + `remark-gfm` + `marked`（仅 `content/MarkdownContent.tsx`，marked 用于 Lexer 提取）
- `lowlight` + `hast-util-to-text` + `unist-util-visit`（`adapter/shared-rehype-highlight.ts` 自定义高亮）
- `@pierre/diffs/react`（`PatchDiff`、FileDiffMetadata，activity 文件变更 diff）
- `lucide-react`（大量图标）

**workbench 用了**：
- `highlight.js`（仅 `auxiliary-sidebar/panels/FileExplorer.tsx` 的 `highlight.js/lib/common`）
- `@pierre/diffs/react`（ReviewPanel 相关）
- `lucide-react`

**settings 用了**：
- `qrcode`（仅 `im-channels/WecomQrBindDialog.tsx`）
- `lucide-react`

**code-viewer / diff / ui**：
- `@codemirror/state` + `@codemirror/view`（`CodeMirrorEditor.tsx`）；`@codemirror/commands`、`@codemirror/language`、`@codemirror/lang-markdown`、`@codemirror/language-data`、`@lezer/highlight`（`lib/codemirror-setup.ts`、`lib/codemirror-theme.ts`）
- `react-diff-viewer-continued`（`components/diff/DiffViewer.tsx`）
- `class-variance-authority`（`components/ui/button.tsx`）

**全局/状态**：
- `zustand`（全部 15 个 store）
- `sonner`（`App.tsx` Toaster、`lib/notifications.ts`、`stores/replay-store.ts`）
- `clsx` / `tailwind-merge`：**renderer 源码未直接 import**（`lib/utils.ts` 的 `cn()` 是手写 join）

**⚠️ 已在 package.json 但 renderer 源码零 import**：`framer-motion`（^12.40.0）、`react-arborist`（^3.12.0）、`rehype-highlight`（^7.0.2，被自定义 `rehypeSharedHighlight` 替代）。`@anthropic-ai/claude-agent-sdk`、`@anthropic-ai/sandbox-runtime`、`better-sqlite3`、`adm-zip`、`fflate`、`loge`、`nodemailer`、`remend`、`@larksuiteoapi/node-sdk`、`@wecom/aibot-node-sdk` 属主进程/后端，UI 移植不需要。

---

## 6. preload API（`src/preload/index.ts` → `window.neoBot`）

`contextBridge.exposeInMainWorld("neoBot", api)`，`renderer/src/lib/ipc-client.ts` 里 `export const ipc = window.neoBot`。

**一级命名空间（20 个）与关键方法**：

| 命名空间 | 关键方法 |
|---|---|
| `auth` | getStatus / getStatusSync / openLogin / openRegister / checkPermission / logout / onStatusChanged |
| `app` | platform（静态）/ getVersionInfo / markRendererReady / exportDiagnostics |
| `window` | minimize / maximize / isMaximized / setMaximized / onMaximizedChange / close / setTheme |
| `workspace` | select / switch / rename / remove / getSettings / getGitContext / openInExplorer |
| `fs` | listDir / readFile / stat |
| `memory` | list / read / write |
| `config` | getAgentSettings / saveAgentSettings / testEndpointProfile / testEndpointModel / listEndpointModels |
| `runtime` | listModels / setModel |
| `mcp` | testServer / refreshStatus / listTools |
| `audit` | list |
| `skill` | list / selectImportFolder / importFolder / toggle / remove / getDetail / marketplaceList / marketplaceDetail / marketplaceInstall / marketplaceTagStats |
| `languageRuntimes` | listInstalled / listAvailable / install / uninstall / onInstallProgress |
| `update` | getState / check / download / installNow / onState |
| `chat` | listSessions / listAllSessions / searchSessions / getPendingState / resumeOutbox / createSession / deleteSession / updateSessionTitle / toggleSessionPinned / forkSession / exportAsNeobot / send / abort / compact / cancelTool / cancelSteer / applySteerNow / reorderSteers / **readThread(cursor,limit) / onReadThread / onEvent(UIEvent) / onItemEvent / onPermissionRequest / respondToPermission** |
| `notification` | onToast |
| `schedule` | list / create / update / remove / toggle / runNow / listRuns / onChanged |
| `replay` | selectFile / addSource / listPackages / getPackageConversations / getConversationDetail / deletePackage / importConversations / showExportInFolder |
| `sandbox` | check / install / uninstall |
| `patch` | revert |
| `im` | getConfig / saveConfig / testChannel / listSessions / onStatus / onSessionsChanged / generateWecomQr / pollWecomQr / registerFeishuApp / cancelFeishuRegister / onFeishuQrCode / onFeishuQrStatus |

**移植要点**：聊天 UI 的数据入口是 `chat.readThread`（拉取）+ `chat.onReadThread`（订阅）+ `chat.onEvent`（UIEvent 流）+ `chat.onItemEvent`（item 级增量），发送走 `chat.send` / `chat.abort` / steer 系列。事件通道名统一来自 `@shared/types` 的 `IPC` 常量（渲染层不硬编码字符串）。

---

## 7. 移植要点速记

1. **UI 层只依赖 4 个 shared 契约**：`workflow-read-thread-contract`（数据）、`ui-protocol`（事件）、`conversation-page-contract`（尺寸/常量）、`strings.zh`（文案）；其余业务 IPC 均经由 `window.neoBot`。
2. **渲染管线**：`chat.readThread` → `WorkflowReadThreadResponse` → `workflowMessagesToWorkflowReadThreadResponse`(shared/adapters) → `WorkflowMessageBlock` → `buildTurnPresentationModel`（turns/turn-presentation-model）→ `TurnView`/`TurnPresentationBlocks`/`ActivityRenderer`；布局分组由 `turns/turn-layout/turn-layout.ts` 的 `workflowTurnLayout` 完成（内容/活动/结果三分区）。
3. **settled 不变量**是所有 item 渲染/流式状态机的基础（`WorkflowTurnItemBase.settled`）。
4. **样式体系**：tokens.css 单文件语义 token（dark/light/warm 三主题），全局 CSS 按 @layer（tailwind < neobot-components < neobot-workbench < neobot-overlays）组织；新组件可任选全局 css 或 CSS Module，架构脚本 `check:css` 强制单 owner。
5. **高风险/性能组件**：`ComposerShell`（673 行全功能输入区）、`ViewportCulling`/`ReadThreadTurnList`（Virtuoso 虚拟滚动）、`turn-presentation-model`（记忆化核心）、`shared-rehype-highlight`（共享 lowlight 防重复注册）。
6. **可裁剪项**：im-space 目录为空；framer-motion、react-arborist、rehype-highlight 在 renderer 未使用（依赖可移除）；企业功能（audit/sso/wa-analytics/IM 绑定）在开源裁剪版可按需剔除，但 `strings.zh` 文案与 IPC 常量仍贯穿 UI。
