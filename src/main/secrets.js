'use strict';
/* secrets.js: how the web UI uses keys it never holds.

   The web UI was written to read its keys from localStorage. In the Mac app a small shim
   (renderer/desktop-shim.js) answers those reads with a PLACEHOLDER instead of the key. The UI
   puts the placeholder in its request headers as usual, and just before the request leaves the
   app, the main process swaps the placeholder for the real key from the Keychain, but only on a
   request to that key's own host over https. A placeholder reaching any other host stays a
   placeholder, and a real key typed into the UI (the first time it is entered) passes untouched.

   The Higgsfield sign-in is not offered in the Mac app yet (its tokens rotate and travel in request
   bodies, and its web sign-in needs an https return address), so anything the UI tries to keep
   under that name is dropped, never stored. */

/* Each placeholder fits the shape the UI checks before it will use a key. */
const PLACEHOLDER = {
  anthropic: 'sk-ant-api03-JARVIS-KEYCHAIN-PLACEHOLDER-not-a-key-0000000000',
  elevenlabs: 'jarvis-keychain-placeholder-elevenlabs-not-a-key',
  relay: 'JarvisKeychainPlaceholderRelayToken.not-a-real-token.000000'
};
/** localStorage name in the web UI -> Keychain name, and how it is handled */
const STORE_MAP = {
  'kin.key': { name: 'anthropic', mode: 'inject' },
  'kin.tts.key': { name: 'elevenlabs', mode: 'inject' },
  'kin.gb.tok': { name: 'relay', mode: 'inject' },
  'kin.hf.tok': { name: 'higgsfield', mode: 'block' }
};
/** where each injected key goes: host, and the header the UI sends it in */
const ROUTES = [
  { name: 'anthropic', host: 'api.anthropic.com', header: 'x-api-key', prefix: '' },
  { name: 'elevenlabs', host: 'api.elevenlabs.io', header: 'xi-api-key', prefix: '' },
  { name: 'relay', host: null /* the owner's relay */, header: 'authorization', prefix: 'Bearer ' }
];

function relayHost(relayUrl) {
  try {
    const u = new URL(String(relayUrl || ''));
    return u.protocol === 'https:' && !u.username && !u.password ? u.hostname.toLowerCase() : null;
  } catch (e) { return null; }
}

/**
 * Rewrite outgoing request headers. Pure: returns { headers, injected } and never mutates input.
 * secrets: { anthropic: 'sk-ant-...', ... } (only those present). relayUrl: the owner's relay address.
 */
function injectHeaders(url, headers, secrets, relayUrl) {
  const out = Object.assign({}, headers || {});
  let u;
  try { u = new URL(url); } catch (e) { return { headers: out, injected: null }; }
  if (u.protocol !== 'https:') return { headers: out, injected: null };
  const host = u.hostname.toLowerCase();
  const rh = relayHost(relayUrl);
  for (const r of ROUTES) {
    const want = r.host || rh;
    if (!want || host !== want) continue;
    const key = Object.keys(out).find(function (k) { return k.toLowerCase() === r.header; });
    if (!key) continue;
    const ph = r.prefix + PLACEHOLDER[r.name];
    if (out[key] !== ph) continue;                 /* a real key the owner just typed: leave it */
    const real = secrets && secrets[r.name];
    if (!real) continue;
    out[key] = r.prefix + real;
    return { headers: out, injected: r.name };
  }
  return { headers: out, injected: null };
}

/** the url patterns the main process watches, given the relay address */
function watchUrls(relayUrl) {
  const list = ['https://api.anthropic.com/*', 'https://api.elevenlabs.io/*'];
  const rh = relayHost(relayUrl);
  if (rh) list.push('https://' + rh + '/*');
  return list;
}

module.exports = { PLACEHOLDER, STORE_MAP, ROUTES, injectHeaders, watchUrls, relayHost };
