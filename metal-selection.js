(() => {
  'use strict';

  if (!document.createRange || !window.getSelection || !window.requestAnimationFrame) return;
  const measureCanvas = document.createElement('canvas');
  const measure = measureCanvas.getContext('2d');
  if (!measure) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = window.matchMedia('(forced-colors: active)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
  const excluded = 'script,style,noscript,template,svg,math,canvas,input,textarea,select,option,button,.button,[contenteditable]:not([contenteditable="false"]),[hidden],.sr-only';
  const maxGlyphs = 1200;
  const maxScanned = 18000;
  const maxPixels = 2000000;
  const duration = 1800;
  let canvas = null;
  let context = null;
  let scene = null;
  let identity = null;
  let layoutFrame = 0;
  let paintFrame = 0;
  let selectionTimer = 0;
  let dragging = false;
  let touchWaitUntil = 0;
  let glintStart = -Infinity;
  let pointerShift = 0;
  let lastPointerPaint = 0;

  function cancelPaint() {
    if (paintFrame) cancelAnimationFrame(paintFrame);
    paintFrame = 0;
  }

  function hide() {
    cancelPaint();
    scene = null;
    if (canvas) canvas.hidden = true;
  }

  function sameIdentity(next) {
    if (!identity || !next || identity.length !== next.length) return false;
    for (let i = 0; i < next.length; i += 1) {
      const a = identity[i];
      const b = next[i];
      if (a.start !== b.start || a.end !== b.end || a.from !== b.from || a.to !== b.to) return false;
    }
    return true;
  }

  function intersects(a, b) {
    return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
  }

  function intersect(a, b) {
    return {
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
    };
  }

  function collect() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || document.hidden || forcedColors.matches) return null;
    if (document.activeElement?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return null;
    if (document.querySelector('[data-menu-toggle][aria-expanded="true"]')) return null;
    if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) > 0.02) return null;

    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode : selection.anchorNode?.parentElement;
    const focus = selection.focusNode?.nodeType === Node.ELEMENT_NODE
      ? selection.focusNode : selection.focusNode?.parentElement;
    if (!anchor || !focus || anchor.closest(excluded) || focus.closest(excluded)) return null;
    const host = anchor.closest('dialog[open]') || document.body;
    if (host !== document.body && !host.open) return null;
    if ((focus.closest('dialog[open]') || document.body) !== host) return null;
    if (host === document.body && document.querySelector('dialog[open]')) return null;

    const header = host === document.body ? document.querySelector('.header') : null;
    const headerRect = header?.getBoundingClientRect();
    const styles = new Map();
    const boxes = new Map();
    const fonts = new Map();
    const glyphs = [];
    const nextIdentity = [];
    let scanned = 0;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    function styleOf(element) {
      if (!styles.has(element)) styles.set(element, getComputedStyle(element));
      return styles.get(element);
    }

    function boxOf(element) {
      if (!boxes.has(element)) boxes.set(element, element.getBoundingClientRect());
      return boxes.get(element);
    }

    function textInfo(element) {
      const style = styleOf(element);
      if (style.writingMode !== 'horizontal-tb' || style.direction !== 'ltr' || style.textTransform !== 'none') return null;
      const size = parseFloat(style.fontSize);
      if (!Number.isFinite(size) || size < 10 || size > 180) return null;
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      let metrics = fonts.get(font);
      if (!metrics) {
        measure.font = font;
        metrics = measure.measureText('Hgj');
        if (!Number.isFinite(metrics.fontBoundingBoxAscent) || !Number.isFinite(metrics.fontBoundingBoxDescent)) return null;
        fonts.set(font, metrics);
      }
      let clip = viewport;
      let current = element;
      while (current) {
        const currentStyle = styleOf(current);
        if (currentStyle.display === 'none' || currentStyle.visibility !== 'visible' || parseFloat(currentStyle.opacity) < 0.98) return null;
        if (currentStyle.transform !== 'none' || (currentStyle.translate && currentStyle.translate !== 'none') || (currentStyle.rotate && currentStyle.rotate !== 'none') || (currentStyle.scale && currentStyle.scale !== 'none')) return null;
        if (currentStyle.clipPath && currentStyle.clipPath !== 'none') return null;
        const clipX = /^(auto|scroll|hidden|clip)$/.test(currentStyle.overflowX);
        const clipY = /^(auto|scroll|hidden|clip)$/.test(currentStyle.overflowY);
        if (clipX || clipY) {
          const box = boxOf(current);
          clip = intersect(clip, {
            left: clipX ? box.left + current.clientLeft : clip.left,
            right: clipX ? box.left + current.clientLeft + current.clientWidth : clip.right,
            top: clipY ? box.top + current.clientTop : clip.top,
            bottom: clipY ? box.top + current.clientTop + current.clientHeight : clip.bottom,
          });
        }
        if (current === host) break;
        current = current.parentElement;
      }
      if (headerRect && !header.contains(element) && headerRect.top <= 1 && headerRect.bottom > 0) {
        clip = intersect(clip, { ...viewport, top: headerRect.bottom });
      }
      if (clip.right <= clip.left || clip.bottom <= clip.top) return null;
      return { font, metrics, size, clip };
    }

    for (let r = 0; r < Math.min(selection.rangeCount, 8); r += 1) {
      const range = selection.getRangeAt(r);
      nextIdentity.push({ start: range.startContainer, end: range.endContainer, from: range.startOffset, to: range.endOffset });
      const root = range.commonAncestorContainer;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = root.nodeType === Node.TEXT_NODE ? root : walker.nextNode();
      while (node && scanned < maxScanned && glyphs.length < maxGlyphs) {
        if (!range.intersectsNode(node)) { node = walker.nextNode(); continue; }
        const element = node.parentElement;
        if (!element || element.closest(excluded) || (element.closest('dialog[open]') || document.body) !== host) {
          node = walker.nextNode(); continue;
        }
        const from = node === range.startContainer ? range.startOffset : 0;
        const to = node === range.endContainer ? range.endOffset : node.length;
        const boundedTo = Math.min(to, from + maxScanned - scanned);
        const text = node.data.slice(from, boundedTo);
        scanned += text.length;
        if (!text.trim()) { node = walker.nextNode(); continue; }
        const nodeRange = document.createRange();
        nodeRange.setStart(node, from);
        nodeRange.setEnd(node, boundedTo);
        const nodeRects = nodeRange.getClientRects();
        let visible = false;
        for (let i = 0; i < nodeRects.length; i += 1) {
          if (intersects(nodeRects[i], viewport)) { visible = true; break; }
        }
        if (!visible) { node = walker.nextNode(); continue; }
        const info = textInfo(element);
        if (!info) { node = walker.nextNode(); continue; }
        const segments = segmenter ? segmenter.segment(text) : Array.from(text);
        let offset = 0;
        for (const part of segments) {
          const character = typeof part === 'string' ? part : part.segment;
          const index = typeof part === 'string' ? offset : part.index;
          offset = index + character.length;
          if (!character.trim()) continue;
          nodeRange.setStart(node, from + index);
          nodeRange.setEnd(node, from + offset);
          const rects = nodeRange.getClientRects();
          if (rects.length !== 1) continue;
          const rect = rects[0];
          if (rect.width <= 0 || rect.height <= 0 || !intersects(rect, info.clip)) continue;
          const clipped = intersect(rect, info.clip);
          const ascent = info.metrics.fontBoundingBoxAscent;
          const descent = info.metrics.fontBoundingBoxDescent;
          const baseline = rect.top + (rect.height - ascent - descent) / 2 + ascent;
          glyphs.push({ text: character, x: rect.left, y: baseline, rect, clip: clipped, font: info.font, size: info.size });
          left = Math.min(left, clipped.left);
          top = Math.min(top, clipped.top);
          right = Math.max(right, clipped.right);
          bottom = Math.max(bottom, clipped.bottom);
          if (glyphs.length >= maxGlyphs) break;
        }
        node = walker.nextNode();
      }
      if (glyphs.length >= maxGlyphs || scanned >= maxScanned) break;
    }
    if (!glyphs.length) return null;
    return {
      host, glyphs, identity: nextIdentity,
      bounds: {
        left: Math.max(0, Math.floor(left - 1)),
        top: Math.max(0, Math.floor(top - 1)),
        right: Math.min(viewport.right, Math.ceil(right + 1)),
        bottom: Math.min(viewport.bottom, Math.ceil(bottom + 1)),
      },
    };
  }

  function rebuild() {
    layoutFrame = 0;
    if (dragging || performance.now() < touchWaitUntil || document.hidden) { hide(); return; }
    let next;
    try { next = collect(); } catch (_) { hide(); return; }
    if (!next) { hide(); identity = null; return; }

    const changed = !sameIdentity(next.identity);
    identity = next.identity;
    const width = next.bounds.right - next.bounds.left;
    const height = next.bounds.bottom - next.bounds.top;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(maxPixels / (width * height)));
    const bitmap = document.createElement('canvas');
    bitmap.width = Math.max(1, Math.ceil(width * dpr));
    bitmap.height = Math.max(1, Math.ceil(height * dpr));
    const mask = bitmap.getContext('2d');
    if (!mask) { hide(); return; }
    mask.scale(dpr, dpr);
    mask.textBaseline = 'alphabetic';
    mask.textAlign = 'left';
    mask.fontKerning = 'none';
    let lastFont = '';
    let lastTop = NaN;
    let lastHeight = NaN;
    for (let i = 0; i < next.glyphs.length; i += 1) {
      const glyph = next.glyphs[i];
      if (glyph.font !== lastFont) { mask.font = glyph.font; lastFont = glyph.font; }
      if (glyph.rect.top !== lastTop || glyph.rect.height !== lastHeight) {
        lastTop = glyph.rect.top;
        lastHeight = glyph.rect.height;
        const metal = mask.createLinearGradient(0, glyph.rect.top - next.bounds.top, 0, glyph.rect.bottom - next.bounds.top);
        metal.addColorStop(0, '#777d83');
        metal.addColorStop(0.2, '#aeb5bd');
        metal.addColorStop(0.34, '#f0f3f5');
        metal.addColorStop(0.46, '#959da5');
        metal.addColorStop(0.51, '#777f87');
        metal.addColorStop(0.57, '#d9dfe5');
        metal.addColorStop(0.76, '#a2aab2');
        metal.addColorStop(1, '#737b83');
        mask.fillStyle = metal;
      }
      mask.save();
      mask.beginPath();
      mask.rect(glyph.clip.left - next.bounds.left, glyph.clip.top - next.bounds.top, glyph.clip.right - glyph.clip.left, glyph.clip.bottom - glyph.clip.top);
      mask.clip();
      mask.fillText(glyph.text, glyph.x - next.bounds.left, glyph.y - next.bounds.top);
      mask.restore();
    }

    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'metal-selection-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.pointerEvents = 'none';
      context = canvas.getContext('2d');
    }
    if (!context) { hide(); return; }
    if (canvas.parentNode !== next.host) next.host.append(canvas);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.style.left = `${next.bounds.left}px`;
    canvas.style.top = `${next.bounds.top}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.hidden = false;
    scene = { host: next.host, bitmap, width, height, dpr, bounds: next.bounds };
    if (changed) { glintStart = performance.now(); pointerShift = 0; }
    requestPaint();
  }

  function paint(now) {
    paintFrame = 0;
    if (!scene || document.hidden || dragging || !canvas?.isConnected || (scene.host !== document.body && !scene.host.open)) { hide(); return; }
    const { width, height, dpr, bitmap } = scene;
    const elapsed = now - glintStart;
    const moving = !reducedMotion.matches && elapsed >= 0 && elapsed < duration;
    const progress = Math.max(0, Math.min(1, elapsed / duration));
    const center = moving ? -width * 0.25 + width * 1.75 * progress : width * 0.58 + pointerShift;
    const band = Math.max(28, Math.min(140, width * 0.12));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    context.save();
    context.globalCompositeOperation = 'source-atop';
    context.transform(1, 0, -0.24, 1, 0, 0);
    const light = context.createLinearGradient(center - band, 0, center + band, 0);
    light.addColorStop(0, 'rgba(255,255,255,0)');
    light.addColorStop(0.38, `rgba(244,249,255,${moving ? 0.25 : 0.08})`);
    light.addColorStop(0.5, `rgba(255,255,255,${moving ? 0.86 : 0.24})`);
    light.addColorStop(0.62, `rgba(239,245,252,${moving ? 0.25 : 0.08})`);
    light.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = light;
    context.fillRect(-height * 0.24 - 2, 0, width + height * 0.48 + 4, height);
    context.restore();
    if (moving) paintFrame = requestAnimationFrame(paint);
  }

  function requestPaint() {
    if (!paintFrame && scene && !document.hidden && !dragging) paintFrame = requestAnimationFrame(paint);
  }

  function requestLayout() {
    if (!layoutFrame && !document.hidden && !dragging) layoutFrame = requestAnimationFrame(rebuild);
  }

  function onSelectionChange() {
    clearTimeout(selectionTimer);
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      hide();
      identity = null;
      if (layoutFrame) cancelAnimationFrame(layoutFrame);
      layoutFrame = 0;
      return;
    }
    if (dragging) { hide(); return; }
    selectionTimer = window.setTimeout(requestLayout, Math.max(30, touchWaitUntil - performance.now()));
  }

  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('click', () => { hide(); requestLayout(); }, { passive: true });
  document.addEventListener('focusin', () => { hide(); requestLayout(); }, { passive: true });
  document.addEventListener('keyup', (event) => { if (event.key === 'Escape') requestLayout(); }, { passive: true });
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    dragging = true;
    if (event.pointerType === 'touch') touchWaitUntil = performance.now() + 200;
    hide();
  }, { passive: true, capture: true });
  function endDrag(event) {
    dragging = false;
    if (event.pointerType === 'touch') touchWaitUntil = performance.now() + 220;
    onSelectionChange();
  }
  document.addEventListener('pointerup', endDrag, { passive: true, capture: true });
  document.addEventListener('pointercancel', endDrag, { passive: true, capture: true });
  document.addEventListener('pointermove', (event) => {
    if (!scene || dragging || event.buttons || event.pointerType !== 'mouse' || !finePointer.matches || reducedMotion.matches) return;
    const now = performance.now();
    if (now - lastPointerPaint < 32) return;
    const shift = Math.max(-1, Math.min(1, (event.clientX - scene.bounds.left) / scene.width * 2 - 1)) * Math.min(60, scene.width * 0.1);
    if (Math.abs(shift - pointerShift) < 1) return;
    lastPointerPaint = now;
    pointerShift = shift;
    requestPaint();
  }, { passive: true });
  document.addEventListener('scroll', () => { hide(); requestLayout(); }, { passive: true, capture: true });
  window.addEventListener('resize', () => { hide(); requestLayout(); }, { passive: true });
  window.visualViewport?.addEventListener('resize', () => { hide(); requestLayout(); }, { passive: true });
  window.visualViewport?.addEventListener('scroll', () => { hide(); requestLayout(); }, { passive: true });
  document.addEventListener('close', () => { hide(); requestLayout(); }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hide(); clearTimeout(selectionTimer); }
    else requestLayout();
  });
  window.addEventListener('blur', hide);
  window.addEventListener('focus', requestLayout);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', requestLayout);
  reducedMotion.addEventListener('change', requestLayout);
  forcedColors.addEventListener('change', requestLayout);
  document.fonts?.ready.then(requestLayout);
})();
