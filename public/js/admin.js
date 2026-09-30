import { api, getConfig, icon, safeImage, setStatus } from './common.js';
import { initFirebase, onAuthStateChanged, signOut, uploadPhoto } from './firebase.bundle.js';

let firebase,
  user,
  activeTab = 'messages';
const loaded = new Set();
const cursors = { messages: null, gallery: null };
const busy = new Set();
const globalStatus = document.querySelector('#admin-status');
async function adminApi(url, options = {}) {
  try {
    return await api(url, { ...options, token: () => user.getIdToken() });
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      sessionStorage.setItem('loginNotice', error.message);
      await signOut(firebase.auth);
    }
    throw error;
  }
}
async function stats() {
  try {
    const data = await adminApi('/api/admin/stats');
    for (const key of ['messages', 'gallery', 'slider'])
      document.querySelector(`#stat-${key}`).textContent = data[key];
  } catch (error) {
    setStatus(globalStatus, error.message, 'error');
  }
}
function confirmDelete(collection) {
  const dialog = document.querySelector('#delete-dialog');
  dialog.returnValue = 'cancel';
  document.querySelector('#delete-description').textContent =
    collection === 'messages'
      ? 'This feedback message will be permanently removed.'
      : 'This image will be removed from the website. An uploaded file will also be deleted from storage.';
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'delete'), {
      once: true,
    }),
  );
}
function deleteButton(collection, item, reload) {
  const button = document.createElement('button');
  button.className = 'icon-button delete-button';
  button.type = 'button';
  button.append(icon('trash'));
  button.setAttribute(
    'aria-label',
    `Delete ${collection === 'messages' ? `message from ${item.name}` : item.caption || 'image'}`,
  );
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (!(await confirmDelete(collection))) return;
      await adminApi(`/api/${collection}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      await reload();
      await stats();
      setStatus(globalStatus, 'Item deleted.', 'success');
    } catch (error) {
      setStatus(globalStatus, error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
async function loadMessages(append = false) {
  if (busy.has('messages')) return;
  busy.add('messages');
  const status = document.querySelector('#messages-status'),
    list = document.querySelector('#message-list'),
    more = document.querySelector('#messages-more');
  more.disabled = true;
  setStatus(status, 'Loading messages…');
  try {
    const cursor = append ? cursors.messages : null;
    const data = await adminApi(
      `/api/messages?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    if (!append) list.replaceChildren();
    data.items.forEach((item) => {
      const row = document.createElement('article');
      row.className = 'message-row';
      const name = document.createElement('strong');
      name.textContent = item.name;
      const message = document.createElement('p');
      message.textContent = item.message;
      const timestamp = document.createElement('time');
      timestamp.dateTime = item.createdAt;
      timestamp.textContent = new Intl.DateTimeFormat('en-LK', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Colombo',
      }).format(new Date(item.createdAt));
      row.append(name, message, timestamp, deleteButton('messages', item, loadMessages));
      list.append(row);
    });
    cursors.messages = data.nextCursor;
    more.hidden = !data.nextCursor;
    document.querySelector('#messages-empty').hidden = list.children.length !== 0;
    loaded.add('messages');
    setStatus(status, '');
  } catch (error) {
    setStatus(status, error.message, 'error');
  } finally {
    busy.delete('messages');
    more.disabled = false;
  }
}
async function loadGallery(append = false) {
  if (busy.has('gallery')) return;
  busy.add('gallery');
  const status = document.querySelector('#admin-gallery-status'),
    grid = document.querySelector('#admin-gallery-grid'),
    more = document.querySelector('#gallery-more');
  more.disabled = true;
  setStatus(status, 'Loading photographs…');
  try {
    const cursor = append ? cursors.gallery : null;
    const data = await adminApi(
      `/api/gallery?limit=24${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    if (!append) grid.replaceChildren();
    data.items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'admin-photo';
      const image = document.createElement('img');
      image.alt = item.caption || 'Celebration photograph';
      image.loading = 'lazy';
      safeImage(image, item.imageUrl);
      const detail = document.createElement('div');
      detail.className = 'admin-photo-detail';
      const caption = document.createElement('p');
      caption.textContent = item.caption || 'No caption';
      detail.append(caption, deleteButton('gallery', item, loadGallery));
      card.append(image, detail);
      grid.append(card);
    });
    cursors.gallery = data.nextCursor;
    more.hidden = !data.nextCursor;
    document.querySelector('#admin-gallery-empty').hidden = grid.children.length !== 0;
    loaded.add('gallery');
    setStatus(status, '');
  } catch (error) {
    setStatus(status, error.message, 'error');
  } finally {
    busy.delete('gallery');
    more.disabled = false;
  }
}
async function loadSlider() {
  if (busy.has('slider')) return;
  busy.add('slider');
  const status = document.querySelector('#admin-slider-status'),
    list = document.querySelector('#admin-slider-list');
  setStatus(status, 'Loading slides…');
  try {
    const data = await adminApi('/api/slider');
    list.replaceChildren();
    data.items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'slider-item';
      const image = document.createElement('img');
      image.alt = `Slide ${index + 1}`;
      image.loading = 'lazy';
      safeImage(image, item.imageUrl);
      const detail = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'muted';
      title.textContent = `Slide ${String(index + 1).padStart(2, '0')}`;
      const form = document.createElement('form');
      form.className = 'slider-order';
      const label = document.createElement('label');
      label.textContent = 'Order';
      label.htmlFor = `order-${item.id}`;
      const input = document.createElement('input');
      input.id = label.htmlFor;
      input.className = 'form-input';
      input.type = 'number';
      input.min = '0';
      input.max = '9999';
      input.required = true;
      input.value = item.order;
      const save = document.createElement('button');
      save.className = 'button button-outline';
      save.type = 'submit';
      save.textContent = 'Save';
      form.append(label, input, save);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        save.disabled = true;
        try {
          await adminApi(`/api/slider/${item.id}`, {
            method: 'PATCH',
            body: { order: Number(input.value) },
          });
          await loadSlider();
          setStatus(globalStatus, 'Slide order saved.', 'success');
        } catch (error) {
          setStatus(globalStatus, error.message, 'error');
        } finally {
          save.disabled = false;
        }
      });
      detail.append(title, form);
      card.append(image, detail, deleteButton('slider', item, loadSlider));
      list.append(card);
    });
    document.querySelector('#slider-empty').hidden = data.items.length !== 0;
    if (!document.querySelector('#slider-form').dataset.pendingPath)
      document.querySelector('#slider-order').value = data.items.length
        ? Math.max(...data.items.map((x) => x.order)) + 1
        : 0;
    loaded.add('slider');
    setStatus(status, '');
  } catch (error) {
    setStatus(status, error.message, 'error');
  } finally {
    busy.delete('slider');
  }
}
const loaders = { messages: loadMessages, gallery: loadGallery, slider: loadSlider };
function switchTab(name) {
  activeTab = name;
  for (const tab of document.querySelectorAll('[data-tab]')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.querySelector(`#panel-${tab.dataset.tab}`).hidden = !selected;
  }
  if (user && !loaded.has(name)) loaders[name]();
}
for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const index = tabs.indexOf(tab);
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      tabs[next].focus();
      switchTab(tabs[next].dataset.tab);
    }
  });
}
for (const name of ['messages', 'gallery', 'slider'])
  document.querySelector(`#refresh-${name}`).addEventListener('click', () => loaders[name]());
document.querySelector('#messages-more').addEventListener('click', () => loadMessages(true));
document.querySelector('#gallery-more').addEventListener('click', () => loadGallery(true));
let sliderMode = 'upload';
for (const mode of ['upload', 'url'])
  document.querySelector(`#mode-${mode}`).addEventListener('click', () => {
    if (document.querySelector('#slider-form button[type=submit]').disabled) return;
    sliderMode = mode;
    document.querySelector('#slider-upload-field').hidden = mode !== 'upload';
    document.querySelector('#slider-url-field').hidden = mode !== 'url';
    document.querySelector('#slider-file').required = mode === 'upload';
    document.querySelector('#slider-url').required = mode === 'url';
    document.querySelector('#slider-file').disabled = mode !== 'upload';
    document.querySelector('#slider-url').disabled = mode !== 'url';
    for (const m of ['upload', 'url'])
      document.querySelector(`#mode-${m}`).setAttribute('aria-pressed', String(m === mode));
    document.querySelector('#slider-upload-preview').hidden =
      mode !== 'upload' || !document.querySelector('#slider-file').files.length;
  });
function setupUpload(collection) {
  const form = document.querySelector(`#${collection}-form`),
    fileInput = document.querySelector(`#${collection}-file`),
    preview = document.querySelector(`#${collection}-upload-preview`),
    progress = document.querySelector(`#${collection}-progress`),
    status = document.querySelector(`#${collection}-upload-status`),
    button = form.querySelector('button[type=submit]');
  let previewUrl;
  fileInput.addEventListener('change', () => {
    delete form.dataset.pendingPath;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const file = fileInput.files[0];
    preview.hidden = !file;
    setStatus(status, '');
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ||
      file.size > 10 * 1024 * 1024 ||
      !file.size
    ) {
      fileInput.value = '';
      preview.hidden = true;
      setStatus(status, 'Choose a JPG, PNG, WebP, or GIF smaller than 10 MB.', 'error');
      return;
    }
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || button.disabled) return;
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    const controls = [...form.querySelectorAll('input')];
    controls.forEach((input) => {
      input.disabled = true;
    });
    try {
      const body =
        collection === 'gallery'
          ? { caption: form.caption.value.trim() }
          : { order: Number(form.order.value) };
      if (collection === 'slider' && sliderMode === 'url') {
        body.imageUrl = form.imageUrl.value.trim();
        setStatus(status, 'Adding your slide…');
      } else {
        progress.hidden = false;
        if (!form.dataset.pendingPath)
          form.dataset.pendingPath = await uploadPhoto(
            firebase.storage,
            user,
            collection,
            fileInput.files[0],
            (percent) => {
              progress.value = percent;
              setStatus(status, `Uploading photograph… ${percent}%`);
            },
          );
        body.storagePath = form.dataset.pendingPath;
        setStatus(status, 'Publishing your photograph…');
      }
      await adminApi(`/api/${collection}`, { method: 'POST', body });
      delete form.dataset.pendingPath;
      form.reset();
      preview.hidden = true;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      progress.hidden = true;
      setStatus(
        status,
        collection === 'gallery'
          ? 'Photograph published to the gallery.'
          : 'Slide added to the homepage.',
        'success',
      );
      await loaders[collection]();
      await stats();
    } catch (error) {
      const message = error.code?.startsWith('storage/')
        ? 'The upload could not be completed. Check your connection and administrator access, then try again.'
        : error.message;
      setStatus(
        status,
        `${message}${form.dataset.pendingPath ? ' Your upload is saved; submit again to retry publishing.' : ''}`,
        'error',
      );
    } finally {
      button.disabled = false;
      controls.forEach((input) => {
        input.disabled = false;
      });
      if (collection === 'slider') {
        fileInput.disabled = sliderMode !== 'upload';
        document.querySelector('#slider-url').disabled = sliderMode !== 'url';
      }
      form.removeAttribute('aria-busy');
    }
  });
}
setupUpload('gallery');
setupUpload('slider');
document.querySelector('#logout').addEventListener('click', async () => {
  await signOut(firebase.auth);
});
// Recheck the session when a browser restores a cached dashboard after logout.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});
try {
  const config = await getConfig();
  firebase = await initFirebase(config.firebase);
  onAuthStateChanged(firebase.auth, async (signedInUser) => {
    if (!signedInUser) {
      location.replace('/login/index.html');
      return;
    }
    user = signedInUser;
    try {
      const profile = await adminApi('/api/admin/me');
      document.querySelector('#admin-user').textContent = profile.email;
      document.querySelector('#auth-loading').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelector('#logout').hidden = false;
      await Promise.all([stats(), loaders[activeTab]()]);
    } catch (error) {
      document.querySelector('#auth-loading p').textContent = error.message;
      document.querySelector('.spinner').hidden = true;
    }
  });
} catch (error) {
  document.querySelector('#auth-loading p').textContent = error.message;
  document.querySelector('.spinner').hidden = true;
}
