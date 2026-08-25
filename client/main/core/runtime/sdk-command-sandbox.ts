import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { SecurityPermit } from "../security/sandbox-broker";
import {
  CodexProcessSandboxRunner,
  type ProcessSandboxRunner,
} from "../security/process-sandbox-runner";

export const SDK_SANDBOX_SERVER_NAME = "marloues_sandbox";
export const SDK_SANDBOX_TOOL_NAME = `mcp__${SDK_SANDBOX_SERVER_NAME}__bash`;

export class SdkCommandSandbox {
  private readonly permitsByCommand = new Map<string, SecurityPermit[]>();
  private readonly runner: ProcessSandboxRunner;

  constructor(runner: ProcessSandboxRunner = new CodexProcessSandboxRunner()) {
    this.runner = runner;
  }

  readonly server = createSdkMcpServer({
    name: SDK_SANDBOX_SERVER_NAME,
    version: "1.0.0",
    instructions:
      "Executes shell commands through the Marloues process sandbox. On Windows, commands use PowerShell syntax.",
    alwaysLoad: true,
    tools: [
      tool(
        "bash",
        "Run a command in the workspace through the OS-enforced Marloues sandbox. On Windows, provide PowerShell syntax.",
        {
          command: z.string().min(1),
          timeout: z.number().positive().optional(),
          description: z.string().optional(),
          run_in_background: z.boolean().optional(),
          dangerouslyDisableSandbox: z.boolean().optional(),
        },
        async (input) => {
          if (input.run_in_background) {
            return toolError(
              "Background commands are disabled because their sandbox lifetime cannot be audited yet.",
            );
          }
          const permit = this.consumePermit(input.command);
          if (!permit) {
            return toolError(
              "Missing one-time SecurityHost permit; command execution was denied.",
            );
          }
          try {
            const cwd = permit.fs.read[0];
            if (!cwd) {
              return toolError(
                "SecurityHost permit has no workspace root; command execution was denied.",
              );
            }
            const result = await this.runner.run({
              command: input.command,
              cwd,
              permit,
              timeoutMs: input.timeout,
            });
            const output = [
              result.stdout.trimEnd(),
              result.stderr.trimEnd(),
              result.timedOut
                ? "Command timed out."
                : `Process exited with code ${result.exitCode} (${result.backend}).`,
            ]
              .filter(Boolean)
              .join("\n");
            return {
              content: [{ type: "text" as const, text: output }],
              isError: result.exitCode !== 0 || result.timedOut,
            };
          } catch (error) {
            return toolError(
              error instanceof Error ? error.message : String(error),
            );
          }
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
    ],
  });

  authorize(command: string, permit: SecurityPermit): void {
    const queue = this.permitsByCommand.get(command) ?? [];
    queue.push(permit);
    this.permitsByCommand.set(command, queue);
  }

  clear(): void {
    this.permitsByCommand.clear();
  }

  private consumePermit(command: string): SecurityPermit | undefined {
    const queue = this.permitsByCommand.get(command);
    const permit = queue?.shift();
    if (!queue?.length) this.permitsByCommand.delete(command);
    return permit;
  }
}

export function canonicalSdkSecurityToolName(toolName: string): string {
  return toolName === SDK_SANDBOX_TOOL_NAME ? "Bash" : toolName;
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
