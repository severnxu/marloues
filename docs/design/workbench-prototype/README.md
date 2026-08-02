# Marloues 双平台工作台外骨架交互稿

> 版本：v0.3 · 当前评审范围：外骨架像素基线

## 打开方式

直接打开 [展示模式](./index.html)，或在该目录启动任意静态文件服务器。交互稿顶部“← 返回图册”与组件审核图册中的“打开交互原型”组成双向导航，不依赖浏览器历史记录。

需要与 Electron Renderer 做截图对比时，点击“像素验收”，或直接打开 [像素验收模式](./index.html?review=acceptance)。该模式隐藏原型工具栏、底部提示、展示画布、展示外框、圆角与阴影，使 `#app-window` 填满 viewport。按 `Esc` 返回展示模式。

推荐使用可复现 URL，例如：

- Windows 浅色三栏：`index.html?platform=windows&theme=light&review=acceptance&primary=expanded&auxiliary=open&primaryWidth=275&auxiliaryWidth=319&window=restored`
- Windows 深色折叠态：`index.html?platform=windows&theme=dark&review=acceptance&primary=collapsed&auxiliary=closed&window=maximized`
- macOS 浅色：`index.html?platform=macos&theme=light&review=acceptance`
- macOS 深色：`index.html?platform=macos&theme=dark&review=acceptance`

平台、主题、左右栏状态、两栏宽度和窗口状态会自动同步到地址栏。刷新页面后仍可复现同一组合；Peek 是瞬时 hover 状态，不写入 URL。

## 评审目标

本原型当前只评审桌面应用外骨架。内部业务内容用于让外骨架状态可观察；消息、文件树、Composer、Steer、权限和附件等既有结论被保留，但不进入本轮实施门禁。

需要确认：

1. macOS 与 Windows 的顶部窗口模式是否符合预期。
2. `PrimarySidebar / MainWorkspace / AuxiliarySidebar` 三栏关系是否成立。
3. 左侧边栏折叠、Peek 和固定展开是否自然。
4. 右侧辅助区打开、关闭和主视图覆盖态是否自然，且不改变左侧栏状态。
5. `275px / 319px / 46px` 尺寸基线是否具有正确密度。
6. 标题区、主功能区内部标题与辅助区标签是否存在信息重复。
7. 固定边界是否只有一个绘制者，Windows 是否只有一条顶部轨道。
8. Renderer 客户区是否没有误迁入展示用外框、阴影和圆角。

## 当前外骨架组件

| 层级     | 组件                                                                                      |
| -------- | ----------------------------------------------------------------------------------------- |
| 平台窗口 | `PlatformWindowFrame`、`MacWindowChrome`、`WindowsWindowChrome`                           |
| 三栏布局 | `WorkbenchLayout`、`PrimarySidebar`、`MainWorkspace`、`AuxiliarySidebar`                  |
| 外部交互 | `PrimaryResizeHandle`、`AuxiliaryResizeHandle`、`WorkbenchOverlayHost`                    |
| 内部插槽 | `PrimarySidebarViewHost`、`WorkspaceViewHost`、`InteractionDockHost`、`AuxiliaryViewHost` |

外骨架负责插槽矩形、表面、边界、平台顶部轨道和状态；内部插槽内容不得修改这些规则。

## 可操作项目

| 操作                       | 预期结果                                                             |
| -------------------------- | -------------------------------------------------------------------- |
| 切换 macOS / Windows       | 窗口控制、字体、圆角、标题栏模式和快捷键表达变化                     |
| 切换深色 / 浅色            | 整个窗口使用同一套语义令牌切换主题                                   |
| 点击左栏按钮               | 固定展开或折叠左侧边栏                                               |
| 折叠后悬停左上角或窗口左缘 | 左侧边栏以 Peek 浮层出现                                             |
| 拖动左分栏线               | 在 275–480px 之间调整，低于 220px 时折叠                             |
| 点击右栏按钮               | 以 319px 打开或关闭三栏中的右侧辅助区                                |
| 拖动右分栏线               | 在 319–500px 之间调整右栏与主区宽度，低于 220px 时折叠               |
| 点击辅助区扩展按钮         | 辅助区从右向左覆盖主视图区；主区保留在后方，左栏维持展开或收起状态   |
| 点击“像素验收”             | 只显示 Renderer 客户区；展示画布、外框、圆角、投影和辅助说明全部隐藏 |
| 点击文件卡片“审核”         | 打开辅助区并切换到“变更”标签                                         |
| 点击文件/变更/计划         | 切换辅助区内容                                                       |
| `⌘K` / `Ctrl+K`            | 打开全局搜索                                                         |
| `⌘N` / `Ctrl+N`            | 创建新会话并聚焦输入框                                               |
| 在 Composer 输入并发送     | 新增用户消息并滚动到底部                                             |
| Windows 关闭按钮           | 提示窗口隐藏到托盘                                                   |
| macOS 红色交通灯           | 提示关闭窗口但应用保留在 Dock                                        |
| 双击 Windows 标题栏        | 切换最大化与还原状态                                                 |

## macOS 顶栏状态规则

| 工作台状态         | 左上按钮               | 品牌标识               | 主区标题间距                   | 右上按钮                                             |
| ------------------ | ---------------------- | ---------------------- | ------------------------------ | ---------------------------------------------------- |
| 左栏展开           | 左栏开关               | 显示                   | 随主区自然起始                 | 辅助区关闭时显示入口                                 |
| 左栏收起           | 左栏开关、当前视图动作 | 隐藏                   | 向右移动 159px，并显示短分隔线 | 辅助区关闭时显示入口                                 |
| 左栏 Peek          | 左栏开关               | 显示                   | 保持收起态，位于 Peek 浮层后方 | 辅助区关闭时显示入口                                 |
| 辅助区标准态       | 同左栏状态             | 同左栏状态             | 右侧为固定开关保留控件位       | 固定开关负责收起，区内按钮进入覆盖态                 |
| 辅助区主视图覆盖态 | 保持进入前状态         | 展开时显示、收起时隐藏 | 保留在覆盖层后方               | 辅助区从右侧扩展并覆盖主视图区，收回后原主区直接露出 |

macOS 顶栏控件统一为 `28 × 28px`，垂直定位为 `top: 9px`；收起态标题位移和分隔线分别依据 `136px` leading 区计算。状态切换与栏宽动画共用同一 motion token。

辅助区进入 `primary-overlay` 后：左栏展开时，标签组直接使用辅助区标题栏标准 `12px` 左内边距；左栏收起时使用 `164px` 的 macOS leading 安全区，使标签从返回按钮右缘后 `16px` 开始。辅助区标题栏始终按自身边界排版，不再跟随居中的正文内容列。该规则不影响 Windows。

“展开/收回辅助区主视图”使用两个固定平台插槽共享同一命令状态：macOS 与 Windows 标准右栏的按钮始终属于 `AuxiliaryHeader`；Windows `primary-overlay` 使用 `WindowTitlebar` trailing 中的专用按钮。切换平台或视图时只改变插槽显隐与图标语义，不得在两个容器之间搬移 DOM 节点。

### 顶部控件状态矩阵

| 当前视图                 | 左栏状态 | Leading 第一按钮         | Leading 第二按钮 | 辅助区全局按钮         | 辅助区内部按钮       |
| ------------------------ | -------- | ------------------------ | ---------------- | ---------------------- | -------------------- |
| 主视图                   | 展开     | 收起左栏                 | 隐藏             | 打开或关闭辅助区       | 展开辅助区至主视图区 |
| 主视图                   | 收起     | 展开左栏                 | 新建会话         | 打开或关闭辅助区       | 展开辅助区至主视图区 |
| 辅助区 `primary-overlay` | 展开     | 收起左栏                 | 隐藏             | 关闭辅助区并返回主视图 | 收回辅助区至右栏     |
| 辅助区 `primary-overlay` | 收起     | 展开左栏，辅助页保持不变 | 返回主视图       | 关闭辅助区并返回主视图 | 收回辅助区至右栏     |

“返回主视图”只退出覆盖态并保留标准右栏；“关闭辅助区并返回主视图”同时关闭右栏。被折叠的 `PrimarySidebar` 与被覆盖的 `MainWorkspace` 必须同步设置 `inert` 和 `aria-hidden`，不能只做视觉隐藏后仍留在键盘操作树中。macOS 与 Windows 使用同一职责矩阵，只改变交通灯、caption controls 和安全区位置。

`RuntimeStatus` 属于当前任务主区而非窗口全局状态：仅当 `MainWorkspace` 是当前主视图时显示；辅助区进入 `primary-overlay` 后必须隐藏并退出可访问性树，收回右栏、返回主视图或关闭辅助区后再按原状态恢复。隐藏只切换展示插槽，不销毁 Runtime 状态。

## 工作台表面层级规则

颜色按功能归属划分，不按三栏的几何位置划分：

| 区域                   | 表面 token             | 规则                                                     |
| ---------------------- | ---------------------- | -------------------------------------------------------- |
| `PrimarySidebar`       | `--surface-navigation` | 导航与工作区切换层，可与主工作表面形成色差               |
| `MainWorkspace`        | `--surface-workspace`  | 当前任务的基础工作表面                                   |
| `AuxiliarySidebar`     | `--surface-workspace`  | 主任务的上下文延伸，必须与主区同色，只使用左侧分隔线划界 |
| 卡片、筛选框、悬浮控件 | `--surface-elevated`   | 在工作表面上建立局部层级，不改变辅助区整体底色           |

辅助区进入 `primary-overlay` 状态后仍使用 `--surface-workspace`。它只改变定位与覆盖宽度，不卸载或重排 `MainWorkspace`，也不改变 `PrimarySidebar` 状态。v1 冻结的暗色与亮色主题必须遵守同一映射；暖色主题等待独立评审。

右侧辅助区的 `open` 状态参与三栏 flex 布局，手动拖宽会相应压缩主区；只有 `primary-overlay` 脱离 flex 并右锚定覆盖 `MainWorkspace`。覆盖态必须保留进入前的右栏宽度占位轨道，使主区在覆盖层后方保持原宽度与排版；退出后恢复此前三栏宽度。

`primary-overlay` 只停用右侧 `AuxiliaryResizeHandle`，因为此时辅助区覆盖宽度由状态决定；左侧 `PrimaryResizeHandle` 必须继续可用。左栏拖宽时，主区按标准左栏规则重新分配，辅助覆盖层左边界同步跟随左栏右缘；左栏折叠、展开和 Peek 均不受覆盖态限制。

标准态与 `primary-overlay` 之间采用“内容淡出 → 几何原子切换 → 内容淡入”的两阶段过渡。辅助区文字、树节点和标签不得跟随宽度变化横向滑动或在可见状态下换行；主区正文坐标、主区宽度与滚动位置必须全程稳定。几何切换期间辅助区声明 `aria-busy="true"`，并临时锁定重复切换按钮。

## Windows 共享顶栏规则

Windows 只有一条 `46px` 顶部轨道，不允许把窗口标题栏和主区标题栏纵向叠加：

- `WindowTitlebar` 绝对定位在工作台顶部，只承载左侧入口、右侧辅助区开关和 caption controls。
- `WindowTitlebar` 是全宽透明坐标层，不是整块视觉组件：自身不响应指针，只有离散控件岛恢复点击。
- `MainWorkspace` 从窗口顶部开始布局，其 `WorkspaceHeader` 与 `WindowTitlebar` 共用第一条 `46px` 轨道。
- 业务标题只能存在于 `WorkspaceHeader`，不得复制到窗口层。
- 辅助区进入 `primary-overlay` 并成为当前主视图时，被覆盖主区的业务标题、短分隔线和 `RuntimeStatus` 必须隐藏；左栏入口、返回主视图、辅助区动作及 caption controls 保留。辅助区标签栏已经承担当前视图标题职责，不再重复展示来源会话标题或任务运行上下文。
- `RuntimeStatus` 使用单一状态源和平台插槽：`MainWorkspace` 为当前视图时，macOS 挂载在 `WorkspaceHeader` 尾部，Windows 挂载在 `WindowTitlebar` 的 trailing 控件序列中；进入 `primary-overlay` 后两个平台都隐藏，不得复制业务状态到辅助区。
- Windows 顶部没有主区右边界，因此主视图中的运行状态不得以展开态 `MainWorkspace` 的右缘为视觉锚点；状态与辅助区开关保持 `12px` 间距，辅助区开关与 caption controls 保持 `8px` 间距。覆盖态隐藏状态后，剩余动作自然收拢，不保留状态占位。
- Windows 辅助区收起后，`WorkspaceHeader` 仍为长标题保留 `194px` 安全区，避免标题进入窗口控件岛；该安全区不再用于定位运行状态。
- 主区正文从共享顶栏下方开始，不得再增加第二段顶部留白。
- 左栏表面从窗口顶部开始，内部内容为顶栏控件预留 `46px`。
- Windows 的 `1px` 横向边界属于共享顶部轨道的下边界，并使用不参与盒模型的绘制层实现；主区与辅助区自身不得重复绘制该线。
- 右侧辅助区在 Windows 下从共享顶栏下方开始；macOS 下辅助区标签栏与透明标题层对齐。
- Windows 右侧 ResizeHandle 的视觉线和命中区都从 `y=46px` 开始，不得延伸进窗口拖拽与 caption 轨道。
- 上述 `y=46px` 起点只适用于标准右栏。辅助区进入 `primary-overlay` 成为当前主视图后，其表面和 `AuxiliaryHeader` 必须上移到 `y=0`，与透明 `WindowChrome` 共用首个 `46px`；`AuxiliaryViewHost` 从 `y=46px` 开始，不再叠加第二条标题行。
- `primary-overlay` 隐藏被覆盖主区的标题和短竖线。左栏收起时 leading 区只显示边栏开关与“返回主视图”，辅助区标签从 `84px` 安全区后开始；左栏展开时标签从左栏右缘后的标准 `12px` 开始。
- `primary-overlay` 的“收回为标准右栏”按钮移入 Windows trailing 控件岛并位于全局辅助区开关之前；全局开关仍表示“关闭辅助区并返回主视图”。
- 当前主视图表面必须延伸到透明 WindowChrome 后方，因此顶部轨道与辅助区主体都读取 `--surface-workspace`，不得露出被覆盖主区或导航层颜色。

## 外骨架边界规则

- Renderer 外边缘不由 CSS 绘制；Windows DWM 或 macOS 原生 frame 决定真实窗口外缘。
- 左栏竖线只由 `PrimarySidebar.border-right` 绘制。
- 标准辅助区竖线只由 `AuxiliarySidebar.border-left` 绘制；macOS 从顶部开始，Windows 标准右栏从 `y=46px` 开始。`primary-overlay` 不再绘制这条线。
- Windows `y=45px` 的横线只由 `WindowsWindowChrome::after` 绘制，主区与辅助区不能重复补线。
- ResizeHandle 的 `12px` 命中区默认透明，只在 hover/dragging 时于固定边界同坐标显示 `1px` 强调线。
- 所有固定外骨架线使用 `--shell-divider`；拖拽强调使用 `--shell-divider-active`。

## InteractionDock 浮动定位规则

> 以下是已审核的后续内部规则。本轮外骨架实施只负责 `InteractionDockHost` 的定位边界、最大宽度与 containing block。

- `InteractionDock` 是 `MainWorkspace` 内的底部浮动交互层，使用 `position: absolute`，定位参照只能是 `MainWorkspace`。
- 它只有两个一级互斥分支：`InputInteractionStack` 与 `PermissionRequestPanel`。权限进入 `pending` 后，整套输入相关分支隐藏，由权限面板独占同一底部插槽。
- `InputInteractionStack` 包含可选的 `TaskResultSummary`、可选的 `SteerQueue` 与 `ComposerPanel`；结果摘要、Steer、附件和输入框都属于输入相关状态，不得在权限面板显示时继续露出。
- `TaskResultSummary` 是任务执行结果的独立状态胶囊，展示已更改文件数及增删统计。它拥有完整边框，在活动面板上方居中悬浮并保持 `8px` 间距；有 Steer 时排在队列上方，不与 Steer 或活动面板进行边框拼接。点击后打开辅助区“变更”页。
- `ComposerAttachmentList` 位于 Composer 内部、文本输入区上方。图片使用 `54 × 54px` 方形缩略图；普通文件使用 `176 × 54px` 文件卡并展示名称、类型和大小；多附件横向排列，空间不足时只在附件带内部横向滚动。每项的移除按钮固定在卡片内部右上角 `4px`，使用深色圆底与浅色叉号，不得悬挂在卡片外或占用附件间距。允许仅附件提交，提交后附件与本次输入共同清空。
- 没有 steer 时不显示队列；单条 steer 显示一条外置附着条；两条及以上在同一外部队列中显示数量摘要、拖动排序和逐条操作，并以 `30dvh` 为最大高度后转为内部滚动。
- 每条 steer 文本最多展示两行，可“引导”立即发送而不中断当前运行，也可删除或取回输入框编辑。新增 steer 只进入队列，不写入消息文档流。
- `SteerQueue` 是 InputInteractionStack 内、Composer 外部的附着层，不属于输入框内部，也不是完整悬浮卡片。Composer 保持 `760px` 最大宽度、完整四角和连续顶边框；队列左右各缩进 `14px`，只保留顶部与左右边框、顶部圆角，不绘制下边框，并以零间隙贴在 Composer 顶边。Steer 背景不得覆盖 Composer 顶边框，也不得附着或同时显示在 PermissionRequestPanel 上。多条 steer 只增加输入分支高度，不改变 Composer 自身结构。
- 它不属于消息文档流，不随 `WorkspaceViewHost` 滚动，也不得定位到全窗口或跨入 `AuxiliarySidebar`。
- `WorkspaceViewHost` 是唯一正文滚动容器；`ResizeObserver` 根据当前可见分支的实际高度更新 `--interaction-dock-safe-area`：输入态测量完整 InputInteractionStack，权限态只测量 PermissionRequestPanel。
- 固定的是 Dock 的底边，不是最后一条消息的停靠线；正文终点始终为 `DockSurface 顶边 − --interaction-content-gap`，所以队列增加或权限面板变高时，最后一条消息会随实际交互表面向上移动。外层 `--interaction-dock-fade-inset` 只是透明渐隐命中区，不计入正文避让距离。
- Dock 高度变化前若用户距离正文底部不超过 `24px`，变化后继续保持底部锁定；若用户正在浏览历史内容，则保持原 `scrollTop`，不得把视图强制拉回最新消息。
- Dock 外层只负责渐隐、安全间距和定位，使用 `pointer-events: none`；当前活动面板恢复 `pointer-events: auto`。
- 左右栏宽度变化时，Dock 只跟随 `MainWorkspace` 重新居中，最大阅读宽度保持 `760px`。

## 原型边界

- 窗口最小化、关闭到托盘和 Dock 生命周期只做交互反馈，不实际操作系统窗口。
- 文件树、变更和计划使用评审数据，不读取真实项目状态。
- 原型不接入 Renderer Store、IPC、Runtime 或数据库。
- 真实交通灯、frameless 窗口和系统缩放仍需在 Electron 构建中验证。

## 文件职责

| 文件            | 职责                                         |
| --------------- | -------------------------------------------- |
| `index.html`    | 语义结构与原型内容                           |
| `tokens.css`    | 主题、平台和尺寸设计令牌                     |
| `prototype.css` | 三栏布局与组件状态样式                       |
| `prototype.js`  | 平台、主题、拖拽、折叠、搜索和 Composer 交互 |
