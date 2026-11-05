import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {createHandler} from '../api/index.js';
const db=new PGlite();await db.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
const handler=createHandler(async()=>({query:(...args)=>db.query(...args),release(){}}));
process.env.ADMIN_TOKEN='test-only-admin-secret-'.repeat(3);
async function call(body,auth=true,method='POST',ip='127.0.0.10'){
 const req={method,body,headers:{authorization:auth?`Bearer ${process.env.ADMIN_TOKEN}`:''},socket:{remoteAddress:ip}};
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(v){this.body=v;}};
 await handler(req,res);return res;
}
after(()=>db.close());
test('API lifecycle: admin creates, client activates, admin revokes, client refused',async()=>{
 assert.equal((await call({action:'create'},false)).code,401);
 const created=await call({action:'create',label:'<script>not HTML</script>',durationDays:14,maxDevices:1});assert.equal(created.code,201);assert.ok(created.body.key);
 const list=await call({action:'list'});assert.equal(list.code,200);assert.equal(list.body.licenses.length,1);assert.equal(list.body.licenses[0].key_hash,undefined);assert.equal(list.body.licenses[0].key,undefined);
 const input={key:created.body.key,deviceId:'installation-0000001',platform:'android'};
 assert.equal((await call({action:'check',...input},false)).code,403);
 assert.equal((await call({action:'activate',...input},false)).body.valid,true);
 assert.equal((await call({action:'check',...input},false)).body.valid,true);
 assert.equal((await call({action:'revoke',id:created.body.id})).code,200);
 assert.equal((await call({action:'check',...input},false)).code,403);
});
test('API rejects malformed bodies, unsupported methods, and invalid ids',async()=>{
 assert.equal((await call('{broken')).code,400);
 assert.equal((await call('x'.repeat(4097))).code,413);
 assert.equal((await call({action:'list'},true,'GET')).code,405);
 assert.equal((await call({action:'revoke',id:"' OR 1=1"})).code,400);
 assert.equal((await call({action:'unsupported'})).code,400);
});
test('unauthenticated admin attempts hit a persistent rate limit',async()=>{
 for(let i=0;i<60;i++)assert.equal((await call({action:'list'},false,'POST','192.0.2.1')).code,401);
 const result=await call({action:'list'},false,'POST','192.0.2.1');assert.equal(result.code,429);assert.equal(result.headers['Retry-After'],'60');
});
