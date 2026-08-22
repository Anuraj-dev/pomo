type RouteMessage =
  | { readonly type: "POMO_WEBRTC_OPEN"; readonly routeId: string; readonly iceServers: readonly RTCIceServer[]; readonly remoteDescription?: RTCSessionDescriptionInit }
  | { readonly type: "POMO_WEBRTC_CANDIDATE"; readonly routeId: string; readonly candidate: RTCIceCandidateInit }
  | { readonly type: "POMO_WEBRTC_SEND"; readonly routeId: string; readonly bytes: number[] }
  | { readonly type: "POMO_WEBRTC_CLOSE"; readonly routeId: string };

const routes = new Map<string, { peer: RTCPeerConnection; channel: RTCDataChannel | null }>();

chrome.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
  void handle(message as RouteMessage).then(respond, (error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : "route failed" }));
  return true;
});

async function handle(message: RouteMessage): Promise<unknown> {
  if (message.type === "POMO_WEBRTC_OPEN") {
    if (routes.has(message.routeId)) return { ok: true, resumed: true };
    const peer = new RTCPeerConnection({ iceServers: [...message.iceServers] });
    const state = { peer, channel: null as RTCDataChannel | null };
    routes.set(message.routeId, state);
    peer.ondatachannel = (event) => bind(message.routeId, state, event.channel);
    peer.onicecandidate = (event) => { if (event.candidate !== null) void chrome.runtime.sendMessage({ type: "POMO_WEBRTC_LOCAL_CANDIDATE", routeId: message.routeId, candidate: event.candidate.toJSON() }); };
    peer.onconnectionstatechange = () => { void chrome.runtime.sendMessage({ type: "POMO_WEBRTC_STATE", routeId: message.routeId, state: peer.connectionState }); };
    try {
      if (message.remoteDescription === undefined) {
        bind(message.routeId, state, peer.createDataChannel("pomo-sync", { ordered: true }));
        await peer.setLocalDescription(await peer.createOffer());
      } else {
        await peer.setRemoteDescription(message.remoteDescription);
        await peer.setLocalDescription(await peer.createAnswer());
      }
    } catch (error) {
      state.channel?.close();
      peer.close();
      routes.delete(message.routeId);
      throw error;
    }
    return { ok: true, description: peer.localDescription };
  }
  const state = routes.get(message.routeId);
  if (state === undefined) throw new Error("unknown WebRTC route");
  if (message.type === "POMO_WEBRTC_CANDIDATE") { await state.peer.addIceCandidate(message.candidate); return { ok: true }; }
  if (message.type === "POMO_WEBRTC_SEND") {
    if (state.channel?.readyState !== "open" || state.channel.bufferedAmount > 1_048_576) throw new Error("WebRTC backpressure");
    state.channel.send(new Uint8Array(message.bytes)); return { ok: true };
  }
  state.channel?.close(); state.peer.close(); routes.delete(message.routeId); return { ok: true };
}

function openInbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pomo-webrtc-inbox", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("inbox")) request.result.createObjectStore("inbox", { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function stageInbound(routeId: string, bytes: number[]): Promise<void> {
  const db = await openInbox();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("inbox", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("inbox").put({ routeId, bytes, receivedAt: Date.now() });
    });
  } finally {
    db.close();
  }
}

function bind(routeId: string, state: { channel: RTCDataChannel | null }, channel: RTCDataChannel): void {
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = 262_144;
  channel.onmessage = (event) => {
    if (!(event.data instanceof ArrayBuffer)) return;
    const bytes = [...new Uint8Array(event.data)];
    void stageInbound(routeId, bytes).then(() => chrome.runtime.sendMessage({ type: "POMO_WEBRTC_BYTES", routeId, bytes }));
  };
  state.channel = channel;
}
