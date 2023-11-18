import { DynamoDBClient, QueryCommand, QueryCommandOutput } from "@aws-sdk/client-dynamodb";
import { AwsCreds } from "../api/src/users.js";
import { isPlayable, Track } from "./record";
import { Store, openStore } from "./store"
import { Band, Session, User } from "./model";
import { JobQueue, runJobQueue } from "./queue";
import TrackRepo from "./TrackRepo"
import { EMPTY, Observable, Subject, combineLatest, concatMap, connectable, expand, from, interval, map, startWith, take, takeUntil, tap, throwError } from "rxjs";

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

type Slice = {
  page?: PageType,
  mainDiv?: HTMLElement,
  topDiv?: HTMLElement
};

const page$ = new Subject<PageType>();

const slice$ = connectable(page$.pipe(
  startWith('resume'),
  
  map(p => <Slice>{ page: p }),
  
  expand(
    (m: Slice) => m.page ? renderPage(m.page) : EMPTY//,
    // 1   
  )
));

const newPage$ = slice$.pipe(
  concatMap(m => m.page ? [m.page] : EMPTY),
  tap(p => console.info('PAGE', p))
);

const mainDiv$ = slice$.pipe(
  concatMap(m => m.mainDiv ? [m.mainDiv] : EMPTY)
);

const topDiv$ = slice$.pipe(
  concatMap(m => m.topDiv ? [m.topDiv] : EMPTY)
);

slice$.connect();


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



function renderPage(page: PageType): Observable<Slice> {
  switch(page) {
    case 'login': return renderLogin();
    case 'logout': return renderLogout();
    case 'resume': return renderResume();
    case 'user': return renderUser();
    case 'band': return renderBand();
    default: return throwError(() => Error(`Bad page ${page}`));
  }
}
  
function renderLogin(): Observable<Slice> {
  return from((async _ => {
    const googleToken = await getGoogleToken();

    session = await createSession('google', googleToken);
    saveSession(session);

    return { page: 'resume' };
  })());
}

function renderLogout(): Observable<Slice> {
  return from((async _ => {
    clearSession();
    return { page: 'login' };
  })());
}

function renderResume(): Observable<Slice> {
  return from((async _ => {
    const summoned = trySummonSession();
    if(!summoned) {
      return { page: 'login' };
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
      return { page: 'logout' };
    }

    user = loaded;
    return { page: 'user' };
  })());
}

function renderUser(): Observable<Slice> {
  return combineLatest([
    renderTopBar(),

    from((async () => {
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
      }

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
      return bandsDiv;
    })())
  ]).pipe(map(([l,r]) => ({ topDiv: l, mainDiv: r })));
}

function renderBand(): Observable<Slice> {
  return combineLatest([
    renderTopBar(),

    tracks.getTracks(band.bid).pipe(
      takeUntil(newPage$),

      concatMap(trackList => {
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
          tracks.add(track);
        };

        const div = document.createElement('div');
        div.appendChild(header);
        div.appendChild(recordingsUl);
        div.appendChild(button);
        return [div];
      })
    )
  ]).pipe(map(([l,r]) => ({ topDiv: l, mainDiv: r })));
}

function renderTopBar(): Observable<HTMLElement> {
  return interval(1000).pipe(
    startWith(0),

    concatMap(_ => {
      const nameSpan = document.createElement('span');
      nameSpan.innerText = session.uid;
      nameSpan.onclick = () => page$.next('user');

      const logoutButton = document.createElement('input');
      logoutButton.type = 'button';
      logoutButton.value = 'Log out';
      logoutButton.onclick = () => page$.next('logout');

      const timeSpan = document.createElement('span');
      setInterval(() => timeSpan.innerHTML = Date.now().toString(), 1000);

      const div = document.createElement('div');
      div.appendChild(nameSpan);
      div.appendChild(logoutButton);
      div.appendChild(timeSpan);
      return [div];
    })
  )
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


