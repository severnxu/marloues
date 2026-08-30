# Marloues 设置页设计稿

> 版本：v0.1 · 对齐工作台语义令牌设计语言

## 打开方式

直接打开 [展示模式](./index.html)，或在该目录启动任意静态文件服务器。顶部工具栏提供平台、主题切换，以及工作台原型与引导页原型的双向导航。

需要与 Electron Renderer 做截图对比时，点击「像素验收」，或直接打开 [像素验收模式](./index.html?review=acceptance)。该模式隐藏原型工具栏、底部提示、展示外框、圆角与阴影，使设置页填满 viewport。按 `Esc` 返回展示模式。

推荐使用可复现 URL，例如：

- macOS 深色 · 通用分区：`index.html?platform=macos&theme=dark&section=general`
- Windows 浅色 · 模型分区：`index.html?platform=windows&theme=light&section=providers`
- macOS 羊皮纸 · 外观分区：`index.html?platform=macos&theme=warm&section=appearance`
- macOS 深色 · 运行时验收：`index.html?platform=macos&theme=dark&section=runtimes&review=acceptance`

平台、主题、当前分区会自动同步到地址栏，刷新后仍可复现同一组合。

## 背景

设置页在开发时直接写代码、未先做设计稿，导致大量样式使用 `legacy-tokens.css` 中的哈希令牌（`--component-*` / `--theme-*`），与工作台语义令牌脱节。本设计稿用纯语义令牌重建设置页视觉，为后续 CSS 迁移提供像素基线与设计语言参照。

## 评审目标

1. 设置页是否以全屏 overlay 形式覆盖工作台，与工作台共用同一套语义令牌。
2. 左侧导航（240px）与右侧居中内容列（max 800px）的密度与节奏是否成立。
3. 十个分区（通用 → 更新）的信息层级、卡片、行内控件是否一致。
4. `SettingsCard`、`SettingRow`、`ToggleSwitch`、`SegmentedOptions`、`SettingsSelect` 等控件原型是否可直接迁移到 React 组件。
5. 三套主题（深色 / 浅色 / 羊皮纸）在设置页上的表现是否协调。

## 分区总览

| 分区              | 标题       | 说明                 |
| ----------------- | ---------- | -------------------- |
| `general`         | 通用       | 运行行为与通知       |
| `personalization` | 个性化     | 自定义指令与沟通偏好 |
| `appearance`      | 外观       | 主题与强调色         |
| `providers`       | 模型       | 供应商与模型端点     |
| `runtimes`        | 运行时     | Agent 引擎与任务控制 |
| `security`        | 安全中心   | 权限审批与沙箱       |
| `audit`           | 审计       | 工具调用记录         |
| `im-channels`     | IM 渠道    | 企微与飞书桥接       |
| `im-bots`         | 机器人实例 | 空间、用途与权限     |
| `version`         | 更新       | 版本与热更新         |

## 可操作项目

| 操作                     | 预期结果                             |
| ------------------------ | ------------------------------------ |
| 切换 macOS / Windows     | 窗口控制、字体、圆角、标题栏模式变化 |
| 切换深色 / 浅色 / 羊皮纸 | 整页使用同一套语义令牌切换主题       |
| 点击左侧导航项           | 切换右侧内容分区，更新标题与描述     |
| 方向键 ↑/↓（导航聚焦时） | 在分区列表间循环移动                 |
| 点击开关                 | 切换 active 状态，弹出 toast 提示    |
| 点击分段选项             | 切换选中态，弹出 toast 提示          |
| 点击运行时下拉           | 展开 / 收起自定义下拉菜单            |
| 点击「像素验收」         | 只显示设置页客户区，隐藏展示外框     |
| `Esc`                    | 收起下拉 / 退出验收模式 / 返回工作台 |

## 令牌基线

本原型只使用语义令牌，不引入任何哈希令牌。关键令牌：

- 表面：`--surface-navigation`、`--surface-workspace`、`--surface-popover`、`--raised-1/2/3`
- 边界：`--border-subtle`、`--border`、`--border-strong`
- 文本：`--text-1`、`--text-2`、`--text-3`
- 强调：`--accent`、`--accent-soft`、`--primary-fill`、`--primary-ink`
- 半径：`--control-radius: 8px`、`--card-radius: 10px`
- 布局：`--settings-sidebar-width: 240px`、`--settings-content-max-width: 800px`、`--sidebar-row-height: 30px`
- 间距 / 字号：`--space-1..10`、`--text-xs..2xl`

平台令牌：`html[data-platform="windows"]` 调整 `--control-radius: 6px`、`--card-radius: 8px`、字体栈。主题：`html[data-theme="light|dark|warm"]`。

## 与 Renderer 的关系

设置页真实代码位于 `client/renderer/src/components/settings/`，控件原型对应 `shared.tsx` 中的 `SettingsCard`、`SettingRow`、`ToggleSwitch`、`SegmentedOptions`、`SettingsSelect` 等。当前样式仍使用 `auth.css` 与 `legacy-tokens.css` 中的哈希令牌，后续迁移目标是将设置页 CSS 切换到语义令牌并删除 `legacy-tokens.css`。

## 关联设计稿

- [工作台原型](../workbench-prototype/index.html) — 设计语言源头
- [引导页原型](../onboarding-prototype/index.html) — 首次启动引导
