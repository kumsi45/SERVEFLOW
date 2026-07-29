import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";

export type QueuedReviewPhoto = {
  id: string;
  restaurantId: string;
  extractionId: string;
  itemId: string;
  file: Blob;
  fileName: string;
  contentType: string;
  createdAt: string;
};

const DATABASE_NAME = "serveflow-review-studio";
const STORE_NAME = "photo-uploads";
const WORKSPACE_STORE_NAME = "add-item-workspace-photos";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(WORKSPACE_STORE_NAME)) {
        request.result.createObjectStore(WORKSPACE_STORE_NAME, { keyPath: "restaurantId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAddItemWorkspacePhoto(restaurantId: string, file: File) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_STORE_NAME, "readwrite");
    transaction.objectStore(WORKSPACE_STORE_NAME).put({ restaurantId, file, fileName: file.name, contentType: file.type, updatedAt: new Date().toISOString() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function readAddItemWorkspacePhoto(restaurantId: string) {
  const database = await openDatabase();
  const result = await new Promise<{ file: Blob; fileName: string; contentType: string } | null>((resolve, reject) => {
    const request = database.transaction(WORKSPACE_STORE_NAME, "readonly").objectStore(WORKSPACE_STORE_NAME).get(restaurantId);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return result ? new File([result.file], result.fileName, { type: result.contentType }) : null;
}

export async function clearAddItemWorkspacePhoto(restaurantId: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_STORE_NAME, "readwrite");
    transaction.objectStore(WORKSPACE_STORE_NAME).delete(restaurantId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function queueReviewPhoto(restaurantId: string, extractionId: string, itemId: string, file: File) {
  const entry: QueuedReviewPhoto = {
    id: createBrowserUuid(), restaurantId, extractionId, itemId, file,
    fileName: file.name, contentType: file.type, createdAt: new Date().toISOString(),
  };
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(entry);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  return entry;
}

export async function listQueuedReviewPhotos(restaurantId: string) {
  const database = await openDatabase();
  const entries = await new Promise<QueuedReviewPhoto[]>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as QueuedReviewPhoto[]).filter((entry) => entry.restaurantId === restaurantId));
    request.onerror = () => reject(request.error);
  });
  database.close();
  return entries;
}

export async function removeQueuedReviewPhoto(id: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
