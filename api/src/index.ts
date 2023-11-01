import Koa from "koa";
import Router from "@koa/router";
import cors from "@koa/cors";
import bodyparser from "koa-bodyparser";
import jsonwebtoken from "jsonwebtoken";
import { createPublicKey, createPrivateKey, JsonWebKey } from "crypto";
import { userExists, getUserAwsCreds, createBand } from "./users.js";
import fs from "fs";
import { err } from "./util.js";

const app = new Koa();
const router = new Router();

router.get('/', x => x.body = 'UPISAPI™');

router.post('/session', async x => {
  console.log(x.request.body);

  const token = (x.request.body as any).token;
  if(typeof token !== 'string') {
    x.status = 400;
    return;
  }

  const verified = await verifyExternalJwt(token);
  if(!verified) {
    x.status = 403;
    return;
  }

  const [uid, jwt] = verified;
  console.log(uid);
  console.log(jwt);

  if(!await userExists(uid)) {
    x.status = 404;
    return;
  }

  const sessionExpires = (30 * 60 * 1000) + Date.now();
  //todo this needs to match aws creds too!!!

  const [userJwt, awsCreds] = await Promise.all([
    buildJwt({
      sub: uid,
      exp: sessionExpires
    }),
    getUserAwsCreds(uid)
  ]);

  x.status = 201;

  x.cookies.set(
    'upis_user',
    userJwt,
    {
      expires: new Date(sessionExpires),
      httpOnly: true,
      sameSite: 'strict'
      //should also be 'secure' if we are serving from https
    });

  x.body = {
    uid,
    aws: awsCreds,
    expires: sessionExpires
  };
});

router.post('/band', async x => {
  const cookie = x.cookies.get('upis_user') || err('No cookie on request');
  const uid = (await verifyUpisJwt(cookie)) || err('Bad JWT');

  const name = (<any>x.request.body).name;
  if(typeof name !== 'string') err('Bad name prop');

  await createBand(uid, name);

  x.status = 201;
});

app
  .use(cors({
    origin: 'http://localhost:8081',
    allowMethods: ['GET','PUT','POST'],
    credentials: true
  }))
  .use(bodyparser())
  .use(router.routes())
  .use(router.allowedMethods())
  .listen(9999);

async function verifyUpisJwt(token: string): Promise<false|UserId> {
  const jwt = jsonwebtoken.verify(token, upisPublicKey); //todo maxAge!!!!!
  if(typeof jwt === 'string') throw Error('JWT payload not deserialised');
  return jwt.sub!;
}

async function verifyExternalJwt(token: string): Promise<false|[UserId, jsonwebtoken.JwtPayload]> {
  const jwt = jsonwebtoken.decode(token, {json:true, complete:true});
  if(!jwt) throw Error(`No jwt decoded`);

  if(typeof jwt.payload === 'string') {
    throw Error(`String encountered: ${jwt.payload}`);
  }

  switch(jwt.payload.iss) {
    case 'https://accounts.google.com':
      const jwkResp = await fetch('https://www.googleapis.com/oauth2/v3/certs');
      const jwkPayload = await jwkResp.json();
      if(!isJwkPayload(jwkPayload)) throw Error('Bad JWK');

      const foundJwk = jwkPayload.keys.find(k => k.kid == jwt.header.kid);
      if(!foundJwk) throw Error("Can't find matching JWK entry");

      const key = createPublicKey({ format:'jwk', key: foundJwk })

      //TODO also need to verify exp!!!!!!
      const verified = jsonwebtoken.verify(token, key, {complete:false});
      if(typeof verified === 'string') throw Error('JWT payload is not json');

      const email = verified.email;
      if(typeof email !== 'string') throw Error('Missing expected email claim');

      return [email, verified];
  }

  throw Error('Issuer of JWT not recognised');
}

function isJwkPayload(v: any): v is JwkPayload {
  const keys = v.keys;
  return keys
    && Array.isArray(keys)
    && keys.every(isJwk);
}

function isJwk(v: any): v is JsonWebKey {
  return typeof v.kid === 'string'
    && typeof v.kty === 'string'
    && typeof v.alg === 'string'
    && typeof v.n === 'string';
}


const pem = fs.readFileSync('./upis.pem');
const upisPrivateKey = createPrivateKey(pem);
const upisPublicKey = createPublicKey(upisPrivateKey);

async function buildJwt(payload: unknown): Promise<string> {
  const jwt = jsonwebtoken.sign(JSON.stringify(payload), upisPrivateKey, { algorithm: 'RS512' });
  return jwt;
}

type JwkPayload = {
  keys: JsonWebKey[]
};



type UserId = string;

// type Band = {
//   name: string
// }


// async function getBands(id: UserId): Promise<Band[]> {
//   return [{
//     id: 'test123',
//     name: 'The Cocker Spaniels'
//   }];
// }

