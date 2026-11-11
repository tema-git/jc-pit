'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const base = new URL(process.env.JC_PIT_BASE_URL || 'http://127.0.0.1:8765/');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Smoke tests need a local server');
const catalog = JSON.parse(readFileSync(join(__dirname, '../products.json'), 'utf8'));
const multiPhotoProducts = (Array.isArray(catalog) ? catalog : catalog.products)
  .filter((product) => product.images.length > 1)
  .map((product) => product.id);

async function load(page, path) {
  const response = await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' });
  assert.ok(response?.ok(), 'Expected a successful response for ' + path);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.ok(fits, path + ' overflows its viewport');
}

async function decodedImage(page, selector, expectedPath, previousPath = '') {
  await page.waitForFunction(({ selector, expectedPath, previousPath }) => {
    const image = document.querySelector(selector);
    if (!image?.complete || !image.naturalWidth || image.hidden) return false;
    const src = image.getAttribute('src');
    return src && (!expectedPath || src === expectedPath) && src !== previousPath;
  }, { selector, expectedPath, previousPath });
  return page.locator(selector).getAttribute('src');
}

async function testForm(page, activate) {
  const form = page.locator('#enquiry-form');
  assert.equal(await form.locator('select').count(), 0, 'Order form must accept free text');
  const name = form.locator('#name');
  const contact = form.locator('#contact');
  const message = form.locator('#message');
  const submit = form.locator('#form-submit');

  await activate(submit);
  assert.equal(await name.getAttribute('aria-invalid'), 'true');
  assert.equal(await contact.getAttribute('aria-invalid'), 'true');
  assert.ok(await page.locator('#name-error').textContent());
  assert.ok(await page.locator('#contact-error').textContent());
  await page.waitForFunction(() => document.activeElement.id === 'name');

  await name.fill('Проверка');
  await contact.fill('qa@example.invalid');
  await message.fill('Тестовое описание модели и материалов');
  await activate(submit);
  await page.locator('#form-success').waitFor({ state: 'visible' });
  assert.ok(await form.isHidden());
  await activate(page.locator('#form-again'));
  await form.waitFor({ state: 'visible' });
  for (const input of [name, contact, message]) assert.equal(await input.inputValue(), '');
  assert.ok(await page.locator('#form-success').isHidden());
}

async function testCatalog(page, activate) {
  await load(page, 'catalog.html');
  const galleryId = await page.locator('[data-product]').evaluateAll(
    (cards, ids) => cards.find((card) => ids.includes(card.dataset.product))?.dataset.product,
    multiPhotoProducts,
  );
  assert.ok(galleryId, 'Expected a catalog card with multiple photos');
  const card = page.locator('[data-product]').filter({
    has: page.locator('img'),
  }).and(page.locator('[data-product=' + JSON.stringify(galleryId) + ']'));
  await activate(card);
  const dialog = page.locator('#product-dialog[open]');
  await dialog.waitFor();
  const original = await decodedImage(page, '#product-image');
  await activate(dialog.locator('#product-next'));
  await decodedImage(page, '#product-image', '', original);
  await activate(dialog.locator('#product-enquire'));
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement.id === 'name');
  await testForm(page, activate);
}

async function testArchive(page, activate, expectedWidth) {
  const requested = new Set();
  page.on('request', (request) => requested.add(request.url()));
  await load(page, 'archive.html');
  const cards = page.locator('#archive-grid [data-archive-photo]');
  const originals = await cards.evaluateAll((items) => items.map((item) => item.dataset.archivePhoto));
  assert.ok(originals.length >= 2, 'Expected multiple archive cards');
  const first = cards.first();
  await first.scrollIntoViewIfNeeded();
  const image = first.locator('img');
  const variant = await image.evaluate((thumb, width) => {
    const entry = thumb.srcset.split(',').map((part) => part.trim().split(/\s+/))
      .find((parts) => parts[1] === String(width) + 'w');
    return entry ? new URL(entry[0], document.baseURI).href : null;
  }, expectedWidth);
  assert.ok(variant, 'Expected an appropriate archive thumbnail');
  await page.waitForFunction((url) => {
    const thumb = document.querySelector('#archive-grid [data-archive-photo] img');
    return thumb?.currentSrc === url && thumb.complete && thumb.naturalWidth > 0;
  }, variant);
  assert.ok(requested.has(variant), 'Expected the browser to request the thumbnail');
  for (const path of originals) {
    assert.ok(!requested.has(new URL(path, page.url()).href), 'Full-size image loaded before opening: ' + path);
  }

  await activate(first);
  const dialog = page.locator('#archive-dialog[open]');
  await dialog.waitFor();
  await decodedImage(page, '#archive-image', originals[0]);
  await activate(dialog.locator('#archive-next'));
  await decodedImage(page, '#archive-image', originals[1]);
  await activate(dialog.locator('#archive-close'));
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement === document.querySelector('#archive-grid [data-archive-photo]'));
  await testForm(page, activate);
}

async function run() {
  const browser = await chromium.launch({
    executablePath: process.env.JC_PIT_BROWSER_PATH || undefined,
  });
  try {
    const layouts = [
      { name: 'desktop', width: 1280, height: 900, scale: 2, touch: false, thumb: 640 },
      { name: 'mobile', width: 390, height: 844, scale: 1, touch: true, thumb: 320 },
    ];
    for (const layout of layouts) {
      const context = await browser.newContext({
        viewport: { width: layout.width, height: layout.height },
        deviceScaleFactor: layout.scale,
        hasTouch: layout.touch,
        isMobile: layout.touch,
        reducedMotion: 'reduce',
      });
      try {
        const errors = [];
        await context.route('**/*', (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== base.origin || !['GET', 'HEAD'].includes(request.method())) {
            errors.push('Unexpected request: ' + request.method() + ' ' + url.origin + url.pathname);
            return route.abort();
          }
          return route.continue();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('response', (response) => {
          if (response.status() >= 400) errors.push(response.status() + ' ' + response.url());
        });
        const activate = (locator) => layout.touch ? locator.tap() : locator.click();
        await testCatalog(page, activate);
        await testArchive(page, activate, layout.thumb);
        assert.deepEqual(errors, []);
        console.log(layout.name + ': gallery navigation, responsive archive and form validation passed');
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
