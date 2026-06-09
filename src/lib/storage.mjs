import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const DATA_DIR = resolve(process.env.DATA_DIR || './data');

let writeLock = Promise.resolve();

export function withLock(fn) {
  const next = writeLock.then(fn, fn);
  writeLock = next.catch(() => {});
  return next;
}

function resolveDataFile(file) {
  return resolve(DATA_DIR, file);
}

export async function readCollection(file) {
  const path = resolveDataFile(file);
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      throw new Error(`Data file corrupted: ${path}`);
    }
    throw new Error(`Cannot read data file: ${path} (${error.code})`);
  }
}

export async function writeCollection(file, items) {
  const path = resolveDataFile(file);
  await mkdir(dirname(path), { recursive: true });
  // Write to a temp file and rename — rename is atomic on the same filesystem,
  // so a crash mid-write cannot leave a partially written collection behind.
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(items, null, 2), 'utf-8');
  await rename(tmp, path);
}
