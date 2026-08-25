/**
 * Im Command Router — IM 侧斜杠命令路由
 *
 * 支持命令：/new /list /stop /compact /clear。
 * 命令动作通过注入的 ImCommandActions 解耦（由 ImBridge 装配），
 * 避免 pipeline ↔ bridge 循环依赖。
 */

import { logInfo, logWarn } from "../../core/logging/app-logger";
import type {
  ImChannelId,
  ImCommand,
  ImCommandName,
  ImPermissionContext,
} from "@shared/im/im-types";

export const IM_COMMANDS: readonly ImCommandName[] = [
  "new",
  "list",
  "stop",
  "compact",
  "clear",
];

/** 解析文本首词是否为 IM 命令（/new、/stop、/clear 等，忽略大小写） */
export function parseImCommand(text: string): ImCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawName, ...rest] = trimmed.slice(1).split(/\s+/);
  const name = rawName?.toLowerCase() as ImCommandName;
  if (!IM_COMMANDS.includes(name)) return null;
  return { name, args: rest.length > 0 ? rest.join(" ") : undefined };
}

/** 命令执行所需的动作接口（由 ImBridge 装配，依赖注入避免循环依赖） */
export interface ImCommandActions {
  /** /new：为当前 chatId 创建新 active thread；旧 thread 保留为历史；返回回执文本 */
  newSession(ctx: ImPermissionContext): Promise<string>;
  /** /list：列出该用户可用的 IM 会话；返回回执文本 */
  listSessions(ctx: ImPermissionContext): Promise<string>;
  /** /stop：中断当前回合；返回回执文本 */
  stopTurn(ctx: ImPermissionContext): Promise<string>;
  /** /compact：手动压缩当前会话上下文；返回回执文本 */
  compact(ctx: ImPermissionContext): Promise<string>;
  /** /clear：清空当前会话上下文；返回回执文本 */
  clear(ctx: ImPermissionContext): Promise<string>;
}

export class ImCommandRouter {
  constructor(private readonly actions: ImCommandActions) {}

  /** 返回命令回执文本；非命令返回 null（走普通消息） */
  async handle(
    ctx: ImPermissionContext,
    cmd: ImCommand,
  ): Promise<string | null> {
    try {
      switch (cmd.name) {
        case "new":
          logInfo("im.command.new", {
            channel: ctx.channel,
            chatId: ctx.chatId,
          });
          return await this.actions.newSession(ctx);
        case "list":
          logInfo("im.command.list", {
            channel: ctx.channel,
            chatId: ctx.chatId,
          });
          return await this.actions.listSessions(ctx);
        case "stop":
          logInfo("im.command.stop", {
            channel: ctx.channel,
            chatId: ctx.chatId,
          });
          return await this.actions.stopTurn(ctx);
        case "compact":
          logInfo("im.command.compact", {
            channel: ctx.channel,
            chatId: ctx.chatId,
          });
          return await this.actions.compact(ctx);
        case "clear":
          logInfo("im.command.clear", {
            channel: ctx.channel,
            chatId: ctx.chatId,
          });
          return await this.actions.clear(ctx);
        default:
          return null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn("im.command.failed", {
        channel: ctx.channel as ImChannelId,
        name: cmd.name,
        error: message,
      });
      return `命令 /${cmd.name} 执行失败：${message}`;
    }
  }
}
