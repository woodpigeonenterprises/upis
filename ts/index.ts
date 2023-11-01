import { STSClient, AssumeRoleWithWebIdentityCommand } from "@aws-sdk/client-sts";
import { S3Client, PutObjectCommand, UploadPartCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { AwsCreds } from "../api/src/users.js";

let audio: AudioContext|undefined;

let page: 'login'|'user'|'band' = 'login';
let session: Session;
let user: User;
let band: Band;
let recordings: Playable[] = [];

const serverUrl = 'http://localhost:9999';
const googleAuthClientId = '633074721949-f7btgv29kucgh6m10av4td9bi88n903d.apps.googleusercontent.com';

window.onload = async () => {
	page = 'login';
	await redisplay();
};
		
async function redisplay(): Promise<void> {
	switch(page) {
		case 'login':
			const summoned = trySummonSession();

			if(summoned) {
				session = summoned;
			}
			else {
				const googleToken = await getGoogleToken();
				session = await createSession('google', googleToken);
				saveSession(session);
			}

			const nameSpan = document.createElement('span');
			nameSpan.innerText = session.uid;

			const logoutButton = document.createElement('input');
			logoutButton.type = 'button';
			logoutButton.value = 'Log out';
			logoutButton.onclick = () => {
				clearSession();
				window.location.reload();
			};

			document.getElementById('topBar')!
				.appendChild(nameSpan)
				.appendChild(logoutButton);

			const dynamo = new DynamoDBClient({
				region: 'eu-west-1',
				credentials: session.awsCreds
			});

			const loaded = await loadUser(dynamo, session.uid);
			if(!loaded) {
				document.write(`User ${session.uid} not set up`);
				return;
			}

			user = loaded;
			page = 'user';
			return await redisplay();

		case 'user':
			const bandsDiv = document.getElementById('bands')!;
			bandsDiv.childNodes.forEach(n => n.remove());

			const ul = document.createElement('ul');

			for(let [bid, bn] of user.bands.entries()) {
				const li = document.createElement('li');

				const a = document.createElement('a');
				a.href = '#';
				a.onclick = async () => {
					band = {
						bid,
						name: bn
					}
					page = 'band';
					await redisplay();
				};
				a.innerText = bn;
				li.appendChild(a);

				ul.appendChild(li);
			};

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
					}),
					credentials: 'include',
					mode: 'cors'
				})
			};

			bandsDiv.appendChild(bandNameInput);
			bandsDiv.appendChild(createBand);
			break;

		case 'band':
			document.getElementById('recordings')!.innerHTML = `<ul>${recordings.map(renderRecording).map(h => `<li>${h}</li>`)}</ul>`
			break;
	}
}




function clearSession() {
	window.localStorage.removeItem('upis_session');
}


function trySummonSession(): Session|false {
	const found = window.localStorage.getItem('upis_session');
	if(found) {
		const s = JSON.parse(found) as Session;

		if(s.expires > Date.now() + 60 * 1000) {
			return s;
		}
	}

	return false;
}

function saveSession(session: Session): void {
	window.localStorage.setItem('upis_session', JSON.stringify(session));
}

async function createSession(tokenType: 'google', token: string): Promise<Session> {
	const resp = await fetch(`${serverUrl}/session`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			tokenType,
			token
		}),
		credentials: 'include',
		mode: 'cors'
	});

	const body = await resp.json();

	return { 
		uid: body.uid as string,
		awsCreds: body.aws as AwsCreds,
		expires: body.expires as number
	};
}

function getGoogleToken(): Promise<string> {
	return new Promise<string>(resolve => {
		google.accounts.id.initialize({
			log_level: 'debug',
			client_id: googleAuthClientId,
			callback: async result => {
				const googleToken = result.credential;
				console.log('Got Google token', googleToken);
				resolve(googleToken);
			}
		});

		const parent = document.getElementById('googleButton');
		google.accounts.id.renderButton(parent!, {theme: "filled_blue"});

		google.accounts.id.prompt();
	});
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
		bands: new Map(Object.entries(r.Item.bands.M!).map(([k, v]) => [k, v.S!]))
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
		await redisplay();

		// but really Recordings themselves are just like Playables
		// but in a different state
  };

  recorder.start(300);

  await delay(2000);

  recorder.stop();
})



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


type Session = {
	uid: string,
	awsCreds: AwsCreds,
	expires: number
};

type User = {
	name: string,
	bands: Map<string, string>
}

type Band = {
	bid: string,
	name: string
}

