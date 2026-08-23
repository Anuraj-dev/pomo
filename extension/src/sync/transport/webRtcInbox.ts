import type { DrainExchange, DrainRoute } from "./ordinaryDrain";
import type { SyncEnvelope } from "./directSync";
import { classifyCandidate, orderedIceServers, type IceProviderConfig, type IceRouteClass } from "./WebRtcRouteManager";

export interface StagedWebRtcMessage {
  readonly routeId: string;
  readonly bytes: Uint8Array;
  readonly receivedAt: number;
}

export interface WebRtcInboxStore {
  takeAll(): Promise<readonly StagedWebRtcMessage[]> | readonly StagedWebRtcMessage[];
}

/**
 * Drain route that consumes the offscreen WebRTC inbox. Bytes are treated as
 * COSE operation wires for kernel ingest. TURN is optional and recorded via
 * [recordIceRoute].
 */
export function webRtcInboxDrainRoute(input: {
  readonly inbox: WebRtcInboxStore;
  readonly ingest: (wire: Uint8Array) => Promise<string> | string;
  readonly peerDeviceId?: string;
}): DrainRoute {
  const name = input.peerDeviceId === undefined ? "webrtc:inbox" : `webrtc:${input.peerDeviceId}`;
  return {
    name,
    exchange: async (): Promise<DrainExchange> => {
      const staged = await input.inbox.takeAll();
      const inbound: SyncEnvelope[] = [];
      for (const message of staged) {
        await input.ingest(message.bytes.slice());
        inbound.push({
          operationId: `webrtc-${message.routeId}-${message.receivedAt}`,
          feedKey: `webrtc:${message.routeId}`,
          sequence: message.receivedAt,
          wire: message.bytes.slice(),
        });
      }
      return { inbound, connected: true };
    },
  };
}

let lastIceRoute: IceRouteClass | null = null;
let installedWebRtcRoutes: DrainRoute[] = [];
let iceConfig: IceProviderConfig = { stunUrls: [], turnUrls: [] };

export function configureWebRtcIce(config: IceProviderConfig): readonly RTCIceServer[] {
  iceConfig = config;
  return orderedIceServers(config);
}

export function currentWebRtcIceServers(): readonly RTCIceServer[] {
  return orderedIceServers(iceConfig);
}

export function recordIceRoute(candidateType: RTCIceCandidateType, protocol: RTCIceProtocol, url: string | null): IceRouteClass {
  lastIceRoute = classifyCandidate(candidateType, protocol, url);
  return lastIceRoute;
}

export function lastRecordedIceRoute(): IceRouteClass | null {
  return lastIceRoute;
}

export function installWebRtcInboxRoutes(routes: readonly DrainRoute[]): void {
  installedWebRtcRoutes = [...routes];
}

export function webRtcInboxDrainRoutes(): DrainRoute[] {
  return [...installedWebRtcRoutes];
}

export function turnConfigured(): boolean {
  return iceConfig.turnUrls.length > 0;
}

const INBOX_DB = "pomo-webrtc-inbox";
const INBOX_STORE = "inbox";

function openPackagedWebRtcInbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INBOX_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(INBOX_STORE)) {
        request.result.createObjectStore(INBOX_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Reads and clears the offscreen document's durable WebRTC inbox. */
export function packagedWebRtcInbox(): WebRtcInboxStore {
  return {
    async takeAll(): Promise<readonly StagedWebRtcMessage[]> {
      const db = await openPackagedWebRtcInbox();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(INBOX_STORE, "readwrite");
          const store = tx.objectStore(INBOX_STORE);
          let rows: StagedWebRtcMessage[] = [];
          tx.oncomplete = () => resolve(rows);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error("webrtc inbox transaction aborted"));
          const request = store.getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            rows = (request.result as Array<{ routeId: string; bytes: number[]; receivedAt: number }>).map((row) => ({
              routeId: row.routeId,
              bytes: new Uint8Array(row.bytes),
              receivedAt: row.receivedAt,
            }));
            store.clear();
          };
        });
      } finally {
        db.close();
      }
    },
  };
}
