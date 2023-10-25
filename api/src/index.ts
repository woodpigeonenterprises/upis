import Koa from "koa";
import Router from "@koa/router";
import cors from "@koa/cors";
import bodyparser from "koa-bodyparser";
import jsonwebtoken from "jsonwebtoken";

const app = new Koa();
const router = new Router();

router.get('/', x => x.body = 'Hello!');

router.post('/session', x => {
  console.log(x.request.body);

  const token = x.request.body.token;

  if(typeof token === 'string') {
    const jwt = jsonwebtoken.decode(token, {json:true});
    console.log('JWT', jwt);
  }

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
