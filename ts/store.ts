import { openDB } from "idb";


type BlobId = { stream: string, idx: number };
type BlobSaver = (id: BlobId, blob: Blob) => Promise<BlobId>;

export type Store = {
  saveBlob: BlobSaver
};



export async function openStore(): Promise<Store> {
  const db = await openDB('upis', 1, {
    upgrade(db, oldVersion, newVersion) {
      console.log('IDB UPGRADE!!!', oldVersion, newVersion);
      
      switch(`${oldVersion} -> ${newVersion}`) {
        case '0 -> 1':
          const s = db.createObjectStore('blobs', { keyPath: ['stream', 'idx'] });
          break;
      }
    }
  });

  db.addEventListener('error', e => console.error(e));
  db.addEventListener('abort', e => console.error(e));


  const all = await db.getAll('blobs');
  console.log('BLOBS', all);

  return {
    async saveBlob(id: BlobId, blob: Blob) {
      console.log('saving blob', id);

      await db.put('blobs', { stream: id.stream, idx: id.idx, blob });
      console.log('saved blob', id);

      return id;
    }
  };
}

