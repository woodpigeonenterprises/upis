import { DynamoDBClient, QueryCommand, QueryCommandOutput } from "@aws-sdk/client-dynamodb";
import { AwsCreds } from "../api/src/users.js";
import { isPlayable, Track } from "./record";
import { Store, openStore } from "./store"
import { Band, Session, User } from "./model";
import { JobQueue, runJobQueue } from "./queue";
import TrackRepo from "./TrackRepo"
import { BehaviorSubject, EMPTY, Observable, concatMap, empty, expand, from, fromEventPattern, reduce, throwError, withLatestFrom } from "rxjs";

let audio: AudioContext|undefined;

let page: 'login'|'logout'|'resume'|'user'|'band' = 'resume';

let session: Session;
let store: Store;
let jobs: JobQueue;

let user: User;
let band: Band;
let tracks: TrackRepo;

const serverUrl = "http://localhost:9999";
const googleAuthClientId = '633074721949-f7btgv29kucgh6m10av4td9bi88n903d.apps.googleusercontent.com';


type PageType = string;


const page$ = new BehaviorSubject<PageType>('resume');



//todo throttle to 1
const topDiv$ = from([document.createElement('div') as HTMLElement]);

const mainDiv$ = page$.pipe(
  expand(m => 
    typeof m === 'string' ? renderPage(m) : EMPTY
  ),

  concatMap(m =>
    typeof m !== 'string' ? [m] : EMPTY
    )
);


window.onload = async () => {
  const divTop = document.getElementById('topBar')!;
  const divMain = document.getElementById('main')!;

  await Promise.all([
    topDiv$.forEach(el => {
      divTop.innerHTML = '';
      divTop.appendChild(el);
    }),

    mainDiv$.forEach(el => {
      divMain.innerHTML = '';
      divMain.appendChild(el);
    })
  ]);
};



function renderPage(page: PageType): Observable<HTMLElement|PageType> {
  switch(page) {
    case 'login': return renderLogin();
    case 'logout': return renderLogout();
    case 'resume': return renderResume();
    case 'user': return renderUser();
    case 'band': return renderBand();
    default: return throwError(() => Error(`Bad page ${page}`));
  }
}
  
function renderLogin(): Observable<PageType> {
  return from((async _ => {
    const googleToken = await getGoogleToken();

    session = await createSession('google', googleToken);
    saveSession(session);

    return 'resume';
  })());
}

function renderLogout(): Observable<PageType> {
  return from((async _ => {
    clearSession();
    return 'login';
  })());
}

function renderResume(): Observable<PageType> {
  return from((async _ => {
    const summoned = trySummonSession();
    if(!summoned) {
      return 'login';
    }

    session = summoned;
    const uid = session.uid;

    store = await openStore(uid);
    jobs = await runJobQueue(uid, job => {
      console.log('Handling job', job);

      //todo some kind of branching on job type
      return Track.createJobHandler({ store, jobs })(job);
    })

    tracks = new TrackRepo(store, jobs);

    const dynamo = new DynamoDBClient({
      region: 'eu-west-1',
      credentials: session.awsCreds
    });

    const loaded = await loadUser(dynamo, uid);
    if(!loaded) {
      return 'logout';
    }

    user = loaded;
    return 'user';
  })());
}

function renderUser(): Observable<PageType|HTMLElement> {
    // renderTopBar();
      
  const bandsDiv = document.createElement('div');
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
      page$.next('band');
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

  return from([bandsDiv]);
}

function renderBand(): Observable<HTMLElement> {
  return tracks.getTracks(band.bid) //from(tracks.setBand(band.bid, () => {}))
    .pipe(concatMap(trackList => {
      // renderTopBar();

      const header = document.createElement('h1');
      header.innerText = band.name;
      
      const recordingsUl = document.createElement('ul');

      for(const { info, state } of trackList) {
        const li = document.createElement('li');
        li.innerHTML = info.tid;

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
        // track.onchange = () => page$.next();
        tracks.add(track); //this should cause further tracks to appear

        // await render();
      };

      const div = document.createElement('div');
      div.appendChild(header);
      div.appendChild(recordingsUl);
      div.appendChild(button);
      return [div];
    }));

}




    
// async function render(nextPage?: typeof page): Promise<void> {
//   if(nextPage) { page = nextPage }
  
//   const divTop = document.getElementById('topBar')!;
//   const divMain = document.getElementById('main')!;

//   divTop.innerHTML = '';
//   divMain.innerHTML = '';
  
//   switch(page) {
//     case 'login':
//       const googleToken = await getGoogleToken();

//       session = await createSession('google', googleToken);
//       saveSession(session);

//       return await render('resume');

// 		case 'logout':
// 			clearSession();
// 			//todo close store and job queue here
// 			return await render('login');

//     case 'resume':
//       const summoned = trySummonSession();
//       if(!summoned) {
//         return await render('login');
//       }

//       session = summoned;
// 			const uid = session.uid;

// 			store = await openStore(uid);
// 			jobs = await runJobQueue(uid, job => {
// 				console.log('Handling job', job);

// 				//todo some kind of branching on job type
// 				return Track.createJobHandler({ store, jobs })(job);
// 			})

//       tracks = new TrackRepo(store, jobs);

//       const dynamo = new DynamoDBClient({
//         region: 'eu-west-1',
//         credentials: session.awsCreds
//       });

//       const loaded = await loadUser(dynamo, uid);
//       if(!loaded) {
//         return await render('logout');
//       }

//       user = loaded;
//       return await render('user');

//     case 'user':
//       renderTopBar();
      
//       const bandsDiv = document.createElement('div');
//       bandsDiv.childNodes.forEach(n => n.remove());

//       const ul = document.createElement('ul');

//       for(let [bid, bn] of user.bands.entries()) {
//         const li = document.createElement('li');

//         const a = document.createElement('a');
//         a.href = '#';
//         a.onclick = async () => {
//           band = {
//             bid,
//             name: bn
//           }
//           await render('band');
//         };
//         a.innerText = bn;
//         li.appendChild(a);

//         ul.appendChild(li);
//       };

//       bandsDiv.appendChild(ul);

//       const bandNameInput = document.createElement('input');
//       bandNameInput.type = 'text';
//       bandNameInput.placeholder = 'Band name...';

//       const createBand = document.createElement('input');
//       createBand.type = 'button';
//       createBand.value = 'Create Band!';

//       createBand.onclick = async () => {

//         const r = await fetch(`${serverUrl}/band`, {
//           method: 'POST',
//           headers: {
//             'Content-Type': 'application/json'
//           },
//           body: JSON.stringify({
//             name: bandNameInput.value
//           }),
//           credentials: 'include',
//           mode: 'cors'
//         })
//       };

//       bandsDiv.appendChild(bandNameInput);
//       bandsDiv.appendChild(createBand);

//       divMain.appendChild(bandsDiv);
//       break;

//     case 'band':

//       // tracks.getTracks(band.bid).forEach(r => render());

//       // overall system should have one subscription at bottom
//       // receiving pages and their versions
      
//       await tracks.setBand(band.bid, () => render());

//       renderTopBar();

//       const header = document.createElement('h1');
//       header.innerText = band.name;
      
//       const recordingsUl = document.createElement('ul');

//       for(const { info, state } of tracks.list()) {
//         const li = document.createElement('li');
//         li.innerHTML = info.tid;

//         if(isPlayable(state)) {
//           const b = document.createElement('input');
//           b.type = 'button';
//           b.value = 'Play';
//           b.onclick = async () => {
//             await state.play(audio ??= new AudioContext());
//           };

//           li.appendChild(b);
//         }
//         else {
//           const b = document.createElement('input');
//           b.type = 'button';
//           b.value = 'Stop';
//           b.onclick = () => state.stop();

//           li.appendChild(b);
//         }

//         recordingsUl.appendChild(li);
//       }

//       const button = document.createElement('input');
//       button.type = 'button';
//       button.value = 'Record';

//       button.onclick = async () => {
//         const track = await Track.record(band.bid, store, jobs);
//         track.onchange = () => render();
//         tracks.add(track);

//         await render();
//       };

//       divMain.appendChild(header);
//       divMain.appendChild(recordingsUl);
//       divMain.appendChild(button);

//       break;
//   }

//   function renderTopBar() {
//     const nameSpan = document.createElement('span');
//     nameSpan.innerText = session.uid;

//     const logoutButton = document.createElement('input');
//     logoutButton.type = 'button';
//     logoutButton.value = 'Log out';
//     logoutButton.onclick = () => render('logout');

//     const timeSpan = document.createElement('span');
//     setInterval(() => timeSpan.innerHTML = Date.now().toString(), 1000);

//     divTop.appendChild(nameSpan);
//     divTop.appendChild(logoutButton);
//     divTop.appendChild(timeSpan);
//   }
// }

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
  let r: QueryCommandOutput|undefined = undefined;
  
  try {
    r = await dynamo.send(new QueryCommand({
      TableName: 'upis_users',
      KeyConditionExpression: 'uid = :uid',
      ExpressionAttributeValues: {
        ':uid': { S: uid }
      }
    }));

    const items = r.Items;
    if(!items) return false;

    const bands: Record<string, string> = {};
    let name: string = '';

    for(const item of items) {
      const sort = item.sort?.S;
      if(!sort) continue;

      if(sort == 'user') {
        const n = item.name?.S;
        if(n && typeof n === 'string') {
          name = n;
        }
        continue;
      }

      const matched = sort.match(/^band\/(?<bid>.+)/);
      if(matched && matched.groups) {
        const bid = matched.groups['bid'];

        const name = item.name?.S;
        if(name && typeof name === 'string') {
          bands[bid] = name;
        }
      }
    }

    return {
      uid,
      name,
      bands: new Map(Object.entries(bands))
    }
  }
  catch(e) {
    if(e instanceof Error && e.name == 'ExpiredTokenException') {
      return false;
    }
  }

  return false;
}


