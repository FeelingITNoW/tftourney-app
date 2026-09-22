import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Password hashing for player accounts, built on node:crypto's scrypt so no
// new dependency (bcrypt/argon2) is needed -- see AGENTS.md "Do not add
// dependencies casually."
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const SCRYPT_N = 16384; // CPU/memory cost, 2^14
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt's default maxmem (32 MiB) is too small for N=16384, r=8; the formula
// below matches Node's own `128 * N * r * 2` recommendation with headroom.
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

// A fixed salt/params used only to keep verifyPassword's timing identical
// whether or not a real stored hash exists, so a sign-in attempt against an
// unknown username costs the same as one against a known username with a
// wrong password (no username-enumeration timing oracle).
const DUMMY_SALT = Buffer.from("tftourney-player-credentials-dummy-salt");

type ParsedHash = { N: number; r: number; p: number; salt: Buffer; hash: Buffer };

// Stored format: scrypt$N$r$p$saltBase64url$hashBase64url
function parseStoredHash(stored: string | null | undefined): ParsedHash | null {
  if (!stored) return null;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N <= 0 || r <= 0 || p <= 0) return null;
  try {
    const salt = Buffer.from(parts[4], "base64url");
    const hash = Buffer.from(parts[5], "base64url");
    if (salt.length === 0 || hash.length === 0) return null;
    return { N, r, p, salt, hash };
  } catch {
    return null;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(plain, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

// Verifies a plaintext password against a stored hash. Always performs a
// scrypt derivation -- using the real stored salt/params when available, a
// fixed dummy salt/params otherwise -- so a missing or malformed stored hash
// takes the same time as a wrong password against a real one.
export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  const N = parsed?.N ?? SCRYPT_N;
  const r = parsed?.r ?? SCRYPT_R;
  const p = parsed?.p ?? SCRYPT_P;
  const salt = parsed?.salt ?? DUMMY_SALT;
  const keyLength = parsed?.hash.length ?? KEY_LENGTH;

  const derived = await scrypt(plain, salt, keyLength, { N, r, p, maxmem: SCRYPT_MAXMEM });
  if (!parsed) return false;
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}
