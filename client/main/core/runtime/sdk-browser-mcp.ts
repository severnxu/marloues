import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { cdpBrowserService } from "../../services/cdp-browser-service";
import type { SessionApprovalTracker } from "../security/session-approval-tracker";
import type { SecurityPermit } from "../security/sandbox-broker";

export const SDK_BROWSER_SERVER_NAME = "marloues_browser";
export const SDK_BROWSER_TOOL_NAVIGATE = `mcp__${SDK_BROWSER_SERVER_NAME}__navigate`;
export const SDK_BROWSER_TOOL_SCREENSHOT = `mcp__${SDK_BROWSER_SERVER_NAME}__screenshot`;
export const SDK_BROWSER_TOOL_CLICK = `mcp__${SDK_BROWSER_SERVER_NAME}__click`;
export const SDK_BROWSER_TOOL_FILL = `mcp__${SDK_BROWSER_SERVER_NAME}__fill`;
export const SDK_BROWSER_TOOL_GET_STATE = `mcp__${SDK_BROWSER_SERVER_NAME}__get_state`;
export const SDK_BROWSER_TOOL_SCROLL = `mcp__${SDK_BROWSER_SERVER_NAME}__scroll`;
export const SDK_BROWSER_TOOL_POLL_EVENTS = `mcp__${SDK_BROWSER_SERVER_NAME}__poll_events`;

/** Maps full MCP tool names to canonical short names for SecurityHost matching. */
export function canonicalBrowserToolName(toolName: string): string {
  const map: Record<string, string> = {
    [SDK_BROWSER_TOOL_NAVIGATE]: "browser.navigate",
    [SDK_BROWSER_TOOL_SCREENSHOT]: "browser.screenshot",
    [SDK_BROWSER_TOOL_CLICK]: "browser.click",
    [SDK_BROWSER_TOOL_FILL]: "browser.fill",
    [SDK_BROWSER_TOOL_GET_STATE]: "browser.get_state",
    [SDK_BROWSER_TOOL_SCROLL]: "browser.scroll",
    [SDK_BROWSER_TOOL_POLL_EVENTS]: "browser.poll_events",
  };
  return map[toolName] ?? toolName;
}

export interface SdkBrowserServer {
  readonly server: ReturnType<typeof createSdkMcpServer>;
  authorize(url: string, permit: SecurityPermit): void;
  clear(): void;
}

export function normalizeMcpImageData(data: string): string {
  return data.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
}

/**
 * Creates an in-process SDK MCP server exposing CDP-based browser tools.
 * All tools operate on the same WebContentsView the user sees -- no separate
 * headless browser. The agent uses accessibility-tree indices (not CSS
 * selectors) to interact with elements.
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
      "Browser automation via CDP accessibility tree. Every user request to open, reopen, or navigate a page requires a navigate call in that same turn, even when the URL is unchanged or was opened previously. Never report a browser action as completed from an earlier turn's tool result. Use get_state for the indexed accessibility tree, screenshot to capture, click/fill to interact by index, scroll, and poll_events for browser events.",
    alwaysLoad: true,
    tools: [
      tool(
        "navigate",
        "Open or navigate to a URL in the browser. Returns pageId and side effects.",
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
          let pageId = cdpBrowserService.getActivePageId(threadId);
          if (!pageId) {
            pageId = await cdpBrowserService.newPage(input.url, threadId);
          } else {
            await cdpBrowserService.navigate(pageId, input.url);
          }
          cdpBrowserService.setActivePageId(threadId, pageId);
          cdpBrowserService.requestPageReveal(threadId, pageId);
          approvalTracker.markPageApproved(pageId);
          const sideEffects = cdpBrowserService.consumeSideEffects(pageId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ pageId, url: input.url, sideEffects }),
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
        },
        async (input) => {
          const pageId =
            input.pageId ?? cdpBrowserService.getActivePageId(threadId);
          if (!pageId) {
            return {
              content: [
                { type: "text" as const, text: "No active browser page." },
              ],
              isError: true,
            };
          }
          const data = normalizeMcpImageData(
            await cdpBrowserService.screenshot(pageId),
          );
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
        "Click an interactive element by its index from get_state.",
        {
          index: z.number().int().nonnegative(),
          pageId: z.string().optional(),
        },
        async (input) => {
          const pageId =
            input.pageId ?? cdpBrowserService.getActivePageId(threadId);
          if (!pageId) {
            return {
              content: [
                { type: "text" as const, text: "No active browser page." },
              ],
              isError: true,
            };
          }
          await cdpBrowserService.clickByIndex(pageId, input.index);
          const sideEffects = cdpBrowserService.consumeSideEffects(pageId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: true, sideEffects }),
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
        "fill",
        "Fill text into an element by its index from get_state.",
        {
          index: z.number().int().nonnegative(),
          value: z.string(),
          pageId: z.string().optional(),
        },
        async (input) => {
          const pageId =
            input.pageId ?? cdpBrowserService.getActivePageId(threadId);
          if (!pageId) {
            return {
              content: [
                { type: "text" as const, text: "No active browser page." },
              ],
              isError: true,
            };
          }
          await cdpBrowserService.fillByIndex(pageId, input.index, input.value);
          const sideEffects = cdpBrowserService.consumeSideEffects(pageId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: true, sideEffects }),
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
        "get_state",
        "Get the accessibility tree of the current page as indexed text. Each interactive element has a [N] index for use with click/fill. Call this before interacting with the page.",
        {
          pageId: z.string().optional(),
        },
        async (input) => {
          const pageId =
            input.pageId ?? cdpBrowserService.getActivePageId(threadId);
          if (!pageId) {
            return {
              content: [
                { type: "text" as const, text: "No active browser page." },
              ],
              isError: true,
            };
          }
          const axTree = await cdpBrowserService.getAXTree(pageId);
          const sideEffects = cdpBrowserService.consumeSideEffects(pageId);
          const text =
            sideEffects.length > 0
              ? axTree + "\n\nSide effects:\n" + sideEffects.join("\n")
              : axTree;
          return { content: [{ type: "text" as const, text }] };
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
        "scroll",
        "Scroll the page in a direction (up, down, left, right).",
        {
          direction: z.enum(["up", "down", "left", "right"]),
          pages: z.number().int().positive().optional(),
          pageId: z.string().optional(),
        },
        async (input) => {
          const pageId =
            input.pageId ?? cdpBrowserService.getActivePageId(threadId);
          if (!pageId) {
            return {
              content: [
                { type: "text" as const, text: "No active browser page." },
              ],
              isError: true,
            };
          }
          await cdpBrowserService.scroll(
            pageId,
            input.direction,
            input.pages ?? 1,
          );
          const sideEffects = cdpBrowserService.consumeSideEffects(pageId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: true, sideEffects }),
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
        "poll_events",
        "Poll for browser events since a sequence cursor. Returns events array and next cursor.",
        {
          afterSequence: z.number().int().nonnegative().optional(),
          limit: z.number().int().positive().optional(),
          pageId: z.string().optional(),
        },
        async (input) => {
          const pageId =
            input.pageId ?? cdpBrowserService.getActivePageId(threadId);
          if (!pageId) {
            return {
              content: [
                { type: "text" as const, text: "No active browser page." },
              ],
              isError: true,
            };
          }
          const result = await cdpBrowserService.pollEvents(
            pageId,
            input.afterSequence,
            input.limit ?? 50,
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
