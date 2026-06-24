import { randomUUID } from 'node:crypto';
import {
  isObject,
  isDangerousKey,
  isValidUUID,
  normalizeUUID,
  checkScalar,
  isEmbed,
  sanitizeString,
  deepSanitize,
  etagFor,
} from '../lib/validation.mjs';
import { withLock, readCollection, writeCollection } from '../lib/storage.mjs';

const COLLECTION_FILE = "persons.json";
const TYPE_NAME = 'Person';

const FIELDS = {
  "name": { kind: 'scalar', type: "Text", cardinality: "one", maxLength: 256 },
  "givenName": { kind: 'scalar', type: "Text", cardinality: "one", maxLength: 256 },
  "familyName": { kind: 'scalar', type: "Text", cardinality: "one", maxLength: 256 },
  "alternateName": { kind: 'scalar', type: "Text", cardinality: "one", maxLength: 256 },
  "email": { kind: 'scalar', type: "Text", cardinality: "one", maxLength: 320 },
  "url": { kind: 'scalar', type: "URL", cardinality: "one", maxLength: 2048 },
  "description": { kind: 'scalar', type: "Text", cardinality: "one", maxLength: 5000, multiline: true },
  "image": { kind: 'ref', targets: ["ImageObject"], cardinality: "one" },
  "worksFor": { kind: 'ref', targets: ["Organization"], cardinality: "one" },
  "jobTitle": { kind: 'scalar', type: "Text", cardinality: "one", maxLength: 256 },
  "sameAs": { kind: 'scalar', type: "URL", cardinality: "many", maxLength: 2048 },
};
const FIELD_NAMES = new Set(Object.keys(FIELDS));
const REQUIRED_FIELDS = new Set(["name"]);
const SEARCHABLE_FIELDS = new Set(["name","givenName","familyName","alternateName","email","description","jobTitle"]);
const SORTABLE_FIELDS = new Set(["dateCreated", "dateModified", ...["name","givenName","familyName","alternateName","email","url","description","jobTitle"]]);

const SYSTEM_FIELDS = new Set(['id', 'dateCreated', 'dateModified', '@context', '@type']);

const REF_COLLECTIONS = {"ImageObject":"image-objects.json","Organization":"organizations.json"};

// Properties whose combined value must be unique across the collection. Empty
// when the entity allows duplicates.
const UNIQUE_KEY = [];

function isEmpty(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function checkOne(spec, value, path) {
  const errors = [];
  if (spec.kind === 'scalar') {
    if (!checkScalar(spec.type, value)) {
      errors.push(`Field "${path}" must be a ${spec.type}.`);
    } else if (spec.maxLength !== undefined && typeof value === 'string' && value.length > spec.maxLength) {
      errors.push(`Field "${path}" must be at most ${spec.maxLength} characters.`);
    }
  } else if (spec.kind === 'enum') {
    if (!spec.values.includes(value)) {
      errors.push(`Field "${path}" must be one of: ${spec.values.join(', ')}.`);
    }
  } else if (spec.kind === 'ref') {
    if (!isValidUUID(value)) {
      errors.push(`Field "${path}" must be a UUID.`);
    }
  } else if (spec.kind === 'embed') {
    if (!isEmbed(value, spec.type)) {
      errors.push(`Field "${path}" must be an inline ${spec.type} embed with @type set.`);
    }
  }
  return errors;
}

function checkField(spec, value, name) {
  if (spec.cardinality === 'many') {
    if (!Array.isArray(value)) {
      return [`Field "${name}" must be an array.`];
    }
    const errors = [];
    for (let i = 0; i < value.length; i++) {
      errors.push(...checkOne(spec, value[i], `${name}[${i}]`));
    }
    return errors;
  }
  return checkOne(spec, value, name);
}

export function validate(data, { partial = false } = {}) {
  if (!isObject(data)) return ['Request body must be a JSON object.'];

  const errors = [];

  for (const key of Object.keys(data)) {
    if (isDangerousKey(key)) {
      errors.push(`Unknown field "${key}".`);
      continue;
    }
    if (!FIELD_NAMES.has(key) && !SYSTEM_FIELDS.has(key)) {
      errors.push(`Unknown field "${key}".`);
    }
  }

  if (!partial) {
    for (const field of REQUIRED_FIELDS) {
      if (isEmpty(data[field])) {
        errors.push(`Field "${field}" is required.`);
      }
    }
  } else {
    // A partial update may omit a required field, but must not blank one that
    // is present — that would leave the resource violating its own contract.
    for (const field of REQUIRED_FIELDS) {
      if (field in data && isEmpty(data[field])) {
        errors.push(`Field "${field}" must not be empty.`);
      }
    }
  }

  for (const [name, spec] of Object.entries(FIELDS)) {
    const value = data[name];
    if (value === undefined) continue;
    errors.push(...checkField(spec, value, name));
  }

  return errors;
}

// Field-aware input cleaning, run before validation and storage: each known
// scalar string is normalized, stripped of control characters and trimmed,
// with long-form (multiline) fields keeping their internal line breaks. Refs,
// embeds, arrays and other values fall back to the conservative property-blind
// sanitizer. The body is cleaned in place: every key is left where it is —
// dangerous keys (__proto__, …) are deliberately untouched so validate() can
// reject the body, rather than silently dropped here.
export function sanitize(data) {
  if (!isObject(data)) return data;
  for (const key of Object.keys(data)) {
    if (isDangerousKey(key)) continue;
    const value = data[key];
    const spec = FIELDS[key];
    if (spec && spec.kind === 'scalar' && typeof value === 'string') {
      data[key] = sanitizeString(value, { multiline: spec.multiline === true });
    } else {
      data[key] = deepSanitize(value);
    }
  }
  return data;
}

function normalizeRefs(data) {
  const out = { ...data };
  for (const [name, spec] of Object.entries(FIELDS)) {
    if (spec.kind !== 'ref' || out[name] === undefined) continue;
    if (spec.cardinality === 'many' && Array.isArray(out[name])) {
      out[name] = out[name].map(normalizeUUID);
    } else if (typeof out[name] === 'string') {
      out[name] = normalizeUUID(out[name]);
    }
  }
  return out;
}

// Type-aware ordering: numbers compare numerically, booleans as booleans,
// everything else lexicographically by string form. Missing values (null or
// absent) always sort last, regardless of order — never coerced to ''.
function compareForSort(va, vb, direction) {
  const aMissing = va === undefined || va === null;
  const bMissing = vb === undefined || vb === null;
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0;
    return aMissing ? 1 : -1;
  }
  let cmp;
  if (typeof va === 'number' && typeof vb === 'number') {
    cmp = va < vb ? -1 : va > vb ? 1 : 0;
  } else if (typeof va === 'boolean' && typeof vb === 'boolean') {
    cmp = va === vb ? 0 : va ? 1 : -1;
  } else {
    const sa = String(va);
    const sb = String(vb);
    cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return cmp * direction;
}

export async function findAll({ filter = {}, sort = 'dateCreated', order = 'desc', limit = 20, offset = 0 } = {}) {
  let results = await readCollection(COLLECTION_FILE);

  for (const [field, value] of Object.entries(filter)) {
    if (!SEARCHABLE_FIELDS.has(field)) continue;
    const needle = String(value).toLowerCase();
    results = results.filter((item) =>
      typeof item[field] === 'string' && item[field].toLowerCase().includes(needle));
  }

  const sortField = SORTABLE_FIELDS.has(sort) ? sort : 'dateCreated';
  const direction = order === 'asc' ? 1 : -1;
  results.sort((a, b) => compareForSort(a[sortField], b[sortField], direction));

  const total = results.length;
  const items = results.slice(offset, offset + limit);
  return { items, total };
}

export async function findById(id) {
  if (!isValidUUID(id)) return null;
  const items = await readCollection(COLLECTION_FILE);
  const normalized = normalizeUUID(id);
  return items.find((item) => item.id === normalized) || null;
}

// Embeds referenced entities one level deep for single-resource GET (JSON-LD
// style): each ref UUID is replaced by the referenced object. List responses
// stay flat. Embedded objects keep their own refs as UUIDs; a ref that no
// longer resolves is left as the stored UUID string.
export async function embedRefs(item) {
  const cache = new Map();
  const load = async (file) => {
    if (!cache.has(file)) cache.set(file, await readCollection(file));
    return cache.get(file);
  };
  const resolveRef = async (id, targets) => {
    if (typeof id !== 'string') return id;
    for (const target of targets) {
      const file = REF_COLLECTIONS[target];
      if (!file) continue;
      const found = (await load(file)).find((entry) => entry.id === id);
      if (found) return found;
    }
    return id;
  };
  const out = { ...item };
  for (const [name, spec] of Object.entries(FIELDS)) {
    if (spec.kind !== 'ref' || out[name] === undefined || out[name] === null) continue;
    if (spec.cardinality === 'many') {
      if (!Array.isArray(out[name])) continue;
      out[name] = await Promise.all(out[name].map((id) => resolveRef(id, spec.targets)));
    } else {
      out[name] = await resolveRef(out[name], spec.targets);
    }
  }
  return out;
}

// A candidate collides when some other record shares every unique-key value.
// Comparison runs on already-sanitized, ref-normalized data, so equal values
// are in canonical form. Entities without a key never collide.
function violatesUniqueKey(items, candidate, excludeId) {
  if (UNIQUE_KEY.length === 0) return false;
  return items.some((item) =>
    item.id !== excludeId && UNIQUE_KEY.every((field) => item[field] === candidate[field]));
}

function duplicateError() {
  const message = `A ${TYPE_NAME} with this ${UNIQUE_KEY.join(' and ')} already exists.`;
  const error = new Error(message);
  error.name = 'DuplicateError';
  error.details = [message];
  return error;
}

export function create(rawData) {
  return withLock(async () => {
    const data = normalizeRefs(rawData);
    const items = await readCollection(COLLECTION_FILE);
    if (violatesUniqueKey(items, data, null)) throw duplicateError();
    const now = new Date().toISOString();
    const item = {
      ...data,
      '@context': 'https://schema.org',
      '@type': TYPE_NAME,
      id: randomUUID(),
      dateCreated: now,
      dateModified: now,
    };
    items.push(item);
    await writeCollection(COLLECTION_FILE, items);
    return item;
  });
}

export function update(id, rawData) {
  return withLock(async () => {
    const items = await readCollection(COLLECTION_FILE);
    const normalized = normalizeUUID(id);
    const index = items.findIndex((item) => item.id === normalized);
    if (index === -1) return null;

    const data = normalizeRefs(rawData);
    const updated = {
      ...items[index],
      ...data,
      '@context': items[index]['@context'],
      '@type': items[index]['@type'],
      id: items[index].id,
      dateCreated: items[index].dateCreated,
      dateModified: new Date().toISOString(),
    };
    if (violatesUniqueKey(items, updated, updated.id)) throw duplicateError();
    items[index] = updated;
    await writeCollection(COLLECTION_FILE, items);
    return updated;
  });
}

export function remove(id) {
  return withLock(async () => {
    const items = await readCollection(COLLECTION_FILE);
    const normalized = normalizeUUID(id);
    const filtered = items.filter((item) => item.id !== normalized);
    if (filtered.length === items.length) return false;
    await writeCollection(COLLECTION_FILE, filtered);
    return true;
  });
}

export function etagOf(item) {
  return etagFor(item);
}

export const SCHEMA = { FIELDS, REQUIRED_FIELDS, SEARCHABLE_FIELDS, SORTABLE_FIELDS, UNIQUE_KEY, TYPE_NAME, COLLECTION_FILE };
