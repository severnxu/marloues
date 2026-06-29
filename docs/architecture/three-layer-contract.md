# marloues 三层契约

> 目标：把 `workflow-web`、`marloues`、`personal-claw` 三条线拆成可组合资产。

更新时间：2026-06-25

## 1. 分层

### 1.1 Runtime 层

职责：

- 执行 Agent 任务
- 管理 thread / turn / tool / approval
- 输出统一的 runtime 事件

约束：

- 不直接依赖 React 组件
- 不直接认识 `workflow-web` 的 DOM 结构
- 不把 SDK 原始事件暴露给 UI

### 1.2 Protocol 层

职责：

- 把不同 runtime 的原生事件归一化
- 稳定 renderer 侧数据形状
- 屏蔽 厂商 SDK、Workflow binary、self-built loop 的差异

约束：

- 只定义消息与状态，不承载渲染逻辑
- 版本可演进，但必须向后兼容

### 1.3 UI 层

职责：

- 消费稳定协议
- 负责消息展示、交互、布局、动效
- 复用 `workflow-web` 逆向出的会话页 / Message 组件体系

约束：

- 只认协议，不认 runtime 内部实现
- 不向下穿透到 SDK / JSON-RPC / agent loop

## 2. 三条线的分工

- `workflow-web`：提供消息展示与交互范式
- `marloues`：提供产品闭环、配置、MCP、Skills、审计
- `personal-claw`：提供未来自建核心 runtime 的控制权

## 3. 推荐数据流

```txt
Runtime Native Event
  -> Runtime Adapter
  -> Stable UI Protocol
  -> workflow-web 风格组件消费
```

## 4. 设计原则

1. UI 只能消费稳定协议。
2. Protocol 只能做归一化，不能做业务决策。
3. Runtime 可以替换，UI 不应感知替换。
4. `workflow-web` 组件可以复用，但只能作为展示层。
5. `marloues` 的产品能力优先保留，迁移 UI 只能服务于产品目标。

## 5. 落地建议

- 先冻结 `RuntimeEvent` / `UIEvent`
- 再定义 adapter 映射表
- 最后把 `workflow-web` 组件接到 renderer

## 6. 资产映射

### 6.1 `workflow-web`

适合继承的部分：

- 会话页布局
- Message 列表与消息气泡
- tool / reasoning / command / file change 的视觉表达
- 流式渲染节奏和底部 composer 交互

抽象成的目标模块：

- `renderer/components/workflow-chat/*`
- `shared/ui-protocol.ts`

不能直接继承的部分：

- Workflow 原生事件形状
- 任何直接绑定单一 runtime 的状态机
- 直接依赖某个 SDK 或 JSON-RPC 结构的视图逻辑

### 6.2 `marloues`

适合继承的部分：

- 产品闭环
- 配置系统
- MCP / Skills / 权限 / 审计
- workspace / session / diagnostics
- 企业策略与内网约束

抽象成的目标模块：

- `main/services/*`
- `main/core/config/*`
- `main/core/session/*`
- `main/core/permissions/*`
- `main/core/context/*`

不能直接继承的部分：

- 只适配 厂商 SDK 的 runtime 假设
- 与单一产品形态强绑定的 UI 交互
- 任何写死 protocol-compatible 的地方，除非作为默认实现

### 6.3 `personal-claw`

适合继承的部分：

- 自建 runtime core 的 loop 设计
- agent state machine
- context 策略
- tool orchestration
- 可控的任务执行与恢复机制

抽象成的目标模块：

- `runtime/self-built/*`
- `runtime/core/*`
- `shared/protocol-core/*`

不能直接继承的部分：

- 任何与现成 UI 或具体产品强耦合的实现
- 过深的业务逻辑和展示逻辑绑定

## 7. 映射表

| 能力域 | 主要来源 | 在 marloues 中的落点 |
|---|---|---|
| 消息展示 | `workflow-web` | renderer chat components |
| tool timeline | `workflow-web` + `marloues` | UI protocol + tool cards |
| session / thread | `marloues` | session manager + IPC |
| workspace | `marloues` | workspace service + settings |
| MCP | `marloues` | mcp service + runtime injection |
| Skills | `marloues` | skill service + policy |
| 权限 | `marloues` + `personal-claw` | permission handler + runtime contract |
| 事件流协议 | 三者共同收敛 | `RuntimeEvent` / `UIEvent` |
| 自建 loop | `personal-claw` | future runtime core |
| 产品外壳 | `marloues` | desktop app shell |

## 8. 决策规则

1. 如果能力是“怎么展示”，优先看 `workflow-web`。
2. 如果能力是“怎么做成产品”，优先看 `marloues`。
3. 如果能力是“怎么自己控制核心 loop”，优先看 `personal-claw`。
4. 任何跨层实现都先落到 protocol，再落到 adapter，再落到 UI 或 runtime。
