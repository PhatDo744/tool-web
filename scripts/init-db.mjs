import { readFile } from 'node:fs/promises';
import { connect } from '../lib/db.js';
const db=await connect();
try {await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));console.log('Database initialized');} finally{db.release();}
