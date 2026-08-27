import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { browserService } from "../../services/browser-service";
import type { SessionApprovalTracker } from "../security/session-approval-tracker";
import type { SecurityPermit } from "../security/sandbox-broker";

export const SDK_BROWSER_SERVER_NAME = "marloues_browser";
export const SDK_BROWSER_TOOL_NAVIGATE = `mcp__${SDK_BROWSER_SERVER_NAME}__navigate`;
export const SDK_BROWSER_TOOL_SCREENSHOT = `mcp__${SDK_BROWSER_SERVER_NAME}__screenshot`;
export const SDK_BROWSER_TOOL_CLICK = `mcp__${SDK_BROWSER_SERVER_NAME}__click`;
export const SDK_BROWSER_TOOL_FILL = `mcp__${SDK_BROWSER_SERVER_NAME}__fill`;
export const SDK_BROWSER_TOOL_GET_TEXT = `mcp__${SDK_BROWSER_SERVER_NAME}__get_text`;

/** Maps full MCP tool names to canonical short names for SecurityHost matching. */
export function canonicalBrowserToolName(toolName: string): string {
  const map: Record<string, string> = {
    [SDK_BROWSER_TOOL_NAVIGATE]: "browser.navigate",
    [SDK_BROWSER_TOOL_SCREENSHOT]: "browser.screenshot",
    [SDK_BROWSER_TOOL_CLICK]: "browser.click",
    [SDK_BROWSER_TOOL_FILL]: "browser.fill",
    [SDK_BROWSER_TOOL_GET_TEXT]: "browser.get_text",
  };
  return map[toolName] ?? toolName;
}

export interface SdkBrowserServer {
  readonly server: ReturnType<typeof createSdkMcpServer>;
  authorize(url: string, permit: SecurityPermit): void;
  clear(): void;
}

/**
 * Creates an in-process SDK MCP server exposing browser tools.
 * The approvalTracker is a per-thread instance (survives across turns).
 * The permit queue is per-turn (cleared when the turn ends).
 */
export function createSdkBrowserServer(
  approvalTracker: SessionApprovalTracker,
  threadId: string,
): SdkBrowserServer {
  const permitsByUrl = new Map<string, SecurityPermit[]>();

  function consumePermit(url: string): SecurityPermit | undefined {
    const queue = permitsByUrl.get(url);
    const permit = queue?.shift();
    if (!queue?.length) permitsByUrl.delete(url);
    return permit;
  }

  const server = createSdkMcpServer({
    name: SDK_BROWSER_SERVER_NAME,
    version: "1.0.0",
    instructions:
      "Browser automation via Playwright. Use navigate to open pages, screenshot to capture, click/fill to interact, get_text to read content.",
    alwaysLoad: true,
    tools: [
      tool(
        "navigate",
        "Open or navigate to a URL in the headless browser. Returns pageId.",
        {
          url: z.string().url(),
        },
        async (input) => {
          const permit = consumePermit(input.url);
          if (!permit) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Missing one-time SecurityHost permit; browser navigate was denied.",
                },
              ],
              isError: true,
            };
          }
          // Lazy-launch browser for this thread
          let browserId = browserService.getBrowserId(threadId);
          if (!browserId) {
            browserId = await browserService.launch({
              threadId,
              headless: true,
            });
            browserService.setBrowserId(threadId, browserId);
          }
          let pageId = browserService.getActivePageId(threadId);
          if (!pageId) {
            pageId = await browserService.newPage(
              browserId,
              input.url,
              threadId,
            );
          } else {
            await browserService.navigate(pageId, input.url);
          }
          browserService.setActivePageId(threadId, pageId);
          approvalTracker.markPageApproved(pageId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ pageId, url: input.url }),
              },
            ],
          };
        },
        {
          annotations: {
            destructiveHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
          alwaysLoad: true,
        },
      ),
      tool(
        "screenshot",
        "Take a screenshot of the current or specified page. Returns base64 image.",
        {
          pageId: z.string().optional(),
          fullPage: z.boolean().optional(),
        },
        async (input) => {
          const pageId =
            input.pageId ?? browserService.getActivePageId(threadId);
          if (!pageId) {
            return {
              content: [
                { type: "text" as const, text: "No active browser page." },
              ],
              isError: true,
            };
          }
          const data = await browserService.screenshot(pageId, {
            fullPage: input.fullPage,
          });
          return {
            content: [
              {
                type: "image" as const,
                data,
                mimeType: "image/png",
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
        "click",
        "Click an element matching the given CSS selector on the current page.",
        {
          selector: z.string().min(1),
          pageId: z.string().optional(),
        },
        async (input) => {
          const pageId =
            input.pageId ?? browserService.getActivePageId(threadId);
          if (!pageId) {
            return {
              content: [
                { type: "text" as const, text: "No active browser page." },
              ],
              isError: true,
            };
          }
          await browserService.click(pageId, input.selector);
          return { content: [{ type: "text" as const, text: "ok" }] };
        },
        {
          annotations: {
            destructiveHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
          alwaysLoad: true,
        },
      ),
      tool(
        "fill",
        "Fill an input element matching the given CSS selector with a value.",
        {
          selector: z.string().min(1),
          value: z.string(),
          pageId: z.string().optional(),
        },
        async (input) => {
          const pageId =
            input.pageId ?? browserService.getActivePageId(threadId);
          if (!pageId) {
            return {
              content: [
                { type: "text" as const, text: "No active browser page." },
              ],
              isError: true,
            };
          }
          await browserService.fill(pageId, input.selector, input.value);
          return { content: [{ type: "text" as const, text: "ok" }] };
        },
        {
          annotations: {
            destructiveHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
          alwaysLoad: true,
        },
      ),
      tool(
        "get_text",
        "Get the text content of the current page or a specific element.",
        {
          selector: z.string().optional(),
          pageId: z.string().optional(),
        },
        async (input) => {
          const pageId =
            input.pageId ?? browserService.getActivePageId(threadId);
          if (!pageId) {
            return {
              content: [
                { type: "text" as const, text: "No active browser page." },
              ],
              isError: true,
            };
          }
          const content = await browserService.getContent(pageId);
          return { content: [{ type: "text" as const, text: content }] };
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
    authorize(url: string, permit: SecurityPermit): void {
      const queue = permitsByUrl.get(url) ?? [];
      queue.push(permit);
      permitsByUrl.set(url, queue);
    },
    clear(): void {
      permitsByUrl.clear();
    },
  };
}
