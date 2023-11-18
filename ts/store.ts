import { openDB } from "idb";
import { PersistableTrack, isPersistedTrack } from "./record";
import { Observable, concatMap, from } from "rxjs";

export type StreamId = string;
export type StreamBlob = { cursor: StreamCursor, blob: Blob }
export type StreamCursor = { stream: StreamId, idx: number };
export type BlobId = StreamCursor;

type BlobSaver = (id: BlobId, blob: Blob) => Promise<BlobId>;

export type Store = {
  saveTrack(track: PersistableTrack): Promise<void>
  loadTrack(bid: string, tid: string): Promise<PersistableTrack|false>
  loadTracks(bid: string): Promise<PersistableTrack[]>

  saveBlob: BlobSaver
  loadBlobs(cursor: StreamCursor): Observable<StreamBlob>
};

export async function openStore(name: string): Promise<Store> {
  const db = await openDB(`upis_${name}`, 1, {
    upgrade(db, oldVersion, newVersion) {
      console.log('IDB UPGRADE!!!', oldVersion, newVersion);
      
      switch(`${oldVersion} -> ${newVersion}`) {
        case '0 -> 1':
          db.createObjectStore('blobs', { keyPath: ['stream', 'idx'] });
          db.createObjectStore('tracks', { keyPath: ['info.bid', 'info.tid'] });
          break;
      }
    }
  });

  db.addEventListener('error', e => console.error(e));
  db.addEventListener('abort', e => console.error(e));


  const all = await db.getAll('blobs');

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

    async loadTrack(bid: string, tid: string): Promise<PersistableTrack|false> {
      console.log('LOADING TRACK', bid, tid);
      
      const track = await db.get('tracks', [bid, tid]);
      if(!track) return false;

      if(isPersistedTrack(track)) {
        console.log('LOADED TRACK', track)
        return track;
      }

      console.error('Bad track loaded', track)
      return false;
    },

    async loadTracks(bid: string): Promise<PersistableTrack[]> {
      const rows = await db.getAll('tracks', IDBKeyRange.bound([bid], [bid, 'ZZZZZZ']));
      const tracks = rows.flatMap(r => isPersistedTrack(r) ? [r] : []);

      console.info('Loaded tracks from IDB for band', bid, tracks);

      return tracks;
    },

    loadBlobs(cursor: StreamCursor): Observable<StreamBlob> {
      return from(db.getAll('blobs', IDBKeyRange.bound([cursor.stream], [cursor.stream, 9999999])))
        .pipe(
          concatMap(rows => rows),
          concatMap(row => {
            return [<StreamBlob>{ //todo proper typing here
              blob: row.blob as Blob,
              cursor: {
                stream: row.stream as string,
                idx: row.idx as number
              }
            }];
          })
        );

      //todo load blobs in blocks, streaming results gradually
    }
  };
}


