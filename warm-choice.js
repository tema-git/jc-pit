(() => {
  'use strict';

  // Only the public CHOICE route is warmed. Navigation stays a normal link.
  const dive = document.querySelector('a.dive-in[href]');
  if (!dive || typeof fetch !== 'function' || navigator.onLine === false) return;

  let choice;
  let directory;
  try {
    directory = new URL('./', location.href);
    choice = new URL(dive.getAttribute('href'), document.baseURI);
    if (!/^https?:$/.test(choice.protocol) || choice.origin !== location.origin
      || choice.pathname !== new URL('choice.html', directory).pathname
      || choice.username || choice.password) return;
    choice.search = '';
    choice.hash = '';
  } catch {
    return;
  }

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const limited = () => Boolean(connection?.saveData)
    || /^(slow-)?2g$/.test(connection?.effectiveType || '');
  const assets = new Set([
    'style.css',
    'app.js',
    'metal-selection.js',
    'assets/fonts/source-code-pro-variable.woff2',
    'assets/brand-mark-cropped.png',
    'assets/tilda-flowers.webp',
    'assets/tilda-stump.webp',
  ].map((path) => new URL(path, directory).pathname));
  let stopped = false;
  window.addEventListener('pagehide', () => { stopped = true; }, { once: true });

  function prerenderChoice() {
    try {
      if (stopped || limited() || typeof HTMLScriptElement === 'undefined'
        || !HTMLScriptElement.supports?.('speculationrules')) return;
      const rules = document.createElement('script');
      rules.type = 'speculationrules';
      rules.textContent = JSON.stringify({
        prerender: [{ source: 'list', urls: [choice.href], eagerness: 'immediate' }],
      });
      // Only CHOICE: the browser prepares the actual page without following links.
      // Native prerender scheduling/credentials are managed by the browser.
      document.head.append(rules);
    } catch { /* Unsupported or blocked hints leave the fetch fallback intact. */ }
  }

  function decodeAttribute(value) {
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, code) => {
      if (code[0] !== '#') return named[code.toLowerCase()] || entity;
      const point = code[1].toLowerCase() === 'x'
        ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });
  }

  function resources(markup) {
    const found = new Set();
    // Read known URL attributes only: no DOM insertion, scripts, or parser loads.
    for (const tag of markup.match(/<(?:link|script|img)\b[^>]*>/gi) || []) {
      const attributes = {};
      const pattern = /(?:^|\s)(href|src|rel|as)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
      let match;
      while ((match = pattern.exec(tag))) {
        attributes[match[1].toLowerCase()] = decodeAttribute(match[2] ?? match[3] ?? match[4]);
      }
      const kind = /^<(\w+)/.exec(tag)?.[1].toLowerCase();
      const relation = (attributes.rel || '').toLowerCase().split(/\s+/);
      const relevant = kind === 'img' || kind === 'script' || relation.includes('stylesheet')
        || (relation.includes('preload') && (attributes.as || '').toLowerCase() === 'font');
      if (!relevant) continue;
      try {
        const url = new URL(attributes.src || attributes.href, choice);
        if (url.origin === location.origin && !url.username && !url.password
          && assets.has(url.pathname)) {
          url.hash = '';
          found.add(url.href);
        }
      } catch { /* An invalid hint must never affect the landing page. */ }
    }
    return Array.from(found).slice(0, 8);
  }

  async function read(url, documentRequest = false) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'same-origin',
        credentials: 'omit',
        // Revalidate HTML across deployments; versioned assets reuse the HTTP cache.
        cache: documentRequest ? 'no-cache' : 'force-cache',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        priority: 'low',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok || Number(response.headers.get('content-length')) > 1000000) {
        await response.body?.cancel();
        return '';
      }
      if (documentRequest) {
        if (!(response.headers.get('content-type') || '').includes('text/html')) return '';
        return await response.text();
      }
      // Consume the response so the complete resource enters the HTTP cache.
      // Avoid extra Image/FontFace requests with browser-managed credentials.
      await response.arrayBuffer();
      return '';
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function warm() {
    try {
      if (stopped || navigator.onLine === false) return;
      prerenderChoice();
      const markup = await read(choice.href, true);
      // Shared landing assets are already cached; avoid photo/font traffic on 2G.
      if (!markup || stopped || limited()) return;
      const queue = resources(markup);
      async function worker() {
        while (queue.length && !stopped && !limited()) {
          const url = queue.shift();
          try { await read(url); } catch { /* Best effort, never block navigation. */ }
        }
      }
      await Promise.all([worker(), worker(), worker()]);
    } catch { /* Offline, cache, or CSP failures leave the normal link intact. */ }
  }

  // Start after this deferred script returns; fetches carry low network priority.
  setTimeout(warm, 0);
})();
