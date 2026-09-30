import { HttpError } from './errors.js';

const bad = (message) => {
  throw new HttpError(400, 'VALIDATION_ERROR', message);
};
export function text(value, label, min, max) {
  if (typeof value !== 'string') bad(`${label} must be text.`);
  const clean = value.normalize('NFC').trim();
  if (clean.length < min || clean.length > max)
    bad(`${label} must contain ${min}–${max} characters.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(clean))
    bad(`${label} contains unsupported characters.`);
  return clean;
}
export function id(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) bad('Invalid item ID.');
  return value;
}
export function imageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) bad('Enter a valid HTTPS image URL.');
  let url;
  try {
    url = new URL(value);
  } catch {
    bad('Enter a valid HTTPS image URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    bad('Image URLs must use public HTTPS.');
  return url.href;
}
export function order(value) {
  if (!Number.isInteger(value) || value < 0 || value > 9999)
    bad('Order must be a whole number between 0 and 9999.');
  return value;
}
export function uploadPath(value, collection, uid) {
  if (
    typeof value !== 'string' ||
    !/^[\w-]{1,128}$/.test(uid) ||
    !new RegExp(`^${collection}/${uid}/[a-f0-9-]{36}\\.(jpg|jpeg|png|webp|gif)$`, 'i').test(value)
  )
    bad('Choose a photo uploaded by your account.');
  return value;
}
export function pagination(query) {
  const limit = query.limit === undefined ? 24 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) bad('Limit must be between 1 and 100.');
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 512))
    bad('Invalid pagination cursor.');
  return { limit, cursor: query.cursor || null };
}
