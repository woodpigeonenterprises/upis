import { JobQueue } from "./queue";
import { Store, StreamCursor } from "./store"
import { timeOrderedId } from "./util";
import SparkMD5 from "spark-md5";

export function isPlayable(v: unknown): v is Playable {
  const p = (<any>v).play;
  return !!p && typeof p === 'function';
}

type State = Recording|Playable|Playing;
type Sink = (state: State) => void;

export class Recording {
  readonly track: TrackContext
  readonly parts: Blob[] = []
  readonly recorder: MediaRecorder

  private _nextBlobId = 0
  
  constructor(track: TrackContext, recorder: MediaRecorder) {
    this.track = track;
    this.recorder = recorder;
  }

  start(): Promise<void> {
    return new Promise<void>(resolve => {
      this.recorder.onstart = () => {
        console.log('Recording', this.track.info.tid, 'started')
        resolve();
      };

      this.recorder.ondataavailable = e => {
        this.pushBlob(e.data);
        console.log('Data recorded');
      };

      this.recorder.onstop = async e => {
        console.log('Recording', this.track.info.tid, 'complete of', this.parts.length, 'blob parts');
        this.complete();
      };

      this.recorder.start(5000);
    });
  }

  stop() {
    this.recorder.stop();
  }

  private async pushBlob(blob: Blob) {
    const blobId = { stream: this.track.info.tid, idx: this._nextBlobId++ };
    
    this.parts.push(blob);

    if(this.parts.length == 1) {
      //first blob
      //must save track to local db for persist jobs to pick up
      //track entry will have persist state
      await this.track.store.saveTrack(this.track.persistable());
    }

    await this.track.store.saveBlob(blobId, blob);

    await this.track.jobs.addJob({
      type: 'persistTrack',
      track: { bid: this.track.info.bid, tid: this.track.info.tid }
    });
  }

  private complete() {
    const blob = new Blob(this.parts, { type: this.track.info.mimeType });

    console.log('Created blob of type', blob.type, 'of size', blob.size);

    this.track.sink(new Playable(this.track, blob));
  }
};

export class Playable {
  readonly track: TrackContext
  readonly blob: Blob
  
  constructor(track: TrackContext, blob: Blob) {
    this.track = track;
    this.blob = blob;
  }

  async play(x: AudioContext): Promise<void> {
    const source = x.createBufferSource();
    source.buffer = await x.decodeAudioData(await this.blob.arrayBuffer());;

    source.connect(x.destination);
    source.start();

    source.onended = () => this.track.sink(this);

    this.track.sink(new Playing(this, source));
  }
}

export class Playing {
  readonly inner: Playable;
  readonly source: AudioBufferSourceNode;
  
  constructor(inner: Playable, source: AudioBufferSourceNode) {
    this.inner = inner;
    this.source = source;
  }

  stop(): void {
    this.source.stop();
    this.source.disconnect();

    this.inner.track.sink(this.inner);
  }
}



type Local = {
  type: 'local'
}

type Uploading = {
  type: 'uploading',
  cursor: StreamCursor
}

type Uploaded = {
  type: 'uploaded'
}

export type TrackPersistState = Local|Uploading|Uploaded;

export class Track implements PersistableTrack
{
  readonly info: TrackInfo
  state: State
  persistState: TrackPersistState

  private constructor(info: TrackInfo, state: State, persistState: TrackPersistState) {
    this.info = info;
    this.state = state;
    this.persistState = persistState;
  }

  onchange?: (t:Track)=>void

  private sink(state: State) {
    this.state = state;
    if(this.onchange) this.onchange(this);
  }

  static createJobHandler = (x: { store: Store, jobs: JobQueue }) => async (job: unknown) => {
    if(!isPersistTrackJob(job)) return false;

    return await navigator.locks
      .request(trackLockKey(job.track), async () => {

        console.info('about to load track with job', job)

        const track = await x.store.loadTrack(job.track.bid, job.track.tid);
        if(!track) {
          console.error(`failed to load track ${job.track.tid}`)
          return true;
        }

        switch(track.persistState.type) {
          case 'local': {
            const { bid, tid } = track.info;

            const r = await fetch(`http://localhost:9999/bands/${bid}/tracks/${tid}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                //...
              }),
              credentials: 'include',
              mode: 'cors'
            });

            if(!r.ok) {
              console.warn(`Could not register track ${job.track.tid}`)
              return 10000;
            }

            console.info(`Registered track ${job.track.tid} as ${tid}`);

            track.persistState = { type: 'uploading', cursor: { stream: tid, idx: 0 } };
            await x.store.saveTrack(track);

            await x.jobs.addJob({
              type: 'persistTrack',
              track: { bid: track.info.bid, tid: track.info.tid }
            });
            break;
          }

          case 'uploading': {
            const { bid, tid } = track.info; 

            const found = await x.store.readBlobs(track.persistState.cursor);
            if(!found.length) return true;

            const { blob, cursor } = found[0]; //todo save all together, poss via clumping

            const hash = btoa(SparkMD5.ArrayBuffer.hash(await blob.arrayBuffer(), true));

            const oid = cursor.idx.toString();

            const r = await fetch(`http://localhost:9999/bands/${bid}/tracks/${tid}/blocks/${oid}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                size: blob.size,
                mimeType: blob.type,
                hash: hash
              }),
              credentials: 'include',
              mode: 'cors'
            });

            if(!r.ok) {
              console.warn(`Could not propose upload for track ${tid}`)
              return 10000;
            }

            const body = await r.json();

            console.info('Proposed upload, got response', body);

            //todo should read bytes allowed
            //and trim blob accordingly

            const uploadUrl = body.uploadUrl as string;

            const r2 = await fetch(uploadUrl, {
              method: 'PUT',
              headers: {
                'Content-MD5': hash 
              },
              body: blob,
              credentials: 'include',
              mode: 'cors',
            });

            if(!r2.ok) {
              console.warn(`Could not upload test block`)
              return 10000;
            }

            track.persistState = { type: 'uploading', cursor: { stream: cursor.stream, idx: cursor.idx + 1 } };
            await x.store.saveTrack(track);

            return true;
          }
        }
      });
  };

  static async record(bid: string, store: Store, jobs: JobQueue): Promise<Track> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const mimeType = 'audio/ogg;codecs=opus'

    const recorder = new MediaRecorder(stream, { mimeType });

    const info: TrackInfo = {
      bid,
      tid: timeOrderedId(),
      mimeType
    };

    let track: Track;

    const context: TrackContext = {
      info,
      sink: s => track.sink(s),
      store,
      jobs,
      persistable(): PersistableTrack
      {
        return track;
      }
    };

    const recording = new Recording(context, recorder);

    track = new Track(info, recording, { type: 'local' });

    recording.start();

    return track;
  }
}

export interface TrackId {
  bid: string,
  tid: string
}

export interface TrackInfo extends TrackId {
  mimeType: string
}

interface TrackContext {
  info: TrackInfo
  sink: Sink
  store: Store
  jobs: JobQueue
  persistable(): PersistableTrack
}


function trackLockKey(info: TrackId) {
  return `upis_track_${info.tid}`;
}


type PersistTrackJob = {
  type: 'persistTrack',
  track: TrackId
}

function isPersistTrackJob(v: any): v is PersistTrackJob {
  return !!v
      && v.type == 'persistTrack'
      && isTrackId(v.track);
}

function isTrackId(v: any): v is TrackId {
  return !!v
      && typeof v.bid === 'string'
      && typeof v.tid === 'string';
}

function isTrackInfo(v: any): v is TrackInfo {
  return typeof v.mimeType === 'string'
      && isTrackId(v);
}



export interface PersistableTrack {
  info: TrackInfo,
  persistState: TrackPersistState
}

export function isPersistedTrack(v: any): v is PersistableTrack {
  return !!v
      && isTrackInfo(v.info)
      && isTrackPersistState(v.persistState);
}

function isTrackPersistState(v: any): v is TrackPersistState {
  //todo!!!
  return true;
}
