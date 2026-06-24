import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import * as BlogPosting from '../src/models/BlogPosting.mjs';
import * as Person from '../src/models/Person.mjs';
import * as Organization from '../src/models/Organization.mjs';
import * as WebPage from '../src/models/WebPage.mjs';
import * as ImageObject from '../src/models/ImageObject.mjs';
import * as VideoObject from '../src/models/VideoObject.mjs';
import * as AudioObject from '../src/models/AudioObject.mjs';
import * as CategoryCode from '../src/models/CategoryCode.mjs';
import * as CategoryCodeSet from '../src/models/CategoryCodeSet.mjs';
import * as DefinedTerm from '../src/models/DefinedTerm.mjs';
import * as DefinedTermSet from '../src/models/DefinedTermSet.mjs';
import * as Comment from '../src/models/Comment.mjs';
import * as WebSite from '../src/models/WebSite.mjs';
import * as SiteNavigationElement from '../src/models/SiteNavigationElement.mjs';
import { hashPassword } from '../src/models/account.mjs';
import { READONLY_FIELDS } from '../src/lib/access.mjs';

const MODELS = {
  BlogPosting,
  Person,
  Organization,
  WebPage,
  ImageObject,
  VideoObject,
  AudioObject,
  CategoryCode,
  CategoryCodeSet,
  DefinedTerm,
  DefinedTermSet,
  Comment,
  WebSite,
  SiteNavigationElement,
};

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

function pluralKebab(name) {
  return name.replace(/([A-Z])/g, '-$1').replace(/^-/, '').toLowerCase() + 's';
}

// Ask the OS for a free port instead of guessing one. Test files run in
// parallel; a guessed port from a fixed range collides under load (EADDRINUSE).
function freePort() {
  return new Promise((res, rej) => {
    const probe = createServer();
    probe.once('error', rej);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => res(port));
    });
  });
}

// Auth is mandatory on writes. The entity suite drives the API as an admin (who
// sees and may do everything), so the CRUD contract is exercised unchanged. The
// active bearer token is module scoped so the request helpers can attach it
// without threading it through every call.
const DEFAULT_ADMIN = { username: 'admin', password: 'bootstrap-admin-secret', role: 'admin' };
let authToken = null;

function authHeaders(extra = {}) {
  return authToken ? { Authorization: `Bearer ${authToken}`, ...extra } : { ...extra };
}

// fetch with the active bearer token attached (caller headers win on conflict).
export function authedFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: authHeaders(opts.headers || {}) });
}

export function setAuthToken(token) {
  authToken = token;
}

function accountRecord({ username, password, role }) {
  return { id: randomUUID(), username, passwordHash: hashPassword(password), role };
}

export async function login(baseUrl, username, password) {
  const r = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (r.status !== 200) throw new Error(`login(${username}) failed with ${r.status}`);
  return (await r.json()).token;
}

// Starts a fresh server against a temp data dir. By default the account store is
// seeded with one admin, and the returned server carries that admin's token.
// Pass { accounts: [...] } to seed a specific set, or { env: { ADMIN_USER, ... } }
// to exercise the env bootstrap (no store written).
export async function startServer({ accounts, env } = {}) {
  const port = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), 'cms-test-'));

  let seed = accounts;
  if (seed === undefined && env === undefined) seed = [DEFAULT_ADMIN];
  if (seed !== undefined) {
    await writeFile(join(dataDir, 'accounts.json'), JSON.stringify(seed.map(accountRecord), null, 2));
  }

  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...(env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) {
        const admin = (seed || []).find((a) => a.role === 'admin');
        const token = admin ? await login(baseUrl, admin.username, admin.password) : null;
        authToken = token;
        return {
          baseUrl,
          dataDir,
          token,
          async stop() {
            authToken = null;
            child.kill('SIGTERM');
            await new Promise((r) => child.on('exit', r));
            await rm(dataDir, { recursive: true, force: true });
          },
        };
      }
    } catch {/* retry */}
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill('SIGTERM');
  await rm(dataDir, { recursive: true, force: true });
  throw new Error('Server did not start within 5 seconds');
}

const SCALAR_SAMPLES = {
  Text: 'sample text',
  Integer: 42,
  Number: 3.14,
  Boolean: true,
  Date: '2026-05-19T00:00:00Z',
  DateTime: '2026-05-19T12:00:00Z',
  Time: '2026-05-19T12:00:00Z',
  URL: 'https://example.com/resource',
};

async function sampleValue(baseUrl, spec) {
  if (spec.cardinality === 'many') {
    return [await sampleOne(baseUrl, spec)];
  }
  return sampleOne(baseUrl, spec);
}

async function sampleOne(baseUrl, spec) {
  if (spec.kind === 'scalar') return SCALAR_SAMPLES[spec.type] ?? 'sample';
  if (spec.kind === 'enum') return spec.values[0];
  if (spec.kind === 'embed') return { '@type': spec.type, alternateName: 'en' };
  if (spec.kind === 'ref') return await makeDep(baseUrl, spec.targets[0]);
  throw new Error(`unknown spec kind: ${spec.kind}`);
}

// Gives each build a distinct value for a unique-key string field. Without this
// every payload would carry the same sample value and the second create in any
// multi-record test would trip duplicate detection. Ref key components are
// already unique because each is freshly created per build.
function uniqueValue(type, base) {
  return type === 'URL' ? `${base}/${randomUUID()}` : `${base}-${randomUUID()}`;
}

// Builds a request body. System and internal fields are never sent — they are
// not client writable and would be rejected with 400.
export async function buildPayload(baseUrl, entity, { partial = false } = {}) {
  const Model = MODELS[entity];
  if (!Model) throw new Error(`unknown entity: ${entity}`);
  const key = new Set(Model.SCHEMA.UNIQUE_KEY || []);
  const payload = {};
  for (const [name, spec] of Object.entries(Model.SCHEMA.FIELDS)) {
    if (READONLY_FIELDS.has(name)) continue;
    if (!partial && !Model.SCHEMA.REQUIRED_FIELDS.has(name)) continue;
    payload[name] = await sampleValue(baseUrl, spec);
    if (key.has(name) && spec.kind === 'scalar' && typeof payload[name] === 'string') {
      payload[name] = uniqueValue(spec.type, payload[name]);
    }
  }
  return payload;
}

export async function makeDep(baseUrl, entity) {
  const Model = MODELS[entity];
  if (!Model) throw new Error(`unknown entity: ${entity}`);
  const payload = await buildPayload(baseUrl, entity);
  const r = await fetch(`${baseUrl}/${pluralKebab(entity)}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (r.status !== 201) {
    const text = await r.text();
    throw new Error(`makeDep(${entity}) failed with ${r.status}: ${text}`);
  }
  return (await r.json()).id;
}

export async function postEntity(baseUrl, entity, payload) {
  return fetch(`${baseUrl}/${pluralKebab(entity)}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
}
