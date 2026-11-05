import http from 'node:http';
import {readFile} from 'node:fs/promises';
import handler from './api/index.js';
const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
http.createServer(async(req,res)=>{
 if(req.url==='/api'||req.url==='/api/index') {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>4096){res.writeHead(413);res.end();return;}chunks.push(chunk);}
  req.body=Buffer.concat(chunks).toString();
  res.status=code=>{res.statusCode=code;return res;};res.json=data=>res.end(JSON.stringify(data));
  return handler(req,res);
 }
 const entry=files[req.url];if(!entry){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',entry[1]+'; charset=utf-8');res.end(await readFile(new URL('./public/'+entry[0],import.meta.url)));
}).listen(process.env.PORT||3000,'127.0.0.1',()=>console.log('Development server started'));
