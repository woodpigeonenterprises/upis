import { STSClient, AssumeRoleWithWebIdentityCommand } from "@aws-sdk/client-sts";
import { S3Client, PutObjectCommand, UploadPartCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { AwsCreds } from "../api/src/users.js";

let audio: AudioContext|undefined;

let recordings: Playable[] = [];
let user: User;

const serverUrl = 'http://localhost:9999';
const googleAuthClientId = '633074721949-f7btgv29kucgh6m10av4td9bi88n903d.apps.googleusercontent.com';

window.onload = () => {
	google.accounts.id.initialize({
		log_level: 'debug',
		client_id: googleAuthClientId,
		callback: async result => {
			const googleToken = result.credential;
			console.log('Got Google token', googleToken);

			const resp = await fetch(`${serverUrl}/session`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					token: googleToken
				})
			})

			const body = await resp.json();
			const uid = body.uid as string;
			const awsCreds = body.aws as AwsCreds;

			const dynamo = new DynamoDBClient({
				region: 'eu-west-1',
				credentials: awsCreds
			});

			const loaded = await loadUser(dynamo, uid);
			if(!loaded) {
				document.write(`User ${uid} not set up`);
				return;
			}

			user = loaded;

			renderAll();
		}
	});
		
	const parent = document.getElementById('googleButton');
	google.accounts.id.renderButton(parent!, {theme: "filled_blue"});

	google.accounts.id.prompt();
};

type User = {
	name: string,
	bands: string[]
}

async function loadUser(dynamo: DynamoDBClient, uid: string): Promise<User|false> {
	const r = await dynamo.send(new GetItemCommand({
		TableName: 'upis',
		Key: {
			key: { S: `user/${uid}` }
		}
	}));

	if(!r.Item) return false;

	const user = r.Item;
	console.log('Got user', user);

	return {
		name: r.Item.name.S as string,
		bands: r.Item.bands.SS as string[]
	};
}




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



function renderAll() {
  document.getElementById('recordings')!.innerHTML = `<ul>${recordings.map(renderRecording).map(h => `<li>${h}</li>`)}</ul>`

	const bandsDiv = document.getElementById('bands')!;
	bandsDiv.childNodes.forEach(n => n.remove());

	const ul = document.createElement('ul');

	user.bands.forEach(bandName => {
		const li = document.createElement('li');
		li.textContent = bandName;
		ul.appendChild(li);
	});

	bandsDiv.appendChild(ul);

	const bandNameInput = document.createElement('input');
	bandNameInput.type = 'text';
	bandNameInput.placeholder = 'Band name...';
	
	const createBand = document.createElement('input');
	createBand.type = 'button';
	createBand.value = 'Create Band!';

	createBand.onclick = async () => {
		const r = await fetch(`${serverUrl}/band`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				name: bandNameInput.value
			})
		})
	};

	bandsDiv.appendChild(bandNameInput);
	bandsDiv.appendChild(createBand);
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

