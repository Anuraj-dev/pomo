import { indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = (await import("fake-indexeddb")).IDBKeyRange;
