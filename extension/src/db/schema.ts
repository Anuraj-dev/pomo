export const DB_NAME = "pomo";

export const SCHEMA_VERSION = 7;

type IndexDef = readonly [name: string, keyPath: string | string[]];

function ensureStore(
  db: IDBDatabase,
  transaction: IDBTransaction,
  name: string,
  options: IDBObjectStoreParameters,
  indexes: readonly IndexDef[],
): void {
  let store: IDBObjectStore;
  if (!db.objectStoreNames.contains(name)) {
    store = db.createObjectStore(name, options);
  } else {
    store = transaction.objectStore(name);
  }
  for (const [indexName, keyPath] of indexes) {
    if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath);
  }
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction!;
      if (event.oldVersion < 2) {
        if (db.objectStoreNames.contains("settings")) db.deleteObjectStore("settings");
      }
      ensureStore(db, transaction, "sessions", { keyPath: "start" }, [["date", "date"]]);
      ensureStore(db, transaction, "dayStats", { keyPath: "date" }, []);
      const staleStores = [
        "crewSnapshots",
        "crewDailyAggregates",
        "crewHiddenMembers",
        "crewRelayState",
        "syncOperations",
        "syncFeedHeads",
        "syncPreferences",
        "syncOutbox",
        "syncDispositionEvents",
        "syncMemberIdentity",
        "syncDeviceAuthorities",
        "syncLocalDeviceKeys",
        "syncAdmissions",
        "syncAuthorizationEvents",
        "syncContentEpochs",
        "syncCheckpointOperations",
        "syncCheckpointProjection",
      ];
      for (const name of staleStores) {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("indexedDB open blocked"));
  });
}
