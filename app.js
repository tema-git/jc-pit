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
    if (event.target.closest('a[href="#contacts"]')) closeMenu();
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
  const productImage = $('#product-image');
  const productCounter = $('#product-image-counter');
  const galleryStatus = $('#product-gallery-status');
  const productPrevious = $('#product-prev');
  const productNext = $('#product-next');
  const productEnquire = $('#product-enquire');
  const catalogError = $('#catalog-error');
  const interest = $('#interest');
  let productsPromise;
  let currentProduct = null;
  let currentImage = 0;
  let imageVersion = 0;
  let openVersion = 0;
  let dialogTrigger = null;

  async function loadProducts() {
    if (!productsPromise) {
      productsPromise = fetch('./products.json', { credentials: 'omit' })
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
      const products = await loadProducts();
      if (version !== openVersion) return;
      const product = products.find((item) => String(item.id) === id);
      if (!product || !dialog) throw new Error('Product unavailable');
      currentProduct = product;
      currentImage = 0;
      dialogTrigger = trigger;
      if (productTitle) productTitle.textContent = product.name;
      if (productYear) productYear.textContent = product.year || '';
      if (productDescription) productDescription.textContent = product.description || '';
      if (productImage) productImage.hidden = true;
      if (catalogError) catalogError.hidden = true;
      closeMenu();
      if (!dialog.open) dialog.showModal();
      document.body.classList.add('dialog-open');
      renderProductImage();
    } catch {
      if (version !== openVersion) return;
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

  const viewButtons = $$('[data-view]');
  const studyImage = $('#study-image');
  const studyCaption = $('#study-caption');
  const studyState = $('#study-state');
  const studyFix = $('#study-fix');
  const studyReset = $('#study-reset');
  const studyResult = $('#study-result');
  const studyContinue = $('#study-continue');
  const initialView = viewButtons.find((button) => button.getAttribute('aria-pressed') === 'true') || viewButtons[0];
  let selectedView = initialView;
  let studyFixed = false;
  let studyImageVersion = 0;

  async function selectStudyView(button, announce = true) {
    if (!button || studyFixed) return;
    const version = ++studyImageVersion;
    selectedView = button;
    for (const option of viewButtons) option.setAttribute('aria-pressed', String(option === button));
    const caption = button.dataset.caption || button.textContent.trim();
    if (studyImage) studyImage.setAttribute('aria-busy', 'true');
    if (announce && studyState) studyState.textContent = 'Меняем ракурс…';
    try {
      if (!button.dataset.image) throw new Error('Image unavailable');
      await preloadImage(button.dataset.image);
      if (version !== studyImageVersion) return;
      if (studyImage) {
        studyImage.src = button.dataset.image;
        studyImage.alt = `Высокие ботинки с молнией спереди — ${caption}`;
      }
      if (studyCaption) studyCaption.textContent = caption;
      if (announce && studyState) studyState.textContent = `Выбран ракурс: ${button.textContent.trim()}. Можно рассмотреть другой или зафиксировать этот.`;
    } catch {
      if (version === studyImageVersion && studyState) studyState.textContent = 'Этот ракурс не загрузился. Выберите другой или попробуйте ещё раз.';
    } finally {
      if (version === studyImageVersion) studyImage?.removeAttribute('aria-busy');
    }
  }

  for (const button of viewButtons) button.addEventListener('click', () => selectStudyView(button));
  studyFix?.addEventListener('click', () => {
    if (!selectedView || studyFixed) return;
    studyFixed = true;
    for (const button of viewButtons) button.disabled = true;
    studyFix.disabled = true;
    const caption = selectedView.dataset.caption || selectedView.textContent.trim();
    if (studyResult) {
      studyResult.textContent = `Ваш ракурс — ${caption}`;
      studyResult.hidden = false;
    }
    if (studyState) studyState.textContent = 'Ракурс зафиксирован. Продолжите знакомство с моделью или начните заново.';
  });
  studyReset?.addEventListener('click', () => {
    studyFixed = false;
    for (const button of viewButtons) button.disabled = false;
    if (studyFix) studyFix.disabled = false;
    if (studyResult) studyResult.hidden = true;
    selectStudyView(initialView, false);
    if (studyState) studyState.textContent = 'Начинаем заново. Выберите ракурс и зафиксируйте тот, который нравится.';
  });
  studyContinue?.addEventListener('click', () => selectInterest('Высокие ботинки с молнией спереди'));

  const brandFilm = $('#brand-film');
  const filmToggle = $('#film-toggle');
  let filmOptedIn = false;
  let filmInView = false;
  let filmPlayVersion = 0;

  function updateFilmControl() {
    if (!filmToggle) return;
    const label = filmOptedIn ? 'Остановить движение' : 'Включить движение';
    filmToggle.setAttribute('aria-pressed', String(filmOptedIn));
    filmToggle.setAttribute('aria-label', label);
    const icon = $('span', filmToggle) || document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '◌';
    filmToggle.replaceChildren(document.createTextNode(`${label} `), icon);
  }

  function resetFailedFilm() {
    if (!brandFilm || !filmOptedIn) return;
    filmOptedIn = false;
    filmPlayVersion += 1;
    brandFilm.pause();
    updateFilmControl();
    brandFilm.load();
  }

  function updateFilmPlayback() {
    if (!brandFilm) return;
    const version = ++filmPlayVersion;
    if (!filmOptedIn || !filmInView || document.hidden) {
      brandFilm.pause();
      return;
    }
    try {
      Promise.resolve(brandFilm.play()).then(() => {
        if (!filmOptedIn || !filmInView || document.hidden) brandFilm.pause();
      }).catch(() => {
        if (version === filmPlayVersion) resetFailedFilm();
      });
    } catch {
      if (version === filmPlayVersion) resetFailedFilm();
    }
  }

  if (brandFilm && filmToggle) {
    brandFilm.autoplay = false;
    brandFilm.pause();
    filmToggle.addEventListener('click', () => {
      filmOptedIn = !filmOptedIn;
      updateFilmControl();
      updateFilmPlayback();
    });
    brandFilm.addEventListener('error', resetFailedFilm);
    document.addEventListener('visibilitychange', updateFilmPlayback);
    reducedMotion.addEventListener('change', () => {
      if (reducedMotion.matches) {
        filmOptedIn = false;
        updateFilmControl();
        updateFilmPlayback();
      }
    });
    if ('IntersectionObserver' in window) {
      const filmObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          filmInView = entry.isIntersecting && entry.intersectionRatio >= 0.05;
        }
        updateFilmPlayback();
      }, { threshold: [0, 0.05] });
      filmObserver.observe(brandFilm);
    } else {
      filmInView = true;
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
    engagedTimer: 0,
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
    for (let i = 0; i < scenes.length; i += 1) {
      const scene = scenes[i];
      if (!scene.visible) continue;
      scene.element.style.setProperty('--px', scene.px.toFixed(3));
      scene.element.style.setProperty('--py', scene.py.toFixed(3));
      scene.element.style.setProperty('--progress', scene.progress.toFixed(4));
      scene.element.style.setProperty('--drift', `${scene.drift.toFixed(2)}px`);
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
  } else {
    for (const scene of scenes) {
      scene.visible = true;
      scene.element.classList.add('is-visible', 'has-entered');
    }
  }

  window.addEventListener('scroll', requestMotionFrame, { passive: true });
  window.addEventListener('resize', () => {
    viewportHeight = window.innerHeight;
    if (window.innerWidth > 900) closeMenu();
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
