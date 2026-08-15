import type { UIEvent } from "../ui-protocol";

/**
 * 参与 WorkflowTurnItem 构建的 runtime 事件子集（UIEvent 的判别联合提取）。
 *
 * 设计：不重复发明事件类型——renderer 端已经以 UIEvent 消费同一事件流
 * （ui-protocol.ts），这里只声明「会触发 item 变更」的成员，供
 * TurnItemBuilder.ingest() 与未来订阅层共用。
 *
 * turn.complete 不在其中：它一次性终态化多个流式 item（agentMessage /
 * reasoning），由 TurnItemBuilder.finalizeStreamingItems() 单独处理，
 * 单次 ingest 的 `{ item, prevItem?, changed }` 契约装不下。
 */
export type RuntimeItemEvent = Extract<
  UIEvent,
  {
    type:
      | "text.chunk"
      | "thinking.chunk"
      | "tool.start"
      | "tool.complete"
      | "plan.delta"
      | "plan.item"
      | "approval.request"
      | "approval.decision";
  }
>;

export function isRuntimeItemEvent(event: UIEvent): event is RuntimeItemEvent {
  switch (event.type) {
    case "text.chunk":
    case "thinking.chunk":
    case "tool.start":
    case "tool.complete":
    case "plan.delta":
    case "plan.item":
    case "approval.request":
    case "approval.decision":
      return true;
    default:
      return false;
  }
}
