import { delay } from "./util.ts";
import { EventEmitter } from "events";

export async function record(): Promise<Recording> {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

	const mimeType = 'audio/ogg;codecs=opus'

	const recorder = new MediaRecorder(stream, { mimeType });

	const r = new Recording(crypto.randomUUID(), mimeType, recorder);

  r.start();

  return r;
}

export function isPlayable(v: unknown): v is Playable {
  const p = (<any>v).play;
  return !!p && typeof p === 'function';
}

export class Recording {
  readonly id: string
  readonly mimeType: string
  readonly parts: Blob[] = []
  readonly recorder: MediaRecorder

  oncomplete?: (p:Playable)=>void
  
  constructor(id: string, mimeType: string, recorder: MediaRecorder) {
    this.id = id;
    this.mimeType = mimeType;
    this.recorder = recorder;
  }

  start(): Promise<void> {
    return new Promise<void>(resolve => {
      this.recorder.ondataavailable = e => {
        this.pushBlob(e.data);
        console.log('Data recorded');
      };

      this.recorder.onstart = () => {
        console.log('Recording', this.id, 'started')
        resolve();
      };

      this.recorder.onstop = async e => {
        console.log('Recording', this.id, 'complete of', this.parts.length, 'blob parts');
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
    const blob = new Blob(this.parts, { type: this.mimeType });

    console.log('Created blob of type', blob.type, 'of size', blob.size);

    if(this.oncomplete) {
      this.oncomplete(new Playable(this.id, blob));
    }
  }
};

export class Playable {
	readonly id: string
	readonly blob: Blob
	
  constructor(id: string, blob: Blob) {
		this.id = id;
		this.blob = blob;
  }

	async play(x: AudioContext) {
    const source = x.createBufferSource();
    source.buffer = await x.decodeAudioData(await this.blob.arrayBuffer());;
    source.connect(x.destination);
    source.start();
	}
}
