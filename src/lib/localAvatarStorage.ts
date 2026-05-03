const DB_NAME = 'lumora_local_media';
const STORE_NAME = 'files';
const PROFILE_AVATAR_KEY = 'profile-avatar';

type StoredLocalAvatar = {
  key: string;
  blob: Blob;
  fileName: string;
  contentType: string;
  updatedAt: string;
};

function openLocalMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Local avatar storage is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open local avatar storage.'));
  });
}

function closeDb(db: IDBDatabase) {
  window.setTimeout(() => db.close(), 0);
}

export async function saveLocalProfileAvatar(file: File) {
  const db = await openLocalMediaDb();

  try {
    const record: StoredLocalAvatar = {
      key: PROFILE_AVATAR_KEY,
      blob: file,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      updatedAt: new Date().toISOString(),
    };

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save local avatar.'));
    });

    return {
      storageKey: PROFILE_AVATAR_KEY,
      fileName: file.name,
      url: URL.createObjectURL(file),
    };
  } finally {
    closeDb(db);
  }
}

export async function loadLocalProfileAvatarFile(storageKey = PROFILE_AVATAR_KEY): Promise<File | null> {
  const db = await openLocalMediaDb();

  try {
    const record = await new Promise<StoredLocalAvatar | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(storageKey);
      request.onsuccess = () => resolve(request.result as StoredLocalAvatar | undefined);
      request.onerror = () => reject(request.error ?? new Error('Unable to load local avatar.'));
    });

    if (!record?.blob) return null;

    return new File([record.blob], record.fileName || 'profile-avatar', {
      type: record.contentType || record.blob.type || 'application/octet-stream',
    });
  } finally {
    closeDb(db);
  }
}

export async function loadLocalProfileAvatarUrl(storageKey?: string | null): Promise<string | null> {
  if (!storageKey) return null;

  const file = await loadLocalProfileAvatarFile(storageKey).catch(() => null);
  return file ? URL.createObjectURL(file) : null;
}
