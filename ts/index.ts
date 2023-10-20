import { STSClient, AssumeRoleWithWebIdentityCommand } from "@aws-sdk/client-sts";
import { S3Client, PutObjectCommand, UploadPartCommand } from "@aws-sdk/client-s3";

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
    return new Playable(this.id, blob);
  }
};

class Playable {
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

let audio: AudioContext|undefined;

let recordings: Playable[] = [];

document.getElementById('recordButton')?.addEventListener('click', async () => {

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

	const mimeType = 'audio/ogg;codecs=opus'

  const recorder = new MediaRecorder(stream, { mimeType });

  const recording = new Recording(crypto.randomUUID(), mimeType);

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
		recordings.push(playable);
		renderAll();

		// but really Recordings themselves are just like Playables
		// but in a different state
  };

  recorder.start(300);

  await delay(2000);

  recorder.stop();
})

window.onload = () => {
	google.accounts.id.initialize({
		log_level: 'debug',
		client_id: '633074721949-f7btgv29kucgh6m10av4td9bi88n903d.apps.googleusercontent.com',
		callback: async result => {
			const googleToken = result.credential;
			console.log('Got Google token', googleToken);

			const sts = new STSClient({ region: 'eu-west-2' });

			const r = await sts.send(new AssumeRoleWithWebIdentityCommand({
				RoleArn: 'arn:aws:iam::874522027524:role/upis_google',
				RoleSessionName: 'wibble',
				WebIdentityToken: googleToken,
				ProviderId: undefined // for google this is unset
			}));

			console.log('Got AWS Creds', r.Credentials);

			const s3 = new S3Client({
				region: 'eu-west-2',
				credentials: {
					accessKeyId: r.Credentials?.AccessKeyId!,
					expiration: r.Credentials?.Expiration,
					secretAccessKey: r.Credentials?.SecretAccessKey!,
					sessionToken: r.Credentials?.SessionToken
				}
			});

			const uploaded = await s3.send(new PutObjectCommand({
				Bucket: 'upis-data',
				Key: 'oink',
				Body: 'hello!',
			}));

			console.log('Uploaded magically to S3 (possibly...)', uploaded)
		}
	});
		
	const parent = document.getElementById('googleButton');
	google.accounts.id.renderButton(parent!, {theme: "filled_blue"});

	google.accounts.id.prompt();
};



function renderAll() {
  document.getElementById('recordings')!.innerHTML = `<ul>${recordings.map(renderRecording).map(h => `<li>${h}</li>`)}</ul>`
}

function renderRecording(r: Playable) {
  return `RECORDING ${r.id} <input type="button" value="Play" onclick="playRecording('${r.id}')" />`;
}

window.playRecording = (id: string) => {
	const found = recordings.find(r => r.id == id);

	if(found) {
		found.play(audio ??= new AudioContext());
	}
};

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

