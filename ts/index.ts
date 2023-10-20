
class Recording {
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

    const source = x.createBufferSource();
    source.buffer = await x.decodeAudioData(await blob.arrayBuffer());;
    source.connect(x.destination);
    source.start();
      
    return new Playable();
  }
};

class Playable {
  constuctor
}


let recordings: Recording[] = [];

document.getElementById('recordButton')?.addEventListener('click', async () => {


  
  const x = new AudioContext();

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const recorder = new MediaRecorder(stream, { mimeType: 'audio/ogg;codecs=opus' });

  const recording = new Recording(crypto.randomUUID());

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



    if(recording.parts.length) {
      const blob = new Blob(parts, { type: parts[0].type });
      console.log('Created blob of type', blob.type, 'of size', blob.size);

      const source = x.createBufferSource();
      source.buffer = await x.decodeAudioData(await blob.arrayBuffer());;
      source.connect(x.destination);
      source.start();
    }

    return true;
  };

  recorder.start(200);

  await delay(700);

  recorder.stop();

  recordings.push({ id })

  renderAll();
})



function renderAll() {
  document.getElementById('recordings')!.innerHTML = `<ul>${recordings.map(renderRecording).map(h => `<li>${h}</li>`)}</ul>`
}

function renderRecording(r: Recording) {
  return `RECORDING ${r.id} <input type="button" value="Play" onclick="playRecording('${r.id}')" />`;
}

window.playRecording = (id: string) => {
  window.alert('HELLO! ' + id)
}



function delay(ms: number) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

export {}

declare global {
  interface Crypto {
    randomUUID: () => `${string}-${string}-${string}-${string}-${string}`
  }

  interface Window {
    playRecording: (id: string) => void
  }
}



//
//
//

