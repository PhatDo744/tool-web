import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {adminAuthorized,newLicense,verifyLicense} from '../lib/core.js';
const db=new PGlite();
await db.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
after(()=>db.close());
async function issue(options={}){const l=newLicense(options);await db.query('INSERT INTO licenses(id,key_hash,label,duration_days,max_devices) VALUES($1,$2,$3,$4,$5)',[l.id,l.keyHash,l.label,l.durationDays,l.maxDevices]);return l;}
const request=(l,device='device-install-id-0001')=>({key:l.key,deviceId:device,platform:'pc'});
test('admin requires configured strong secret and exact bearer',()=>{const s='a'.repeat(64);assert.equal(adminAuthorized(`Bearer ${s}`,s),true);assert.equal(adminAuthorized('Bearer wrong',s),false);assert.equal(adminAuthorized('Bearer short','short'),false);assert.equal(adminAuthorized(undefined,s),false);});
test('keys use unique cryptographic entropy and reject invalid creation parameters',()=>{const a=newLicense({}),b=newLicense({});assert.notEqual(a.key,b.key);assert.equal(a.durationDays,30);assert.equal(a.maxDevices,1);assert.notEqual(a.keyHash,a.key);for(const durationDays of [0,-1,3651,1.5,'30'])assert.throws(()=>newLicense({durationDays}));});
test('first activation starts duration; reactivation never extends expiry',async()=>{const l=await issue({durationDays:7});let {rows:[r]}=await db.query('SELECT activated_at,expires_at FROM licenses WHERE id=$1',[l.id]);assert.equal(r.activated_at,null);assert.equal(r.expires_at,null);const a=await verifyLicense(db,request(l),true);assert.equal(new Date(a.expiresAt)-new Date(a.serverTime),7*86400000);const b=await verifyLicense(db,request(l),true);assert.equal(new Date(a.expiresAt).getTime(),new Date(b.expiresAt).getTime());assert.equal((await verifyLicense(db,request(l))).valid,true);});
test('check cannot activate new device or start expiry',async()=>{const l=await issue();await assert.rejects(()=>verifyLicense(db,request(l)),{message:'ACTIVATION_REQUIRED'});const {rows:[r]}=await db.query('SELECT expires_at FROM licenses WHERE id=$1',[l.id]);assert.equal(r.expires_at,null);});
test('device limit enforced across pc and mobile; existing device still works',async()=>{const l=await issue({maxDevices:2});await verifyLicense(db,request(l),true);await verifyLicense(db,{...request(l,'device-install-id-0002'),platform:'android'},true);await assert.rejects(()=>verifyLicense(db,request(l,'device-install-id-0003'),true),{message:'DEVICE_LIMIT'});assert.equal((await verifyLicense(db,request(l))).valid,true);});
test('revoked and expired licenses cannot be activated or checked',async()=>{const l=await issue();await verifyLicense(db,request(l),true);await db.query('UPDATE licenses SET expires_at=now()-interval \'1 second\' WHERE id=$1',[l.id]);await assert.rejects(()=>verifyLicense(db,request(l)),{message:'LICENSE_INVALID'});const r=await issue();await db.query('UPDATE licenses SET revoked_at=now() WHERE id=$1',[r.id]);await assert.rejects(()=>verifyLicense(db,request(r),true),{message:'LICENSE_INVALID'});});
test('unknown and malformed keys rejected without leaking key existence',async()=>{await assert.rejects(()=>verifyLicense(db,request(newLicense({})),true),{message:'LICENSE_INVALID'});await assert.rejects(()=>verifyLicense(db,{key:'bad',deviceId:'short',platform:'pc'},true),{message:'INVALID_INPUT'});});
test('schema can be reapplied without losing licenses',async()=>{const before=await db.query('SELECT count(*) FROM licenses');await db.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));assert.deepEqual((await db.query('SELECT count(*) FROM licenses')).rows,before.rows);});
test('copied server token ignores surrounding whitespace but still rejects wrong tokens',()=>{
 const secret='b'.repeat(64);
 assert.equal(adminAuthorized(`Bearer ${secret}`,` \n${secret}\r\n`),true);
 assert.equal(adminAuthorized(`Bearer ${'c'.repeat(64)}`,` ${secret} `),false);
 assert.equal(adminAuthorized('Bearer '+ 'x'.repeat(31),' '+ 'x'.repeat(31)+' '),false);
});
