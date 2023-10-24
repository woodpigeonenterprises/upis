import Koa from "koa";

const app = new Koa();

app.use(async x => {

  // read id token from request`a
  // verify token based onpublic key`k


  
  x.body = 'HELLO VITNIJA!!!!! (from Jason)\n';
});

app.listen(9999);

//
// we receive id tokens
// and exchange them for a user context
// as a cookie maybe
// 
//
//
//
