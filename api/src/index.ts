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

  const [userId, jwt] = await verifyJwt(token);
  console.log(userId);
  console.log(jwt);

  // as long as client has token from us with DynamoDb pre-signed URL
  // then they can enquire themselves about bands etc

  

  // const bands = await getBands(userId);
  // console.log(bands);


  //instead of getting bands individually
  //we should just give access to the one DynamoDb root
  //then it's up to the client to poll this
  //and request further links with token

  //we give band urls when we are asked for them
  //(and should verify membership at that point, rather than creating useless signedlinks up front)




  // now we know the canonical userId
  // we should return a signed link to poll DynamoDb for user details (eg memberships)
  // this root will tell the user which bands are available
  //
  // but the user is really after dynamodb urls
  // to allow scanning for all band recordings
  // or S3 list command???
  //

  // 
  //
  //
  //



  

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


async function verifyJwt(token: string): Promise<[UserId, jsonwebtoken.JwtPayload]> {
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

