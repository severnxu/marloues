import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { McpServerConfig } from "@shared/types";

const MCP_PROBE_TIMEOUT_MS = 5_000;

interface McpJsonRpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
}

interface McpProbeSuccess {
  ok: true;
  tools: string[];
  message: string;
  probeTool?: string;
  probeResult?: string;
}

interface McpProbeFailure {
  ok: false;
  error: string;
}

export type McpProbeResult = McpProbeSuccess | McpProbeFailure;

export async function probeMcpServer(server: McpServerConfig): Promise<McpProbeResult> {
  const validationError = validateMcpServerConfig(server.config);
  if (validationError) return { ok: false, error: validationError };

  const config = asRecord(server.config) ?? {};
  const command = stringValue(config.command);
  if (!command) return probeRemoteMcp(config, server.tools ?? []);

  return probeStdioMcp(config);
}

export function validateMcpServerConfig(config: unknown): string | null {
  if (!config || typeof config !== "object") return "MCP 配置必须是对象。";
  const record = config as Record<string, unknown>;
  const hasCommand = typeof record.command === "string" && record.command.trim().length > 0;
  const hasUrl = typeof record.url === "string" && record.url.trim().length > 0;
  if (!hasCommand && !hasUrl) return "MCP 配置需要 command 或 url。";
  if (record.args !== undefined && !Array.isArray(record.args)) return "MCP args 必须是字符串数组。";
  if (Array.isArray(record.args) && record.args.some((arg) => typeof arg !== "string")) {
    return "MCP args 只能包含字符串。";
  }
  if (record.env !== undefined && (!record.env || typeof record.env !== "object" || Array.isArray(record.env))) {
    return "MCP env 必须是对象。";
  }
  if (record.headers !== undefined && (!record.headers || typeof record.headers !== "object" || Array.isArray(record.headers))) {
    return "MCP headers 必须是对象。";
  }
  if (hasUrl) {
    try {
      const url = new URL(record.url as string);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "MCP url 必须是 http(s) 地址。";
    } catch {
      return "MCP url 不是有效地址。";
    }
  }
  return null;
}

async function probeRemoteMcp(config: Record<string, unknown>, fallbackTools: string[]): Promise<McpProbeResult> {
  const url = stringValue(config.url);
  if (!url) return { ok: false, error: "Remote MCP config requires a url." };
  const type = stringValue(config.type);
  const headers = headerRecord(config.headers);
  try {
    const endpoint = type === "sse" ? await discoverSseMessageEndpoint(url, headers) : url;
    const initialize = await remoteJsonRpcRequest(endpoint, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "marloues", version: "0.1.0" },
    }, headers);
    const toolsResponse = await remoteJsonRpcRequest(endpoint, "tools/list", {}, headers);
    const tools = extractToolNames(toolsResponse);
    const serverName = extractServerName(initialize);
    return {
      ok: true,
      tools: tools.length ? tools : fallbackTools,
      message: `${serverName ? `${serverName} ` : ""}${type === "sse" ? "SSE " : "HTTP "}initialize/tools.list ok, discovered ${tools.length || fallbackTools.length} tools.`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
async function remoteJsonRpcRequest(
  url: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`MCP ${method} HTTP ${response.status}: ${body.slice(0, 300)}`);
    const message = parseJsonRpcResponse(body, response.headers.get("content-type") ?? "");
    if (message.error) throw new Error(message.error.message || `MCP ${method} failed`);
    return message.result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`MCP ${method} timed out`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverSseMessageEndpoint(url: string, headers: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream", ...headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MCP SSE HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const text = await readSsePrefix(response, MCP_PROBE_TIMEOUT_MS);
    const endpoint = extractSseEndpoint(text);
    return endpoint ? new URL(endpoint, url).toString() : url;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("MCP SSE endpoint discovery timed out", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readSsePrefix(response: Response, timeoutMs: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const startedAt = Date.now();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (Date.now() - startedAt < timeoutMs) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes("\n\n") || text.includes("\r\n\r\n")) break;
    }
    return text + decoder.decode();
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

function parseJsonRpcResponse(body: string, contentType: string): McpJsonRpcMessage {
  const text = contentType.includes("text/event-stream") ? extractFirstSseData(body) : body;
  const parsed = JSON.parse(text) as McpJsonRpcMessage;
  if (!parsed || typeof parsed !== "object") throw new Error("MCP response is not a JSON-RPC object");
  return parsed;
}

function extractSseEndpoint(text: string): string {
  const events = splitSseEvents(text);
  for (const event of events) {
    if (event.event === "endpoint" && event.data.trim()) return event.data.trim();
  }
  return "";
}

function extractFirstSseData(text: string): string {
  const event = splitSseEvents(text).find((item) => item.data.trim());
  if (!event) throw new Error("MCP SSE response did not include data");
  return event.data;
}

function splitSseEvents(text: string): Array<{ event: string; data: string }> {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const eventLines = lines
        .filter((line) => line.startsWith("event:"))
        .map((line) => line.slice("event:".length).trim());
      const event = eventLines[eventLines.length - 1] ?? "";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      return { event, data };
    })
    .filter((event) => event.event || event.data);
}

interface StdioMcpConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export function normalizeStdioMcpConfig(
  config: Record<string, unknown>,
  platform: NodeJS.Platform = process.platform,
): StdioMcpConfig {
  const command = stringValue(config.command);
  const args = Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === "string") : [];
  const env = envRecord(config.env);
  const cwd = stringValue(config.cwd) || undefined;
  if (platform !== "win32" || !isWindowsPackageRunner(command)) return { command, args, env, cwd };
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
    env,
    cwd,
  };
}

function isWindowsPackageRunner(command: string): boolean {
  return command === "npx" || command === "npm" || command === "pnpm" || command === "yarn";
}

async function probeStdioMcp(config: Record<string, unknown>): Promise<McpProbeResult> {
  const stdio = normalizeStdioMcpConfig(config);
  const child = spawn(stdio.command, stdio.args, {
    cwd: stdio.cwd,
    env: { ...process.env, ...stdio.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const client = new StdioJsonRpcClient(child);

  try {
    const initialize = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "marloues", version: "0.1.0" },
    });
    client.notify("notifications/initialized", {});
    const toolsResponse = await client.request("tools/list", {});
    const toolEntries = extractToolEntries(toolsResponse);
    const tools = toolEntries.map((tool) => tool.name).sort((a, b) => a.localeCompare(b));
    const serverName = extractServerName(initialize);
    const prefix = `${serverName ? `${serverName} ` : ""}initialize/tools.list ok, discovered ${tools.length} tools.`;
    const callableTool = selectCallableMcpToolForProbe(toolEntries);
    if (!callableTool) {
      const probeResult = tools.length
        ? "Skipped tools/call: discovered tools require arguments."
        : "Skipped tools/call: no tools were advertised.";
      return {
        ok: true,
        tools,
        message: `${prefix} ${probeResult}`,
        probeResult,
      };
    }

    const callResult = await client.request("tools/call", { name: callableTool.name, arguments: {} });
    const probeResult = stringifyMcpCallResult(callResult);
    return {
      ok: true,
      tools,
      message: `${prefix} tools/call ${callableTool.name} ok.`,
      probeTool: callableTool.name,
      probeResult,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    client.dispose();
  }
}

class StdioJsonRpcClient {
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private stderr = "";

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-2_000);
    });
    child.on("error", (error) => this.rejectAll(error instanceof Error ? error : new Error(String(error))));
    child.on("exit", (code, signal) => {
      if (this.pending.size === 0) return;
      this.rejectAll(new Error(`MCP process exited before response: code=${code ?? "null"} signal=${signal ?? "null"} ${this.stderr}`.trim()));
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.child.stdin.write(`${payload}\n`);
    return withTimeout(
      new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
      }),
      MCP_PROBE_TIMEOUT_MS,
      `MCP ${method} timed out`,
    );
  }

  notify(method: string, params: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  dispose(): void {
    this.rejectAll(new Error("MCP probe disposed"));
    this.child.kill();
  }

  private onStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.consumeNextMessage()) {
      // Keep draining buffered newline-delimited or Content-Length framed messages.
    }
  }

  private consumeNextMessage(): boolean {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    const newlineEnd = this.buffer.indexOf("\n");
    if (headerEnd >= 0 && (newlineEnd < 0 || headerEnd < newlineEnd)) {
      const header = this.buffer.slice(0, headerEnd).toString("utf-8");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        return true;
      }
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return false;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf-8");
      this.buffer = this.buffer.slice(bodyEnd);
      this.handleMessage(body);
      return true;
    }
    if (newlineEnd < 0) return false;
    const line = this.buffer.slice(0, newlineEnd).toString("utf-8").trim();
    this.buffer = this.buffer.slice(newlineEnd + 1);
    if (line) this.handleMessage(line);
    return true;
  }

  private handleMessage(body: string): void {
    let message: McpJsonRpcMessage;
    try {
      message = JSON.parse(body) as McpJsonRpcMessage;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message || `MCP request ${message.id} failed`));
      return;
    }
    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  return new Promise<T>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        if (timeout) clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

interface McpToolEntry {
  name: string;
  inputSchema?: unknown;
}

function extractToolNames(value: unknown): string[] {
  return extractToolEntries(value).map((tool) => tool.name).sort((a, b) => a.localeCompare(b));
}

function extractToolEntries(value: unknown): McpToolEntry[] {
  const record = asRecord(value);
  const tools = Array.isArray(record?.tools) ? record.tools : [];
  const byName = new Map<string, McpToolEntry>();
  for (const tool of tools) {
    const toolRecord = asRecord(tool);
    const name = stringValue(toolRecord?.name);
    if (!name || byName.has(name)) continue;
    byName.set(name, { name, inputSchema: toolRecord?.inputSchema });
  }
  return Array.from(byName.values());
}

export function selectCallableMcpToolForProbe(tools: McpToolEntry[]): McpToolEntry | undefined {
  return tools.find((tool) => canCallWithoutArguments(tool.inputSchema));
}

function canCallWithoutArguments(inputSchema: unknown): boolean {
  const schema = asRecord(inputSchema);
  if (!schema) return true;
  const required = schema.required;
  return !Array.isArray(required) || required.length === 0;
}

function stringifyMcpCallResult(result: unknown): string {
  const record = asRecord(result);
  if (!record) return formatProbeValue(result);
  if (record.isError) throw new Error(`MCP tools/call returned an error: ${formatProbeValue(result)}`);
  const content = Array.isArray(record.content) ? record.content : undefined;
  if (!content) return formatProbeValue(result);
  const text = content
    .map((item) => {
      const itemRecord = asRecord(item);
      if (itemRecord?.type === "text" && typeof itemRecord.text === "string") return itemRecord.text;
      return formatProbeValue(item);
    })
    .filter(Boolean)
    .join("\n");
  return text || formatProbeValue(result);
}

function formatProbeValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function extractServerName(value: unknown): string {
  const info = asRecord(asRecord(value)?.serverInfo);
  return stringValue(info?.name);
}

function envRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => Boolean(key.trim()))
      .map(([key, item]) => [key, String(item)]),
  );
}

function headerRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .filter(([key]) => Boolean(key.trim())),
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
