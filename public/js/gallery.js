import { api, setupCommon, starterPhotos, photoCard, safeImage, setStatus } from './common.js';
setupCommon();
const grid = document.querySelector('#gallery-grid');
const loadMore = document.querySelector('#load-more');
const notice = document.querySelector('#gallery-notice');
const status = document.querySelector('#gallery-status');
const photos = [];
let cursor = null,
  selected = 0,
  busy = false;
const dialog = document.querySelector('#lightbox');
const viewer = document.querySelector('#lightbox-image');
async function load() {
  if (busy) return;
  busy = true;
  loadMore.disabled = true;
  setStatus(status, 'Loading photographs…');
  try {
    let result;
    try {
      result = await api(
        `/api/gallery?limit=24${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
    } catch (error) {
      if (error.code !== 'FIREBASE_NOT_CONFIGURED') throw error;
      result = { items: await starterPhotos(), nextCursor: null };
      notice.textContent =
        'Preview album · These are illustrative education photographs. SCMU will publish the official celebration photographs here.';
      notice.hidden = false;
    }
    for (const photo of result.items) {
      const index = photos.length;
      photos.push(photo);
      grid.append(photoCard(photo, { index, onClick: () => open(index) }));
    }
    cursor = result.nextCursor;
    loadMore.hidden = !cursor;
    document.querySelector('#gallery-total').textContent =
      `${photos.length} photograph${photos.length === 1 ? '' : 's'}${cursor ? ' loaded' : ''}`;
    document.querySelector('#gallery-empty').hidden = photos.length !== 0;
    setStatus(status, '');
  } catch (error) {
    setStatus(status, error.message, 'error');
    loadMore.textContent = 'Try again';
    loadMore.hidden = false;
    document.querySelector('#gallery-total').textContent = 'Album unavailable';
  } finally {
    busy = false;
    loadMore.disabled = false;
  }
}
function show(index) {
  selected = (index + photos.length) % photos.length;
  const photo = photos[selected];
  viewer.alt = photo.caption || 'Teacher’s Day celebration photograph';
  safeImage(viewer, photo.imageUrl);
  document.querySelector('#lightbox-caption').textContent = photo.caption || 'ගුරු අභිවන්දනා 2k26';
  document.querySelector('#lightbox-count').textContent = `${selected + 1} / ${photos.length}`;
}
function open(index) {
  show(index);
  dialog.showModal();
  document.body.classList.add('viewer-open');
}
dialog.addEventListener('close', () => document.body.classList.remove('viewer-open'));
document.querySelector('#lightbox-close').addEventListener('click', () => dialog.close());
document.querySelector('#lightbox-prev').addEventListener('click', () => show(selected - 1));
document.querySelector('#lightbox-next').addEventListener('click', () => show(selected + 1));
dialog.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    show(selected + (event.key === 'ArrowLeft' ? -1 : 1));
  }
});
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  }
});
let touchX;
viewer.addEventListener(
  'touchstart',
  (event) => {
    touchX = event.changedTouches[0].clientX;
  },
  { passive: true },
);
viewer.addEventListener(
  'touchend',
  (event) => {
    const dx = event.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 45) show(selected + (dx < 0 ? 1 : -1));
  },
  { passive: true },
);
loadMore.addEventListener('click', load);
load();
