import { test as base, expect, chromium } from '@playwright/test';
// Start a fresh browser per scenario; this also supports headless-shell runtimes.
const test = base.extend({
  page: async ({ launchOptions, baseURL }, use) => {
    const browser = await chromium.launch(launchOptions);
    try {
      const context = await browser.newContext({ baseURL });
      await use(await context.newPage());
    } finally {
      await browser.close();
    }
  },
});
async function staffFixture(page, role) {
  await page.route('**/js/firebase.bundle.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
    const makeUser=role=>({email:role+'@school.example',getIdToken:async()=>role});
    if(sessionStorage.getItem('fixture-initialised')===null){sessionStorage.setItem('fixture-initialised','1');sessionStorage.setItem('fixture-role',${role ? `'${role}'` : "''"});}
    const initial=sessionStorage.getItem('fixture-role');const auth={currentUser:initial ? makeUser(initial) : null};let listener;
    export async function initFirebase(){return {auth,storage:{}};}
    export function onAuthStateChanged(a,fn){listener=fn;queueMicrotask(()=>fn(a.currentUser));}
    export async function signInWithCustomToken(a,token){a.currentUser=makeUser(token);sessionStorage.setItem('fixture-role',token);listener?.(a.currentUser);return {user:a.currentUser};}
    export async function signOut(a){a.currentUser=null;sessionStorage.setItem('fixture-role','');listener?.(null);}
    export function ref(s,path){return path;}
    export function uploadBytesResumable(){return {on(event,progress,error,complete){progress({bytesTransferred:8,totalBytes:8});complete();}};}
  `,
    }),
  );
}
async function capturePage(page, path) {
  for (const section of await page.locator('.motion-ready').all()) {
    await section.scrollIntoViewIfNeeded();
    await expect(section).toHaveCSS('opacity', '1');
  }
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.screenshot({ path, fullPage: true });
}
let scenarioIp = 10;
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.2.${scenarioIp++}` });
  await page.route('https://images.example/**', (route) =>
    route.fulfill({ path: 'public/assets/photos/classroom.jpg', contentType: 'image/jpeg' }),
  );
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({
      body: '<html><body>Test video player</body></html>',
      contentType: 'text/html',
    }),
  );
});
test('desktop home retains Sinhala/gold design, six slides, events, live and board', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'SCMU special event' })).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('#hero-title')).toHaveText(/සඟබෝ\s+පැහැසර/);
  await expect(page.locator('.slide')).toHaveCount(6);
  await page.getByRole('button', { name: 'Next slide', exact: true }).click();
  await expect(page.locator('#slide-count')).toHaveText('02 / 06');
  await page.getByRole('button', { name: 'Pause slideshow' }).click();
  await expect(page.getByRole('button', { name: 'Play slideshow' })).toBeVisible();
  await expect(page.locator('#event-title')).toHaveText('SCMU special event');
  await expect(page.locator('#event-date')).toBeHidden();
  await expect(page.locator('#live-section iframe')).toBeVisible();
  await expect(page.locator('.board-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Event notifications' }).click();
  await expect(page.getByRole('dialog', { name: 'Events & notifications' })).toBeVisible();
  await page.keyboard.press('Escape');
  await capturePage(page, 'test-results/home-desktop.png');
  expect(errors).toEqual([]);
});
test('mobile navigation, layout and two-field feedback work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('#navigation').getByRole('link', { name: 'Contact', exact: true }).click();
  await expect(page.locator('[data-feedback-form] input')).toHaveCount(1);
  await expect(page.locator('[data-feedback-form] textarea')).toHaveCount(1);
  await page.getByLabel('Your name').fill('SCMU visitor');
  await page.getByLabel('Your message').fill('A message from our school community.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.feedback-form .form-status')).toContainText('received privately');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  await capturePage(page, 'test-results/contact-mobile.png');
});
test('gallery groups exact albums and opens a keyboard lightbox with inert captions', async ({
  page,
}) => {
  await page.goto('/gallery');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('.gallery-album')).toHaveCount(2);
  const links = page.getByRole('link', { name: 'View more on Facebook' });
  await expect(links).toHaveCount(2);
  await expect(links.first()).toHaveAttribute('href', /set=a\.456/);
  await expect(page.locator('.photo-card img').first()).toHaveAttribute('loading', 'lazy');
  await page.locator('.photo-card').first().click();
  await expect(page.locator('#lightbox')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#lightbox-count')).toHaveText('2 / 4');
  await page.keyboard.press('Escape');
  await expect(page.locator('#lightbox')).not.toBeVisible();
  expect(await page.locator('.photo-card .photo-caption img').count()).toBe(0);
});
for (const [role, count] of [
  ['admin', 9],
  ['teacher', 4],
  ['student', 2],
])
  test(`${role} dashboard shows only permitted tools and private gallery metadata`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await staffFixture(page, role);
    await page.goto('/admin/index.html');
    await expect(page.locator('#staff-role')).toHaveText(role);
    await expect(page.getByRole('tab')).toHaveCount(count);
    await page.getByRole('tab', { name: 'Gallery', exact: true }).click();
    await expect(page.locator('#admin-gallery-grid .admin-content-card')).toHaveCount(4);
    if (role === 'student') {
      await expect(page.locator('#admin-gallery-grid')).not.toContainText('Posted by');
      await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
    } else
      await expect(page.locator('#admin-gallery-grid')).toContainText('teacher@school.example');
    if (role === 'admin') {
      await page.getByRole('tab', { name: 'Head board' }).click();
      await expect(page.locator('#head-list .admin-content-card')).toHaveCount(1);
      await page.locator('#head-list').getByRole('button', { name: 'Edit', exact: true }).click();
      await page.locator('#head-name').fill('Updated board member');
      await page.getByRole('button', { name: 'Save board member' }).click();
      await expect(page.locator('#head-list')).toContainText('Updated board member');
      await page.screenshot({ path: 'test-results/admin-desktop.png', fullPage: true });
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login\/index.html/);
    expect(errors).toEqual([]);
  });
test('staff sign-in uses server-verified SCMU password and redirects to dashboard', async ({
  page,
}) => {
  await staffFixture(page, null);
  await page.goto('/login/index.html');
  await expect(page.locator('#login-button')).toBeEnabled();
  await page.getByLabel('SCMU account email').fill('admin@school.example');
  await page.getByLabel('Password', { exact: true }).fill('unique-scmu-password');
  await page.locator('#login-button').click();
  await expect(page).toHaveURL(/\/admin\/index.html/);
  await expect(page.locator('#staff-role')).toHaveText('admin');
});

test('Student file publishing shows progress and registers the server permit', async ({ page }) => {
  await staffFixture(page, 'student');
  await page.goto('/admin/index.html');
  await expect(page.locator('#staff-role')).toHaveText('student');
  await page.locator('#gallery-file').setInputFiles({
    name: 'approved-photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  await page.locator('#gallery-caption').fill('Published from file input');
  await page.getByRole('button', { name: 'Publish photograph' }).click();
  await expect(page.locator('#gallery-form .form-status')).toContainText('Saved successfully');
  await expect(page.locator('#admin-gallery-grid')).toContainText('Published from file input');
  await expect(page.locator('#admin-gallery-grid')).not.toContainText('Posted by');
});
test('Admin account/event/IP forms and maintenance/live controls save and remove correctly', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await staffFixture(page, 'admin');
  await page.goto('/admin/index.html');
  await expect(page.locator('#staff-role')).toHaveText('admin');
  await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
  await page.locator('#account-name').fill('New contributor');
  await page.locator('#account-email').fill('new@school.example');
  await page.locator('#account-password').fill('unique-test-password');
  await page.getByRole('button', { name: 'Save account' }).click();
  await expect(page.locator('#account-list')).toContainText('New contributor');
  const account = page
    .locator('#account-list .staff-item')
    .filter({ hasText: 'new@school.example' });
  await account.getByRole('button', { name: 'Edit account' }).click();
  await page.locator('#account-role').selectOption('teacher');
  await page.getByRole('button', { name: 'Save account' }).click();
  await expect(account).toContainText('teacher');
  await account.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(account).toBeVisible();
  await account.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(account).toHaveCount(0);
  await page.getByRole('tab', { name: 'Events', exact: true }).click();
  await page.locator('#popup-title').fill('New event notice');
  await page.locator('#popup-message').fill('Details for our school event.');
  await page.getByRole('button', { name: 'Publish event' }).click();
  await expect(page.locator('#popup-list')).toContainText('New event notice');
  await page.getByRole('tab', { name: 'IP blocks', exact: true }).click();
  await page.locator('#block-ip').fill('198.51.100.9');
  await page.locator('#block-reason').fill('Test access restriction');
  await page.getByRole('button', { name: 'Block staff access' }).click();
  await expect(page.locator('#ip-list')).toContainText('198.51.100.9');
  await page.locator('#ip-list').getByRole('button', { name: 'Unblock', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#ip-list')).not.toContainText('198.51.100.9');
  await page.getByRole('tab', { name: 'Live', exact: true }).click();
  await expect(page.locator('#live-form input[type=checkbox]')).toBeChecked();
  await page.locator('#live-form input[type=checkbox]').uncheck();
  await page.getByRole('button', { name: 'Save live status' }).click();
  await expect(page.locator('#live-form .form-status')).toContainText('Saved successfully');
  await page.getByRole('tab', { name: 'Availability', exact: true }).click();
  await page.locator('#settings-form input').check();
  await page.getByRole('button', { name: 'Save availability' }).click();
  await expect(page.locator('#settings-form .form-status')).toContainText('Saved successfully');
  const response = await page.request.get('/');
  expect(response.status()).toBe(503);
  await page.locator('#settings-form input').uncheck();
  await page.getByRole('button', { name: 'Save availability' }).click();
  await expect(page.locator('#settings-form .form-status')).toContainText('Saved successfully');
  expect((await page.request.get('/')).status()).toBe(200);
  expect(errors).toEqual([]);
});

for (const role of ['teacher', 'student'])
  test(`${role} publishes a special-event image from the dashboard`, async ({ page }) => {
    await staffFixture(page, role);
    await page.goto('/admin/index.html');
    await page.getByRole('tab', { name: 'Events', exact: true }).click();
    await expect(page.locator('#popup-list')).not.toContainText('Edit text');
    await expect(page.locator('#popup-list')).not.toContainText('Remove event');
    const title = `Special event by ${role}`;
    await page.getByLabel('Event title', { exact: true }).fill(title);
    await page.locator('#popups-form textarea').fill('Published by our media team.');
    await page.locator('#popup-file').setInputFiles({
      name: 'event.png',
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await page.getByRole('button', { name: 'Publish event', exact: true }).click();
    await expect(page.locator('#popup-list')).toContainText(title);
    await page.goto('/');
    await expect(page.locator('#event-title')).toHaveText(title);
    await expect(page.locator('.featured-event-image')).toBeVisible();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
  });
test('navigation underline follows hover and focus; reduced motion keeps sections visible', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  const underline = page.locator('.nav-indicator');
  const home = await underline.evaluate((node) => getComputedStyle(node).transform);
  await page.locator('#navigation a[href="/gallery"]').hover();
  await expect
    .poll(() => underline.evaluate((node) => getComputedStyle(node).transform))
    .not.toBe(home);
  await page.locator('#navigation a[href="/contact"]').focus();
  await expect(underline).toBeVisible();
  expect(await underline.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0s');
  expect(
    await page.locator('.special-event').evaluate((node) => getComputedStyle(node).opacity),
  ).toBe('1');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await expect(page.locator('#navigation')).toBeVisible();
  expect(
    await page.locator('#navigation').evaluate((node) => getComputedStyle(node).position),
  ).toBe('absolute');
});
