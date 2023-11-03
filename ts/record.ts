
export function isPlayable(v: unknown): v is Playable {
  const p = (<any>v).play;
  return !!p && typeof p === 'function';
}

type State = Recording|Playable|Playing;
type Sink = (state: State) => void;

export class Recording {
  readonly track: TrackInfo
  readonly sink: Sink
  readonly parts: Blob[] = []
  readonly recorder: MediaRecorder
  
  constructor(track: TrackInfo, sink: Sink, recorder: MediaRecorder) {
    this.track = track;
    this.sink = sink;
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

  private pushBlob(blob: Blob) {
    //assuming blob is always the expected type here
    this.parts.push(blob);
  }

  private complete() {
    const blob = new Blob(this.parts, { type: this.track.mimeType });

    console.log('Created blob of type', blob.type, 'of size', blob.size);

    this.sink(new Playable(this.track, this.sink, blob));
  }
};

export class Playable {
  readonly track: TrackInfo
  readonly sink: Sink
	readonly blob: Blob
	
  constructor(track: TrackInfo, sink: Sink, blob: Blob) {
    this.track = track;
    this.sink = sink;
		this.blob = blob;
  }

	async play(x: AudioContext): Promise<void> {
    const source = x.createBufferSource();
    source.buffer = await x.decodeAudioData(await this.blob.arrayBuffer());;

    source.connect(x.destination);
    source.start();

    this.sink(new Playing(this, source));
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

    this.inner.sink(this.inner);
  }
}

export class Track {
  info: TrackInfo
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

  static async record(): Promise<Track> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const mimeType = 'audio/ogg;codecs=opus'

    const recorder = new MediaRecorder(stream, { mimeType });

    const info: TrackInfo = {
      id: crypto.randomUUID(),
      mimeType
    };

    let track: Track;

    const recording = new Recording(info, s => track.sink(s), recorder);

    track = new Track(info, recording);

    recording.start();

    return track;
  }
}

type TrackInfo = {
  id: string
  mimeType: string
}
