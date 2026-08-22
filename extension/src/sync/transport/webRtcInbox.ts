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
