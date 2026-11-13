(() => {
  'use strict';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  // Keep crawlable links in the document source. Enhance internal transitions
  // without a native href so the browser does not cover the image with a URL.
  for (const card of $$('.choice-card')) {
    const heading = $('h2', card);
    const link = $('h2 a[href]', card);
    if (!heading || !link) continue;
    heading.id ||= `choice-${link.getAttribute('href').replace('.html', '')}`;
    card.dataset.destination = link.getAttribute('href');
    card.setAttribute('role', 'link');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-labelledby', heading.id);
    for (const anchor of $$('a[data-route]', card)) {
      const label = document.createElement('span');
      label.className = anchor.className;
      label.append(...anchor.childNodes);
      anchor.replaceWith(label);
    }
  }

  for (const anchor of $$('a[data-route], a#product-enquire')) {
    const button = document.createElement('button');
    for (const attribute of anchor.attributes) {
      if (!['href', 'data-route'].includes(attribute.name)) button.setAttribute(attribute.name, attribute.value);
    }
    button.type = 'button';
    button.setAttribute('role', 'link');
    button.classList.add('route-button');
    button.dataset.destination = anchor.getAttribute('href');
    button.append(...anchor.childNodes);
    anchor.replaceWith(button);
  }

  function followRoute(event) {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const target = event.target.closest('[data-destination]');
    if (!target || (event.type === 'auxclick' && event.button !== 1)) return;
    // Dragging across a card must still select and copy its text.
    const selection = window.getSelection();
    if (target.matches('.choice-card') && selection && !selection.isCollapsed
      && target.contains(selection.anchorNode) && target.contains(selection.focusNode)) return;
    event.preventDefault();
    const destination = new URL(target.dataset.destination, document.baseURI);
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) {
      window.open(destination.href, '_blank', 'noopener');
    } else {
      closeMenu();
      window.location.assign(destination.href);
    }
  }
  document.addEventListener('click', followRoute);
  document.addEventListener('auxclick', followRoute);
  for (const card of $$('.choice-card[data-destination]')) {
    card.addEventListener('keydown', (event) => {
      if (event.target === card && event.key === 'Enter') followRoute(event);
    });
  }

  // Only the face moves; the contact control's layout and hit area stay fixed.
  for (const contact of $$('.button-contact')) {
    const face = document.createElement('span');
    face.className = 'contact-face';
    face.append(...contact.childNodes);
    contact.append(face);
    let frame = 0;
    let x = 0;
    let y = 0;
    const paint = () => {
      frame = 0;
      contact.style.setProperty('--magnet-x', `${x.toFixed(2)}px`);
      contact.style.setProperty('--magnet-y', `${y.toFixed(2)}px`);
    };
    const reset = () => {
      x = y = 0;
      if (frame) cancelAnimationFrame(frame);
      paint();
    };
    contact.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse' || !finePointer.matches || reducedMotion.matches) return;
      const rect = contact.getBoundingClientRect();
      x = Math.max(-5, Math.min(5, ((event.clientX - rect.left) / rect.width - .5) * 10));
      y = Math.max(-4, Math.min(4, ((event.clientY - rect.top) / rect.height - .5) * 8));
      if (!frame) frame = requestAnimationFrame(paint);
    });
    for (const name of ['pointerleave', 'pointercancel', 'pointerup', 'blur']) contact.addEventListener(name, reset);
    window.addEventListener('blur', reset);
    reducedMotion.addEventListener('change', reset);
    finePointer.addEventListener('change', reset);
  }

  // Native image cursors fall back near the viewport edge. On the landing,
  // draw the same mark as a non-interactive overlay with no easing or trail.
  if (document.body.classList.contains('entry-page')) {
    const crown = document.createElement('img');
    crown.className = 'landing-cursor';
    crown.alt = '';
    crown.setAttribute('aria-hidden', 'true');
    crown.hidden = true;
    let ready = false;
    let frame = 0;
    let pointer = null;
    const hide = () => {
      crown.hidden = true;
      pointer = null;
      document.documentElement.classList.remove('landing-cursor-ready');
    };
    const sync = () => {
      const enabled = ready && finePointer.matches && Boolean(pointer);
      document.documentElement.classList.toggle('landing-cursor-ready', enabled);
      if (!ready || !finePointer.matches) hide();
    };
    const paint = () => {
      frame = 0;
      if (!pointer || !finePointer.matches || !ready) return;
      const target = document.elementFromPoint(pointer.x, pointer.y);
      crown.hidden = !target || getComputedStyle(target).cursor !== 'none';
      if (!crown.hidden) crown.style.transform = `translate3d(${pointer.x - 24}px,${pointer.y - 24}px,0)`;
    };
    crown.addEventListener('load', () => { ready = true; sync(); }, { once: true });
    crown.src = 'assets/cursor-crown-light.svg?v=20261028-refine2';
    document.body.append(crown);
    document.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return hide();
      pointer = { x: event.clientX, y: event.clientY };
      if (ready && finePointer.matches) document.documentElement.classList.add('landing-cursor-ready');
      if (!frame) frame = requestAnimationFrame(paint);
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', hide);
    document.addEventListener('pointercancel', hide);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', hide);
    finePointer.addEventListener('change', sync);
  }

  const menuToggle = $('[data-menu-toggle]');
  const navigation = $('#site-nav');
  const header = menuToggle?.closest('header') || $('header');

  function closeMenu() {
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', 'Открыть меню');
    navigation?.classList.remove('is-open');
    header?.classList.remove('menu-open');
  }

  menuToggle?.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    navigation?.classList.toggle('is-open', open);
    header?.classList.toggle('menu-open', open);
  });

  navigation?.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a, [data-destination]')) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuToggle?.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuToggle.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('a[href$="#contacts"], a[href$="#makeorder"]')) closeMenu();
    if (menuToggle?.getAttribute('aria-expanded') === 'true' && !header?.contains(event.target)) closeMenu();
  });

  const filterButtons = $$('[data-filter]');
  const productCards = $$('.product[data-category]');
  const filterCount = $('#filter-count');

  function filterProducts(category) {
    let visible = 0;
    for (const product of productCards) {
      const show = category === 'all' || product.dataset.category === category;
      product.hidden = !show;
      if (show) visible += 1;
    }
    for (const button of filterButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === category));
    }
    if (filterCount) filterCount.textContent = `Показано: ${visible}`;
    requestMotionFrame();
  }

  for (const button of filterButtons) {
    button.addEventListener('click', () => filterProducts(button.dataset.filter || 'all'));
  }

  const dialog = $('#product-dialog');
  const productTitle = $('#product-title');
  const productYear = $('#product-year');
  const productDescription = $('#product-description');
  const productSpecs = $('#product-specs');
  const productPrice = $('#product-price');
  const productPriceNote = $('#product-price-note');
  const productImage = $('#product-image');
  const productCounter = $('#product-image-counter');
  const galleryStatus = $('#product-gallery-status');
  const productPrevious = $('#product-prev');
  const productNext = $('#product-next');
  const productPhotoNext = $('#product-photo-next');
  const productRetry = $('#product-retry');
  const productEnquire = $('#product-enquire');
  const catalogError = $('#catalog-error');
  const productURL = new URL('./products.json', document.baseURI);
  const scriptVersion = document.currentScript?.src
    ? new URL(document.currentScript.src, document.baseURI).searchParams.get('v')
    : '';
  productURL.searchParams.set('v', scriptVersion || '20261027-tilda3');
  let productsPromise;
  let currentProduct = null;
  let requestedProductImage = 0;
  let displayedProductImage = -1;
  let imageVersion = 0;
  let openVersion = 0;
  let dialogTrigger = null;

  async function loadProducts(refresh = false) {
    if (refresh) productsPromise = undefined;
    if (!productsPromise) {
      productsPromise = fetch(productURL.href, { credentials: 'omit', cache: 'no-cache' })
        .then((response) => {
          if (!response.ok) throw new Error('Catalog unavailable');
          return response.json();
        })
        .then((data) => {
          const products = Array.isArray(data) ? data : data.products;
          if (!Array.isArray(products)) throw new Error('Invalid catalog');
          return products;
        })
        .catch((error) => {
          productsPromise = undefined;
          throw error;
        });
    }
    return productsPromise;
  }

  async function findProduct(id) {
    const products = await loadProducts();
    const product = products.find((item) => String(item.id) === id);
    if (product) return product;
    const refreshedProducts = await loadProducts(true);
    return refreshedProducts.find((item) => String(item.id) === id);
  }

  function imageEntry(product, index) {
    const item = product.images?.[index];
    return typeof item === 'string'
      ? { src: item, caption: product.captions?.[index] || '' }
      : { src: item?.src || item?.url || '', caption: item?.caption || item?.alt || product.captions?.[index] || '' };
  }

  const imageCache = new Map();

  function trimImageCache(protectedRecord) {
    if (imageCache.size <= 8) return;
    for (const [key, value] of imageCache) {
      if (imageCache.size <= 8) break;
      if (value !== protectedRecord && value.status !== 'loading') imageCache.delete(key);
    }
  }

  function imageRequest(src, priority = 'low') {
    const url = new URL(src, document.baseURI).href;
    const cached = imageCache.get(url);
    if (cached) {
      if (priority === 'high') cached.image.fetchPriority = 'high';
      imageCache.delete(url);
      imageCache.set(url, cached);
      return cached;
    }
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = priority;
    const record = { image, status: 'loading', promise: null };
    record.promise = new Promise((resolve, reject) => {
      image.onload = () => {
        const decoded = typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve();
        decoded.then(() => {
          record.status = 'loaded';
          image.onload = null;
          image.onerror = null;
          trimImageCache(record);
          resolve(image);
        });
      };
      image.onerror = () => {
        record.status = 'error';
        if (imageCache.get(url) === record) imageCache.delete(url);
        reject(new Error('Image unavailable'));
      };
    });
    imageCache.set(url, record);
    image.src = url;
    trimImageCache(record);
    return record;
  }

  function preloadImage(src) {
    if (!src) return;
    imageRequest(src).promise.catch(() => {});
  }

  function bindPhotoNavigation(element, changePhoto) {
    if (!element) return () => {};
    let gesture = null;
    let suppressClick = false;
    let suppressionTimer = 0;
    function reset() {
      gesture = null;
      suppressClick = false;
      clearTimeout(suppressionTimer);
    }
    element.addEventListener('click', (event) => {
      if (suppressClick && event.detail > 0) {
        reset();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      changePhoto(1);
    });
    element.addEventListener('pointerdown', (event) => {
      reset();
      if (event.pointerType === 'touch' && event.isPrimary) {
        gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
      }
    }, { passive: true });
    element.addEventListener('pointerup', (event) => {
      const start = gesture;
      gesture = null;
      if (!start || start.pointer !== event.pointerId) return;
      const x = event.clientX - start.x;
      const y = event.clientY - start.y;
      if (event.timeStamp - start.time >= 1000 || Math.abs(x) <= 48 || Math.abs(y) >= Math.abs(x) * 0.55) return;
      suppressClick = true;
      suppressionTimer = window.setTimeout(() => { suppressClick = false; }, 450);
      if (event.cancelable) event.preventDefault();
      changePhoto(x < 0 ? 1 : -1);
    });
    element.addEventListener('pointercancel', () => { gesture = null; });
    return reset;
  }

  const archiveGrid = $('#archive-grid');
  const archivePhotos = $$('[data-archive-photo]', archiveGrid || document);
  const archiveDialog = $('#archive-dialog');
  const archiveImage = $('#archive-image');
  const archiveFrame = $('.archive-lightbox-image');
  const archivePhotoNext = $('#archive-photo-next') || archiveFrame;
  const archiveClose = $('#archive-close');
  const archivePrevious = $('#archive-prev');
  const archiveNext = $('#archive-next');
  const archiveCounter = $('#archive-photo-counter');
  const archiveStatus = $('#archive-photo-status');
  const archiveRetry = $('#archive-retry');
  let requestedArchiveImage = 0;
  let displayedArchiveImage = -1;
  let archiveImageVersion = 0;
  let archiveTrigger = null;

  const archiveDesktopSizes = '(max-width: 1100px) calc((100vw - 92px) / 3), (min-width: 1800px) 397px, (min-width: 1496px) 347px, calc((100vw - 110px) / 4)';

  if (archiveGrid && archivePhotos.length) {
    for (let index = archivePhotos.length - 1; index > 0; index -= 1) {
      const other = Math.floor(Math.random() * (index + 1));
      [archivePhotos[index], archivePhotos[other]] = [archivePhotos[other], archivePhotos[index]];
    }
    const fragment = document.createDocumentFragment();
    let rowRemaining = 0;
    let rowSize = 0;
    let previousRowSize = 0;
    let repeatedRows = 0;
    for (let index = 0; index < archivePhotos.length; index += 1) {
      const photo = archivePhotos[index];
      photo.setAttribute('aria-label', `Открыть фотографию ${index + 1} из ${archivePhotos.length}`);
      const image = $('img', photo);
      if (!rowRemaining) {
        const remaining = archivePhotos.length - index;
        const portrait = image && Number(image.getAttribute('width')) / Number(image.getAttribute('height')) < .85;
        rowSize = remaining < 3 || Math.random() < (portrait ? .72 : .36) ? 1 : 3;
        // Vary the rhythm without leaving an incomplete three-photo row.
        if (remaining >= 3 && previousRowSize === 1 && repeatedRows >= 2) rowSize = 3;
        if (previousRowSize === 3 && repeatedRows >= 3) rowSize = 1;
        if (remaining === 3) rowSize = 3;
        repeatedRows = previousRowSize === rowSize ? repeatedRows + 1 : 1;
        previousRowSize = rowSize;
        rowRemaining = rowSize;
      }
      const wide = rowSize === 1;
      rowRemaining -= 1;
      photo.classList.toggle('archive-photo-wide', wide);
      if (image) image.sizes = (wide
        ? '(max-width: 370px) calc(100vw - 36px), (max-width: 700px) calc(100vw - 44px), '
        : '(max-width: 370px) calc((100vw - 56px) / 3), (max-width: 700px) calc((100vw - 68px) / 3), ') + archiveDesktopSizes;
      if (image && index < 6) image.loading = 'eager';
      fragment.append(photo);
    }
    archiveGrid.append(fragment);
  }

  function archiveImageEntry(index) {
    const photo = archivePhotos[index];
    const thumbnail = photo && $('img', photo);
    return { thumbnail, src: photo?.dataset.archivePhoto || thumbnail?.getAttribute('src') || '' };
  }

  function preloadArchiveNeighbors(index) {
    if (archivePhotos.length < 2) return;
    for (const direction of [-1, 1]) {
      const neighbor = (index + direction + archivePhotos.length) % archivePhotos.length;
      preloadImage(archiveImageEntry(neighbor).src);
    }
  }

  async function renderArchivePhoto() {
    if (!archiveImage || !archiveDialog?.open || !archivePhotos.length) return;
    const version = ++archiveImageVersion;
    const index = requestedArchiveImage;
    const { thumbnail, src } = archiveImageEntry(index);
    const number = index + 1;
    displayedArchiveImage = -1;
    archiveImage.hidden = true;
    archiveImage.removeAttribute('src');
    archiveImage.alt = '';
    archiveImage.setAttribute('aria-busy', 'true');
    archivePhotoNext?.setAttribute('aria-busy', 'true');
    if (archiveCounter) {
      archiveCounter.textContent = `${number} / ${archivePhotos.length}`;
      archiveCounter.setAttribute('aria-label', `Загружается фотография ${number} из ${archivePhotos.length}`);
    }
    if (archivePrevious) archivePrevious.disabled = archivePhotos.length < 2;
    if (archiveNext) archiveNext.disabled = archivePhotos.length < 2;
    if (archivePhotoNext instanceof HTMLButtonElement) archivePhotoNext.disabled = archivePhotos.length < 2;
    if (archiveRetry) archiveRetry.hidden = true;
    if (archiveStatus) archiveStatus.textContent = `Загружаем фотографию ${number} из ${archivePhotos.length}…`;
    archiveDialog.setAttribute('aria-label', `Фотографии архива. Фото ${number} из ${archivePhotos.length}`);
    try {
      if (!src) throw new Error('Archive image unavailable');
      const request = imageRequest(src, 'high');
      preloadArchiveNeighbors(index);
      const image = request.status === 'loaded' ? request.image : await request.promise;
      if (version !== archiveImageVersion || index !== requestedArchiveImage || !archiveDialog.open) return;
      archiveImage.width = image.naturalWidth || thumbnail?.width || 1200;
      archiveImage.height = image.naturalHeight || thumbnail?.height || 1200;
      archiveImage.src = src;
      archiveImage.alt = thumbnail?.alt || `Архив Jerusalem Chinaski, фотография ${number}`;
      displayedArchiveImage = index;
      archiveImage.hidden = false;
      if (archiveStatus) archiveStatus.textContent = '';
      archiveCounter?.setAttribute('aria-label', `Фотография ${number} из ${archivePhotos.length}`);
    } catch {
      if (version !== archiveImageVersion || !archiveDialog.open) return;
      if (archiveStatus) archiveStatus.textContent = `Фотография ${number} не загрузилась. Выберите другую или нажмите «Повторить».`;
      archiveCounter?.setAttribute('aria-label', `Фотография ${number} из ${archivePhotos.length} не загрузилась`);
      if (archiveRetry) archiveRetry.hidden = false;
    } finally {
      if (version === archiveImageVersion) {
        archiveImage.removeAttribute('aria-busy');
        archivePhotoNext?.removeAttribute('aria-busy');
      }
    }
  }

  function openArchivePhoto(photo, fromKeyboard = false) {
    if (!archiveDialog || !archiveImage) return;
    const index = archivePhotos.indexOf(photo);
    if (index < 0) return;
    requestedArchiveImage = index;
    archiveTrigger = photo;
    resetArchivePhotoNavigation();
    closeMenu();
    if (!archiveDialog.open) archiveDialog.showModal();
    document.body.classList.add('dialog-open');
    (fromKeyboard ? archiveClose : archiveDialog)?.focus({ preventScroll: true });
    renderArchivePhoto();
  }

  function changeArchivePhoto(direction) {
    if (!archiveDialog?.open || archivePhotos.length < 2) return;
    requestedArchiveImage = (requestedArchiveImage + direction + archivePhotos.length) % archivePhotos.length;
    renderArchivePhoto();
  }

  const resetArchivePhotoNavigation = bindPhotoNavigation(archivePhotoNext, changeArchivePhoto);

  archiveGrid?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const photo = event.target.closest('[data-archive-photo]');
    if (photo) openArchivePhoto(photo, event.detail === 0);
  });
  archiveClose?.addEventListener('click', () => archiveDialog?.close());
  archivePrevious?.addEventListener('click', () => changeArchivePhoto(-1));
  archiveNext?.addEventListener('click', () => changeArchivePhoto(1));
  archiveRetry?.addEventListener('click', renderArchivePhoto);
  archiveDialog?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      changeArchivePhoto(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  archiveDialog?.addEventListener('click', (event) => {
    if (event.target === archiveDialog) archiveDialog.close();
  });
  archiveDialog?.addEventListener('close', () => {
    if (archiveDialog.open) return;
    archiveImageVersion += 1;
    displayedArchiveImage = -1;
    resetArchivePhotoNavigation();
    document.body.classList.remove('dialog-open');
    if (archiveImage) {
      archiveImage.hidden = true;
      archiveImage.removeAttribute('aria-busy');
      archiveImage.removeAttribute('src');
    }
    archivePhotoNext?.removeAttribute('aria-busy');
    const trigger = archiveTrigger;
    archiveTrigger = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  });

  function renderProductDescription(product) {
    if (!productDescription) return;
    const description = typeof product.description === 'string' ? product.description : '';
    productDescription.replaceChildren();
    let rest = description;
    for (const entry of Array.isArray(product.descriptionLinks) ? product.descriptionLinks : []) {
      if (!entry || typeof entry.text !== 'string' || !entry.text || typeof entry.url !== 'string') continue;
      let url;
      try { url = new URL(entry.url); } catch { continue; }
      if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.username || url.password) continue;
      const position = rest.indexOf(entry.text);
      if (position < 0) continue;
      const link = document.createElement('a');
      link.textContent = entry.text;
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      productDescription.append(document.createTextNode(rest.slice(0, position)), link);
      rest = rest.slice(position + entry.text.length);
    }
    productDescription.append(document.createTextNode(rest));
  }

  function renderProductDetails(product) {
    if (productPriceNote) productPriceNote.hidden = product.customizable === false;
    if (productPrice) {
      const price = typeof product.price === 'string' || typeof product.price === 'number' ? String(product.price) : '';
      productPrice.textContent = price;
      productPrice.hidden = !price;
    }
    if (!productSpecs) return;
    productSpecs.replaceChildren();
    const specs = Array.isArray(product.specs)
      ? product.specs
      : product.specs && typeof product.specs === 'object'
        ? Object.entries(product.specs).map(([label, value]) => ({ label, value }))
        : [];
    for (const spec of specs) {
      const label = typeof spec === 'string' ? 'Детали' : spec?.label || spec?.title || spec?.name || '';
      const value = typeof spec === 'string' ? spec : spec?.value || spec?.text || '';
      if (!label || !value) continue;
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const definition = document.createElement('dd');
      term.textContent = String(label);
      definition.textContent = Array.isArray(value) ? value.join(', ') : String(value);
      row.append(term, definition);
      productSpecs.append(row);
    }
    productSpecs.hidden = !productSpecs.childElementCount;
  }

  function preloadProductNeighbors(product, index) {
    const total = product.images?.length || 0;
    if (total < 2) return;
    for (const direction of [-1, 1]) {
      preloadImage(imageEntry(product, (index + direction + total) % total).src);
    }
  }

  async function renderProductImage() {
    if (!currentProduct || !productImage || !dialog?.open) return;
    const version = ++imageVersion;
    const product = currentProduct;
    const index = requestedProductImage;
    const total = product.images?.length || 0;
    const item = imageEntry(product, index);
    const number = index + 1;
    displayedProductImage = -1;
    productImage.hidden = true;
    productImage.removeAttribute('src');
    productImage.alt = '';
    if (productCounter) {
      productCounter.textContent = `${number} / ${total}`;
      productCounter.setAttribute('aria-label', `Загружается фотография ${number} из ${total}`);
    }
    if (productPrevious) productPrevious.disabled = total < 2;
    if (productNext) productNext.disabled = total < 2;
    if (productPhotoNext) productPhotoNext.disabled = total < 2;
    if (productRetry) productRetry.hidden = true;
    productImage.setAttribute('aria-busy', 'true');
    productPhotoNext?.setAttribute('aria-busy', 'true');
    if (galleryStatus) galleryStatus.textContent = `Загружаем фотографию ${number} из ${total}…`;

    try {
      if (!item.src || !total) throw new Error('Image unavailable');
      const request = imageRequest(item.src, 'high');
      preloadProductNeighbors(product, index);
      const image = request.status === 'loaded' ? request.image : await request.promise;
      if (version !== imageVersion || currentProduct !== product || index !== requestedProductImage || !dialog.open) return;
      productImage.width = image.naturalWidth || 1400;
      productImage.height = image.naturalHeight || 1400;
      productImage.src = item.src;
      productImage.alt = `${product.name}${item.caption ? ` — ${item.caption}` : `, фотография ${number}`}`;
      displayedProductImage = index;
      productImage.hidden = false;
      productCounter?.setAttribute('aria-label', `Фотография ${number} из ${total}`);
      if (galleryStatus) galleryStatus.textContent = item.caption || '';
    } catch {
      if (version !== imageVersion || !dialog.open) return;
      productCounter?.setAttribute('aria-label', `Фотография ${number} из ${total} не загрузилась`);
      if (galleryStatus) galleryStatus.textContent = `Фотография ${number} не загрузилась. Попробуйте другой ракурс${productRetry ? ' или нажмите «Повторить»' : ' или откройте модель ещё раз'}.`;
      if (productRetry) productRetry.hidden = false;
    } finally {
      if (version === imageVersion) {
        productImage.removeAttribute('aria-busy');
        productPhotoNext?.removeAttribute('aria-busy');
      }
    }
  }

  async function openProduct(id, trigger, fromKeyboard = false) {
    const version = ++openVersion;
    trigger.setAttribute('aria-busy', 'true');
    try {
      const product = await findProduct(id);
      if (version !== openVersion) return;
      if (!product) throw new Error(`Product unavailable: ${id}`);
      if (!dialog) throw new Error('Product dialog unavailable');
      currentProduct = product;
      requestedProductImage = 0;
      displayedProductImage = -1;
      resetProductPhotoNavigation();
      dialogTrigger = trigger;
      if (productTitle) productTitle.textContent = product.name;
      if (productYear) productYear.textContent = product.year || '';
      renderProductDescription(product);
      renderProductDetails(product);
      if (productImage) productImage.hidden = true;
      if (catalogError) catalogError.hidden = true;
      closeMenu();
      if (!dialog.open) dialog.showModal();
      document.body.classList.add('dialog-open');
      (fromKeyboard ? $('[data-close-dialog]', dialog) : productTitle)?.focus({ preventScroll: true });
      renderProductImage();
    } catch (error) {
      if (version !== openVersion) return;
      console.error('HJC Pit: не удалось открыть модель', id, error);
      if (catalogError) {
        catalogError.textContent = 'Не удалось открыть модель. Попробуйте ещё раз или перейдите к контактам ниже.';
        catalogError.hidden = false;
      }
    } finally {
      trigger.removeAttribute('aria-busy');
    }
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest('[data-product]');
    if (!trigger) return;
    event.preventDefault();
    openProduct(trigger.dataset.product || '', trigger, event.detail === 0);
  });

  function closeDialog() {
    if (dialog?.open) {
      openVersion += 1;
      imageVersion += 1;
      dialog.close();
    }
  }

  function changeProductImage(direction) {
    const total = currentProduct?.images?.length || 0;
    if (!dialog?.open || total < 2) return;
    requestedProductImage = (requestedProductImage + direction + total) % total;
    renderProductImage();
  }

  const resetProductPhotoNavigation = bindPhotoNavigation(productPhotoNext, changeProductImage);
  productPrevious?.addEventListener('click', () => changeProductImage(-1));
  productNext?.addEventListener('click', () => changeProductImage(1));
  productRetry?.addEventListener('click', renderProductImage);
  for (const button of $$('[data-close-dialog]', dialog || document)) {
    button.addEventListener('click', closeDialog);
  }
  dialog?.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
    event.preventDefault();
    changeProductImage(event.key === 'ArrowLeft' ? -1 : 1);
  });
  dialog?.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();
  });
  dialog?.addEventListener('cancel', () => {
    openVersion += 1;
    imageVersion += 1;
  });
  dialog?.addEventListener('close', () => {
    if (dialog.open) return;
    imageVersion += 1;
    displayedProductImage = -1;
    resetProductPhotoNavigation();
    document.body.classList.remove('dialog-open');
    if (productImage) {
      productImage.hidden = true;
      productImage.removeAttribute('aria-busy');
      productImage.removeAttribute('src');
    }
    productPhotoNext?.removeAttribute('aria-busy');
    currentProduct = null;
    const trigger = dialogTrigger;
    dialogTrigger = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  });

  const form = $('#enquiry-form');
  const nameInput = $('#name');
  const formSuccess = $('#form-success');
  productEnquire?.addEventListener('click', () => {
    if (formSuccess) formSuccess.hidden = true;
    if (form && form.dataset.unavailable !== 'true') form.hidden = false;
    dialogTrigger = null;
    closeDialog();
    requestAnimationFrame(() => (form?.dataset.unavailable === 'true' ? $('#form-availability a') : nameInput)?.focus({ preventScroll: true }));
  });

  const brandFilm = $('#brand-film');
  let filmInView = false;
  let filmUnavailable = false;
  let filmPlayVersion = 0;
  const connection = navigator.connection;

  function resetFailedFilm() {
    if (!brandFilm || filmUnavailable) return;
    filmUnavailable = true;
    filmPlayVersion += 1;
    brandFilm.pause();
    for (const source of $$('source', brandFilm)) source.removeAttribute('src');
    brandFilm.load();
  }

  function updateFilmPlayback() {
    if (!brandFilm) return;
    const version = ++filmPlayVersion;
    if (filmUnavailable || !filmInView || document.hidden || reducedMotion.matches || connection?.saveData) {
      brandFilm.pause();
      return;
    }
    try {
      Promise.resolve(brandFilm.play()).then(() => {
        if (!filmInView || document.hidden || reducedMotion.matches || connection?.saveData) brandFilm.pause();
      }).catch((error) => {
        if (version === filmPlayVersion && error.name !== 'AbortError') resetFailedFilm();
      });
    } catch {
      if (version === filmPlayVersion) resetFailedFilm();
    }
  }

  if (brandFilm) {
    brandFilm.autoplay = false;
    brandFilm.muted = true;
    brandFilm.pause();
    brandFilm.addEventListener('error', resetFailedFilm);
    document.addEventListener('visibilitychange', updateFilmPlayback);
    reducedMotion.addEventListener('change', updateFilmPlayback);
    connection?.addEventListener?.('change', updateFilmPlayback);
    if ('IntersectionObserver' in window) {
      const filmObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          filmInView = entry.isIntersecting && entry.intersectionRatio >= 0.05;
        }
        updateFilmPlayback();
      }, { threshold: [0, 0.05] });
      filmObserver.observe(brandFilm.closest('section') || brandFilm);
    } else {
      filmInView = true;
      updateFilmPlayback();
    }
  }

  const scenes = $$('[data-scene]').map((element) => ({
    element,
    visible: false,
    pointerInside: false,
    pointerDirty: false,
    clientX: 0,
    clientY: 0,
    px: 0,
    py: 0,
    progress: 0.5,
    drift: 0,
    exit: 0,
    engagedTimer: 0,
  }));
  const mediaTargets = $$('.portal-media, .scene-media, .choice-image, .product-media, .archive-photo, .intro-sign, .order-image, .contact-mark, .footer-title').map((element) => ({
    element, visible: false, progress: 0.5, reveal: 1, shift: 0,
  }));
  let motionFrame = 0;
  let layoutDirty = true;
  let viewportHeight = window.innerHeight;

  function requestMotionFrame() {
    layoutDirty = true;
    if (!motionFrame && !document.hidden) motionFrame = requestAnimationFrame(renderMotion);
  }

  function renderMotion() {
    motionFrame = 0;
    if (document.hidden) return;
    const moving = !reducedMotion.matches;
    const pointing = moving && finePointer.matches;
    for (let i = 0; i < scenes.length; i += 1) {
      const scene = scenes[i];
      if (!scene.visible) continue;
      if (layoutDirty || scene.pointerDirty) {
        const rect = scene.element.getBoundingClientRect();
        scene.progress = Math.max(0, Math.min(1, (viewportHeight - rect.top) / (viewportHeight + rect.height)));
        scene.drift = moving ? (scene.progress - 0.5) * 70 : 0;
        scene.exit = moving && rect.height ? Math.max(0, Math.min(1, -rect.top / rect.height)) : 0;
        if (pointing && scene.pointerInside && rect.width && rect.height) {
          scene.px = Math.max(-1, Math.min(1, ((scene.clientX - rect.left) / rect.width - 0.5) * 2));
          scene.py = Math.max(-1, Math.min(1, ((scene.clientY - rect.top) / rect.height - 0.5) * 2));
        } else {
          scene.px = 0;
          scene.py = 0;
        }
        scene.pointerDirty = false;
      }
    }
    for (let i = 0; i < mediaTargets.length; i += 1) {
      const media = mediaTargets[i];
      if (!media.visible || !layoutDirty) continue;
      const rect = media.element.getBoundingClientRect();
      media.progress = Math.max(0, Math.min(1, (viewportHeight - rect.top) / (viewportHeight + rect.height)));
      media.reveal = moving ? Math.max(0, Math.min(1, (viewportHeight - rect.top) / (viewportHeight * 0.32 + Math.min(rect.height, 600) * 0.3))) : 1;
      media.shift = moving ? (0.5 - media.progress) * 52 : 0;
    }
    for (let i = 0; i < scenes.length; i += 1) {
      const scene = scenes[i];
      if (!scene.visible) continue;
      scene.element.style.setProperty('--px', scene.px.toFixed(3));
      scene.element.style.setProperty('--py', scene.py.toFixed(3));
      scene.element.style.setProperty('--progress', scene.progress.toFixed(4));
      scene.element.style.setProperty('--drift', `${scene.drift.toFixed(2)}px`);
      scene.element.style.setProperty('--scroll-out', scene.exit.toFixed(4));
    }
    for (let i = 0; i < mediaTargets.length; i += 1) {
      const media = mediaTargets[i];
      if (!media.visible) continue;
      media.element.style.setProperty('--media-progress', media.progress.toFixed(4));
      media.element.style.setProperty('--reveal', media.reveal.toFixed(4));
      media.element.style.setProperty('--media-shift', `${media.shift.toFixed(2)}px`);
    }
    layoutDirty = false;
  }

  function brieflyEngage(scene) {
    clearTimeout(scene.engagedTimer);
    scene.element.classList.add('is-engaged');
    scene.engagedTimer = window.setTimeout(() => {
      if (!scene.pointerInside) scene.element.classList.remove('is-engaged');
    }, 1100);
  }

  for (const scene of scenes) {
    for (const element of $$('[data-float]', scene.element)) {
      const depth = Number(element.dataset.depth);
      if (Number.isFinite(depth)) element.style.setProperty('--depth', String(depth));
    }
    scene.element.addEventListener('pointerenter', (event) => {
      if (!finePointer.matches || reducedMotion.matches || event.pointerType === 'touch') return;
      scene.pointerInside = true;
      scene.clientX = event.clientX;
      scene.clientY = event.clientY;
      scene.pointerDirty = true;
      scene.element.classList.add('is-engaged');
      if (!motionFrame && !document.hidden) motionFrame = requestAnimationFrame(renderMotion);
    });
    scene.element.addEventListener('pointermove', (event) => {
      if (!finePointer.matches || reducedMotion.matches || event.pointerType === 'touch') return;
      scene.clientX = event.clientX;
      scene.clientY = event.clientY;
      scene.pointerDirty = true;
      if (!motionFrame && !document.hidden) motionFrame = requestAnimationFrame(renderMotion);
    }, { passive: true });
    scene.element.addEventListener('pointerleave', () => {
      scene.pointerInside = false;
      scene.pointerDirty = true;
      scene.element.classList.remove('is-engaged');
      if (!motionFrame && !document.hidden) motionFrame = requestAnimationFrame(renderMotion);
    });
    scene.element.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' || !finePointer.matches) brieflyEngage(scene);
    }, { passive: true });
    scene.element.addEventListener('focusin', () => brieflyEngage(scene));
  }

  if ('IntersectionObserver' in window) {
    const sceneByElement = new Map(scenes.map((scene) => [scene.element, scene]));
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const scene = sceneByElement.get(entry.target);
        if (!scene) continue;
        scene.visible = entry.isIntersecting;
        scene.element.classList.toggle('is-visible', scene.visible);
        if (scene.visible) scene.element.classList.add('has-entered');
        else {
          scene.pointerInside = false;
          scene.element.classList.remove('is-engaged');
          scene.element.style.setProperty('--px', '0');
          scene.element.style.setProperty('--py', '0');
        }
      }
      requestMotionFrame();
    }, { rootMargin: '0px', threshold: 0 });
    for (const scene of scenes) observer.observe(scene.element);
    const mediaByElement = new Map(mediaTargets.map((media) => [media.element, media]));
    const mediaObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const media = mediaByElement.get(entry.target);
        if (media) media.visible = entry.isIntersecting;
      }
      requestMotionFrame();
    }, { threshold: 0 });
    for (const media of mediaTargets) mediaObserver.observe(media.element);
  } else {
    for (const scene of scenes) {
      scene.visible = true;
      scene.element.classList.add('is-visible', 'has-entered');
    }
    for (const media of mediaTargets) media.visible = true;
  }

  const carousels = [];
  for (const [index, section] of $$('[data-carousel]').entries()) {
    const track = $('.carousel-track', section);
    const cards = $$('.carousel-card', section);
    if (!track || !cards.length) continue;
    const previous = $('[data-carousel-prev]', section);
    const next = $('[data-carousel-next]', section);
    const status = $('[data-carousel-status]', section);
    if (!track.id) track.id = `carousel-track-${index + 1}`;
    if (!track.hasAttribute('tabindex')) track.tabIndex = 0;
    if (!track.hasAttribute('role')) track.setAttribute('role', 'group');
    if (!track.hasAttribute('aria-label')) track.setAttribute('aria-label', section.getAttribute('aria-label') || 'Изделия. Стрелки влево и вправо — листать, Home и End — начало и конец.');
    track.setAttribute('aria-roledescription', 'карусель');
    for (const control of [previous, next]) control?.setAttribute('aria-controls', track.id);
    if (previous && !previous.hasAttribute('aria-label')) previous.setAttribute('aria-label', 'Предыдущие изделия');
    if (next && !next.hasAttribute('aria-label')) next.setAttribute('aria-label', 'Следующие изделия');
    let points = [0];
    let targetPoint = 0;
    let moving = false;
    let settlingTimer = 0;
    let indicatorFrame = 0;
    let lastStatus = '';

    function nearestPoint() {
      let nearest = 0;
      let distance = Infinity;
      for (let point = 0; point < points.length; point += 1) {
        const currentDistance = Math.abs(points[point] - track.scrollLeft);
        if (currentDistance < distance) {
          distance = currentDistance;
          nearest = point;
        }
      }
      return nearest;
    }

    function updateIndicators() {
      indicatorFrame = 0;
      const rect = track.getBoundingClientRect();
      let first = -1;
      let last = -1;
      for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
        const cardRect = cards[cardIndex].getBoundingClientRect();
        const overlap = Math.min(rect.right, cardRect.right) - Math.max(rect.left, cardRect.left);
        const visible = overlap >= Math.min(cardRect.width * 0.45, track.clientWidth * 0.45);
        if (visible) {
          if (first === -1) first = cardIndex;
          last = cardIndex;
        }
      }
      if (first === -1) first = last = 0;
      const text = `${first + 1}${last > first ? `–${last + 1}` : ''} / ${cards.length}`;
      if (status && text !== lastStatus) {
        status.textContent = text;
        lastStatus = text;
      }
      section.classList.toggle('at-start', track.scrollLeft < 2);
      section.classList.toggle('at-end', Math.abs(track.scrollWidth - track.clientWidth - track.scrollLeft) < 2);
    }

    function scheduleIndicators() {
      if (!indicatorFrame && !document.hidden) indicatorFrame = requestAnimationFrame(updateIndicators);
    }

    function settle() {
      clearTimeout(settlingTimer);
      moving = false;
      targetPoint = nearestPoint();
      scheduleIndicators();
    }

    function measure() {
      const rect = track.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
      const maximum = Math.max(0, track.scrollWidth - track.clientWidth);
      points = [0];
      for (const card of cards) {
        const position = Math.max(0, Math.min(maximum, card.getBoundingClientRect().left - rect.left - track.clientLeft + track.scrollLeft - padding));
        if (position - points[points.length - 1] > 2) points.push(position);
      }
      if (maximum - points[points.length - 1] > 2) points.push(maximum);
      const cannotMove = points.length < 2;
      if (previous) previous.disabled = cannotMove;
      if (next) next.disabled = cannotMove;
      moving = false;
      targetPoint = nearestPoint();
      scheduleIndicators();
    }

    function goToPoint(point) {
      if (points.length < 2) return;
      targetPoint = (point + points.length) % points.length;
      moving = !reducedMotion.matches;
      track.scrollTo({ left: points[targetPoint], behavior: moving ? 'smooth' : 'auto' });
      clearTimeout(settlingTimer);
      settlingTimer = window.setTimeout(settle, moving ? 180 : 0);
      scheduleIndicators();
    }

    function advance(direction) {
      goToPoint((moving ? targetPoint : nearestPoint()) + direction);
    }

    previous?.addEventListener('click', () => advance(-1));
    next?.addEventListener('click', () => advance(1));
    track.addEventListener('keydown', (event) => {
      if (event.target !== track || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        advance(event.key === 'ArrowLeft' ? -1 : 1);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        goToPoint(event.key === 'Home' ? 0 : points.length - 1);
      }
    });
    track.addEventListener('scroll', () => {
      scheduleIndicators();
      requestMotionFrame();
      clearTimeout(settlingTimer);
      settlingTimer = window.setTimeout(settle, 140);
    }, { passive: true });
    track.addEventListener('scrollend', settle);
    for (const type of ['pointerdown', 'touchstart', 'wheel']) track.addEventListener(type, () => {
      moving = false;
      clearTimeout(settlingTimer);
    }, { passive: true });
    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(track);
      for (const card of cards) resizeObserver.observe(card);
    }
    carousels.push({ measure });
    measure();
  }

  window.addEventListener('scroll', requestMotionFrame, { passive: true });
  window.addEventListener('resize', () => {
    viewportHeight = window.innerHeight;
    if (window.innerWidth > 900) closeMenu();
    for (const carousel of carousels) carousel.measure();
    requestMotionFrame();
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && motionFrame) {
      cancelAnimationFrame(motionFrame);
      motionFrame = 0;
    } else requestMotionFrame();
  });
  for (const query of [reducedMotion, finePointer]) query.addEventListener('change', requestMotionFrame);
  window.addEventListener('load', requestMotionFrame, { once: true });
  requestMotionFrame();
})();
