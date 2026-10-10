import { api, getConfig, icon, safeImage, setStatus } from './common.js';
import { initFirebase, onAuthStateChanged, signOut } from './firebase.bundle.js';
import { uploadPhoto } from './upload.js';

const $ = (selector) => document.querySelector(selector);
const forms = Object.fromEntries(
  ['gallery', 'slider', 'accounts', 'popups', 'live', 'heads', 'settings', 'ips'].map((key) => [
    key,
    $(`#${key}-form`),
  ]),
);
const tabs = {
  messages: ['Feedback', 'message'],
  gallery: ['Gallery', 'camera'],
  slider: ['Image slider', 'grid'],
  accounts: ['Accounts', 'user'],
  popups: ['Events', 'bell'],
  live: ['Live', 'play'],
  heads: ['Head board', 'users'],
  settings: ['Availability', 'settings'],
  ips: ['IP blocks', 'lock'],
};
const paths = {
  messages: 'messages',
  gallery: 'gallery',
  slider: 'slider',
  accounts: 'accounts',
  popups: 'popups',
  heads: 'media-heads',
  ips: 'blocked-ips',
};
const roots = {
  messages: '#message-list',
  gallery: '#admin-gallery-grid',
  slider: '#admin-slider-list',
  accounts: '#account-list',
  popups: '#popup-list',
  heads: '#head-list',
  ips: '#ip-list',
};
const states = {};
let firebase,
  user,
  profile,
  activeTab,
  booted = false;
const date = (value) =>
  value
    ? new Intl.DateTimeFormat('en-LK', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Colombo',
      }).format(new Date(value)) + ' SLST'
    : '';
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function button(label, action, className = 'button button-outline') {
  const node = el('button', label, className);
  node.type = 'button';
  node.addEventListener('click', async () => {
    node.disabled = true;
    try {
      await action();
    } catch (e) {
      setStatus($('#admin-status'), e.message, 'error');
    } finally {
      node.disabled = false;
    }
  });
  return node;
}
async function staffApi(url, options = {}) {
  try {
    return await api(url, { ...options, token: () => user.getIdToken() });
  } catch (e) {
    if (e.status === 401 || ['IP_BLOCKED', 'ACCESS_DENIED'].includes(e.code)) {
      await signOut(firebase.auth);
      location.replace('/login/index.html');
    }
    throw e;
  }
}
async function confirmRemoval(description) {
  const dialog = $('#confirm-dialog');
  $('#confirm-description').textContent = description;
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }),
  );
}
async function remove(key, item) {
  if (
    !(await confirmRemoval(
      `Remove ${item.name || item.email || item.caption || item.title || item.ip || 'this item'}? This cannot be undone.`,
    ))
  )
    return;
  await staffApi(`/api/${paths[key]}/${encodeURIComponent(key === 'ips' ? item.ip : item.id)}`, {
    method: 'DELETE',
  });
  await load(key, true);
  await stats();
  setStatus(
    $('#admin-status'),
    key === 'ips' ? 'Staff access unblocked.' : 'Item removed.',
    'success',
  );
}
function details(title, body) {
  const box = el('article', undefined, 'staff-item');
  box.append(el('h3', title), el('p', body, 'preserve-lines'));
  return box;
}
function fill(form, values) {
  for (const [key, value] of Object.entries(values)) {
    const control = form.elements.namedItem(key);
    if (!control) continue;
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else control.value = value ?? '';
  }
  form.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'center',
  });
}
function resetEditor(key) {
  const form = forms[key];
  form.reset();
  for (const name of ['uid', 'itemId'])
    if (form.elements.namedItem(name)) form.elements.namedItem(name).value = '';
  delete form.dataset.ticketId;
  for (const control of form.querySelectorAll('input,textarea,select')) control.disabled = false;
  setStatus(form.querySelector('.form-status'), '');
  if (key === 'accounts') form.elements.password.required = true;
}
function editPhoto(key, item, card) {
  const editor = el('form', undefined, 'inline-editor');
  const fields =
    key === 'gallery' ? ['caption', 'albumTitle', 'facebookAlbumUrl'] : ['caption', 'order'];
  for (const field of fields) {
    const control = el('input');
    control.name = field;
    control.value = item[field] ?? '';
    control.type = field === 'order' ? 'number' : field === 'facebookAlbumUrl' ? 'url' : 'text';
    if (field === 'order') {
      control.min = '0';
      control.max = '9999';
    }
    const label = el(
      'label',
      {
        caption: 'Caption',
        albumTitle: 'Album title',
        facebookAlbumUrl: 'Exact Facebook album URL',
        order: 'Display order',
      }[field],
    );
    label.append(control);
    editor.append(label);
  }
  const submit = el('button', 'Save details', 'button button-outline');
  submit.type = 'submit';
  const status = el('p', '', 'form-status');
  editor.append(submit, status);
  editor.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editor.reportValidity() || submit.disabled) return;
    submit.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(editor));
      if (key === 'slider') body.order = Number(body.order);
      await staffApi(`/api/${key}/${item.id}`, { method: 'PATCH', body });
      setStatus(status, 'Saved.', 'success');
      await load(key, true);
    } catch (e) {
      setStatus(status, e.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });
  card.append(editor);
}
function render(key, item) {
  let card;
  if (['gallery', 'slider', 'heads'].includes(key)) {
    card = el('article', undefined, 'admin-content-card');
    const image = el('img');
    image.alt = item.caption || item.name || 'SCMU photograph';
    image.loading = 'lazy';
    safeImage(image, item.imageUrl || item.photoUrl);
    card.append(image);
    const body = el('div', undefined, 'content-card-body');
    body.append(el('h3', item.caption || item.name || 'Untitled photograph'));
    if (key === 'heads') body.append(el('p', item.role, 'muted'));
    else if (['admin', 'teacher'].includes(profile.role))
      body.append(
        el(
          'p',
          `Posted by ${item.postedByEmail || item.postedBy || 'SCMU'} · ${date(item.createdAt)}`,
          'muted',
        ),
      );
    if (item.albumTitle) body.append(el('p', item.albumTitle));
    card.append(body);
    if (profile.role === 'admin' && key !== 'heads') editPhoto(key, item, body);
    if (key === 'heads')
      body.append(
        button('Edit', () => {
          resetEditor('heads');
          fill(forms.heads, { ...item, position: item.id });
        }),
      );
    if (profile.role === 'admin')
      body.append(button('Remove', () => remove(key, item), 'button button-danger'));
  } else if (key === 'messages') {
    card = details(item.name, item.message);
    card.append(el('time', date(item.createdAt), 'muted'));
    if (profile.role === 'admin')
      card.append(button('Delete message', () => remove(key, item), 'button button-danger'));
  } else if (key === 'accounts') {
    card = details(item.displayName || item.email, item.email);
    card.append(
      el(
        'p',
        `${item.role} · ${item.disabled ? 'Disabled' : 'Active'} · ${date(item.createdAt)}`,
        'muted',
      ),
    );
    card.append(
      button('Edit account', () => {
        resetEditor('accounts');
        fill(forms.accounts, { ...item, uid: item.id, password: '' });
        forms.accounts.elements.password.required = false;
      }),
    );
    if (item.id !== profile.uid)
      card.append(button('Delete account', () => remove(key, item), 'button button-danger'));
  } else if (key === 'popups') {
    card = details(item.title, item.message);
    if (item.imageUrl) {
      const img = el('img');
      img.className = 'event-thumb';
      img.alt = item.title;
      img.loading = 'lazy';
      safeImage(img, item.imageUrl);
      card.prepend(img);
    }
    card.append(
      el('time', date(item.createdAt), 'muted'),
      button('Edit text', () => {
        resetEditor('popups');
        fill(forms.popups, { itemId: item.id, title: item.title, message: item.message });
        forms.popups.elements.file.disabled = true;
        forms.popups.elements.imageUrl.disabled = true;
      }),
      button('Remove event', () => remove(key, item), 'button button-danger'),
    );
  } else {
    card = details(item.ip, item.reason);
    card.append(
      el('time', date(item.blockedAt), 'muted'),
      button('Unblock', () => remove(key, item)),
    );
  }
  return card;
}
async function stats() {
  const counts = await staffApi('/api/admin/stats');
  const root = $('#stats');
  root.replaceChildren();
  const labels = {
    messages: 'Feedback messages',
    gallery: 'Gallery photographs',
    slider: 'Homepage slides',
    users: 'Staff accounts',
    popups: 'Event notices',
  };
  for (const [key, count] of Object.entries(counts)) {
    const card = el('article', undefined, 'stat-card');
    card.append(
      icon(
        key === 'messages'
          ? 'message'
          : key === 'users'
            ? 'users'
            : key === 'popups'
              ? 'bell'
              : 'camera',
      ),
      el('strong', String(count)),
      el('span', labels[key]),
    );
    root.append(card);
  }
}
async function load(key, refresh = false) {
  const state = (states[key] ||= { cursor: null, busy: false, loaded: false });
  if (state.busy) return;
  state.busy = true;
  const more = $(`[data-more="${key}"]`);
  if (more) more.disabled = true;
  try {
    if (['live', 'settings'].includes(key)) {
      fill(forms[key], await staffApi(`/api/${key}`));
      state.loaded = true;
      return;
    }
    const page = refresh ? null : state.cursor;
    const result = await staffApi(
      `/api/${paths[key]}?limit=24${page ? `&cursor=${encodeURIComponent(page)}` : ''}`,
    );
    const root = $(roots[key]);
    if (refresh || !state.loaded) root.replaceChildren();
    root.querySelector('.empty-state')?.remove();
    for (const item of result.items) root.append(render(key, item));
    state.cursor = result.nextCursor || null;
    state.loaded = true;
    if (!root.children.length) root.append(el('p', 'Nothing published here yet.', 'empty-state'));
    if (more) more.hidden = !state.cursor;
  } catch (e) {
    setStatus($('#admin-status'), e.message, 'error');
  } finally {
    state.busy = false;
    if (more) more.disabled = false;
  }
}
function activate(key) {
  activeTab = key;
  for (const node of $('#dashboard-tabs').children) {
    const active = node.dataset.tab === key;
    node.setAttribute('aria-selected', String(active));
    node.tabIndex = active ? 0 : -1;
  }
  for (const node of document.querySelectorAll('.staff-panel'))
    node.hidden = node.id !== `panel-${key}`;
  if (!states[key]?.loaded) load(key, true);
}
function setupTabs() {
  const available =
    profile.role === 'admin'
      ? Object.keys(tabs)
      : profile.role === 'teacher'
        ? ['messages', 'gallery', 'slider']
        : ['gallery'];
  const nav = $('#dashboard-tabs');
  nav.setAttribute('role', 'tablist');
  for (const key of available) {
    const tab = button(tabs[key][0], () => activate(key), 'dashboard-tab');
    tab.prepend(icon(tabs[key][1]));
    tab.dataset.tab = key;
    tab.id = `tab-${key}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `panel-${key}`);
    $(`#panel-${key}`).setAttribute('role', 'tabpanel');
    $(`#panel-${key}`).setAttribute('aria-labelledby', tab.id);
    nav.append(tab);
  }
  nav.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let index = available.indexOf(activeTab);
    index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? available.length - 1
          : (index + (event.key === 'ArrowLeft' ? -1 : 1) + available.length) % available.length;
    activate(available[index]);
    $(`#tab-${available[index]}`).focus();
  });
  activate(available[0]);
}
async function imageBody(key, form, data, collection = key) {
  const field = key === 'heads' ? 'photoUrl' : 'imageUrl',
    file = form.elements.file.files[0],
    url = data.get(field)?.trim();
  if (file && url) throw new Error('Choose a file or image URL. Clear the other field first.');
  if (file) {
    if (!form.dataset.ticketId) {
      const progress = $(`#${collection}-progress`);
      progress.hidden = false;
      progress.value = 0;
      form.dataset.ticketId = await uploadPhoto(
        staffApi,
        firebase.storage,
        collection,
        file,
        (value) => {
          progress.value = value;
        },
      );
    }
    return { ticketId: form.dataset.ticketId };
  }
  return { [field]: url || '' };
}
function setupForms() {
  for (const [key, form] of Object.entries(forms)) {
    form.elements.file?.addEventListener('change', () => delete form.dataset.ticketId);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity() || form.dataset.busy) return;
      const data = new FormData(form);
      form.dataset.busy = 'true';
      form.setAttribute('aria-busy', 'true');
      const status = form.querySelector('.form-status');
      setStatus(status, 'Saving…');
      const submit = form.querySelector('button:not([type="button"])');
      submit.disabled = true;
      try {
        let path = `/api/${paths[key] || key}`,
          method = 'POST',
          body;
        if (['gallery', 'slider'].includes(key)) {
          body = { ...(await imageBody(key, form, data)), caption: data.get('caption') || '' };
          if (key === 'gallery')
            Object.assign(body, {
              albumTitle: data.get('albumTitle'),
              facebookAlbumUrl: data.get('facebookAlbumUrl'),
            });
          else body.order = Number(data.get('order'));
        } else if (key === 'accounts') {
          body = {
            email: data.get('email'),
            displayName: data.get('displayName'),
            role: data.get('role'),
          };
          if (data.get('password')) body.password = data.get('password');
          if (data.get('uid')) {
            path += `/${data.get('uid')}`;
            method = 'PATCH';
            body.disabled = data.get('disabled') === 'on';
          } else if (!body.password)
            throw new Error('Create a unique SCMU password with at least 12 characters.');
        } else if (key === 'popups') {
          body = { title: data.get('title'), message: data.get('message') };
          if (data.get('itemId')) {
            path += `/${data.get('itemId')}`;
            method = 'PATCH';
          } else Object.assign(body, await imageBody(key, form, data));
        } else if (key === 'heads') {
          method = 'PUT';
          path += `/${data.get('position')}`;
          body = { ...(await imageBody(key, form, data, 'mediaHeads')) };
          for (const name of ['name', 'whatsapp', 'facebook', 'linkedin', 'gmail'])
            body[name] = data.get(name);
        } else if (key === 'live') {
          method = 'PUT';
          body = {
            isLive: data.get('isLive') === 'on',
            platform: data.get('platform'),
            url: data.get('url'),
          };
        } else if (key === 'settings') {
          method = 'PUT';
          body = { maintenanceMode: data.get('maintenanceMode') === 'on' };
        } else body = { ip: data.get('ip'), reason: data.get('reason') };
        await staffApi(path, { method, body });
        if (!['live', 'settings'].includes(key)) resetEditor(key);
        setStatus(status, 'Saved successfully.', 'success');
        if (!['live', 'settings'].includes(key)) await load(key, true);
        await stats();
      } catch (e) {
        setStatus(status, e.message, 'error');
      } finally {
        delete form.dataset.busy;
        form.removeAttribute('aria-busy');
        submit.disabled = false;
        const progress = form.querySelector('progress');
        if (progress) progress.hidden = true;
      }
    });
  }
  for (const [id, key] of [
    ['account-reset', 'accounts'],
    ['popup-reset', 'popups'],
    ['head-reset', 'heads'],
  ])
    $(`#${id}`).addEventListener('click', () => resetEditor(key));
  forms.accounts.elements.password.required = true;
  for (const node of document.querySelectorAll('[data-refresh]'))
    node.addEventListener('click', () => load(node.dataset.refresh, true));
  for (const node of document.querySelectorAll('[data-more]'))
    node.addEventListener('click', () => load(node.dataset.more));
  $('#logout').addEventListener('click', async () => {
    await signOut(firebase.auth);
    location.replace('/login/index.html');
  });
}
async function start() {
  try {
    const config = await getConfig();
    for (const logo of document.querySelectorAll('.brand img')) safeImage(logo, config.logoUrl);
    firebase = await initFirebase(config.firebase);
    onAuthStateChanged(firebase.auth, async (current) => {
      if (!current) {
        location.replace('/login/index.html');
        return;
      }
      user = current;
      if (booted) return;
      booted = true;
      try {
        profile = await staffApi('/api/admin/me');
        $('#admin-user').textContent = profile.displayName || profile.email;
        $('#staff-role').textContent = profile.role;
        $('#current-ip').textContent = `Your IP: ${profile.ip}`;
        $('#auth-loading').hidden = true;
        $('#dashboard').hidden = false;
        $('#logout').hidden = false;
        setupTabs();
        setupForms();
        await stats();
      } catch (e) {
        $('#auth-loading').replaceChildren(
          el('p', e.message, 'form-status error'),
          button('Return to login', () => {
            location.replace('/login/index.html');
          }),
        );
      }
    });
  } catch (e) {
    $('#auth-loading').replaceChildren(el('p', e.message, 'form-status error'));
  }
}
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});
start();
