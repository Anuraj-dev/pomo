import { HTTP_FLUSH_TIMEOUT_MS, HTTP_TIMEOUT_MS } from "./constants";
import { phoneOrigin, type Pairing } from "./pairing";

export interface RestResult {
  status: number;
  body: string;
}

export interface RestPort {
  configure(pairing: Pairing): void;
  getStatus(): Promise<RestResult>;
  getConfig(): Promise<RestResult>;
  post(path: string, body?: unknown): Promise<RestResult>;
}

function parseJson(body: string): unknown {
  if (body.trim().length === 0) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

export function jsonOf(result: RestResult): unknown {
  return parseJson(result.body);
}

export class PhoneRest implements RestPort {
  private baseUrl = "";
  private token = "";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  configure(pairing: Pairing): void {
    this.baseUrl = phoneOrigin(pairing);
    this.token = pairing.token;
  }

  getStatus(): Promise<RestResult> {
    return this.request("GET", "/api/status");
  }

  getConfig(): Promise<RestResult> {
    return this.request("GET", "/api/config");
  }

  post(path: string, body?: unknown): Promise<RestResult> {
    const timeout = path === "/api/sessions/import" || path === "/api/timer/adopt" ? HTTP_FLUSH_TIMEOUT_MS : HTTP_TIMEOUT_MS;
    return this.request("POST", path, body, timeout);
  }

  private async request(method: string, path: string, body?: unknown, timeoutMs = HTTP_TIMEOUT_MS): Promise<RestResult> {
    if (this.baseUrl.length === 0) return { status: 0, body: "" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { "X-Pomo-Token": this.token };
    let payload: string | undefined;
    if (body !== undefined) {
      payload = typeof body === "string" ? body : JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: method === "POST" ? (payload ?? "") : undefined,
        signal: controller.signal,
        redirect: "manual",
      });
      return { status: response.status, body: await response.text() };
    } catch {
      return { status: 0, body: "" };
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface SocketHandlers {
  onOpen: () => void;
  onMessage: (text: string) => void;
  onClose: () => void;
}

export interface SocketHandle {
  send(text: string): void;
  close(): void;
}

export type SocketFactory = (url: string, handlers: SocketHandlers) => SocketHandle;

export const browserSocket: SocketFactory = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.addEventListener("open", () => handlers.onOpen());
  ws.addEventListener("message", (event) => handlers.onMessage(String(event.data)));
  ws.addEventListener("close", () => handlers.onClose());
  ws.addEventListener("error", () => handlers.onClose());
  return {
    send: (text) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    },
    close: () => {
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    },
  };
};
