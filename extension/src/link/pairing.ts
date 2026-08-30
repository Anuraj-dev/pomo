import { DEFAULT_PORT } from "./constants";

export interface ParsedPairing {
  host?: string;
  port?: number;
  token?: string;
}

export interface Pairing {
  host: string;
  port: number;
  token: string;
}

export function parsePairingPayload(value: unknown): ParsedPairing {
  let source: unknown = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length === 0) return {};
    try {
      source = JSON.parse(text) as unknown;
    } catch {
      return {};
    }
  }
  if (typeof source !== "object" || source === null || Array.isArray(source)) return {};
  const record = source as Record<string, unknown>;
  const out: ParsedPairing = {};
  const tokenRaw = record.token;
  const token = tokenRaw === undefined || tokenRaw === null ? "" : String(tokenRaw).trim();
  if (token.length > 0) out.token = token;

  let urlHost: string | undefined;
  const url = record.url;
  if (typeof url === "string" && url.trim().length > 0) {
    try {
      const parsed = new URL(url.trim());
      const host = parsed.hostname;
      const port = parsed.port.length > 0 ? Number(parsed.port) : DEFAULT_PORT;
      if (host.length > 0) {
        urlHost = host;
        out.host = host;
        out.port = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
      }
    } catch {
      // Ignore a malformed url field; discrete host/port may still pair.
    }
  }

  let hostOverride = "";
  if (Object.hasOwn(record, "host")) {
    hostOverride = String(record.host ?? "").trim();
    if (hostOverride.length > 0) out.host = hostOverride;
    else if (urlHost === undefined) out.host = "";
  }
  if (Object.hasOwn(record, "port") && record.port !== "" && record.port !== null && record.port !== undefined) {
    const port = typeof record.port === "number" ? record.port : Number(record.port);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      if (urlHost === undefined || hostOverride.length > 0) out.port = port;
    }
  }
  return out;
}

export function pairingFromParsed(parsed: ParsedPairing, previous?: Pairing | null): Pairing | null {
  const host = parsed.host ?? previous?.host ?? "";
  const port = parsed.port ?? previous?.port ?? DEFAULT_PORT;
  const token = parsed.token ?? previous?.token ?? "";
  if (host.length === 0 || token.length === 0) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, token };
}

export function phoneOrigin(pairing: Pairing): string {
  const host = pairing.host.includes(":") && !pairing.host.startsWith("[") ? `[${pairing.host}]` : pairing.host;
  return `http://${host}:${pairing.port}`;
}

export function phoneWsUrl(pairing: Pairing): string {
  return `${phoneOrigin(pairing).replace(/^http/u, "ws")}/ws`;
}

export function hostPermissionOrigins(pairing: Pairing): string[] {
  const origin = phoneOrigin(pairing);
  return [`${origin}/*`];
}
