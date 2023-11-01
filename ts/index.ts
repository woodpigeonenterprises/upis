import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { AwsCreds } from "../api/src/users.js";
import { Playable, record } from "./record.ts";

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
	await refresh();
};
		
async function refresh(): Promise<void> {
	const divTop = document.getElementById('topBar')!;
	const divMain = document.getElementById('main')!;

	divTop.innerHTML = '';
	divMain.innerHTML = '';
	
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
			return await refresh();

		case 'user':
			renderTopBar();
			
			const bandsDiv = document.createElement('div');
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
					await refresh();
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

			divMain.appendChild(bandsDiv);
			break;

		case 'band':
			renderTopBar();

			const header = document.createElement('h1');
			header.innerText = band.name;
			
			const recordingsUl = document.createElement('ul');

			for(let r of recordings) {
				const li = document.createElement('li');
				li.innerHTML = r.id;

				const b = document.createElement('input');
				b.type = 'button';
				b.value = 'Play';
				b.onclick = async () => {
					await r.play(audio ??= new AudioContext());
				};

				li.appendChild(b);
				
				recordingsUl.appendChild(li);
			}

			const button = document.createElement('input');
			button.type = 'button';
			button.value = 'Record';

			button.onclick = async () => {
				const recording = await record();
				recordings.push(recording);
				await refresh();
			};

			divMain.appendChild(header);
			divMain.appendChild(recordingsUl);
			divMain.appendChild(button);

			break;
	}

	function renderTopBar() {
		const nameSpan = document.createElement('span');
		nameSpan.innerText = session.uid;

		const logoutButton = document.createElement('input');
		logoutButton.type = 'button';
		logoutButton.value = 'Log out';
		logoutButton.onclick = () => {
			clearSession();
			window.location.reload();
		};

		divTop.appendChild(nameSpan);
		divTop.appendChild(logoutButton);
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

		const el = document.createElement('div');
		el.id = 'googleButton';
		document.getElementById('main')?.appendChild(el);
		
		google.accounts.id.initialize({
			log_level: 'debug',
			client_id: googleAuthClientId,
			callback: async result => {
				const googleToken = result.credential;
				console.log('Got Google token', googleToken);
				resolve(googleToken);
			}
		});

		google.accounts.id.renderButton(el, {theme: "filled_blue"});

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


declare global {
  interface Crypto {
    randomUUID: () => `${string}-${string}-${string}-${string}-${string}`
  }
}
