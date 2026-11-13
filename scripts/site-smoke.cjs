'use strict';

const assert = require('node:assert/strict');
const { readFileSync, mkdirSync } = require('node:fs');
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

async function orderHeadingAligned(page) {
  await page.waitForFunction(() => {
    const title = document.querySelector('#makeorder').getBoundingClientRect();
    const header = document.querySelector('.header').getBoundingClientRect();
    return Math.abs(title.top - header.bottom - 24) <= 2;
  });
}

async function noStickyControl(page, selector) {
  if (!await page.evaluate(() => matchMedia('(hover: none)').matches)) await page.mouse.move(1, 1);
  await page.waitForFunction(selector => {
    const style = getComputedStyle(document.querySelector(selector));
    return style.outlineStyle === 'none' && style.backgroundColor === 'rgba(0, 0, 0, 0)';
  }, selector);
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
  assert.equal(await form.locator('#consent').getAttribute('aria-invalid'), 'true');
  assert.ok(await form.isVisible(), 'Unchecked consent must prevent submission');
  await activate(form.locator('#consent'));
  await activate(submit);
  await page.locator('#form-success').waitFor({ state: 'visible' });
  assert.match(await page.locator('#form-success').innerText(), /данные не отправлены/);
  await page.waitForFunction(() => {
    const receipt = document.querySelector('#form-success h3').getBoundingClientRect();
    const header = document.querySelector('.header').getBoundingClientRect();
    return receipt.top >= header.bottom && receipt.bottom <= innerHeight;
  });
  assert.ok(await form.isHidden());
  await activate(page.locator('#form-again'));
  await form.waitFor({ state: 'visible' });
  for (const input of [name, contact, message]) assert.equal(await input.inputValue(), '');
  assert.ok(await page.locator('#form-success').isHidden());
  assert.equal(await form.locator('#consent').isChecked(), false);
}

async function testCatalog(page, activate) {
  await load(page, 'catalog.html');
  assert.equal(await page.locator('.page-hero img').getAttribute('src'), 'assets/forest-flowers.webp');
  for (const [id, price] of [['boot-installation', ''], ['mules', '60 000 ₽'], ['belt', '20 000 ₽'], ['chain-bag', '120 000 ₽']]) {
    await activate(page.locator('[data-product="' + id + '"]'));
    const details = page.locator('#product-dialog[open]');
    await details.waitFor();
    assert.equal(await details.locator('[data-close-dialog]').evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'Pointer opening must not highlight Close');
    const item = catalog.find(product => product.id === id);
    assert.equal(await details.locator('#product-description').textContent(), item.description);
    assert.equal(await details.locator('#product-price').textContent(), price);
    assert.equal(await details.locator('#product-price-note').isHidden(), item.customizable === false);
    const links = details.locator('#product-description a');
    assert.equal(await links.count(), id === 'boot-installation' ? 1 : 0, 'No link leaks between products');
    if (id === 'boot-installation') {
      assert.equal(await links.getAttribute('href'), 'https://t.me/lamodegalerie');
      assert.equal(await links.getAttribute('target'), '_blank');
    }
    assert.ok(await details.evaluate(element => element.scrollWidth <= element.clientWidth), 'Product copy overflows the dialog');
    await activate(details.locator('[data-close-dialog]'));
    await details.waitFor({ state: 'hidden' });
  }
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
  await noStickyControl(page, '#product-next');
  await activate(dialog.locator('#product-prev'));
  await decodedImage(page, '#product-image', original);
  await noStickyControl(page, '#product-prev');
  await activate(dialog.locator('#product-enquire'));
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement.id === 'name');
  await orderHeadingAligned(page);
  await testForm(page, activate);
}

async function testEntryAndChoice(page, activate, layout) {
  await load(page, '');
  assert.equal(await page.locator('a[href*="privacy"], a[href*="consent"]').count(), 0, 'Landing must not contain legal links');
  const geometry = await page.evaluate(() => ({
    top: document.querySelector('.portal').getBoundingClientRect().top,
    scrollbar: getComputedStyle(document.documentElement).scrollbarWidth,
    border: getComputedStyle(document.querySelector('.dive-in')).borderTopWidth,
    buttonColor: getComputedStyle(document.querySelector('.button-contact')).color,
  }));
  assert.equal(geometry.top, 0);
  assert.equal(geometry.scrollbar, 'none');
  assert.ok(parseFloat(geometry.border) > 0, 'DIVE IN must retain its visible frame');
  assert.equal(geometry.buttonColor, 'rgb(16, 16, 16)', 'Contact text must stay dark on silver');
  for (const selector of ['.dive-in', '.button-contact']) {
    assert.equal(await page.locator(selector).getAttribute('href'), null, 'Enhanced transitions must not expose a hover URL');
  }
  await activate(page.locator('.button-contact'));
  await page.waitForURL('**/catalog.html#makeorder');
  await orderHeadingAligned(page);
  await load(page, '');
  if (layout.touch) await activate(page.locator('.dive-in'));
  else await page.locator('.dive-in').press('Enter');
  await page.waitForURL('**/choice.html');
  assert.equal(await page.locator('.choice-card h2 svg').count(), 0);
  for (const [index, path] of [[0, 'catalog.html'], [1, 'archive.html']]) {
    if (index) await load(page, 'choice.html');
    const card = page.locator('.choice-card').nth(index);
    assert.equal(await card.getAttribute('role'), 'link');
    assert.equal(await card.locator('a,button').count(), 0, 'Full-card links must not contain nested controls');
    await card.scrollIntoViewIfNeeded();
    if (!layout.touch) assert.equal(await card.locator('p').first().evaluate((el) => getComputedStyle(el).cursor), 'pointer');
    // Exercise the empty area outside the heading and the old small link.
    const box = await card.boundingBox();
    const position = { x: box.width - 8, y: Math.min(box.height - 12, 180) };
    if (layout.touch) await card.tap({ position });
    else await card.click({ position });
    await page.waitForURL('**/' + path);
  }
}

async function testPointerAndMotion(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
  try {
    const page = await context.newPage();
    await load(page, '');
    await page.waitForFunction(() => document.querySelector('.landing-cursor')?.complete);
    for (const [x, y] of [[1, 220], [1279, 220], [640, 1], [640, 899]]) {
      await page.mouse.move(x, y);
      await page.waitForFunction(({ x, y }) => {
        const crown = document.querySelector('.landing-cursor');
        const rect = crown.getBoundingClientRect();
        return !crown.hidden && Math.abs(rect.x + 24 - x) < 1 && Math.abs(rect.y + 24 - y) < 1;
      }, { x, y });
    }
    const contact = page.locator('.button-contact');
    const before = await contact.boundingBox();
    await page.mouse.move(before.x + before.width - 8, before.y + before.height - 8);
    await page.waitForFunction(() => {
      const button = document.querySelector('.button-contact');
      return parseFloat(button.style.getPropertyValue('--magnet-x')) > 2 && document.querySelector('.landing-cursor').hidden;
    });
    assert.deepEqual(await contact.boundingBox(), before, 'Magnet must not move its click area');
    assert.equal(await contact.evaluate((el) => getComputedStyle(el).cursor), 'pointer');
    await page.mouse.move(400, 200);
    await page.waitForFunction(() => parseFloat(document.querySelector('.button-contact').style.getPropertyValue('--magnet-x')) === 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.move(before.x + before.width - 8, before.y + 8);
    assert.equal(await contact.locator('.contact-face').evaluate((el) => getComputedStyle(el).transform), 'none');

    await load(page, 'choice.html');
    const copy = page.locator('.about-text p').first();
    assert.equal(await copy.evaluate((el) => getComputedStyle(el).cursor), 'text');
    await page.locator('.choice-card').first().press('Enter');
    await page.waitForURL('**/catalog.html');
    const boots = page.locator('[data-product="zip-2026"]');
    await boots.hover();
    const hover = boots.locator('.card-image-hover');
    await decodedImage(page, '[data-product="zip-2026"] .card-image-hover', 'assets/zip-boots-2026.webp');
    assert.equal(await hover.evaluate((el) => getComputedStyle(el).objectFit), 'contain');
    assert.equal(await hover.evaluate((el) => getComputedStyle(el).transform), 'none');
    assert.equal(await boots.evaluate((el) => getComputedStyle(el).cursor), 'pointer');
    assert.equal(await page.locator('#name').evaluate((el) => getComputedStyle(el).cursor), 'text');
    await boots.press('Enter');
    await page.locator('#product-dialog[open]').waitFor();
    assert.ok(await page.locator('[data-close-dialog]').evaluate(el => el === document.activeElement && el.matches(':focus-visible')), 'Keyboard opening must keep visible focus');
    await page.keyboard.press('Tab');
    assert.ok(await page.locator('#product-photo-next').evaluate(el => el === document.activeElement && el.matches(':focus-visible')));
    await page.keyboard.press('Escape');
    console.log('desktop pointer: four viewport edges, stable contact magnet, reduced motion, keyboard routes and boot framing passed');
  } finally {
    await context.close();
  }
}

async function testArchive(page, activate, expectedWidth) {
  const requested = new Set();
  page.on('request', (request) => requested.add(request.url()));
  await load(page, 'archive.html');
  assert.equal(await page.locator('.page-hero img').getAttribute('src'), 'assets/forest-stump.webp');
  assert.equal(await page.locator('h1').count(), 1);
  const cards = page.locator('#archive-grid [data-archive-photo]');
  const originals = await cards.evaluateAll((items) => items.map((item) => item.dataset.archivePhoto));
  assert.ok(originals.length >= 2, 'Expected multiple archive cards');
  if (page.viewportSize().width <= 700) {
    const grid = await page.locator('#archive-grid').boundingBox();
    const boxes = await cards.evaluateAll(items => items.map(el => {const r = el.getBoundingClientRect(); return {width:r.width,top:Math.round(r.top)};}));
    const rows = new Map();
    for (const box of boxes) rows.set(box.top, [...(rows.get(box.top) || []), box]);
    const counts = [...rows.values()].map(row => row.length);
    assert.ok(counts.includes(1) && counts.includes(3), 'Mobile archive needs both large photographs and three-photo rows');
    assert.ok(counts.every(n => n === 1 || n === 3), 'No incomplete mobile rows');
    for (const row of rows.values()) for (const box of row) {
      assert.ok(row.length === 1 ? Math.abs(box.width - grid.width) < 1 : box.width < grid.width / 2);
    }
  }
  const first = cards.first();
  await first.scrollIntoViewIfNeeded();
  const image = first.locator('img');
  if (page.viewportSize().width <= 700) expectedWidth = (await first.boundingBox()).width > 320 ? 640 : 320;
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
  assert.equal(await dialog.locator('#archive-close').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  await decodedImage(page, '#archive-image', originals[0]);
  await activate(dialog.locator('#archive-next'));
  await decodedImage(page, '#archive-image', originals[1]);
  await noStickyControl(page, '#archive-next');
  await activate(dialog.locator('#archive-close'));
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement === document.querySelector('#archive-grid [data-archive-photo]'));
  await activate(page.locator('.button-contact'));
  await orderHeadingAligned(page);
  await testForm(page, activate);
}

async function run() {
  const browser = await chromium.launch({
    executablePath: process.env.JC_PIT_BROWSER_PATH || undefined,
  });
  try {
    const layouts = [
      { name: 'desktop', width: 1280, height: 900, scale: 2, touch: false, thumb: 640 },
      { name: 'mobile-320', width: 320, height: 740, scale: 1, touch: true, thumb: 320 },
      { name: 'mobile-390', width: 390, height: 844, scale: 1, touch: true, thumb: 640 },
      { name: 'mobile-430', width: 430, height: 932, scale: 1, touch: true, thumb: 640 },
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
        await testEntryAndChoice(page, activate, layout);
        await testCatalog(page, activate);
        await testArchive(page, activate, layout.thumb);
        mkdirSync(join(__dirname, '../qa/form-review'), { recursive: true });
        await page.locator('#consent').scrollIntoViewIfNeeded();
        await page.screenshot({path: join(__dirname, '../qa/form-review/' + layout.name + '-form.png')});
        for (const legal of ['privacy.html', 'consent.html']) {
          await load(page, legal);
          assert.equal(await page.locator('h1').count(), 1);
          assert.equal(await page.locator('.button-contact').count(), 1);
          assert.ok(await page.locator('main').innerText().then(text=>text.includes('Александр')));
          await page.screenshot({path: join(__dirname, '../qa/form-review/' + layout.name + '-' + legal + '.png')});
        }
        assert.deepEqual(errors, []);
        console.log(layout.name + ': landing, full-card navigation, galleries, responsive archive and form validation passed');
      } finally {
        await context.close();
      }
    }
    await testPointerAndMotion(browser);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
