import type { CodexTransport } from "./connection";
import { log as clog } from "../../logger";

let idCounter = 0;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class JsonRpcClient {
  private transport: CodexTransport;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  constructor(transport: CodexTransport) {
    this.transport = transport;
    // Wire up response handling from stdout
    this.transport.onResponse((msg: unknown) => this.handleResponse(msg));
  }

  private handleResponse(msg: unknown): void {
    const response = msg as JsonRpcResponse;
    if (response && typeof response.id === "number" && response.id !== 0) {
      const pending = this.pending.get(response.id);
      if (pending) {
        this.pending.delete(response.id);
        if (response.error) {
          clog(`[rpc] response error id=${response.id}:`, response.error);
          pending.reject(new Error(response.error.message));
        } else {
          clog(`[rpc] response ok id=${response.id}`);
          pending.resolve(response.result);
        }
      }
    }
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = ++idCounter;

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      clog(`[rpc] request id=${id} method=${method}`);
      this.transport.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  notify(method: string, params?: unknown): void {
    const msg = {
      jsonrpc: "2.0" as const,
      method,
      params,
    };
    clog(`[rpc] notify method=${method}`);
    this.transport.stdin.write(JSON.stringify(msg) + "\n");
  }

  respond(id: string | number, result: unknown): void {
    clog(`[rpc] server response id=${id}`);
    this.transport.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n",
    );
  }

  respondError(id: string | number, code: number, message: string): void {
    clog(`[rpc] server response error id=${id} code=${code}`);
    this.transport.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n",
    );
  }

  isOpen(): boolean {
    return this.transport.isAlive();
  }
}
