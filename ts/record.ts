import { Store } from "./store"

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

    await this.track.store.saveBlob(blobId, blob);
    //store must guarantee order above todo
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

export class Track {
  readonly info: TrackInfo
  state: State

  private constructor(info: TrackInfo, state: Recording|Playable|Playable) {
    this.info = info;
    this.state = state;
  }

  onchange?: (t:Track)=>void

  private sink(state: State) {
    this.state = state;
    if(this.onchange) this.onchange(this);
  }

  static async record(store: Store): Promise<Track> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const mimeType = 'audio/ogg;codecs=opus'

    const recorder = new MediaRecorder(stream, { mimeType });

    const info: TrackInfo = {
      id: crypto.randomUUID(),
      mimeType
    };

    let track: Track;

    const context: TrackContext = {
      ...info,
      sink: s => track.sink(s),
      store
    };

    const recording = new Recording(context, recorder);

    track = new Track(context, recording);

    recording.start();

    return track;
  }
}

interface TrackInfo {
  id: string
  mimeType: string
}

interface TrackContext extends TrackInfo {
  sink: Sink
  store: Store
}

