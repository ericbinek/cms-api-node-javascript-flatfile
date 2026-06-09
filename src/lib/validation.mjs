import { createHash } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const MAX_STRING_LENGTH = 100000;

export function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isDangerousKey(k) {
  return DANGEROUS_KEYS.has(k);
}

export function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\0/g, '').normalize('NFC');
}

export function deepSanitize(value) {
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(deepSanitize);
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isDangerousKey(k)) continue;
      out[k] = deepSanitize(v);
    }
    return out;
  }
  return value;
}

export function isValidUUID(s) {
  return typeof s === 'string' && UUID_PATTERN.test(s);
}

export function normalizeUUID(s) {
  return typeof s === 'string' ? s.toLowerCase() : s;
}

export function isText(v) {
  return typeof v === 'string' && v.length <= MAX_STRING_LENGTH;
}
export function isInteger(v) {
  return typeof v === 'number' && Number.isInteger(v);
}
export function isNumberValue(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
export function isBoolean(v) {
  return typeof v === 'boolean';
}
export function isDateTime(v) {
  return typeof v === 'string' && ISO_DATETIME_PATTERN.test(v);
}
export function isHttpUrl(v) {
  return typeof v === 'string' && HTTP_URL_PATTERN.test(v);
}

export function isEmbed(v, type) {
  return isObject(v) && v['@type'] === type;
}

const SCALAR_CHECKS = {
  Text: isText,
  Integer: isInteger,
  Number: isNumberValue,
  Boolean: isBoolean,
  Date: isDateTime,
  DateTime: isDateTime,
  Time: isDateTime,
  URL: isHttpUrl,
};

export function checkScalar(type, value) {
  const fn = SCALAR_CHECKS[type] || isText;
  return fn(value);
}

export function etagFor(item) {
  const hash = createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 16);
  return `"${hash}"`;
}
