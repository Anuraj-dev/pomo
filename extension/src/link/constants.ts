export const DEFAULT_PORT = 9876;
export const QUEUE_CAPACITY = 32;
export const EXTEND_SECONDS = 300;

export const STALE_AFTER_MS = 20_000;
export const OFFLINE_PROBE_MS = 5_000;
export const RECONNECT_INTERVAL_MS = 5_000;
export const UNPAIRED_RETRY_MS = 300_000;
export const CONFIG_REFRESH_MS = 300_000;
export const CONFIG_RETRY_MS = 60_000;
export const SOFT_RESYNC_MAX = 8;
export const HTTP_TIMEOUT_MS = 2_000;
export const HTTP_FLUSH_TIMEOUT_MS = 5_000;

export const IMPORT_MAX_FUTURE_S = 5 * 60;
export const IMPORT_MAX_AGE_S = 14 * 24 * 60 * 60;

export const SOURCE = "chrome";

export type LinkMode = "BOOT" | "DISCOVERING" | "CONNECTING" | "SYNCED" | "OFFLINE" | "UNPAIRED";
