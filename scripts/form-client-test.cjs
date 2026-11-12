'use strict';
// Run the production module against small DOM/fetch doubles; no network or mail.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = readFileSync(join(__dirname, '../form.js'), 'utf8');
class Element {
  constructor() { this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; this.textContent = ''; this.events = {}; this.attrs = {}; this.children = {}; }
  addEventListener(name, fn) { this.events[name] = fn; }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
  focus() { this.focused = true; }
  scrollIntoView() {}
  querySelector(name) { return this.children[name] ||= new Element(); }
}
function setup(hostname = 'hjcpit.com') {
  const elements = Object.fromEntries(['enquiry-form','name','contact','message','consent','website','form-submit','form-status','form-success','form-preview','form-availability','form-again',...['name','contact','message','consent'].map(x => x+'-error')].map(x => [x, new Element()]));
  const form = elements['enquiry-form'];
  form.dataset = { page: 'catalog', liveEnabled: 'true' };
  form.reset = () => { for (const id of ['name','contact','message','website']) elements[id].value = ''; elements.consent.checked = false; };
  let handler = async () => ({ ok: true, json: async () => ({ok:true, token:'test-token'}) });
  const calls = [];
  vm.runInNewContext(source, { document: {querySelector: id => elements[id.slice(1)], getElementById: id => elements[id]},
    location: {hostname}, crypto: webcrypto, Uint8Array, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => { calls.push({url,options}); return handler(url, options); } });
  return { elements, calls, setHandler: fn => { handler = fn; }, submit: () => form.events.submit({preventDefault(){}}),
    fill: () => { elements.name.value='Тест формы'; elements.contact.value='qa@example.invalid'; elements.message.value='Тестовые пожелания'; elements.consent.checked=true; } };
}
const reply = (body, ok = true) => ({ ok, json: async () => body });
(async () => {
  const a=setup();
  await a.submit(); assert.equal(a.calls.length,0); assert.ok(a.elements['name-error'].textContent);
  a.fill(); a.elements.consent.checked=false; await a.submit(); assert.equal(a.calls.length,0);
  a.elements.consent.checked=true;
  let post = 0;
  a.setHandler(async (_, options) => {
    if (!options.method) return reply({ok:true,token:'valid'});
    post++;
    if (post === 1) throw new TypeError('Network failed after handoff');
    return reply({ok:true,reference:'ABCDEF12'});
  });
  await a.submit();
  assert.equal(a.elements.name.value,'Тест формы');
  assert.match(a.elements['form-status'].textContent,/Не удалось подтвердить/);
  assert.equal(a.elements['enquiry-form'].hidden,false);
  await a.submit();
  const sent = a.calls.filter(x => x.options.method === 'POST').map(x => JSON.parse(x.options.body));
  assert.equal(sent[0].requestId,sent[1].requestId,'Uncertain retry keeps the id');
  assert.equal(a.elements['enquiry-form'].hidden,true);
  assert.equal(a.elements.name.value,'');
  assert.equal(a.elements.consent.checked,false);
  a.elements['form-again'].events.click();
  assert.equal(a.elements['enquiry-form'].hidden,false);
  const b=setup(); b.fill(); let release;
  b.setHandler((_,options) => !options.method ? Promise.resolve(reply({ok:true,token:'valid'})) : new Promise(resolve=>{release=resolve;}));
  const first=b.submit(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(b.elements['form-submit'].disabled,true);
  await b.submit(); assert.equal(b.calls.length,2,'Double tap makes one POST');
  release(reply({ok:false,code:'delivery',message:'Не отправлено'},false)); await first;
  assert.equal(b.elements.name.value,'Тест формы'); assert.equal(b.elements['form-status'].textContent,'Не отправлено');
  assert.equal(b.elements['form-submit'].disabled,false);
  const c=setup('tema-git.github.io'); c.fill(); await c.submit();
  assert.equal(c.calls.length,0,'Preview never sends');
  assert.match(c.elements['form-success'].querySelector('p').textContent,/данные не отправлены/);
  const d=setup(); d.fill(); let phase=0;
  d.setHandler(async (_,options)=> !options.method ? reply({ok:true,token:'token-'+(++phase)}) : phase===1 ? reply({ok:false,code:'token',message:'Повторите отправку'},false) : reply({ok:true,reference:'FEDCBA98'}));
  await d.submit(); await d.submit();
  assert.equal(phase,2,'Expired token is renewed on explicit retry');
  const retries=d.calls.filter(x=>x.options.method==='POST').map(x=>JSON.parse(x.options.body));
  assert.equal(retries[0].requestId,retries[1].requestId);
  console.log('Form client checks passed: consent, network failure, preserved fields, stable retry id, duplicate click, server failure, preview isolation and token renewal.');
})().catch(error=>{console.error(error);process.exitCode=1;});
