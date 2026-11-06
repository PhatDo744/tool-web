import {
  generateKeyPair,
  createPublicKey,
  sign,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { sealKey, openKey } from "./key-vault.js";
import { hash } from "./core.js";
const generate = promisify(generateKeyPair);
const keyId = "primary";
let cachedSigner;
export async function publicSigningKey(db) {
  let {
    rows: [row],
  } = await db.query(
    "SELECT public_xml,private_encrypted FROM license_signing_keys WHERE id=$1",
    [keyId],
  );
  if (!row) {
    const pair = await generate("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const jwk = createPublicKey(pair.publicKey).export({ format: "jwk" });
    const xml = `<RSAKeyValue><Modulus>${Buffer.from(jwk.n, "base64url").toString("base64")}</Modulus><Exponent>${Buffer.from(jwk.e, "base64url").toString("base64")}</Exponent></RSAKeyValue>`;
    await db.query(
      "INSERT INTO license_signing_keys(id,public_xml,private_encrypted) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
      [keyId, xml, sealKey(pair.privateKey, "license-signing-primary")],
    );
    ({
      rows: [row],
    } = await db.query(
      "SELECT public_xml,private_encrypted FROM license_signing_keys WHERE id=$1",
      [keyId],
    ));
  }
  return row;
}
export async function issueTicket(db, input, result) {
  const fingerprint = hash(
    `${process.env.LICENSE_ENCRYPTION_KEY || ""}\0${process.env.ADMIN_TOKEN || ""}`,
  );
  if (!cachedSigner || cachedSigner.fingerprint !== fingerprint) {
    const row = await publicSigningKey(db);
    cachedSigner = {
      fingerprint,
      xml: row.public_xml,
      pem: openKey(row.private_encrypted, "license-signing-primary"),
    };
  }
  const issued = Math.floor(new Date(result.serverTime).getTime() / 1000);
  const expiry = Math.min(
    issued + 300,
    Math.floor(new Date(result.expiresAt).getTime() / 1000),
  );
  if (!Number.isSafeInteger(issued) || expiry <= issued)
    throw Error("Invalid ticket lifetime");
  const kid = createHash("sha256").update(cachedSigner.xml).digest("hex");
  const payload = Buffer.from(
    [
      "v1",
      kid,
      hash(input.key.toUpperCase()),
      hash(input.deviceId),
      input.platform,
      issued,
      expiry,
    ].join("|"),
  );
  return (
    payload.toString("base64url") +
    "." +
    sign("RSA-SHA256", payload, cachedSigner.pem).toString("base64url")
  );
}
