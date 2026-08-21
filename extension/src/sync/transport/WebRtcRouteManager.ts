export interface IceProviderConfig { readonly stunUrls: readonly string[]; readonly turnUrls: readonly string[]; readonly turnUsername?: string; readonly turnCredential?: string }
export type IceRouteClass = "DIRECT_HOST" | "DIRECT_SERVER_REFLEXIVE" | "RELAYED_TURN_UDP" | "RELAYED_TURN_TCP_TLS";
export interface DurableRouteObligation { readonly peerDeviceId: string; readonly operationId: string }

export function orderedIceServers(config: IceProviderConfig): readonly RTCIceServer[] {
  const direct = config.stunUrls.map((urls) => ({ urls }));
  const relayed = config.turnUrls.map((urls) => ({ urls, username: config.turnUsername, credential: config.turnCredential }));
  return [...direct, ...relayed];
}

export function classifyCandidate(candidateType: RTCIceCandidateType, protocol: RTCIceProtocol, url: string | null): IceRouteClass {
  if (candidateType === "host") return "DIRECT_HOST";
  if (candidateType === "srflx") return "DIRECT_SERVER_REFLEXIVE";
  if (candidateType !== "relay") throw new Error("unsupported ICE route");
  return protocol === "udp" ? "RELAYED_TURN_UDP" : "RELAYED_TURN_TCP_TLS";
}

export async function ensureWebRtcOffscreenDocument(): Promise<void> {
  const url = chrome.runtime.getURL("offscreen-webrtc.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (contexts.length === 0) await chrome.offscreen.createDocument({ url, reasons: [chrome.offscreen.Reason.WEB_RTC], justification: "Authenticated Full Replica peer synchronization" });
}

export function reconstructRoutePeers(obligations: readonly DurableRouteObligation[]): readonly string[] {
  return [...new Set(obligations.map((obligation) => obligation.peerDeviceId))].sort();
}
