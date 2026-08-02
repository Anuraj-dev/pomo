export const DB_NAME = "pomo";

export const SCHEMA_VERSION = 2;

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains("settings")) db.deleteObjectStore("settings");
      const sessions = db.createObjectStore("sessions", { keyPath: "start" });
      sessions.createIndex("date", "date");
      db.createObjectStore("dayStats", { keyPath: "date" });
      const crewSnapshots = db.createObjectStore("crewSnapshots", { keyPath: ["crewId", "identityPublicKey"] });
      crewSnapshots.createIndex("crewId", "crewId");
      const crewDailyAggregates = db.createObjectStore("crewDailyAggregates", {
        keyPath: ["crewId", "identityPublicKey", "localDate"],
      });
      crewDailyAggregates.createIndex("crewId_key", ["crewId", "identityPublicKey"]);
      const crewHiddenMembers = db.createObjectStore("crewHiddenMembers", { keyPath: ["crewId", "identityPublicKey"] });
      crewHiddenMembers.createIndex("crewId", "crewId");
      db.createObjectStore("crewRelayState", { keyPath: ["crewId", "relayUrl"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("indexedDB open blocked"));
  });
}
