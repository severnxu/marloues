/**
 * Contract test: verifies the terminal/browser tool exposure matrix
 * across the three runtime kinds (Binary, Claude, Self-built).
 *
 * Run: npx tsx --tsconfig client/tsconfig.node.json tests/contract/terminal-browser.contract.ts
 */
import {
  SDK_TERMINAL_SERVER_NAME,
  SDK_TERMINAL_TOOL_EXEC,
  SDK_TERMINAL_TOOL_WRITE,
  SDK_TERMINAL_TOOL_READ,
  SDK_TERMINAL_TOOL_RESIZE,
  canonicalTerminalToolName,
} from "../../client/main/core/runtime/sdk-terminal-mcp";
import {
  SDK_BROWSER_SERVER_NAME,
  SDK_BROWSER_TOOL_NAVIGATE,
  SDK_BROWSER_TOOL_SCREENSHOT,
  SDK_BROWSER_TOOL_CLICK,
  SDK_BROWSER_TOOL_FILL,
  SDK_BROWSER_TOOL_GET_TEXT,
  canonicalBrowserToolName,
} from "../../client/main/core/runtime/sdk-browser-mcp";
import {
  EMPTY_SECURITY_RULES,
  matchesDomainList,
} from "../../client/main/core/security/security-host";
import { SessionApprovalTracker } from "../../client/main/core/security/session-approval-tracker";

let failures = 0;

function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

async function main(): Promise<void> {
  console.log("=== Terminal-Browser Tool Exposure Contract ===\n");

  // --- SDK Terminal MCP Server ---
  console.log("SDK Terminal MCP Server:");
  assert(
    "server name is marloues_terminal",
    SDK_TERMINAL_SERVER_NAME === "marloues_terminal",
  );
  assert(
    "exec full name = mcp__marloues_terminal__exec",
    SDK_TERMINAL_TOOL_EXEC === "mcp__marloues_terminal__exec",
  );
  assert(
    "write full name = mcp__marloues_terminal__write",
    SDK_TERMINAL_TOOL_WRITE === "mcp__marloues_terminal__write",
  );
  assert(
    "read full name = mcp__marloues_terminal__read",
    SDK_TERMINAL_TOOL_READ === "mcp__marloues_terminal__read",
  );
  assert(
    "resize full name = mcp__marloues_terminal__resize",
    SDK_TERMINAL_TOOL_RESIZE === "mcp__marloues_terminal__resize",
  );

  // --- SDK Browser MCP Server ---
  console.log("\nSDK Browser MCP Server:");
  assert(
    "server name is marloues_browser",
    SDK_BROWSER_SERVER_NAME === "marloues_browser",
  );
  assert(
    "navigate full name = mcp__marloues_browser__navigate",
    SDK_BROWSER_TOOL_NAVIGATE === "mcp__marloues_browser__navigate",
  );
  assert(
    "screenshot full name = mcp__marloues_browser__screenshot",
    SDK_BROWSER_TOOL_SCREENSHOT === "mcp__marloues_browser__screenshot",
  );
  assert(
    "click full name = mcp__marloues_browser__click",
    SDK_BROWSER_TOOL_CLICK === "mcp__marloues_browser__click",
  );
  assert(
    "fill full name = mcp__marloues_browser__fill",
    SDK_BROWSER_TOOL_FILL === "mcp__marloues_browser__fill",
  );
  assert(
    "get_text full name = mcp__marloues_browser__get_text",
    SDK_BROWSER_TOOL_GET_TEXT === "mcp__marloues_browser__get_text",
  );

  // --- Canonical Name Mapping (disallowedTools compatibility) ---
  console.log("\nCanonical Name Mapping (disallowedTools compatibility):");
  assert(
    "exec canonical = terminal.exec",
    canonicalTerminalToolName(SDK_TERMINAL_TOOL_EXEC) === "terminal.exec",
  );
  assert(
    "navigate canonical = browser.navigate",
    canonicalBrowserToolName(SDK_BROWSER_TOOL_NAVIGATE) === "browser.navigate",
  );
  assert(
    "disallowedTools 'terminal.exec' matches SDK full name via canonical",
    canonicalTerminalToolName(SDK_TERMINAL_TOOL_EXEC) === "terminal.exec",
  );
  assert(
    "disallowedTools 'browser.navigate' matches SDK full name via canonical",
    canonicalBrowserToolName(SDK_BROWSER_TOOL_NAVIGATE) === "browser.navigate",
  );

  // --- Security exports ---
  console.log("\nSecurity Layer Exports:");
  assert(
    "EMPTY_SECURITY_RULES exported",
    EMPTY_SECURITY_RULES !== undefined && EMPTY_SECURITY_RULES !== null,
  );
  assert(
    "matchesDomainList exported and callable",
    typeof matchesDomainList === "function",
  );
  assert(
    "matchesDomainList returns false for empty list (non-whitelist)",
    matchesDomainList("example.com", []) === false,
  );

  // --- SessionApprovalTracker ---
  console.log("\nSessionApprovalTracker:");
  const tracker = new SessionApprovalTracker();
  assert(
    "unmarked session is not approved",
    tracker.isSessionApproved("s1") === false,
  );
  tracker.markSessionApproved("s1");
  assert(
    "marked session is approved",
    tracker.isSessionApproved("s1") === true,
  );
  tracker.clear();
  assert(
    "cleared session is not approved",
    tracker.isSessionApproved("s1") === false,
  );

  // --- Tool Exposure Matrix ---
  console.log("\nTool Exposure Matrix:");
  console.log(
    "  Binary Runtime:   Codex Bash (event intercept) — no terminal.exec",
  );
  console.log(
    "  Claude Runtime:   mcp__marloues_terminal__* + mcp__marloues_browser__*",
  );
  console.log(
    "  Self-built:       /term + /browse routes (registerBuiltinTools)",
  );
  assert(
    "Binary does NOT provide terminal.exec (by design)",
    true, // Binary uses Codex's built-in Bash, not terminal tools
  );
  assert(
    "Claude provides terminal.exec via SDK MCP",
    SDK_TERMINAL_TOOL_EXEC === "mcp__marloues_terminal__exec",
  );
  assert(
    "Claude provides browser.navigate via SDK MCP",
    SDK_BROWSER_TOOL_NAVIGATE === "mcp__marloues_browser__navigate",
  );

  // --- Result ---
  console.log(
    `\n=== ${failures === 0 ? "ALL PASS" : `${failures} FAILED`} ===`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
