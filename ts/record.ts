import { JobHandler, JobQueue } from "./queue";
import { Store } from "./store"
import { delay } from "./util";

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
        console.log('Recording', this.track.id, 'started')
        resolve();
      };

      this.recorder.ondataavailable = e => {
        this.pushBlob(e.data);
        console.log('Data recorded');
      };

      this.recorder.onstop = async e => {
        console.log('Recording', this.track.id, 'complete of', this.parts.length, 'blob parts');
        this.complete();
      };

      this.recorder.start(300);
    });
  }

  stop() {
    this.recorder.stop();
  }

  private async pushBlob(blob: Blob) {
    const blobId = { stream: this.track.id, idx: this._nextBlobId++ };
    
    this.parts.push(blob);

    if(this.parts.length == 1) {
      //first blob
      //must save track to local db for persist jobs to pick up
      //track entry will have persist state
      await this.track.store.saveTrack(this.track.getTrack());
    }

    await this.track.store.saveBlob(blobId, blob);

    await this.track.jobs.addJob({
      type: 'persistTrack',
      track: { id: this.track.id }
    });
  }

  private complete() {
    const blob = new Blob(this.parts, { type: this.track.mimeType });

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
  type: 'uploading'
}

type Uploaded = {
  type: 'uploaded'
}

export type TrackPersistState = Local|Uploading|Uploaded;

export type PersistableTrack = {
  info: TrackInfo,
  persistState: TrackPersistState
}


export class Track {
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

  private sinkPersistState(state: TrackPersistState) {
    throw 'unimpl';
  }

  static createJobHandler = (store: Store) => async (job: unknown) => {
    if(isPersistTrackJob(job)) {
      console.log('PERSIST', job);

      const track = await store.loadTrack(job.trackId);
      if(!track) return false;

      switch(track.persistState.type) {
        case 'local':
          break;

        case 'uploading':
          break;
      }

      await delay(1000);
      return true;
    }

    return false;
  };

  static async record(bandId: string, store: Store, jobs: JobQueue): Promise<Track> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const mimeType = 'audio/ogg;codecs=opus'

    const recorder = new MediaRecorder(stream, { mimeType });

    const info: TrackInfo = {
      bandId,
      id: crypto.randomUUID(),
      mimeType
    };

    let track: Track;

    const context: TrackContext = {
      ...info,
      sink: s => track.sink(s),
      store,
      jobs,
      getTrack() { return track; }
    };

    const recording = new Recording(context, recorder);

    track = new Track(context, recording, { type: 'local' });

    recording.start();

    return track;
  }
}

interface TrackInfo {
  bandId: string,
  id: string
  mimeType: string
}

interface TrackContext extends TrackInfo {
  sink: Sink
  store: Store
  jobs: JobQueue
  getTrack(): Track
}



type PersistTrackJob = {
  type: 'persistTrack',
  trackId: string
}

function isPersistTrackJob(v: unknown): v is PersistTrackJob {
  return (<any>v).type == 'persistTrack';
}
