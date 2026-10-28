(() => {
  'use strict';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

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
    if (event.target instanceof Element && event.target.closest('a')) closeMenu();
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
  const productImage = $('#product-image');
  const productCounter = $('#product-image-counter');
  const galleryStatus = $('#product-gallery-status');
  const productPrevious = $('#product-prev');
  const productNext = $('#product-next');
  const productEnquire = $('#product-enquire');
  const catalogError = $('#catalog-error');
  const interest = $('#interest');
  const productURL = new URL('./products.json', document.baseURI);
  const scriptVersion = document.currentScript?.src
    ? new URL(document.currentScript.src, document.baseURI).searchParams.get('v')
    : '';
  productURL.searchParams.set('v', scriptVersion || '20261027-tilda3');
  let productsPromise;
  let currentProduct = null;
  let currentImage = 0;
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

  function preloadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (typeof image.decode === 'function') {
          image.decode().catch(() => {}).then(() => resolve(image));
        } else {
          resolve(image);
        }
      };
      image.onerror = () => reject(new Error('Image unavailable'));
      image.src = src;
    });
  }

  const archiveGrid = $('#archive-grid');
  const archivePhotos = $$('[data-archive-photo]', archiveGrid || document);
  const archiveDialog = $('#archive-dialog');
  const archiveImage = $('#archive-image');
  const archiveFrame = $('.archive-lightbox-image');
  const archiveClose = $('#archive-close');
  const archivePrevious = $('#archive-prev');
  const archiveNext = $('#archive-next');
  const archiveCounter = $('#archive-photo-counter');
  const archiveStatus = $('#archive-photo-status');
  const archiveRetry = $('#archive-retry');
  let archiveIndex = 0;
  let archiveImageVersion = 0;
  let archiveTrigger = null;
  let archiveGesture = null;

  if (archiveGrid && archivePhotos.length) {
    for (let index = archivePhotos.length - 1; index > 0; index -= 1) {
      const other = Math.floor(Math.random() * (index + 1));
      [archivePhotos[index], archivePhotos[other]] = [archivePhotos[other], archivePhotos[index]];
    }
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < archivePhotos.length; index += 1) {
      const photo = archivePhotos[index];
      photo.setAttribute('aria-label', `Открыть фотографию ${index + 1} из ${archivePhotos.length}`);
      const image = $('img', photo);
      if (image && index < 6) image.loading = 'eager';
      fragment.append(photo);
    }
    archiveGrid.append(fragment);
  }

  async function renderArchivePhoto() {
    if (!archiveImage || !archiveDialog?.open || !archivePhotos.length) return;
    const version = ++archiveImageVersion;
    const photo = archivePhotos[archiveIndex];
    const thumbnail = $('img', photo);
    const src = photo.dataset.archivePhoto || thumbnail?.getAttribute('src');
    const number = archiveIndex + 1;
    if (archiveCounter) archiveCounter.textContent = `${number} / ${archivePhotos.length}`;
    if (archivePrevious) archivePrevious.disabled = archivePhotos.length < 2;
    if (archiveNext) archiveNext.disabled = archivePhotos.length < 2;
    if (archiveRetry) archiveRetry.hidden = true;
    archiveImage.hidden = true;
    archiveImage.setAttribute('aria-busy', 'true');
    if (archiveStatus) archiveStatus.textContent = 'Загружаем фотографию…';
    try {
      if (!src) throw new Error('Archive image unavailable');
      const image = await preloadImage(src);
      if (version !== archiveImageVersion || !archiveDialog.open) return;
      archiveImage.width = image.naturalWidth || thumbnail?.width || 1200;
      archiveImage.height = image.naturalHeight || thumbnail?.height || 1200;
      archiveImage.src = src;
      archiveImage.alt = thumbnail?.alt || `Архив Jerusalem Chinaski, фотография ${number}`;
      archiveImage.hidden = false;
      if (archiveStatus) archiveStatus.textContent = '';
      archiveDialog.setAttribute('aria-label', `Фотографии архива. Фото ${number} из ${archivePhotos.length}`);
    } catch {
      if (version !== archiveImageVersion || !archiveDialog.open) return;
      if (archiveStatus) archiveStatus.textContent = 'Фотография не загрузилась. Выберите другую или нажмите «Повторить».';
      if (archiveRetry) archiveRetry.hidden = false;
    } finally {
      if (version === archiveImageVersion) archiveImage.removeAttribute('aria-busy');
    }
  }

  function openArchivePhoto(photo) {
    if (!archiveDialog || !archiveImage) return;
    const index = archivePhotos.indexOf(photo);
    if (index < 0) return;
    archiveIndex = index;
    archiveTrigger = photo;
    closeMenu();
    if (!archiveDialog.open) archiveDialog.showModal();
    document.body.classList.add('dialog-open');
    archiveClose?.focus({ preventScroll: true });
    renderArchivePhoto();
  }

  function changeArchivePhoto(direction) {
    if (archivePhotos.length < 2) return;
    archiveIndex = (archiveIndex + direction + archivePhotos.length) % archivePhotos.length;
    renderArchivePhoto();
  }

  archiveGrid?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const photo = event.target.closest('[data-archive-photo]');
    if (photo) openArchivePhoto(photo);
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
    archiveGesture = null;
    document.body.classList.remove('dialog-open');
    if (archiveImage) {
      archiveImage.hidden = true;
      archiveImage.removeAttribute('aria-busy');
      archiveImage.removeAttribute('src');
    }
    const trigger = archiveTrigger;
    archiveTrigger = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  });
  archiveFrame?.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) {
      archiveGesture = null;
      return;
    }
    archiveGesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
  }, { passive: true });
  archiveFrame?.addEventListener('pointerup', (event) => {
    const gesture = archiveGesture;
    archiveGesture = null;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const x = event.clientX - gesture.x;
    const y = event.clientY - gesture.y;
    if (event.timeStamp - gesture.time < 1000 && Math.abs(x) > 48 && Math.abs(y) < Math.abs(x) * 0.55) {
      changeArchivePhoto(x < 0 ? 1 : -1);
    }
  }, { passive: true });
  archiveFrame?.addEventListener('pointercancel', () => { archiveGesture = null; });

  function renderProductDetails(product) {
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

  async function renderProductImage() {
    if (!currentProduct || !productImage) return;
    const version = ++imageVersion;
    const product = currentProduct;
    const index = currentImage;
    const total = product.images?.length || 0;
    const item = imageEntry(product, index);
    const counter = `${index + 1} / ${total}`;
    if (productCounter) productCounter.textContent = counter;
    if (productPrevious) productPrevious.disabled = total < 2;
    if (productNext) productNext.disabled = total < 2;
    productImage.setAttribute('aria-busy', 'true');
    if (galleryStatus) galleryStatus.textContent = 'Загружаем фотографию…';

    try {
      if (!item.src || !total) throw new Error('Image unavailable');
      await preloadImage(item.src);
      if (version !== imageVersion || currentProduct !== product || !dialog?.open) return;
      productImage.src = item.src;
      productImage.alt = `${product.name}${item.caption ? ` — ${item.caption}` : `, фотография ${index + 1}`}`;
      productImage.hidden = false;
      if (galleryStatus) galleryStatus.textContent = `${product.name}. Фотография ${index + 1} из ${total}${item.caption ? `. ${item.caption}` : ''}.`;
    } catch {
      if (version !== imageVersion) return;
      productImage.hidden = true;
      if (galleryStatus) galleryStatus.textContent = 'Фотография не загрузилась. Попробуйте другой ракурс или откройте модель ещё раз.';
    } finally {
      if (version === imageVersion) productImage.removeAttribute('aria-busy');
    }
  }

  async function openProduct(id, trigger) {
    const version = ++openVersion;
    trigger.setAttribute('aria-busy', 'true');
    try {
      const product = await findProduct(id);
      if (version !== openVersion) return;
      if (!product) throw new Error(`Product unavailable: ${id}`);
      if (!dialog) throw new Error('Product dialog unavailable');
      currentProduct = product;
      currentImage = 0;
      dialogTrigger = trigger;
      if (productTitle) productTitle.textContent = product.name;
      if (productYear) productYear.textContent = product.year || '';
      if (productDescription) productDescription.textContent = product.description || '';
      renderProductDetails(product);
      if (productImage) productImage.hidden = true;
      if (productEnquire && !interest) productEnquire.href = `catalog.html?model=${encodeURIComponent(product.id)}#makeorder`;
      if (catalogError) catalogError.hidden = true;
      closeMenu();
      if (!dialog.open) dialog.showModal();
      document.body.classList.add('dialog-open');
      renderProductImage();
    } catch (error) {
      if (version !== openVersion) return;
      console.error('JC Pit: не удалось открыть модель', id, error);
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
    openProduct(trigger.dataset.product || '', trigger);
  });

  function closeDialog() {
    if (dialog?.open) dialog.close();
  }

  function changeProductImage(direction) {
    const total = currentProduct?.images?.length || 0;
    if (total < 2) return;
    currentImage = (currentImage + direction + total) % total;
    renderProductImage();
  }

  productPrevious?.addEventListener('click', () => changeProductImage(-1));
  productNext?.addEventListener('click', () => changeProductImage(1));
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
  dialog?.addEventListener('close', () => {
    imageVersion += 1;
    document.body.classList.remove('dialog-open');
    const trigger = dialogTrigger;
    dialogTrigger = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  });

  function selectInterest(value) {
    if (interest && Array.from(interest.options).some((option) => option.value === value)) {
      interest.value = value;
      interest.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  productEnquire?.addEventListener('click', () => {
    if (currentProduct) selectInterest(currentProduct.name);
    if (formSuccess) formSuccess.hidden = true;
    if (form) form.hidden = false;
    dialogTrigger = null;
    closeDialog();
    requestAnimationFrame(() => {
      if (!form?.hidden) nameInput?.focus({ preventScroll: true });
      else formAgain?.focus({ preventScroll: true });
    });
  });

  const form = $('#enquiry-form');
  const nameInput = $('#name');
  const contactInput = $('#contact');
  const messageInput = $('#message');
  const formSubmit = $('#form-submit');
  const formSuccess = $('#form-success');
  const formAgain = $('#form-again');
  const nameError = $('#name-error');
  const contactError = $('#contact-error');
  let enquiryVersion = 0;

  function focusEnquiry() {
    requestAnimationFrame(() => {
      if (!form?.hidden) nameInput?.focus({ preventScroll: true });
      else formAgain?.focus({ preventScroll: true });
    });
  }

  async function selectModel(id, focus = false) {
    if (!interest || !id) return;
    const version = ++enquiryVersion;
    try {
      const product = await findProduct(id);
      if (version !== enquiryVersion) return;
      if (!product) return;
      if (formSuccess) formSuccess.hidden = true;
      if (form) form.hidden = false;
      selectInterest(product.name);
      if (focus) focusEnquiry();
      requestMotionFrame();
    } catch {
      if (focus) focusEnquiry();
    }
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const trigger = event.target.closest('a[data-enquire]');
    if (!trigger || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const destination = new URL(trigger.href, location.href);
    if (destination.origin !== location.origin || destination.pathname !== location.pathname || !interest) return;
    if (formSuccess) formSuccess.hidden = true;
    if (form) form.hidden = false;
    closeMenu();
    selectModel(trigger.dataset.enquire || '', true);
  });

  const requestedModel = new URL(location.href).searchParams.get('model');
  if (requestedModel && interest) selectModel(requestedModel);

  function validateName() {
    const error = (nameInput?.value.trim().length || 0) < 2 ? 'Напишите имя: минимум 2 символа.' : '';
    if (nameError) nameError.textContent = error;
    nameInput?.setAttribute('aria-invalid', String(Boolean(error)));
    return !error;
  }

  function validateContact() {
    const value = contactInput?.value.trim() || '';
    let valid = value.length >= 5;
    if (valid && value.startsWith('@')) valid = /^@[a-zA-Z0-9_]{4,}$/.test(value);
    else if (valid && value.includes('@')) valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    else if (valid && /^[+\d\s().-]+$/.test(value)) valid = value.replace(/\D/g, '').length >= 7;
    else valid = false;
    const error = valid ? '' : 'Укажите email, @ник в Telegram или телефон, чтобы с вами можно было связаться.';
    if (contactError) contactError.textContent = error;
    contactInput?.setAttribute('aria-invalid', String(Boolean(error)));
    return valid;
  }

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const nameValid = validateName();
      const contactValid = validateContact();
      if (!nameValid || !contactValid) {
        (nameValid ? contactInput : nameInput)?.focus();
        return;
      }
      if (nameInput) nameInput.value = '';
      if (contactInput) contactInput.value = '';
      if (messageInput) messageInput.value = '';
      form.hidden = true;
      if (formSuccess) {
        formSuccess.hidden = false;
        formSuccess.setAttribute('tabindex', '-1');
        formSuccess.focus({ preventScroll: true });
      }
      requestMotionFrame();
    });
    if (formSubmit) formSubmit.disabled = false;
  }

  nameInput?.addEventListener('input', () => {
    if (nameInput.getAttribute('aria-invalid') === 'true') validateName();
  });
  contactInput?.addEventListener('input', () => {
    if (contactInput.getAttribute('aria-invalid') === 'true') validateContact();
  });
  formAgain?.addEventListener('click', () => {
    if (formSuccess) formSuccess.hidden = true;
    if (form) form.hidden = false;
    form?.reset();
    if (nameError) nameError.textContent = '';
    if (contactError) contactError.textContent = '';
    nameInput?.removeAttribute('aria-invalid');
    contactInput?.removeAttribute('aria-invalid');
    nameInput?.focus({ preventScroll: true });
    requestMotionFrame();
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
