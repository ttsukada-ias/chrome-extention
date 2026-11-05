const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../Helper By Tets/page-bridge.js'), 'utf8');

function browser(entries = [['pbapp.prod.token', JSON.stringify({ access_token: 'token-a' })]], route = '#/app/pub/111/dashboard') {
  class Storage {
    constructor() { this.values = new Map(entries); }
    get length() { return this.values.size; }
    key(i) { return [...this.values.keys()][i] ?? null; }
    getItem(key) { return this.values.get(String(key)) ?? null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
  }
  const listeners = new Map(), messages = [];
  const location = { hash: route, pathname: '/', origin: 'https://app.getpublica.com' };
  const window = {
    location, localStorage: new Storage(),
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    postMessage(message, origin) { assert.equal(origin, location.origin); messages.push(JSON.parse(JSON.stringify(message.payload))); },
    history: Object.fromEntries(['pushState', 'replaceState'].map(method => [method, function(state, title, url) {
      if (state === 'throw') throw new Error('History failed');
      const parsed = new URL(url, location.origin);
      location.hash = parsed.hash; location.pathname = parsed.pathname;
      return method;
    }]))
  };
  vm.runInNewContext(source, { window, Storage });
  return { window, messages, emit: (type, event = {}) => (listeners.get(type) || []).forEach(fn => fn(event)) };
}

test('captures a valid token after a malformed matching storage entry', () => {
  const b = browser([['pbapp.stale.token', '{'], ['pbapp.prod.token', JSON.stringify({ access_token: 'valid-token' })]]);
  assert.deepEqual(b.messages, [{ accessToken: 'valid-token', publisherId: '111' }]);
});

test('keeps publisher context current across hash navigation and returning to a publisher', () => {
  const b = browser();
  for (const id of ['222', '111']) { b.window.location.hash = `#/app/pub/${id}/dashboard`; b.emit('hashchange'); }
  assert.deepEqual(b.messages.map(m => m.publisherId), ['111', '222', '111']);
  b.emit('hashchange'); assert.equal(b.messages.length, 3, 'Consecutive identical events are deduplicated');
});

test('captures a publisher reached after initial sign-in routing', () => {
  const b = browser(undefined, '#/login');
  b.window.location.hash = '#/app/pub/394/dashboard'; b.emit('hashchange');
  assert.equal(b.messages.at(-1).publisherId, '394');
});

test('supports pushState, replaceState, and browser back navigation without changing their return/error behavior', () => {
  const b = browser();
  assert.equal(b.window.history.pushState({}, '', '/app/pub/222/dashboard'), 'pushState');
  assert.equal(b.window.history.replaceState({}, '', '/app/pub/333/dashboard'), 'replaceState');
  b.window.location.pathname = '/app/pub/222/dashboard'; b.emit('popstate');
  assert.deepEqual(b.messages.map(m => m.publisherId), ['111', '222', '333', '222']);
  assert.throws(() => b.window.history.pushState('throw', '', '/app/pub/444/dashboard'), /History failed/);
  assert.equal(b.messages.at(-1).publisherId, '222');
});

test('captures refreshed and reused tokens and storage events from other tabs', () => {
  const b = browser();
  b.window.localStorage.setItem('pbapp.prod.token', JSON.stringify({ access_token: 'token-b' }));
  b.window.localStorage.setItem('pbapp.prod.token', JSON.stringify({ access_token: 'token-a' }));
  b.window.localStorage.values.set('pbapp.prod.token', JSON.stringify({ access_token: 'token-c' }));
  b.emit('storage', { storageArea: b.window.localStorage, key: 'pbapp.prod.token' });
  assert.deepEqual(b.messages.map(m => m.accessToken), ['token-a', 'token-b', 'token-a', 'token-c']);
});
