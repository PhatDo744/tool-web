import { connect } from "../lib/db.js";
import { publicSigningKey } from "../lib/license-ticket.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  let db;
  try {
    db = await connect();
    const key = await publicSigningKey(db);
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    return res.status(200).end(key.public_xml);
  } catch (e) {
    console.error("Signing public key unavailable:", e.code || e.name);
    return res.status(503).end("Public key unavailable");
  } finally {
    db?.release();
  }
}
