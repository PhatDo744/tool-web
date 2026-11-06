import { readFile } from "node:fs/promises";
import { connect } from "../lib/db.js";
import { publicSigningKey } from "../lib/license-ticket.js";
import { vaultConfigured } from "../lib/key-vault.js";
const db = await connect();
try {
  await db.query(
    await readFile(new URL("../schema.sql", import.meta.url), "utf8"),
  );
  if (vaultConfigured()) await publicSigningKey(db);
  console.log("Database initialized");
} finally {
  db.release();
}
