# Marloues 引导页设计稿

> 版本：v0.1 · 对齐工作台语义令牌设计语言

## 打开方式

直接打开 [展示模式](./index.html)，或在该目录启动任意静态文件服务器。顶部工具栏提供平台、主题切换，以及工作台原型与设置页原型的双向导航。

需要与 Electron Renderer 做截图对比时，点击「像素验收」，或直接打开 [像素验收模式](./index.html?review=acceptance)。该模式隐藏原型工具栏、底部提示、展示外框、圆角与阴影，使引导页填满 viewport。按 `Esc` 返回展示模式。

推荐使用可复现 URL，例如：

- macOS 深色 · 初始态：`index.html?platform=macos&theme=dark&workspace=0&model=0`
- macOS 浅色 · 工作区已选：`index.html?platform=macos&theme=light&workspace=1&model=0`
- Windows 深色 · 全部完成：`index.html?platform=windows&theme=dark&workspace=1&model=1`
- macOS 羊皮纸 · 验收态：`index.html?platform=macos&theme=warm&review=acceptance`

平台、主题、工作区与模型步骤状态会自动同步到地址栏，刷新后仍可复现同一组合。

## 背景

引导页最初直接写在 `auth.css` 中，并使用自动提取的哈希令牌。本设计稿用纯语义令牌重建视觉；Renderer 已将实现抽离到独立的 `onboarding.css`，以本设计稿作为像素基线，并完成了兼容 token 的清理。

## 评审目标

1. 引导页是否以全屏 dimmed overlay 居中卡片形式覆盖工作台。
2. 两步流程（选择工作区 → 配置模型端点）的状态机与信息层级是否清晰。
3. 卡片宽度（560px）、内边距、步骤卡片、按钮密度是否与工作台/设置页协调。
4. 步骤完成态（绿底圆圈 + 勾选）与未完成态的视觉区分是否充分。
5. 「开始使用」按钮的禁用/启用逻辑（依赖工作区选择）是否直观。
6. 三套主题（深色 / 浅色 / 羊皮纸）在引导页上的表现是否协调。

## 流程说明

引导页对应 PRD 5.10，状态持久化于 `onboarding-store.ts`（`marloues.onboarding.v2`）。两步：

1. **选择工作区**（必填，不可跳过）：Agent 运行时需要 cwd。⌘O 模拟打开文件夹。
2. **配置模型端点**（可跳过）：可「稍后配置」或「前往设置」打开设置页模型分区。

选择工作区后「开始使用」启用，点击完成引导并进入工作台。已完成的引导不再弹出。

## 可操作项目

| 操作                     | 预期结果                                  |
| ------------------------ | ----------------------------------------- |
| 切换 macOS / Windows     | 窗口控制、字体、圆角、标题栏模式变化      |
| 切换深色 / 浅色 / 羊皮纸 | 整页使用同一套语义令牌切换主题            |
| 点击「打开文件夹」       | 模拟选择工作区，步骤 1 变为完成态         |
| `⌘O` / `Ctrl+O`          | 快捷键模拟打开文件夹                      |
| 点击「稍后配置」         | 步骤 2 标记为完成，提示稍后可配置         |
| 点击「前往设置」         | 标记步骤 2 完成并提示前往设置（交互演示） |
| 点击「开始使用」         | 工作区就绪时启用，完成后跳转工作台原型    |
| `Enter`                  | 工作区就绪时等同于点击「开始使用」        |
| 点击「像素验收」         | 只显示引导页客户区，隐藏展示外框          |
| `Esc`                    | 退出验收模式                              |

## 令牌基线

本原型只使用语义令牌，不引入任何哈希令牌。关键令牌：

- 表面：`--surface-workspace`（卡片）、`--overlay`（遮罩）、`--raised-1/2/3`
- 边界：`--border-subtle`、`--border`、`--border-strong`
- 文本：`--text-1`、`--text-2`、`--text-3`
- 强调：`--accent`、`--primary-fill`、`--primary-ink`、`--success` / `--success-soft`（完成态）
- 半径：`--control-radius: 8px`、`--card-radius: 10px`、`--radius-sm`
- 间距 / 字号：`--space-1..10`、`--text-xs..2xl`

平台令牌：`html[data-platform="windows"]` 调整 `--control-radius: 6px`、`--card-radius: 8px`、字体栈。主题：`html[data-theme="light|dark|warm"]`。

## 与 Renderer 的关系

引导页真实代码位于 `client/renderer/src/components/onboarding/OnboardingView.tsx`，状态管理于 `client/renderer/src/stores/onboarding-store.ts`，独立样式位于 `client/renderer/src/styles/components/onboarding.css`。实现与原型共享同名语义令牌，不再依赖 `auth.css` 的引导页规则。

## 关联设计稿

- [工作台原型](../workbench-prototype/index.html) — 设计语言源头
- [设置页原型](../settings-prototype/index.html) — 模型端点配置目标
