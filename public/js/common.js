let configPromise;
export function getConfig() {
  return (configPromise ||= api('/api/config'));
}
export async function api(url, { method = 'GET', body, token, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${await token()}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    credentials: 'same-origin',
  });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Unable to complete the request. Please try again.',
    );
    error.status = response.status;
    error.code = result.error?.code;
    throw error;
  }
  return result;
}
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/assets/icons.svg#${name}`);
  svg.append(use);
  return svg;
}
export function setStatus(element, message, type = '') {
  element.textContent = message;
  element.className = `form-status ${type}`;
}
export function safeImage(image, source) {
  let parsed;
  try {
    parsed = new URL(source, location.origin);
  } catch {
    parsed = null;
  }
  image.src =
    parsed &&
    ((parsed.origin === location.origin && parsed.pathname.startsWith('/assets/')) ||
      parsed.protocol === 'https:')
      ? parsed.href
      : '/assets/empty-photo.svg';
  image.addEventListener(
    'error',
    () => {
      image.src = '/assets/empty-photo.svg';
    },
    { once: true },
  );
}
export async function starterPhotos() {
  const items = await fetch('/assets/starter-slides.json').then((r) => r.json());
  return items.map((photo, index) => ({
    ...photo,
    id: `preview-${index}`,
    order: index,
    caption: `${photo.caption} · illustrative photo`,
  }));
}
export function photoCard(photo, { onClick, link, index = 0 } = {}) {
  const card = document.createElement(onClick ? 'button' : 'a');
  card.className = 'photo-card';
  if (onClick) {
    card.type = 'button';
    card.addEventListener('click', onClick);
    card.setAttribute(
      'aria-label',
      `View photograph ${index + 1}: ${photo.caption || 'Celebration photograph'}`,
    );
  } else card.href = link || '/gallery';
  const image = document.createElement('img');
  image.alt = photo.caption || 'Teacher’s Day celebration photograph';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.width = 600;
  image.height = 450;
  safeImage(image, photo.imageUrl);
  const caption = document.createElement('span');
  caption.className = 'photo-caption';
  caption.textContent = photo.caption || 'ගුරු අභිවන්දනා 2k26';
  card.append(image, caption);
  return card;
}
function setupNavigation() {
  const button = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#navigation');
  if (!button || !nav) return;
  const close = () => {
    nav.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Open menu');
  };
  button.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  document.addEventListener('click', (event) => {
    if (!nav.contains(event.target) && !button.contains(event.target)) close();
  });
  matchMedia('(min-width: 681px)').addEventListener('change', (event) => {
    if (event.matches) close();
  });
}
function renderSocials(social) {
  const names = {
    facebook: 'Facebook',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    youtube: 'YouTube',
    website: 'Official website',
  };
  for (const area of document.querySelectorAll('[data-social-links]')) {
    for (const [key, label] of Object.entries(names)) {
      const link = document.createElement(social[key] ? 'a' : 'span');
      link.className = `social-link ${key}`;
      link.append(icon(key === 'website' ? 'globe' : key));
      link.setAttribute('aria-label', social[key] ? label : `${label} link coming soon`);
      link.title = social[key] ? label : `${label} link coming soon`;
      if (key === 'website') link.append(document.createTextNode('Official website'));
      if (social[key]) {
        link.href = social[key];
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else {
        link.setAttribute('role', 'link');
        link.setAttribute('aria-disabled', 'true');
      }
      area.append(link);
    }
  }
}
function setupFeedback() {
  for (const form of document.querySelectorAll('[data-feedback-form]')) {
    const status = form.querySelector('.form-status');
    const button = form.querySelector('button[type=submit]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity() || button.disabled) return;
      button.disabled = true;
      form.setAttribute('aria-busy', 'true');
      setStatus(status, 'Sending your message…');
      const data = new FormData(form);
      try {
        const result = await api('/api/messages', {
          method: 'POST',
          body: { name: data.get('name'), message: data.get('message') },
        });
        form.reset();
        setStatus(status, result.message, 'success');
      } catch (error) {
        setStatus(
          status,
          error.message || 'Unable to send your message. Please try again.',
          'error',
        );
      } finally {
        button.disabled = false;
        form.removeAttribute('aria-busy');
      }
    });
  }
}
export async function setupCommon() {
  setupNavigation();
  setupFeedback();
  try {
    const config = await getConfig();
    renderSocials(config.social);
    const event = document.querySelector('#event-date');
    if (event && config.eventDate) {
      event.textContent = `Celebration: ${new Intl.DateTimeFormat('en-LK', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Colombo' }).format(new Date(config.eventDate))} (Sri Lanka time)`;
      event.hidden = false;
    }
  } catch {
    /* The page and form remain usable during a configuration request failure. */
  }
}
