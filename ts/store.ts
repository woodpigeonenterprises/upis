import { openDB } from "idb";
import { PersistableTrack, isPersistedTrack } from "./record";

type BlobId = { stream: string, idx: number };
type BlobSaver = (id: BlobId, blob: Blob) => Promise<BlobId>;

export type Store = {
  saveBlob: BlobSaver
  saveTrack(track: PersistableTrack): Promise<void>
  loadTrack(trackId: string): Promise<PersistableTrack|false>
};

export async function openStore(name: string): Promise<Store> {
  const db = await openDB(`upis_${name}`, 1, {
    upgrade(db, oldVersion, newVersion) {
      console.log('IDB UPGRADE!!!', oldVersion, newVersion);
      
      switch(`${oldVersion} -> ${newVersion}`) {
        case '0 -> 1':
          db.createObjectStore('blobs', { keyPath: ['stream', 'idx'] });

          db.createObjectStore('tracks', { keyPath: ['info.id'] })
              .createIndex('byBand', ['info.bandId', 'date', 'info.id']);

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

    async saveTrack(track: PersistableTrack): Promise<void> {
      await db.put('tracks', {
        date: Date.now(),
        info: track.info,
        persistState: track.persistState
      });
    },

    async loadTrack(id: string): Promise<PersistableTrack|false> {
      console.log('LOADING TRACK', id);
      
      const track = await db.get('tracks', [id]);
      if(!track) return false;

      if(isPersistedTrack(track)) {
        console.log('LOADED TRACK', track)
        return track;
      }

      console.error('Bad track loaded', track)
      return false;
    }
  };
}


