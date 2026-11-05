import pg from 'pg';
let pool;
export async function connect() {
 if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
 pool ??= new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:8000,idleTimeoutMillis:10000,allowExitOnIdle:true});
 return pool.connect();
}
