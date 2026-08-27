import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { terminalService } from "../../services/terminal-service";
import type { SessionApprovalTracker } from "../security/session-approval-tracker";
import type { SecurityPermit } from "../security/sandbox-broker";

export const SDK_TERMINAL_SERVER_NAME = "marloues_terminal";
export const SDK_TERMINAL_TOOL_EXEC = `mcp__${SDK_TERMINAL_SERVER_NAME}__exec`;
export const SDK_TERMINAL_TOOL_WRITE = `mcp__${SDK_TERMINAL_SERVER_NAME}__write`;
export const SDK_TERMINAL_TOOL_READ = `mcp__${SDK_TERMINAL_SERVER_NAME}__read`;
export const SDK_TERMINAL_TOOL_RESIZE = `mcp__${SDK_TERMINAL_SERVER_NAME}__resize`;

/** Maps full MCP tool names to canonical short names for SecurityHost matching. */
export function canonicalTerminalToolName(toolName: string): string {
  const map: Record<string, string> = {
    [SDK_TERMINAL_TOOL_EXEC]: "terminal.exec",
    [SDK_TERMINAL_TOOL_WRITE]: "terminal.write",
    [SDK_TERMINAL_TOOL_READ]: "terminal.read",
    [SDK_TERMINAL_TOOL_RESIZE]: "terminal.resize",
  };
  return map[toolName] ?? toolName;
}

export interface SdkTerminalServer {
  readonly server: ReturnType<typeof createSdkMcpServer>;
  authorize(command: string, permit: SecurityPermit): void;
  clear(): void;
}

/**
 * Creates an in-process SDK MCP server exposing terminal tools.
 * The approvalTracker is a per-thread instance (survives across turns).
 * The permit queue is per-turn (cleared when the turn ends).
 */
export function createSdkTerminalServer(
  approvalTracker: SessionApprovalTracker,
): SdkTerminalServer {
  const permitsByCommand = new Map<string, SecurityPermit[]>();

  function consumePermit(command: string): SecurityPermit | undefined {
    const queue = permitsByCommand.get(command);
    const permit = queue?.shift();
    if (!queue?.length) permitsByCommand.delete(command);
    return permit;
  }

  const server = createSdkMcpServer({
    name: SDK_TERMINAL_SERVER_NAME,
    version: "1.0.0",
    instructions:
      "Interactive PTY terminal sessions. Use exec to start a session, write to send input, read to get output.",
    alwaysLoad: true,
    tools: [
      tool(
        "exec",
        "Start an interactive PTY session and run a command. Returns sessionId and initial output.",
        {
          command: z.string().min(1),
          cwd: z.string().optional(),
        },
        async (input) => {
          const permit = consumePermit(input.command);
          if (!permit) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Missing one-time SecurityHost permit; terminal exec was denied.",
                },
              ],
              isError: true,
            };
          }
          const sessionId = terminalService.spawn(
            input.cwd ?? process.cwd(),
            {},
          );
          approvalTracker.markSessionApproved(sessionId);
          terminalService.write(sessionId, input.command + "\n");
          const output = await terminalService.readUntilStable(
            sessionId,
            300,
            5000,
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  sessionId,
                  output: output.data,
                  stable: output.stable,
                  exitCode: output.exitCode,
                }),
              },
            ],
          };
        },
        {
          annotations: {
            destructiveHint: true,
            openWorldHint: true,
            readOnlyHint: false,
          },
          alwaysLoad: true,
        },
      ),
      tool(
        "write",
        "Write data to an active PTY session's stdin.",
        {
          sessionId: z.string().min(1),
          data: z.string(),
        },
        async (input) => {
          // canUseTool short-circuit allows this if session is approved
          terminalService.write(input.sessionId, input.data);
          return { content: [{ type: "text" as const, text: "ok" }] };
        },
        {
          annotations: {
            destructiveHint: false,
            openWorldHint: false,
            readOnlyHint: false,
          },
          alwaysLoad: true,
        },
      ),
      tool(
        "read",
        "Read incremental output from an active PTY session since the last read.",
        {
          sessionId: z.string().min(1),
        },
        async (input) => {
          const result = terminalService.read(input.sessionId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result),
              },
            ],
          };
        },
        {
          annotations: {
            destructiveHint: false,
            openWorldHint: false,
            readOnlyHint: true,
          },
          alwaysLoad: true,
        },
      ),
      tool(
        "resize",
        "Resize an active PTY session's terminal dimensions.",
        {
          sessionId: z.string().min(1),
          cols: z.number().int().positive(),
          rows: z.number().int().positive(),
        },
        async (input) => {
          terminalService.resize(input.sessionId, input.cols, input.rows);
          return { content: [{ type: "text" as const, text: "ok" }] };
        },
        {
          annotations: {
            destructiveHint: false,
            openWorldHint: false,
            readOnlyHint: true,
          },
          alwaysLoad: true,
        },
      ),
    ],
  });

  return {
    server,
    authorize(command: string, permit: SecurityPermit): void {
      const queue = permitsByCommand.get(command) ?? [];
      queue.push(permit);
      permitsByCommand.set(command, queue);
    },
    clear(): void {
      permitsByCommand.clear();
    },
  };
}
