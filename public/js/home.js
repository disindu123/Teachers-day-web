import { api, setupCommon, starterPhotos, safeImage, photoCard } from './common.js';
setupCommon();

async function setupSlider() {
  let slides;
  let starter = false;
  try {
    slides = (await api('/api/slider')).items;
  } catch (error) {
    if (error.code !== 'FIREBASE_NOT_CONFIGURED') throw error;
    slides = [];
  }
  if (!slides.length) {
    slides = await starterPhotos();
    starter = true;
  }
  document.querySelector('#starter-label').hidden = !starter;
  const track = document.querySelector('#slider-track');
  const dots = document.querySelector('#slider-dots');
  const root = document.querySelector('#hero-slider');
  const count = document.querySelector('#slide-count');
  const pause = document.querySelector('#slider-pause');
  let current = 0,
    userPaused = matchMedia('(prefers-reduced-motion: reduce)').matches,
    hovered = false,
    focused = false;
  const announcement = document.createElement('span');
  announcement.className = 'sr-only';
  announcement.setAttribute('aria-live', 'polite');
  root.append(announcement);
  slides.forEach((slide, index) => {
    const item = document.createElement('div');
    item.className = `slide${index === 0 ? ' active' : ''}`;
    item.setAttribute('role', 'group');
    item.setAttribute('aria-roledescription', 'slide');
    item.setAttribute('aria-label', `${index + 1} of ${slides.length}`);
    item.setAttribute('aria-hidden', String(index !== 0));
    const image = document.createElement('img');
    image.alt = slide.caption || `Sanghabodhi College photograph ${index + 1}`;
    image.decoding = 'async';
    image.loading = index === 0 ? 'eager' : 'lazy';
    if (index === 0) image.fetchPriority = 'high';
    safeImage(image, slide.imageUrl);
    item.append(image);
    track.append(item);
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'slider-dot';
    dot.setAttribute('aria-label', `Show slide ${index + 1}`);
    dot.setAttribute('aria-pressed', String(index === 0));
    dot.addEventListener('click', () => show(index, true));
    dots.append(dot);
  });
  function show(index, manual = false) {
    current = (index + slides.length) % slides.length;
    [...track.children].forEach((slide, i) => {
      slide.classList.toggle('active', i === current);
      slide.setAttribute('aria-hidden', String(i !== current));
    });
    [...dots.children].forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === current)));
    count.textContent = `${String(current + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
    if (manual) announcement.textContent = `Slide ${current + 1} of ${slides.length}`;
  }
  function pauseLabel() {
    pause.setAttribute('aria-label', userPaused ? 'Play slideshow' : 'Pause slideshow');
    pause
      .querySelector('use')
      .setAttribute('href', `/assets/icons.svg#${userPaused ? 'play' : 'pause'}`);
  }
  pause.addEventListener('click', () => {
    userPaused = !userPaused;
    pauseLabel();
  });
  document.querySelector('.slider-prev').addEventListener('click', () => show(current - 1, true));
  document.querySelector('.slider-next').addEventListener('click', () => show(current + 1, true));
  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      show(current + (event.key === 'ArrowLeft' ? -1 : 1), true);
    }
  });
  const visual = document.querySelector('.hero-visual');
  visual.addEventListener('pointerenter', () => {
    hovered = true;
  });
  visual.addEventListener('pointerleave', () => {
    hovered = false;
  });
  visual.addEventListener('focusin', () => {
    focused = true;
  });
  visual.addEventListener('focusout', (event) => {
    focused = visual.contains(event.relatedTarget);
  });
  let touchX;
  root.addEventListener(
    'touchstart',
    (event) => {
      touchX = event.changedTouches[0].clientX;
    },
    { passive: true },
  );
  root.addEventListener(
    'touchend',
    (event) => {
      const delta = event.changedTouches[0].clientX - touchX;
      if (Math.abs(delta) > 45) show(current + (delta < 0 ? 1 : -1), true);
    },
    { passive: true },
  );
  if (slides.length > 1)
    setInterval(() => {
      if (!userPaused && !hovered && !focused && !document.hidden) show(current + 1);
    }, 6000);
  else {
    document.querySelector('.slider-arrows').hidden = true;
    pause.hidden = true;
  }
  show(0);
  pauseLabel();
}
async function setupPreview() {
  const root = document.querySelector('#gallery-preview');
  const note = document.querySelector('#gallery-note');
  let items;
  try {
    items = (await api('/api/gallery?limit=3')).items;
  } catch (error) {
    if (error.code === 'FIREBASE_NOT_CONFIGURED') {
      items = (await starterPhotos()).slice(0, 3);
      note.textContent =
        'Illustrative preview images. Official SCMU photographs will be published here.';
    } else {
      note.textContent = 'The album is temporarily unavailable. Please try again shortly.';
      return;
    }
  }
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const text = document.createElement('p');
    text.textContent = 'SCMU photographs will be published here soon.';
    empty.append(text);
    root.append(empty);
    return;
  }
  items.forEach((photo) => root.append(photoCard(photo)));
}
setupSlider().catch(() => {
  document.querySelector('#starter-label').textContent = 'SCMU photographs coming soon';
  document.querySelector('#starter-label').hidden = false;
});
setupPreview().catch(() => {
  document.querySelector('#gallery-note').textContent = 'The album is temporarily unavailable.';
});

async function setupLive() {
  try {
    const live = await api('/api/live');
    if (!live.isLive || !live.embedUrl) return;
    const url = new URL(live.embedUrl);
    if (!['https://www.youtube-nocookie.com', 'https://www.facebook.com'].includes(url.origin))
      return;
    const frame = document.createElement('iframe');
    frame.src = url.href;
    frame.title = 'SCMU live broadcast';
    frame.loading = 'lazy';
    frame.allow = 'encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    document.querySelector('#live-frame').append(frame);
    const link = document.querySelector('#live-link');
    link.href = live.url;
    document.querySelector('#live-section').hidden = false;
  } catch {
    /* A live viewer is shown only when published. */
  }
}
setupLive();
