/**
 * Im Channel Adapter — 企微/飞书渠道统一接口
 *
 * 渠道插件化（对齐 OpenClaw plugin-sdk / Proma Bridge Registry）：
 * 核心只依赖此接口，企微/飞书各一个实现。
 *
 * 流式三段协议：
 * - sendStreamStart：开启一条流式消息（平台侧创建待更新消息/卡片）
 * - patchStream：增量追加内容（平台侧节流合并，如飞书 500ms 卡片 patch）
 * - finishStream：结束（最终文本整发/卡片定型）
 */

import type {
  ImApprovalCardPayload,
  ImApprovalOutcome,
  ImChannelId,
  ImInboundMessage,
} from "@shared/im/im-types";
import type { WorkflowFileChange } from "@shared/workflow-read-thread-contract";

/** 流式句柄（一次回复的续传上下文） */
export interface StreamHandle {
  channel: ImChannelId;
  chatId: string;
  requestId: string;
  lastPatchAt: number;
  buffer: string;
}

/** 审批卡片按钮动作（IM → 主进程） */
export interface ImCardAction {
  requestId: string;
  approved: boolean;
  reason?: string;
  chatId: string;
}

export interface ImChannelAdapter {
  readonly channel: ImChannelId;

  /** 建立长连接并开始收消息；失败抛错（由 registry 重试） */
  start(): Promise<void>;
  /** 断开连接（幂等） */
  stop(): Promise<void>;
  isHealthy(): boolean;

  /** 一次性文本（命令回执/错误/降级整发） */
  sendText(chatId: string, text: string): Promise<void>;

  /** 开启流式回复，返回句柄 */
  sendStreamStart(
    chatId: string,
    meta: { turnId: string; initialText?: string },
  ): Promise<StreamHandle>;
  /** 增量追加（实现内部节流合并） */
  patchStream(handle: StreamHandle, delta: string): Promise<void>;
  /** 结束流式回复（finalText 为最终完整文本） */
  finishStream(handle: StreamHandle, finalText: string): Promise<void>;
  /** 流式回复失败/被中断的收尾 */
  cancelStream(handle: StreamHandle, reason?: string): Promise<void>;

  /** 审批卡片：渲染 approve/deny 按钮 */
  sendApprovalCard(
    chatId: string,
    payload: ImApprovalCardPayload,
  ): Promise<void>;
  /** 审批卡片终态更新 */
  updateApprovalCard(
    requestId: string,
    outcome: ImApprovalOutcome,
  ): Promise<void>;

  /** 工具结果卡片（mcpToolCall / webSearch 等终态摘要） */
  sendResultCard(
    chatId: string,
    payload: { title: string; summary: string },
  ): Promise<void>;
  /** 文件变更摘要卡片（一等投影对象） */
  sendFileChangeCard(
    chatId: string,
    payload: { changes: WorkflowFileChange[] },
  ): Promise<void>;
  /** 命令执行结果卡片（一等投影对象） */
  sendCommandExecutionCard(
    chatId: string,
    payload: {
      command: string;
      exitCode?: number | null;
      output?: string;
    },
  ): Promise<void>;

  /** 入站消息回调（订阅返回取消函数） */
  onMessage(cb: (msg: ImInboundMessage) => void): () => void;
  /** 审批按钮动作回调 */
  onCardAction(cb: (action: ImCardAction) => void): () => void;
}
