(() => {
  'use strict';
  const form = document.querySelector('#enquiry-form');
  if (!form) return;
  const fields = Object.fromEntries(['name', 'contact', 'message', 'consent'].map(id => [id, document.getElementById(id)]));
  const submit = document.querySelector('#form-submit');
  const submitLabel = submit.querySelector('span');
  const status = document.querySelector('#form-status');
  const success = document.querySelector('#form-success');
  const preview = !['hjcpit.com', 'www.hjcpit.com'].includes(location.hostname);
  const endpoint = 'https://forms.hjcpit.com/submit.php';
  let pending = false;
  let ticket = null;
  let attempt = null;

  document.querySelector('#form-preview').hidden = !preview;
  // Keep the public form closed until HTTPS and the authorized delivery test pass.
  if (!preview && form.dataset.liveEnabled !== 'true') {
    document.querySelector('#form-availability').hidden = false;
    form.dataset.unavailable = 'true';
    form.hidden = true;
    return;
  }
  submitLabel.textContent = preview ? 'Проверить заявку' : 'Отправить обращение';
  submit.disabled = false;

  function setError(id, message = '') {
    document.getElementById(id + '-error').textContent = message;
    fields[id].setAttribute('aria-invalid', String(Boolean(message)));
  }

  function validate() {
    const name = fields.name.value.trim();
    const contact = fields.contact.value.trim();
    const digits = contact.replace(/\D/g, '').length;
    const validContact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)
      || /^@[a-zA-Z0-9_]{4,32}$/.test(contact)
      || (/^\+?[\d ().-]+$/.test(contact) && digits >= 7 && digits <= 15);
    const errors = {
      name: name.length >= 2 && name.length <= 80 && !/[\x00-\x1f\x7f]/.test(name) ? '' : 'Укажите имя длиной от 2 до 80 символов.',
      contact: validContact && contact.length <= 160 && !/[\x00-\x1f\x7f]/.test(contact) ? '' : 'Укажите email, телефон или @ник в Telegram.',
      message: fields.message.value.length <= 2000 ? '' : 'Сократите пожелания до 2000 символов.',
      consent: fields.consent.checked ? '' : 'Для отправки нужно согласие на обработку данных.',
    };
    for (const [id, error] of Object.entries(errors)) setError(id, error);
    const invalid = Object.keys(errors).find(id => errors[id]);
    if (invalid) fields[invalid].focus();
    return !invalid;
  }

  async function request(options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, { ...options, mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        const error = new Error(body.message || 'Не удалось отправить обращение. Попробуйте ещё раз.');
        error.code = body.code;
        error.fields = body.fields;
        throw error;
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  function showSuccess(reference) {
    form.reset();
    form.hidden = true;
    success.querySelector('h3').textContent = preview ? 'Заявка проверена' : 'Обращение принято';
    success.querySelector('p').textContent = preview
      ? 'Это тестовая версия: данные не отправлены и заказ не создан. Отправить обращение можно на hjcpit.com.'
      : 'Спасибо. Мы ответим по указанному контакту. Номер обращения: ' + reference + '.';
    success.hidden = false;
    success.focus({ preventScroll: true });
    attempt = null;
    ticket = null;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !validate()) return;
    status.textContent = '';
    if (preview) { showSuccess(''); return; }
    const data = {
      name: fields.name.value.trim(), contact: fields.contact.value.trim(), message: fields.message.value.trim(),
      website: document.getElementById('website').value, consent: fields.consent.checked,
      consentVersion: '2026-11-12', page: form.dataset.page,
    };
    const fingerprint = JSON.stringify(data);
    if (!attempt || attempt.fingerprint !== fingerprint) {
      attempt = { fingerprint, id: Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('') };
    }
    pending = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    // Freeze the submitted fields until the response, preserving their values on failure.
    for (const field of Object.values(fields)) field.disabled = true;
    submitLabel.textContent = 'Отправляем…';
    try {
      if (!ticket || ticket.until < Date.now()) {
        const response = await request();
        if (typeof response.token !== 'string') throw new Error();
        ticket = { token: response.token, until: Date.now() + 7000000 };
      }
      const response = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, requestId: attempt.id, token: ticket.token }) });
      if (typeof response.reference !== 'string' || !/^[A-F0-9]{8}$/.test(response.reference)) throw new Error();
      showSuccess(response.reference);
    } catch (error) {
      if (error.code === 'token') ticket = null;
      if (error.fields) {
        for (const [id, message] of Object.entries(error.fields)) if (fields[id]) setError(id, message);
      }
      status.textContent = error.code ? error.message : 'Не удалось подтвердить отправку. Данные сохранены в форме. Проверьте соединение и повторите попытку или напишите нам на почту.';
    } finally {
      pending = false;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
      for (const field of Object.values(fields)) field.disabled = false;
      submitLabel.textContent = 'Отправить обращение';
    }
  });

  for (const [id, field] of Object.entries(fields)) {
    field.addEventListener(id === 'consent' ? 'change' : 'input', () => setError(id));
  }
  document.getElementById('form-again').addEventListener('click', () => {
    success.hidden = true;
    form.hidden = false;
    form.reset();
    for (const id of Object.keys(fields)) setError(id);
    status.textContent = '';
    fields.name.focus({ preventScroll: true });
  });
})();
