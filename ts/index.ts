import { DynamoDBClient, GetItemCommand, GetItemCommandOutput } from "@aws-sdk/client-dynamodb";
import { AwsCreds } from "../api/src/users.js";
import { isPlayable, Track } from "./record";
import { Store, openStore } from "./store"
import { Band, Session, User } from "./model";
import { JobQueue, runJobQueue } from "./queue";
import { delay } from "./util";

let audio: AudioContext|undefined;

let page: 'login'|'logout'|'resume'|'user'|'band' = 'resume';

let session: Session;
let store: Store;
let jobs: JobQueue;

let user: User;
let band: Band;
let tracks: Track[] = [];

const serverUrl = "http://localhost:9999";
const googleAuthClientId = '633074721949-f7btgv29kucgh6m10av4td9bi88n903d.apps.googleusercontent.com';

window.onload = async () => {
  await render('resume');
};
    
async function render(nextPage?: typeof page): Promise<void> {
  if(nextPage) { page = nextPage }
  
  const divTop = document.getElementById('topBar')!;
  const divMain = document.getElementById('main')!;

  divTop.innerHTML = '';
  divMain.innerHTML = '';
  
  switch(page) {
    case 'login':
      const googleToken = await getGoogleToken();

      session = await createSession('google', googleToken);
      saveSession(session);

      return await render('resume');

		case 'logout':
			clearSession();
			//todo close store and job queue here
			return await render('login');

    case 'resume':
      const summoned = trySummonSession();
      if(!summoned) {
        return await render('login');
      }

      session = summoned;
			const uid = session.uid;

			store = await openStore(uid);
			jobs = await runJobQueue(uid, job => {
				console.log('Handling job', job);

				//todo some kind of branching on job type
				return Track.createJobHandler({ store, jobs })(job);
			})

			// jobs.addJob('hello', { due: Date.now() + 10000 });

      const dynamo = new DynamoDBClient({
        region: 'eu-west-1',
        credentials: session.awsCreds
      });

      const loaded = await loadUser(dynamo, uid);
      if(!loaded) {
        return await render('logout');
      }

      user = loaded;
      return await render('user');

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
          await render('band');
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

      for(const { info, state } of tracks) {
        const li = document.createElement('li');
        li.innerHTML = info.id;

        if(isPlayable(state)) {
          const b = document.createElement('input');
          b.type = 'button';
          b.value = 'Play';
          b.onclick = async () => {
            await state.play(audio ??= new AudioContext());
          };

          li.appendChild(b);
        }
        else {
          const b = document.createElement('input');
          b.type = 'button';
          b.value = 'Stop';
          b.onclick = () => state.stop();

          li.appendChild(b);
        }

        recordingsUl.appendChild(li);
      }

      const button = document.createElement('input');
      button.type = 'button';
      button.value = 'Record';

      button.onclick = async () => {
        const track = await Track.record(band.bid, store, jobs);
        track.onchange = () => render();
        tracks.push(track);

        await render();
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
    logoutButton.onclick = () => render('logout');

    divTop.appendChild(nameSpan);
    divTop.appendChild(logoutButton);
  }
}

function trySummonSession(): Session|false {
  const found = window.localStorage.getItem('upis_session');
  if(found) {
    const s = JSON.parse(found) as Session;


    const now = Date.now();
    const remaining = s.expires - now;

    console.log(
      'now:', now,
      'expires:', s.expires,
      'remaining:', remaining 
    );
    
    if(now < s.expires - (60 * 1000)) {
      return s;
    }
  }

  return false;
}

function clearSession() {
  window.localStorage.removeItem('upis_session');
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
      // log_level: 'debug',
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
  let r: GetItemCommandOutput|undefined = undefined;
  
  try {
    r = await dynamo.send(new GetItemCommand({
      TableName: 'upis',
      Key: {
        key: { S: `user/${uid}` }
      }
    }));
  }
  catch(e) {
    if(e instanceof Error && e.name == 'ExpiredTokenException') {
      return false;
    }
  }

  if(!!r && !!r.Item) {
    const user = r.Item;

    console.log('Got user', user);

    return {
      name: r.Item.name.S as string,
      bands: new Map(Object.entries(r.Item.bands.M!).map(([k, v]) => [k, v.S!]))
    };
  }

  return false;
}


