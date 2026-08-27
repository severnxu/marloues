import { describe, expect, it } from "vitest";
import {
  canonicalTerminalToolName,
  SDK_TERMINAL_TOOL_EXEC,
  SDK_TERMINAL_TOOL_WRITE,
  SDK_TERMINAL_TOOL_READ,
  SDK_TERMINAL_TOOL_RESIZE,
} from "../../client/main/core/runtime/sdk-terminal-mcp";
import {
  canonicalBrowserToolName,
  SDK_BROWSER_TOOL_NAVIGATE,
  SDK_BROWSER_TOOL_SCREENSHOT,
  SDK_BROWSER_TOOL_CLICK,
  SDK_BROWSER_TOOL_FILL,
  SDK_BROWSER_TOOL_GET_TEXT,
} from "../../client/main/core/runtime/sdk-browser-mcp";

describe("canonicalTerminalToolName", () => {
  it("maps full MCP exec name to canonical short name", () => {
    expect(canonicalTerminalToolName(SDK_TERMINAL_TOOL_EXEC)).toBe(
      "terminal.exec",
    );
  });

  it("maps full MCP write name to canonical short name", () => {
    expect(canonicalTerminalToolName(SDK_TERMINAL_TOOL_WRITE)).toBe(
      "terminal.write",
    );
  });

  it("maps full MCP read name to canonical short name", () => {
    expect(canonicalTerminalToolName(SDK_TERMINAL_TOOL_READ)).toBe(
      "terminal.read",
    );
  });

  it("maps full MCP resize name to canonical short name", () => {
    expect(canonicalTerminalToolName(SDK_TERMINAL_TOOL_RESIZE)).toBe(
      "terminal.resize",
    );
  });

  it("passes through unknown tool names unchanged", () => {
    expect(canonicalTerminalToolName("unknown.tool")).toBe("unknown.tool");
  });

  it("passes through already-canonical names unchanged", () => {
    expect(canonicalTerminalToolName("terminal.exec")).toBe("terminal.exec");
  });
});

describe("canonicalBrowserToolName", () => {
  it("maps full MCP navigate name to canonical short name", () => {
    expect(canonicalBrowserToolName(SDK_BROWSER_TOOL_NAVIGATE)).toBe(
      "browser.navigate",
    );
  });

  it("maps full MCP screenshot name to canonical short name", () => {
    expect(canonicalBrowserToolName(SDK_BROWSER_TOOL_SCREENSHOT)).toBe(
      "browser.screenshot",
    );
  });

  it("maps full MCP click name to canonical short name", () => {
    expect(canonicalBrowserToolName(SDK_BROWSER_TOOL_CLICK)).toBe(
      "browser.click",
    );
  });

  it("maps full MCP fill name to canonical short name", () => {
    expect(canonicalBrowserToolName(SDK_BROWSER_TOOL_FILL)).toBe(
      "browser.fill",
    );
  });

  it("maps full MCP get_text name to canonical short name", () => {
    expect(canonicalBrowserToolName(SDK_BROWSER_TOOL_GET_TEXT)).toBe(
      "browser.get_text",
    );
  });

  it("passes through unknown tool names unchanged", () => {
    expect(canonicalBrowserToolName("unknown.tool")).toBe("unknown.tool");
  });

  it("passes through already-canonical names unchanged", () => {
    expect(canonicalBrowserToolName("browser.navigate")).toBe(
      "browser.navigate",
    );
  });
});

describe("chained canonical mapping (SecurityHost flow)", () => {
  // In canUseTool, names go through: SDK security → browser → terminal mapping
  it("SDK terminal full name → terminal canonical", () => {
    const sdkName = SDK_TERMINAL_TOOL_EXEC; // mcp__marloues_terminal__exec
    const afterBrowser = canonicalBrowserToolName(sdkName); // passthrough
    const afterTerminal = canonicalTerminalToolName(afterBrowser);
    expect(afterTerminal).toBe("terminal.exec");
  });

  it("SDK browser full name → browser canonical", () => {
    const sdkName = SDK_BROWSER_TOOL_NAVIGATE; // mcp__marloues_browser__navigate
    const afterBrowser = canonicalBrowserToolName(sdkName);
    const afterTerminal = canonicalTerminalToolName(afterBrowser); // passthrough
    expect(afterTerminal).toBe("browser.navigate");
  });

  it("disallowedTools canonical name matches SDK full name after mapping", () => {
    // User configures "terminal.exec" in disallowedTools
    // SDK full name is mcp__marloues_terminal__exec
    // canonicalTerminalToolName(full) === "terminal.exec" → match
    const userConfig = "terminal.exec";
    const sdkFullName = SDK_TERMINAL_TOOL_EXEC;
    expect(canonicalTerminalToolName(sdkFullName)).toBe(userConfig);
  });
});
