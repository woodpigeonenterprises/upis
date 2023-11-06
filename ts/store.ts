import { openDB } from "idb";
import { Track } from "./record";

type BlobId = { stream: string, idx: number };
type BlobSaver = (id: BlobId, blob: Blob) => Promise<BlobId>;

export type Store = {
  saveBlob: BlobSaver
  saveTrack(track: Track): Promise<void>
  loadTrack(trackId: string): Promise<Track|false>
};

export async function openStore(name: string): Promise<Store> {
  const db = await openDB(`upis_${name}`, 1, {
    upgrade(db, oldVersion, newVersion) {
      console.log('IDB UPGRADE!!!', oldVersion, newVersion);
      
      switch(`${oldVersion} -> ${newVersion}`) {
        case '0 -> 1':
          db.createObjectStore('blobs', { keyPath: ['stream', 'idx'] });
          db.createObjectStore('tracks', { keyPath: ['bandId', 'date', 'id'] });
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
      await db.put('blobs', { stream: id.stream, idx: id.idx, blob });
      console.log('saved blob', id);
      return id;
    },

    async saveTrack(track: Track): Promise<void> {
      await db.put('tracks', {
        bandId: track.info.bandId,
        date: Date.now(),
        id: track.info.id,
        persistState: track.persistState
      });
    },

    async loadTrack(id: string): Promise<Track|false> {
      //todo
      return false;
    }
  };
}

