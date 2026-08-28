# 设计稿落地实施计划

> 版本：v0.5 · 待审核（已根据第四轮复核修订）
> 范围：设置页 + 引导页
> 日期：2026-08-28

---

## 〇、修订历史

### v0.4 → v0.5

根据第四轮独立复核（验证 per-file 1a/1b/1c 交叉分布、令牌集不重叠性）修正一处执行约束 + 三处可选优化：

| # | 改动 | 类型 |
|---|---|---|
| 1 | **并行建议补串行约束**：1a/1b/1c 令牌集虽不重叠，但 27/16/97 处均落在 `settings-controls.css` 同一文件，三 PR 同时改会 git 冲突。涉及该文件的部分建议串行合并（1c 先走），其余文件可并行 | 执行约束 |
| 2 | 修订历史三张表占前 50 行，两个 `## 〇、` 编号重复 → 重构为 `## 〇、修订历史` 下设 `###` 子标题，按版本倒序排列 | 可选优化 |
| 3 | 1c 全域失效令牌总量（86 unique / 102 refs）在文档中未出现过，补一行说明避免核总数对不上 | 可选优化 |
| 4 | 节奏表 1c 描述补"脚本验证 + 视觉验收"，避免误以为只能靠肉眼 | 可选优化 |

---

### v0.3 → v0.4

根据第三轮独立复核（脚本精算失效令牌分布、验证跨文件依赖性质）修正六处：

| # | 问题 | 修正 |
|---|---|---|
| 1 | 3c 跨文件依赖令牌 `eee1328` 被当作迁移依赖，产生 3a→3c PR 排序约束 | 实测该令牌**本身无定义**（Phase 1c 范围），opacity 声明已失效。取消 3a→3c 顺序约束，3a/3b/3c 可自由排序 |
| 2 | auth onboarding 4 处失效令牌被划入 1c，但 Phase 5 已统一处理 onboarding 令牌 | 4 处 runtime-card 失效令牌归 Phase 5，1c 收敛为 settings 范围 98 处 / 2 文件（controls 97 + providers 1） |
| 3 | 1c 验证仅写"逐处验收视觉变化"，无法机械检出遗漏 | 新增可执行验证脚本（消费端失效引用归零检查） |
| 4 | 1c 分布表偏高且漏项：row 20→14、card-action 19→11，漏 settings-card 8、row-inline 6 | 按脚本精算重排分布表，合计 98 |
| 5 | 五.3 残留"200 条"、四.3 残留"56%"，与 1b 正文 165 / 57% 不一致 | 订正为 165 / 57% |
| 6 | 1c 描述"跨 7 文件"给人工作量大的错觉 | 标注 97/98 集中在 `settings-controls.css`，1c 实为单文件 PR，风险更可控 |

---

---

### v0.2 → v0.3

根据第二轮独立复核（脚本交叉验证 `legacy-tokens.css` 定义与消费端引用）修正六处，并新增一类风险阶段：

| # | 问题 | 修正 |
|---|---|---|
| 1 | Phase 1 范围把 auth.css 全量误并入设置页，算成 7 文件 / 481 引用 | 实为 6 个设置页全局 CSS（381）+ auth onboarding（39），合计 420 |
| 2 | 1.3 节行数 4074 与逐文件相加结果不符 | 改为 4136 |
| 3 | 4.8 节占比 ~520 / 44% | 改为 ~420 / 36%（420 / 1177） |
| 4 | 1a / 1b 条数 157 / 200 与严格口径不符 | 改为 126 / 165（纯转发 = 定义只含 `var()`，混合值归 1b） |
| 5 | 1b、五.4 写"login 44 条"与 Phase 5 的 37 自相矛盾 | 统一为 37（login 37 + auth-loading-screen 7 分列） |
| 6 | **新发现**：104 处 legacy 引用指向全仓无定义令牌（~87 unique），样式当前失效 | 新增 **Phase 1c**（高风险，独立 PR）；Phase 3a 定性"对齐"→"重建" |

> 复核依据：全仓 `--component-*` 令牌仅在 `legacy-tokens.css` 有定义（1004 个），别处无任何定义；98 处引用（settings 范围）的令牌无一例外均无 fallback 值，故当前声明按 invalid at computed-value time 回退到初始值。

---

---

### v0.1 → v0.2（历史）

根据复核反馈修正五处问题：

| # | 问题 | 修正 |
|---|---|---|
| 1 | Phase 1 声称"纯替换不改视觉"，但 56% legacy 令牌含字面值 | 拆为 Phase 1a（机械替换）+ Phase 1b（逐条设计决策） |
| 2 | Phase 1 范围漏了 3 个文件，验收命令与范围不自洽 | 补入 `settings-appearance.css` / `settings-security.css` / `update.css`，范围改为 7 文件 |
| 3 | auth.css 前缀写错（`--component-auth-l-*` 不存在） | 改为 `--component-auth-onboarding-*`（39 条），Phase 5 只删 onboarding 令牌，不碰 login |
| 4 | Phase 4 行数表有误（IM 渠道 740→968，P0 1658→1654） | 修正行数，IM 渠道展开为 5 个文件 |
| 5 | Phase 2 做"替换"会触碰 6 个 Phase 4 分区文件 | Phase 2 只交付组件 + 样式，替换下放到 Phase 4 |

---

## 一、调研结论

### 1.1 令牌层（好消息）

原型 `tokens.css` 用到的全部语义令牌（`--text-1` / `--raised-1` / `--accent` / `--border` / `--surface-workspace` 等），**真实 `client/renderer/src/styles/tokens.css` 已全部具备**，三套主题（dark / light / warm）值也对齐。无需新增语义令牌。

真正需要消除的是 legacy 哈希令牌（`--component-*-*` 形式的中间层别名）。

### 1.2 代码层现状

| 层 | 文件 | 行数 | legacy 引用 | 状态 |
|---|---|---|---|---|
| **设置页 CSS Module** | `SettingsPage.module.css` | 1839 | 0 | ✅ 已迁移语义令牌 |
| | `AddEndpointDialog.module.css` | — | 0 | ✅ 已迁移 |
| | `ImChannelsBindingDialog.module.css` | — | 0 | ✅ 已迁移 |
| | `ImChannelIcon.module.css` | — | 0 | ✅ 已迁移 |
| **设置页全局 CSS** | `settings-shell.css` | 850 | 87 | ❌ legacy 待迁移 |
| | `settings-controls.css` | 1340 | 140 | ❌ legacy 待迁移 |
| | `settings-providers.css` | 974 | 57 | ❌ legacy 待迁移 |
| | `settings-appearance.css` | 232 | 17 | ❌ legacy 待迁移 |
| | `settings-security.css` | 238 | 35 | ❌ legacy 待迁移 |
| | `update.css` | 502 | 45 | ❌ legacy 待迁移 |
| **引导页** | `OnboardingView.tsx` | 175 | — | ⚠️ 结构待对齐原型 |
| | `auth.css`（全局，与登录页共用） | 578 | 83 | ❌ legacy 待迁移 |
| **UI 原子组件** | `ui/toggle.tsx` 等 | — | — | 不动（Tailwind 体系，设置页未引用） |

**Phase 1 实际范围**：6 个设置页全局 CSS 文件（381 引用）+ `auth.css` 中 onboarding 部分（39 引用）= **420 个 legacy 引用**。

> ⚠️ **prettier 折行问题**：legacy 令牌的 `var()` 被 prettier 折成多行，逐行 `grep` / `sed` 会漏算。Phase 1 替换必须用跨行正则或 CSS 语法解析处理。

### 1.3 核心差距

1. **设置页全局 CSS（4136 行 / 381 个 legacy 引用）**：最大的迁移量。六个文件用 legacy 哈希令牌做中间层别名，且 CSS 规则本身与原型有视觉差异。另有 ~82 个唯一令牌 / 98 处引用指向**全仓无定义**的令牌，样式当前失效（见 Phase 1c）。
2. **设置页共享组件**（`shared.tsx`，299 行）：已有 `SettingsCard` / `SettingRow` / `ToggleSwitch` / `SegmentedOptions` / `SettingsSelect` / `SettingsTextField` / `SettingsTextarea`。**缺 `Radio` 和 `Checkbox` 组件**。`SegmentedOptions` 选中态用勾（✓）（`shared.tsx:113`），原型已改为圆点（●）。
3. **原生 input 散落**：17 处 `type="radio"` / `type="checkbox"` 分布在 6 个 TSX 文件，横跨 P0 模型和 P3 运行时/IM 渠道分区。
4. **引导页**：样式寄生在 `auth.css` 全局文件中（与登录页共用），用 legacy 哈希令牌。原型设计了居中卡片 + 步骤卡片 + 模型选择，真实代码结构需对齐。

### 1.4 架构决策

**继续设置页既有模式（全局 CSS + `shared.tsx` 组件 + 语义令牌），不引入 Tailwind `ui/` 体系。**

理由：
- 设置页已有完善的组件体系（`shared.tsx` + 全局 CSS），4 个 CSS Module 文件已全部迁移语义令牌。
- `ui/` 组件用 Tailwind 类名（`bg-primary`），与设置页的语义令牌体系（`var(--text-1)`）是两套范式。混用会增加心智负担。
- 新增的 Radio / Checkbox 等控件直接加入 `shared.tsx`，样式写入全局 `settings-controls.css`，保持一致性。

---

## 二、实施阶段

### Phase 1a — legacy 令牌机械替换（低风险）

**目标**：替换全部纯 `var()` 转发形式的 legacy 令牌（约 126 条，43%），不改变视觉。

> 口径说明：纯转发 = 令牌定义**只含 `var(--x)` 不含其他**。定义里同时出现 `var()` 与字面值（如渐变、hsl）的混合令牌不算纯转发，归入 1b。

**范围**：6 个设置页全局 CSS 文件 + `auth.css` onboarding 部分。

**方法**：
1. 用跨行正则解析每个 `var(--component-*)` 引用（prettier 折行后跨多行）
2. 追溯 legacy 令牌在 `legacy-tokens.css` 中的定义
3. 如果定义是纯 `var()` 转发（如 `--xxx: var(--border)`），直接替换消费端的 `var(--component-xxx)` 为 `var(--border)`
4. 替换后从 `legacy-tokens.css` 删除对应条目

**验证**：`rg "component-settings-|component-auth-onboarding" client/renderer/src/styles/components/` 中纯转发引用归零。

### Phase 1b — legacy 令牌设计决策（中高风险）

**目标**：处理含字面值（或 var+字面值混合）的 legacy 令牌（约 165 条，57%），每条需要设计确认。

**示例**：
```
auth-login-content-box-shadow-45cfadf = 0 22px 80px hsl(220 40% 2% / 0.48), 0 0 0 1px hsl(186 78% 54% / 0.18)
auth-login-page-background-807c610  = radial-gradient(circle at 20% 18%, color-mix(in srgb, var(--accent) 12%, ...))
```

**处理策略**（逐条决策）：
- **(A) 抽成新语义令牌**：如果值有跨分区复用价值（如自定义阴影），新建语义令牌加入 `tokens.css`
- **(B) 内联字面值**：如果值只在一处使用，直接内联到 CSS 规则中
- **(C) 接受视觉变化**：如果值与最接近的语义令牌差异可接受，替换为语义令牌并验收

**工作量预估**：可能比 Phase 3 更大，因为每条都是人工决策。

> 注意：`auth.css` 中 onboarding 相关的含字面值令牌在 Phase 5 引导页迁移时统一处理，不在 1b 范围内。login 相关令牌（37 条）+ auth-loading-screen（7 条）不在本次范围内。

---

### Phase 1c — 失效令牌补写（高风险，独立 PR）

**目标**：处理指向**全仓无定义**令牌的 legacy 引用（约 82 个唯一令牌 / 98 处引用），照原型补写这些声明该是什么。

**背景**：这 98 处 `var(--component-*)` 引用的令牌在 `legacy-tokens.css` 及全仓任何地方**都没有定义**，且**无一例外均无 fallback 值**。CSS 中 `var()` 指向未定义变量且无 fallback 时，该声明按 invalid at computed-value time 处理，属性回退到继承值或初始值——**这些样式现在就是不生效的**。

**集中分布**（settings 范围 98 处：`settings-controls.css` 97 + `settings-providers.css` 1）：

| 组件前缀 | 失效引用 |
|---|---|
| `settings-segmented-options` | 17 |
| `mcp-inspector`（actions / v2） | 12 |
| `settings-card-action` | 11 |
| `settings-row-card` | 7 |
| `settings-row-actions` | 7 |
| `settings-row-inline` | 6 |
| `mcp-provider-row` | 6 |
| `settings-card` | 8 |
| `settings-stat-card` / `settings-chip` / `settings-status` | 各 5 |
| `settings-toolbar` / `settings-switch` | 各 4 |
| `settings-row-icon` | 1 |

> 实测 97/98 集中在 `settings-controls.css` 单文件，1c 实为单文件 PR，风险可控。`settings-shell.css` / `settings-appearance.css` / `settings-security.css` / `update.css` 各为 0。

**处理策略**：这类**没有值可追溯**，不属于迁移而是补写样式——逐处对照原型 `prototype.css` 确定该声明该是什么值（语义令牌或字面值），写入对应 CSS 规则，并从消费端删除失效的 `var(--component-*)` 引用。

> **auth onboarding 归属说明**：引导页的 4 处失效令牌（`runtime-card` 的 background × 2 + border-color × 2）不在 1c 范围，归 Phase 5 统一处理——它们和引导页样式重建绑在一起，单独在 1c 里补写没有意义。

> **全域失效令牌总量**：1c 范围 82 unique / 98 refs（settings）+ Phase 5 范围 4 unique / 4 refs（auth onboarding）= 合计 **86 unique / 102 refs**。按阶段拆分后此总数无执行意义，仅供交叉核对。

**为什么必须独立 PR**：
- Phase 1a 声称"纯机械替换不改视觉"，1c **必然改视觉**（从"无样式"到"有样式"）。混进 1a 会让"不改视觉"的承诺作废。
- `settings-segmented-options` 的 17 处失效正好撞上 Phase 3a 第 1 条改动（勾 → 圆点），说明分段选项样式本就残缺——Phase 3a 对它不是"调整"而是"重建"。

> 与 3a 的关系：1c 照原型补写时已采用原型目标值，因此分段选项等组件的"对齐"工作部分被 1c 吸收；3a 只需处理其余（值有效但与原型不符）的声明。

**验证**（可执行脚本 + 视觉验收双保险）：

```bash
# 1c 完成后，消费端不应再有指向无定义令牌的引用
python3 - <<'EOF'
import re
lt = open('client/renderer/src/styles/legacy-tokens.css').read()
defined = set(re.findall(r'(--component-[a-zA-Z0-9-]+)\s*:', lt))
for f in ['settings-controls.css','settings-providers.css']:
    src = ' '.join(open(f'client/renderer/src/styles/components/{f}').read().split())
    miss = [m for m in re.findall(r'var\(\s*(--component-[a-zA-Z0-9-]+)', src) if m not in defined]
    print(f'{f}: 失效引用残留 {len(miss)}')
EOF
```

视觉验收重点：分段选项、mcp 行、卡片选中态、开关。

---

### Phase 2 — 共享控件补齐（中风险，仅新增不替换）

**目标**：补齐原型中反复出现但 `shared.tsx` 中缺失的控件，统一选中态视觉语言。

**⚠️ 范围限定**：Phase 2 **只交付组件 + 样式，不做替换**。17 处原生 `<input>` 的替换下放到 Phase 4 各分区 PR 中，避免与分区改造冲突。

**新增组件**：

| 组件 | 用途 | 原型参考 |
|---|---|---|
| `Radio` | 单选圆点（16px 圆框 + 6px 白色圆点） | 通用-输出风格、外观-基础主题、安全-权限模式、更新-更新通道 |
| `Checkbox` | 复选框（16px 方框 + accent 填充 + 白色勾） | 模型-模型池勾选、视觉/推理、思考 |

**修改组件**：

| 组件 | 改动 | 原因 |
|---|---|---|
| `SegmentedOptions` | 选中态从勾（✓）改为圆点（●） | 原型统一：单选 = 圆点，多选 = 勾 |

**视觉规范**（来自原型 `prototype.css`）：
- **Radio**：`16×16` 圆框，`1px solid var(--border)`，选中 `border-color: var(--accent)` + `background: var(--accent)`，内部 `6px` 白色圆点居中（`top:4 left:4`，box-sizing border-box）
- **Checkbox**：`16×16` 方框，`4px` 圆角，选中 `background: var(--accent)` + `border-color: var(--accent)`，内部白色勾 SVG
- **Switch**：`38×22` pill，已存在，不改
- **卡片单选选中态**：右上角 `16px` accent 圆圈 + 内部 `6px` 白色圆点（`::before` + `::after`）

**文件**：
- `client/renderer/src/components/settings/shared.tsx` — 新增 `Radio` / `Checkbox` 导出（受控 API，与 `ToggleSwitch` 一致）
- `client/renderer/src/styles/components/settings-controls.css` — 新增 `.settings-radio` / `.settings-checkbox` 全局样式

---

### Phase 3 — 设置页全局 CSS 视觉对齐（中高风险，逐文件）

**目标**：将全局 CSS 文件的规则逐条对齐原型 `prototype.css` 的视觉规范。

> ⚠ **3a 定性修正**：分段选项（`settings-segmented-options`）有 17 处引用指向无定义令牌（见 Phase 1c），样式当前是失效的。对它不是"对齐现有视觉"而是"重建"，工作量被低估。

**按文件拆分**（可独立提 PR）：

#### 3a. `settings-controls.css`（1340 行，最大）

涉及控件：卡片、行、开关、分段选项、选择器、输入框、文本域、单选、复选、空状态。

**关键改动点**（基于原型与用户多轮反馈）：
1. `SegmentedOptions` 选中态：勾 → 圆点（**重建**——当前样式因令牌无定义而失效，见 Phase 1c）
2. `SettingsSelect` 下拉：原生 `<select>` → 自定义弹层（已有 JS 实现，样式需对齐）
3. 复选框：勾位置修正、深色模式勾颜色修正
4. 卡片选中态：从文字打勾 → 右上角圆点徽章
5. mac 顶部间距：`padding-top` 从 46px → 30px（mac 专属，原型已验证）

#### 3b. `settings-shell.css`（850 行）

涉及结构：页面布局、侧边栏、导航、内容区、标题栏间距、滚动条。

**关键改动点**：
1. mac 内容区顶部间距（原型已完成，需同步到真实代码）
2. 滚动条样式与位置
3. Windows 窗口控制区透传问题

#### 3c. `settings-providers.css`（974 行）

涉及模型供应商：供应商卡片、模型端点、模型池、添加供应商弹框。

**关键改动点**（用户反馈最多的区域）：
1. 供应商卡片：hover 效果、点击展开行为
2. 添加供应商弹框：tab 切换、下拉选、输入框、获取模型交互
3. 模型端点：与弹框内样式统一、可收起展开
4. 模型池：复选框、视觉/推理复选框位置
5. 取色器：吸管图标

> **跨文件依赖已改判**：`settings-providers.css` 引用的 `--component-settings-controls-settings-row-actions-opacity-eee1328` 本身是**无定义令牌**（见 Phase 1c），当前 opacity 声明已失效。3a 和 3c 之间**不存在 PR 排序约束**，可自由排序。1c 只需覆盖到 `settings-providers.css` 这 1 处即可。

#### 3d. `settings-appearance.css`（232 行）+ `settings-security.css`（238 行）+ `update.css`（502 行）

这三个文件对应 Phase 4 的 P1（外观 / 安全中心）和 P2（更新）分区。可在 Phase 1 令牌清理后，随各自分区的 Phase 4 PR 一起做视觉对齐，不单独拆 PR。

---

### Phase 4 — 分区组件对齐（中风险，逐分区）

**目标**：逐个分区将 TSX 组件结构与原型对齐，使用 Phase 2 的新控件，替换原生 `<input>`。

**分区优先级**（按用户反馈频率和复杂度排序）：

| 优先级 | 分区 | 组件文件 | 行数 | legacy CSS 文件 | 关键改动 |
|---|---|---|---|---|---|
| P0 | 模型 | `ProviderSection.tsx` 97 / `ProviderRow.tsx` 505 / `ProviderModelCard.tsx` 166 / `AddEndpointDialog.tsx` 886 | 1654 | `settings-providers.css` 974 | 弹框样式对齐、卡片交互、端点统一 |
| P1 | 外观 | `BasicSettingsSections.tsx`(部分) | — | `settings-appearance.css` 232 | 主题色卡、取色器、强调色 |
| P1 | 通用 | `BasicSettingsSections.tsx`(部分) | 273 | (共用 shell/controls) | 输出风格卡片单选 |
| P1 | 安全中心 | `SecuritySettings.tsx` | 333 | `settings-security.css` 238 | 权限模式卡片、安全项添加/展开 |
| P2 | 更新 | `UpdateSettings.tsx` | 293 | `update.css` 502 | 更新通道卡片 |
| P2 | 个性化 | `BasicSettingsSections.tsx`(部分) | — | (共用) | 自定义指令 |
| P3 | 运行时 | `RuntimeSettings.tsx` | 122 | (共用) | 引擎选择 |
| P3 | 审计 | `AuditSettings.tsx` | 116 | (共用) | 工具调用记录 |
| P3 | IM 渠道 | `ImChannelsSettings.tsx` 176 / `ImChannelsBindingDialog.tsx` 490 / `ImChannelsBotPanel.tsx` 214 / `ImChannelIcon.tsx` 54 / `ImQrPreview.tsx` 34 | 968 | (共用) | 桥接配置 |
| P3 | 机器人实例 | `ImBotInstancesSettings.tsx` | 77 | (共用) | 有数据态交互 |
| P3 | 版本 | `VersionSettings.tsx` | 47 | (共用) | 版本信息 |

**原生 input 替换清单**（Phase 2 组件就绪后在各分区 PR 中执行）：

| 文件 | 数量 | 所属分区 |
|---|---|---|
| `AddEndpointDialog.tsx` | 6 | P0 模型 |
| `ProviderModelCard.tsx` | 4 | P0 模型 |
| `ProviderRow.tsx` | 3 | P0 模型 |
| `ImChannelsBindingDialog.tsx` | 2 | P3 IM 渠道 |
| `ImChannelsBotPanel.tsx` | 1 | P3 IM 渠道 |
| `RuntimeSettings.tsx` | 1 | P3 运行时 |
| **合计** | **17** | |

---

### Phase 5 — 引导页迁移（中风险）

**目标**：将引导页从 `auth.css` (legacy) 迁移到独立 CSS Module + 语义令牌，对齐原型设计。

**⚠️ 范围限定**：`auth.css` 是引导页和登录页**共用**的文件。Phase 5 **只处理 onboarding 相关的 39 条 legacy 令牌和对应 CSS 规则**，不触碰 login（37 条）/ auth-loading-screen（7 条）令牌。

> 其中 4 条 runtime-card 令牌（background × 2 + border-color × 2）是**全仓无定义**的失效令牌（从 Phase 1c 划入此处统一处理）。引导页运行时卡片的边框和文字色当前生效，但背景和 hover/选中态边框色失效——正好落在工作区选择步骤的对齐范围内。

**文件变更**：
- 新建 `client/renderer/src/components/onboarding/OnboardingView.module.css`
- `OnboardingView.tsx`：class 名从全局 `onboarding-*` 改为 CSS Module 引用
- 从 `auth.css` 中**仅删除 onboarding 相关规则**（约 75 处），保留 login / loading-screen 规则
- 从 `legacy-tokens.css` 仅删除 `--component-auth-onboarding-*` 条目（39 条），保留 `--component-auth-login-*` 等

**原型对齐点**：
1. 全屏 dimmed overlay + 居中卡片（560px 宽）
2. 步骤卡片：完成态（accent 圆圈 + 勾）vs 未完成态
3. 工作区选择步骤 + 模型端点步骤
4. 「开始使用」按钮禁用/启用逻辑
5. 三主题协调

---

### Phase 6 — 像素验收

**方法**：
1. 原型开启验收模式（`?review=acceptance`），隐藏工具栏
2. 真实应用启动，同平台同主题同分区截图
3. 逐分区 A/B 对比
4. 矩阵：3 主题（dark / light / warm）× 2 平台（macos / windows）× 10 分区 = 60 组合

**验收标准**：
- 控件指示器（radio / checkbox / switch / 卡片选中）在所有分区视觉一致
- 三主题切换无令牌缺失
- mac / windows 顶部间距正确
- 滚动条样式与位置正确

---

## 三、交付节奏建议

| 阶段 | 可独立交付 | 建议方式 |
|---|---|---|
| Phase 1a | ✅ | 一个 PR，纯令牌机械替换 |
| Phase 1b | ✅ | 一个或多个 PR，按文件拆分，每条需设计确认 |
| Phase 1c | ✅ | 一个 PR，失效令牌补写，必然改视觉，脚本验证 + 视觉验收 |
| Phase 2 | ✅ | 一个 PR，仅新增组件 + 样式，不触碰分区组件 |
| Phase 3a/3b/3c | ✅ 各自独立 | 三个 PR，按文件拆分，顺序自由 |
| Phase 3d | 随 Phase 4 | 不单独 PR，并入对应分区 PR |
| Phase 4 | ✅ 按分区 | 多个 PR，按优先级 P0→P3，含原生 input 替换 |
| Phase 5 | ✅ | 一个 PR，仅 onboarding 部分 |
| Phase 6 | — | 验收，不产生代码 |

**并行建议**：Phase 1a 与 Phase 2 互不冲突，可并行。Phase 1c 与 1a / 1b 不冲突（不同令牌集），可并行但须独立 PR。Phase 1b 需在 Phase 3 之前完成（否则 3 的视觉对齐会碰到未清理的 legacy 令牌）。Phase 1c 建议在 3a 之前合并（3a 对分段选项是重建，依赖 1c 补写的声明）。

> ⚠️ **1a / 1b / 1c 串行合并提醒**：三者的令牌集虽不重叠，但 `settings-controls.css` 一文件内同时有 1a（27 处）/ 1b（16 处）/ 1c（97 处）共 140 处引用，且都落在 prettier 折行的 `var()` 区域——三 PR 同时改该文件会产生 git 冲突。建议涉及 `settings-controls.css` 的部分串行合并（1c 先走，改动量最大且是补写），其余文件可放心并行。

| 文件 | 1a | 1b | 1c | 可并行? |
|---|---|---|---|---|
| `settings-controls.css` | 27 | 16 | 97 | ❌ 串行（1c → 1a → 1b） |
| `settings-shell.css` | 32 | 55 | 0 | ✅ 1a/1b 可并行 |
| `settings-providers.css` | 20 | 36 | 1 | ⚠️ 1c 仅 1 处，冲突低 |
| `settings-appearance/security/update.css` | 各有 | 各有 | 0 | ✅ 1a/1b 可并行 |
| `auth.css`（onboarding） | 21 | 14 | 0(归P5) | ✅ Phase 5 独立 |

---

## 四、风险与注意事项

1. **不改变 DOM 结构**：用户多次强调"不要改我的结构"。Phase 3-4 只改 CSS 规则和 class 名，不重构 TSX 组件层级，除非原型明确要求（如弹框化展开内容）。
2. **全局 CSS 影响面**：`settings-controls.css` 等全局文件被所有分区引用，改动需全局回归。
3. **legacy 令牌值差异**：57% 的 legacy 令牌含硬编码 hsl / 渐变值，统一到语义令牌后是**可见视觉变化**，不是微小差异。Phase 1b 逐条需验收。
4. **prettier 折行**：legacy 令牌的 `var()` 被折成多行，逐行 sed/grep 会漏算，必须用跨行正则。
5. **auth.css 共用**：引导页和登录页共用 `auth.css`，Phase 5 只删 onboarding 部分（39 令牌 / 75 规则行），保留 login 部分。
6. **跨文件令牌依赖已改判**：`settings-providers.css` 引用的 controls 命名空间令牌（`eee1328`）实测为**无定义令牌**（Phase 1c 范围）。3a 和 3c 之间无 PR 排序约束。
7. **`ui/` 组件不迁移**：Tailwind 体系的 `ui/` 组件不在本次范围。
8. **全仓 legacy 总量**：1177 个引用，设置+引导占 ~420（约 36%），其余在 mcp / skills / global-search 等模块，不在本次范围。

---

## 五、待确认事项

1. **Phase 2 控件 API**：`Radio` / `Checkbox` 做成受控组件（`checked` + `onChange`），与现有 `ToggleSwitch` 一致？✅ 已在 v0.2 确认为受控。
2. **Phase 4 P0 模型分区**：`AddEndpointDialog.tsx`（886 行）已有弹框实现——先对齐样式保留逻辑，还是重构？建议先对齐样式。
3. **Phase 1b 处理策略**：含字面值的 165 条令牌，优先用 (A) 抽语义令牌还是 (B) 内联字面值？建议按 case-by-case，能复用的抽令牌，一次性的内联。
4. **Phase 1b 中 login 令牌范围**：`auth.css` 的 login 部分（37 条令牌）不在本次范围。是否需要后续单独开阶段处理登录页？
