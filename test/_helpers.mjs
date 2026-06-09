import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as BlogPosting from '../src/models/BlogPosting.mjs';
import * as Person from '../src/models/Person.mjs';
import * as WebPage from '../src/models/WebPage.mjs';
import * as ImageObject from '../src/models/ImageObject.mjs';
import * as CategoryCode from '../src/models/CategoryCode.mjs';
import * as CategoryCodeSet from '../src/models/CategoryCodeSet.mjs';
import * as DefinedTerm from '../src/models/DefinedTerm.mjs';
import * as DefinedTermSet from '../src/models/DefinedTermSet.mjs';
import * as Comment from '../src/models/Comment.mjs';
import * as WebSite from '../src/models/WebSite.mjs';

const MODELS = {
  BlogPosting,
  Person,
  WebPage,
  ImageObject,
  CategoryCode,
  CategoryCodeSet,
  DefinedTerm,
  DefinedTermSet,
  Comment,
  WebSite,
};

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

function pluralKebab(name) {
  return name.replace(/([A-Z])/g, '-$1').replace(/^-/, '').toLowerCase() + 's';
}

let portCounter = 14000 + Math.floor(Math.random() * 1000);

export async function startServer() {
  const port = portCounter++;
  const dataDir = await mkdtemp(join(tmpdir(), 'cms-test-'));
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) {
        return {
          baseUrl,
          async stop() {
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

export async function buildPayload(baseUrl, entity, { partial = false } = {}) {
  const Model = MODELS[entity];
  if (!Model) throw new Error(`unknown entity: ${entity}`);
  const payload = {};
  for (const [name, spec] of Object.entries(Model.SCHEMA.FIELDS)) {
    if (!partial && !Model.SCHEMA.REQUIRED_FIELDS.has(name)) continue;
    payload[name] = await sampleValue(baseUrl, spec);
  }
  return payload;
}

export async function makeDep(baseUrl, entity) {
  const Model = MODELS[entity];
  if (!Model) throw new Error(`unknown entity: ${entity}`);
  const payload = await buildPayload(baseUrl, entity);
  const r = await fetch(`${baseUrl}/${pluralKebab(entity)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
