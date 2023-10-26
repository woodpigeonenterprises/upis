import Koa from "koa";
import Router from "@koa/router";
import cors from "@koa/cors";
import bodyparser from "koa-bodyparser";
import jsonwebtoken from "jsonwebtoken";
import { createPublicKey, JsonWebKey } from "crypto";

const app = new Koa();
const router = new Router();

router.get('/', x => x.body = 'Hello!');

router.post('/session', async x => {
  console.log(x.request.body);

  const token = (x.request.body as any).token;
  if(typeof token !== 'string') throw Error('Body not string');

  const jwt = await verifyJwt(token);

  console.log(jwt);

  x.body = '{}';
});

app
  .use(cors({
    origin: 'http://localhost:8080',
    allowMethods: ['GET','PUT','POST']
  }))
  .use(bodyparser())
  .use(router.routes())
  .use(router.allowedMethods())
  .listen(9999);

//
// we receive id tokens
// and exchange them for a user context
// as a cookie maybe
// 
//
//
//


async function verifyJwt(token: string): Promise<jsonwebtoken.JwtPayload> {
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
      return jsonwebtoken.verify(token, key, {complete:true});
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

type JwkPayload = {
  keys: JsonWebKey[]
};
