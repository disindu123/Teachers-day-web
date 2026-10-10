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
      `View photograph ${index + 1}: ${photo.caption || 'SCMU photograph'}`,
    );
  } else card.href = link || '/gallery';
  const image = document.createElement('img');
  image.alt = photo.caption || 'Sanghabodhi College photograph';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.width = 600;
  image.height = 450;
  safeImage(image, photo.imageUrl);
  const caption = document.createElement('span');
  caption.className = 'photo-caption';
  caption.textContent = photo.caption || 'සඟබෝ පැහැසර';
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
    email: 'Email SCMU',
  };
  for (const area of document.querySelectorAll('[data-social-links]')) {
    for (const [key, label] of Object.entries(names)) {
      const link = document.createElement(social[key] ? 'a' : 'span');
      link.className = `social-link ${key}`;
      link.append(icon(key === 'website' ? 'globe' : key === 'email' ? 'mail' : key));
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
  setupNotifications();
  setupHeadBoard();
  try {
    const config = await getConfig();
    renderSocials({ ...config.social, email: `mailto:${config.email}` });
    for (const logo of document.querySelectorAll('.brand img')) safeImage(logo, config.logoUrl);
    const event = document.querySelector('#event-date');
    if (event && config.eventDate) {
      event.textContent = `Celebration: ${new Intl.DateTimeFormat('en-LK', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Colombo' }).format(new Date(config.eventDate))} (Sri Lanka time)`;
      event.hidden = false;
    }
  } catch {
    /* The page and form remain usable during a configuration request failure. */
  }
}

function dialogFrame(title, className = 'event-dialog') {
  const dialog = document.createElement('dialog');
  dialog.className = className;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button modal-close';
  close.setAttribute('aria-label', 'Close');
  close.append(icon('close'));
  close.addEventListener('click', () => dialog.close());
  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.id = `modal-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.append(close, heading);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
  document.body.append(dialog);
  return dialog;
}
function eventContent(item, container) {
  if (item.imageUrl) {
    const image = document.createElement('img');
    image.className = 'event-image';
    image.alt = item.title;
    image.loading = 'lazy';
    safeImage(image, item.imageUrl);
    container.append(image);
  }
  const text = document.createElement('p');
  text.className = 'preserve-lines';
  text.textContent = item.message;
  container.append(text);
  if (item.createdAt) {
    const time = document.createElement('time');
    time.className = 'muted';
    time.textContent = new Intl.DateTimeFormat('en-LK', {
      dateStyle: 'medium',
      timeZone: 'Asia/Colombo',
    }).format(new Date(item.createdAt));
    container.append(time);
  }
}
async function setupNotifications() {
  const nav = document.querySelector('#navigation');
  if (!nav) return;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'icon-button notification-trigger';
  trigger.setAttribute('aria-label', 'Event notifications');
  trigger.title = 'Event notifications';
  trigger.append(icon('bell'));
  nav.append(trigger);
  const list = dialogFrame('Events & notifications', 'notification-dialog');
  const content = document.createElement('div');
  content.className = 'notification-list';
  list.append(content);
  const more = document.createElement('button');
  more.className = 'button button-outline';
  more.textContent = 'More notifications';
  more.hidden = true;
  list.append(more);
  let cursor = null,
    busy = false,
    items = [];
  async function load() {
    if (busy) return;
    busy = true;
    more.disabled = true;
    try {
      const result = await api(
        `/api/popups?limit=24${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      for (const item of result.items) {
        const notice = document.createElement('article');
        notice.className = 'notification-item';
        const title = document.createElement('h3');
        title.textContent = item.title;
        notice.append(title);
        eventContent(item, notice);
        content.append(notice);
        items.push(item);
      }
      cursor = result.nextCursor;
      more.hidden = !cursor;
      if (!items.length)
        content.textContent = 'No event notices yet. Follow our channels for updates.';
    } catch {
      if (!items.length) content.textContent = 'Event notices are temporarily unavailable.';
    } finally {
      busy = false;
      more.disabled = false;
    }
  }
  trigger.addEventListener('click', () => list.showModal());
  more.addEventListener('click', load);
  await load();
  const latest = items[0];
  if (!latest) return;
  let seen = false;
  const key = `scmu-event:${latest.id}:${latest.createdAt}`;
  try {
    seen = localStorage.getItem(key) === 'seen';
  } catch {
    /* Storage is optional. */
  }
  if (!seen) {
    trigger.classList.add('has-notice');
    const popup = dialogFrame(latest.title);
    eventContent(latest, popup);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'button button-primary';
    dismiss.textContent = 'Got it';
    dismiss.addEventListener('click', () => popup.close());
    popup.append(dismiss);
    popup.addEventListener('close', () => {
      try {
        localStorage.setItem(key, 'seen');
      } catch {}
      trigger.classList.remove('has-notice');
      popup.remove();
    });
    if (!document.querySelector('dialog[open]')) popup.showModal();
  }
}
async function setupHeadBoard() {
  const sections = document.querySelectorAll('[data-head-board]');
  if (!sections.length) return;
  try {
    const { items } = await api('/api/media-heads');
    if (!items.length) return;
    for (const section of sections) {
      const grid = section.querySelector('[data-head-grid]');
      for (const head of items) {
        const card = document.createElement('article');
        card.className = 'board-card';
        const photo = document.createElement('img');
        photo.alt = head.name;
        photo.loading = 'lazy';
        photo.width = 240;
        photo.height = 240;
        safeImage(photo, head.photoUrl);
        card.append(photo);
        const role = document.createElement('p');
        role.className = 'eyebrow';
        role.textContent = head.role;
        const name = document.createElement('h3');
        name.textContent = head.name;
        card.append(role, name);
        const links = document.createElement('div');
        links.className = 'board-links';
        for (const [key, label] of Object.entries({
          whatsapp: 'WhatsApp',
          facebook: 'Facebook',
          linkedin: 'LinkedIn',
          gmail: 'Email',
        })) {
          if (!head[key]) continue;
          const link = document.createElement('a');
          link.className = 'icon-button';
          link.setAttribute('aria-label', `${head.name} · ${label}`);
          link.title = label;
          if (key === 'gmail') link.href = `mailto:${head[key]}`;
          else {
            try {
              const parsed = new URL(head[key]);
              if (parsed.protocol !== 'https:') continue;
              link.href = parsed.href;
            } catch {
              continue;
            }
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          }
          link.append(icon(key === 'gmail' ? 'mail' : key));
          links.append(link);
        }
        card.append(links);
        grid.append(card);
      }
      section.hidden = false;
    }
  } catch {
    /* Only published board members are displayed. */
  }
}
