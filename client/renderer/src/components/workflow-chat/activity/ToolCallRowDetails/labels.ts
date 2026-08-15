import { itemInputText } from "../../";
import {
  basename,
  compactCommand,
  compactCommandTarget,
  isEditToolName,
  isSearchToolName,
  itemStatus,
  toolName,
  toolTargetCount,
} from "./helpers";
import { workflowStatusIsRunning } from "../../";
import type { ToolCallRowItem } from "./types";

export function toolLabel(item: ToolCallRowItem): string {
  const codexLabel = codexStyleToolLabel(item);
  if (codexLabel) return codexLabel;
  const label = readableToolLabel(item);
  const status = itemStatus(item);
  if (workflowStatusIsRunning(status))
    return label.startsWith("已") ? label.replace(/^已/, "正在") : label;
  if (status === "error" || status === "failed")
    return label.startsWith("已")
      ? label.replace(/^已/, "失败：")
      : `失败：${label}`;
  return label;
}

function codexStyleToolLabel(item: ToolCallRowItem): string | null {
  const name = toolName(item);
  const status = itemStatus(item);
  const verb =
    status === "error" || status === "failed"
      ? "失败："
      : workflowStatusIsRunning(status)
        ? "正在运行 "
        : "已运行 ";

  if (name === "glob" || name.endsWith(".glob")) return `${verb}Glob`;
  if (name === "grep" || name.endsWith(".grep")) return `${verb}Grep`;
  if (name === "ls" || name.endsWith(".ls")) return `${verb}LS`;

  if (
    name === "read" ||
    name === "read_files" ||
    name.endsWith(".read") ||
    name.endsWith(".read_file")
  ) {
    if (status === "error" || status === "failed") return "失败：Read";
    return workflowStatusIsRunning(status) ? "正在运行 Read" : "已运行 Read";
  }

  return null;
}

function readableToolLabel(item: ToolCallRowItem): string {
  const name = toolName(item);
  const input = itemInputText(item);
  const firstLine =
    input
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? "";

  if (name === "read" || name === "read_files" || name.endsWith(".read"))
    return `已读取 ${toolTargetCount(input) || 1} 个文件`;
  if (name === "workflow_read_file" || name.endsWith(".read_file"))
    return `已读取 ${basename(firstLine || input || "文件")}`;
  if (
    name === "glob" ||
    name.endsWith(".glob") ||
    name === "ls" ||
    name.endsWith(".ls")
  )
    return "已列出文件";
  if (name === "grep" || name.endsWith(".grep")) return "已搜索工作区";
  if (name.includes("tool_search")) return "已搜索工具";
  if (item.type === "webSearch")
    return input.includes('"type": "open_page"') ? "已打开页面" : "已搜索网页";
  if (item.type === "imageGeneration")
    return itemStatus(item) === "running" ? "正在生成图片" : "已生成图片";
  if (name === "token_count") return "已更新用量";
  if (name === "turn_aborted") return "已中断";
  if (name === "thread_rolled_back") return "已回滚";
  if (name === "update_plan" || name === "plan_snapshot") return "已更新计划";
  if (name === "js") return "已使用浏览器";
  if (isSearchToolName(name) || firstLine.startsWith("rg "))
    return firstLine.startsWith("rg --files")
      ? "已列出项目文件"
      : "已搜索工作区";

  if (
    name.includes("shell") ||
    name.includes("command") ||
    name === "commands"
  ) {
    if (/^Get-Content\b/i.test(firstLine))
      return `已读取 ${compactCommandTarget(firstLine, "Get-Content")}`;
    if (/^Get-ChildItem\b/i.test(firstLine)) return "已列出目录";
    if (/^Select-String\b/i.test(firstLine)) return "已搜索工作区";
    if (/^Get-NetTCPConnection\b/i.test(firstLine)) return "已检查开发服务";
    if (/^\$snapshot\s*=/i.test(firstLine)) return "已读取会话日志";
    if (/^\$listener\s*=/i.test(firstLine)) return "已重启开发服务";
    if (/^git status\b/i.test(firstLine)) return "已检查 Git 状态";
    if (/^npm run\b/i.test(firstLine)) return `已运行 ${firstLine}`;
    if (/^Start-Process\b/i.test(firstLine)) return "已启动开发服务";
    if (/^Stop-Process\b/i.test(firstLine)) return "已重启开发服务";
    if (/^Invoke-RestMethod\b/i.test(firstLine)) return "已调用本地 API";
    return firstLine ? `已运行 ${compactCommand(firstLine)}` : "已运行命令";
  }

  if (isEditToolName(name)) return "已编辑文件";
  if (name.includes("todo")) return "已更新待办";
  return `已运行 ${name || item.type}`;
}
