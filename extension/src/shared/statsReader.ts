export interface SurfaceStats {
  todayEarned: number;
  totalFocusMinutes: number;
  streak: number;
}

interface StatsResponse {
  ok: boolean;
  stats?: SurfaceStats;
  error?: string;
}

function sendMessage(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError !== undefined) {
        reject(new Error(lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

export async function readSurfaceStats(): Promise<SurfaceStats> {
  const response = (await sendMessage({ type: "pomo:stats" })) as StatsResponse | undefined;
  if (response === undefined || response.ok !== true || response.stats === undefined) {
    throw new Error(response?.error ?? "stats request failed");
  }
  return response.stats;
}
