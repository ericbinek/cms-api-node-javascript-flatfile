import { randomUUID, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { withLock, readCollection, writeCollection } from '../lib/storage.mjs';

const COLLECTION_FILE = 'accounts.json';

// PBKDF2-HMAC-SHA256 — a built-in, salted, slow KDF. The stored string is self
// describing (algo, digest, iterations, salt, hash) so a future cost bump can
// verify old hashes and rehash on next login.
const ITERATIONS = 210000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return `pbkdf2$${DIGEST}$${ITERATIONS}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const [, digest, iterationsRaw, saltHex, hashHex] = parts;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, digest);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function findByUsername(username) {
  const accounts = await readCollection(COLLECTION_FILE);
  return accounts.find((a) => a.username === username) || null;
}

export async function findById(id) {
  const accounts = await readCollection(COLLECTION_FILE);
  return accounts.find((a) => a.id === id) || null;
}

// A dummy hash kept so an unknown username still runs one PBKDF2 verification:
// the response time does not reveal whether the username existed.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

export async function authenticate(username, password) {
  const account = await findByUsername(username);
  const ok = verifyPassword(password, account ? account.passwordHash : DUMMY_HASH);
  return ok && account ? account : null;
}

export function createAccount({ username, password, role }) {
  return withLock(async () => {
    const accounts = await readCollection(COLLECTION_FILE);
    if (accounts.some((a) => a.username === username)) {
      throw new Error(`Account already exists: ${username}`);
    }
    const account = { id: randomUUID(), username, passwordHash: hashPassword(password), role };
    accounts.push(account);
    await writeCollection(COLLECTION_FILE, accounts);
    return account;
  });
}

// Bootstrap: with an empty store and ADMIN_USER/ADMIN_PASSWORD set, the first
// start creates a single admin. Idempotent — a populated store is a no-op, and
// missing env vars leave the store empty (every protected write then 401s).
export function seedAdmin() {
  return withLock(async () => {
    const user = process.env.ADMIN_USER;
    const password = process.env.ADMIN_PASSWORD;
    if (!user || !password) return null;
    const accounts = await readCollection(COLLECTION_FILE);
    if (accounts.length > 0) return null;
    const account = { id: randomUUID(), username: user, passwordHash: hashPassword(password), role: 'admin' };
    await writeCollection(COLLECTION_FILE, [account]);
    return account;
  });
}
