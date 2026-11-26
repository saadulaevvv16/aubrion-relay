const http = require('http');
const fs = require('fs');
const path = require('path');
http.createServer((req,res)=>{
 const u = new URL(req.url,'http://localhost');
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.writeHead(405);return res.end();}
 if(u.pathname==='/api/state'){
  const upstream=http.get({hostname:'127.0.0.1',port:8080,path:'/api/state'+u.search,timeout:5000},r=>{
   res.writeHead(r.statusCode,{'Content-Type':'application/json; charset=utf-8'});r.pipe(res);
  });
  upstream.on('timeout',()=>upstream.destroy());
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
  return;
 }
 if(u.pathname!=='/'&&u.pathname!=='/readonly.html'){res.writeHead(404);return res.end();}
 fs.readFile(path.join(__dirname,'readonly.html'),(err,data)=>{
  if(err){res.writeHead(500);return res.end('Missing test page');}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(data);
 });
}).listen(8081,'127.0.0.1',()=>console.log('AUBRION read-only proxy on 127.0.0.1:8081'));
