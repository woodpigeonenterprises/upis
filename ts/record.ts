import { delay } from "./util.ts";

export async function record(): Promise<Playable> {
  
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

	const mimeType = 'audio/ogg;codecs=opus'

	const recorder = new MediaRecorder(stream, { mimeType });

	const recording = new Recording(crypto.randomUUID(), mimeType);

  return await new Promise<Playable>(resolve => {
    recorder.ondataavailable = e => {
      recording.pushBlob(e.data);
      console.log('Data recorded');
    };

    recorder.onstart = () => {
      console.log('Recording', recording.id, 'started')
    };

    recorder.onstop = async e => {
      console.log('Recording', recording.id, 'complete of', recording.parts.length, 'blob parts');

      const playable = recording.complete();
      resolve(playable);
    };

    recorder.start(300);

    delay(2000).then(() => recorder.stop());
  });
}


export class Recording {
  readonly id: string
  readonly mimeType: string
  readonly parts: Blob[] = []
  constructor(id: string, mimeType: string) {
    this.id = id;
    this.mimeType = mimeType;
  }

  pushBlob(blob: Blob) {
    //assuming blob is always the expected type here
    this.parts.push(blob);
  }

  complete() {
    const blob = new Blob(this.parts, { type: this.mimeType });
    console.log('Created blob of type', blob.type, 'of size', blob.size);
    return new Playable(this.id, blob);
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
