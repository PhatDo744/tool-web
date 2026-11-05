import { connect } from '../lib/db.js';
import { adminTokenConfigured, adminAuthorized, ApiError, hash, newLicense, verifyLicense } from '../lib/core.js';
export function createHandler(getConnection = connect) {
return async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 const send=(status,data)=>res.status(status).json(data);
 let db;
 try {
  if(req.method !== 'POST') {res.setHeader('Allow','POST'); return send(405,{error:'METHOD_NOT_ALLOWED'});}
  let input=req.body;
  if(Buffer.isBuffer(input)) input=input.toString();
  if(typeof input==='string') { if(Buffer.byteLength(input)>4096) throw new ApiError(413,'BODY_TOO_LARGE'); try{input=JSON.parse(input);}catch{throw new ApiError(400,'INVALID_JSON');} }
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new ApiError(400,'INVALID_INPUT');
  if(Buffer.byteLength(JSON.stringify(input))>4096) throw new ApiError(413,'BODY_TOO_LARGE');
  const {action}=input;
  if(!['list','create','revoke','activate','check'].includes(action)) throw new ApiError(400,'UNKNOWN_ACTION');
  db=await getConnection();
  // Vercel overwrites x-vercel-forwarded-for. Local development uses socket IP.
  const ip=process.env.VERCEL ? req.headers['x-vercel-forwarded-for'] : req.socket?.remoteAddress;
  const bucket=hash(`${ip || 'unknown'}:${['activate','check'].includes(action)?'client':'admin'}`);
  await db.query('DELETE FROM rate_limits WHERE reset_at < now()');
  const {rows:[limit]}=await db.query("INSERT INTO rate_limits(bucket,hits,reset_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(bucket) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits",[bucket]);
  if(limit.hits>60) {res.setHeader('Retry-After','60');throw new ApiError(429,'RATE_LIMITED');}
  if(action==='activate'||action==='check') return send(200,await verifyLicense(db,input,action==='activate'));
  if(!adminTokenConfigured()) throw new ApiError(503,'ADMIN_NOT_CONFIGURED');
  if(!adminAuthorized(req.headers.authorization)) throw new ApiError(401,'UNAUTHORIZED');
  if(action==='create') {
   const value=newLicense(input);
   await db.query('INSERT INTO licenses(id,key_hash,label,duration_days,max_devices) VALUES($1,$2,$3,$4,$5)',[value.id,value.keyHash,value.label,value.durationDays,value.maxDevices]);
   return send(201,{id:value.id,key:value.key});
  }
  if(action==='revoke') {
   if(typeof input.id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) throw new ApiError(400,'INVALID_ID');
   const result=await db.query('UPDATE licenses SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 RETURNING id',[input.id]);
   if(!result.rows.length) throw new ApiError(404,'NOT_FOUND');
   return send(200,{ok:true});
  }
  const {rows}=await db.query('SELECT l.id,l.label,l.duration_days,l.max_devices,l.created_at,l.activated_at,l.expires_at,l.revoked_at,(SELECT count(*)::int FROM devices d WHERE d.license_id=l.id) AS devices FROM licenses l ORDER BY created_at DESC LIMIT 200');
  return send(200,{licenses:rows});
 }catch(e){if(!e.status)console.error('API failure:',e.code || e.name);return send(e.status||503,{error:e.status?e.message:'SERVICE_UNAVAILABLE'});}
 finally{db?.release();}
}

}
export default createHandler();
