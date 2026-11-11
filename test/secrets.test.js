'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PLACEHOLDER, injectHeaders, watchUrls, relayHost } = require('../src/main/secrets');
const S = { anthropic: 'sk-ant-REAL', elevenlabs: 'el-REAL', relay: 'relay-REAL' };

test('placeholders still fit the shapes the web UI checks', () => {
  assert.match(PLACEHOLDER.anthropic, /^sk-ant-[A-Za-z0-9_\-]{20,}$/);
  assert.match(PLACEHOLDER.elevenlabs, /^[A-Za-z0-9_\-]{20,200}$/);
  assert.ok(PLACEHOLDER.relay.length >= 32 && /^[A-Za-z0-9._~+\/=-]+$/.test(PLACEHOLDER.relay));
});
test('the placeholder becomes the real key only on its own host over https', () => {
  let r = injectHeaders('https://api.anthropic.com/v1/messages', { 'x-api-key': PLACEHOLDER.anthropic, 'content-type': 'application/json' }, S, '');
  assert.equal(r.headers['x-api-key'], 'sk-ant-REAL'); assert.equal(r.injected, 'anthropic');
  r = injectHeaders('https://api.elevenlabs.io/v1/voices', { 'xi-api-key': PLACEHOLDER.elevenlabs }, S, '');
  assert.equal(r.headers['xi-api-key'], 'el-REAL');
  r = injectHeaders('https://relay.example.com/v1/ask', { Authorization: 'Bearer ' + PLACEHOLDER.relay }, S, 'https://relay.example.com');
  assert.equal(r.headers.Authorization, 'Bearer relay-REAL');
});
test('no key ever goes to another host, over http, or in another header', () => {
  const cases = [
    ['https://evil.example/v1/messages', { 'x-api-key': PLACEHOLDER.anthropic }],
    ['http://api.anthropic.com/v1/messages', { 'x-api-key': PLACEHOLDER.anthropic }],
    ['https://api.anthropic.com.evil.example/v1', { 'x-api-key': PLACEHOLDER.anthropic }],
    ['https://api.anthropic.com/v1/messages', { 'xi-api-key': PLACEHOLDER.elevenlabs }],
    ['https://api.elevenlabs.io/v1', { 'x-api-key': PLACEHOLDER.anthropic }],
    ['https://relay.example.com/v1', { Authorization: 'Bearer ' + PLACEHOLDER.relay }]   /* relay not configured */
  ];
  for (const [url, h] of cases) {
    const r = injectHeaders(url, h, S, '');
    assert.equal(r.injected, null, url);
    assert.ok(!JSON.stringify(r.headers).includes('REAL'), url);
  }
  assert.equal(injectHeaders('https://relay.example.com/x', { Authorization: 'Bearer ' + PLACEHOLDER.relay }, S, 'http://relay.example.com').injected, null, 'an http relay gets nothing');
});
test('a real key typed in by the owner passes untouched; no key stored means no change', () => {
  const r = injectHeaders('https://api.anthropic.com/v1/messages', { 'x-api-key': 'sk-ant-typed-just-now' }, S, '');
  assert.equal(r.headers['x-api-key'], 'sk-ant-typed-just-now');
  const r2 = injectHeaders('https://api.anthropic.com/v1/messages', { 'x-api-key': PLACEHOLDER.anthropic }, {}, '');
  assert.equal(r2.headers['x-api-key'], PLACEHOLDER.anthropic);
});
test('input headers are not mutated; urls watched follow the relay', () => {
  const h = { 'x-api-key': PLACEHOLDER.anthropic };
  injectHeaders('https://api.anthropic.com/v1/messages', h, S, '');
  assert.equal(h['x-api-key'], PLACEHOLDER.anthropic);
  assert.deepEqual(watchUrls(''), ['https://api.anthropic.com/*', 'https://api.elevenlabs.io/*']);
  assert.deepEqual(watchUrls('https://r.example.com/path'), ['https://api.anthropic.com/*', 'https://api.elevenlabs.io/*', 'https://r.example.com/*']);
  assert.equal(relayHost('https://user:pw@r.example.com'), null);
  assert.equal(relayHost('javascript:alert(1)'), null);
});
