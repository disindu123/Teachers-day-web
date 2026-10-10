import ipaddr from 'ipaddr.js';
import { HttpError } from './errors.js';

export const bad = (message) => {
  throw new HttpError(400, 'VALIDATION_ERROR', message);
};
export function text(value, label, min = 0, max = 300) {
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
  const clean = text(value, 'Image URL', 1, 2048);
  let u;
  try {
    u = new URL(clean);
  } catch {
    bad('Enter a public HTTPS image URL.');
  }
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    (u.port && u.port !== '443') ||
    u.hostname === 'localhost' ||
    u.hostname.endsWith('.localhost') ||
    u.hostname.endsWith('.local')
  )
    bad('Enter a public HTTPS image URL.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host) && ipaddr.process(host).range() !== 'unicast')
    bad('Use a public image URL.');
  return u.href;
}
export function socialUrl(value, kind) {
  if (!value) return '';
  const u = new URL(imageUrl(value));
  const hosts = {
    facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com'],
    linkedin: ['linkedin.com', 'www.linkedin.com'],
    whatsapp: ['wa.me', 'api.whatsapp.com'],
  };
  if (hosts[kind] && !hosts[kind].includes(u.hostname)) bad(`Use an official ${kind} URL.`);
  return u.href;
}
export function albumUrl(value) {
  const link = socialUrl(value, 'facebook');
  if (link && new URL(link).pathname === '/')
    bad('Paste the exact Facebook album URL, not the page homepage.');
  return link;
}
export function email(value) {
  const clean = text(value, 'Email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) bad('Enter a valid email address.');
  return clean;
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    bad('Use a unique password of 12–128 characters.');
  return value;
}
export function role(value) {
  if (!['admin', 'teacher', 'student'].includes(value)) bad('Choose Admin, Teacher, or Student.');
  return value;
}
export function bool(value, label) {
  if (typeof value !== 'boolean') bad(`${label} must be true or false.`);
  return value;
}
export function order(value) {
  if (!Number.isInteger(value) || value < 0 || value > 9999)
    bad('Order must be a whole number between 0 and 9999.');
  return value;
}
export function pagination(query) {
  const limit = query.limit === undefined ? 24 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) bad('Limit must be between 1 and 100.');
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 512))
    bad('Invalid cursor.');
  return { limit, cursor: query.cursor || null };
}
export function ip(value) {
  try {
    return ipaddr.process(text(value, 'IP address', 2, 64)).toString();
  } catch {
    bad('Enter a valid IPv4 or IPv6 address.');
  }
}
export function live(body) {
  const isLive = bool(body.isLive, 'Live status');
  if (!isLive) return { platform: '', url: '', isLive: false, embedUrl: '' };
  const u = new URL(imageUrl(body.url));
  const platform = body.platform;
  if (platform === 'youtube') {
    const allowed = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
    if (!allowed.includes(u.hostname)) bad('Use a YouTube video or live video URL.');
    const videoId =
      u.hostname === 'youtu.be'
        ? u.pathname.split('/')[1]
        : u.pathname === '/watch'
          ? u.searchParams.get('v')
          : /^\/(live|embed|shorts)\//.test(u.pathname)
            ? u.pathname.split('/')[2]
            : '';
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || ''))
      bad('Paste the exact YouTube video URL, not a channel URL.');
    return {
      platform,
      url: u.href,
      isLive,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    };
  }
  if (platform === 'facebook') {
    socialUrl(u.href, 'facebook');
    if (
      !/\/videos\//.test(u.pathname) &&
      u.pathname !== '/watch/' &&
      !/^\/share\/v\//.test(u.pathname)
    )
      bad('Paste a public Facebook video URL.');
    return {
      platform,
      url: u.href,
      isLive,
      embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(u.href)}&show_text=false`,
    };
  }
  bad('Choose YouTube or Facebook.');
}
