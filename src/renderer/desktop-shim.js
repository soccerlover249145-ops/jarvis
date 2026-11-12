/* desktop-shim.js: runs first, in the Mac app only. Keys never live in this window's storage.

   The web UI keeps its keys in localStorage. Here, reading one of those names returns a
   placeholder (when the Keychain holds that key), writing one hands the value to the Keychain
   through the main process, and removing one deletes it from the Keychain. Nothing secret is
   written to disk by this window. The main process swaps the placeholder for the real key on the
   way out, only to that key's own host (see src/main/secrets.js). */
(function () {
  'use strict';
  var D = window.jarvisDesktop;
  if (!D) return;
  var st = null;
  try { st = D.secretsState(); } catch (e) { st = null; }
  st = st || { have: {}, placeholders: {} };
  var PH = { 'kin.key': st.placeholders.anthropic, 'kin.tts.key': st.placeholders.elevenlabs, 'kin.gb.tok': st.placeholders.relay };
  var SECRET = { 'kin.key': 1, 'kin.tts.key': 1, 'kin.gb.tok': 1, 'kin.hf.tok': 1 };
  var have = {};
  Object.keys(SECRET).forEach(function (k) { have[k] = (st.have && st.have[k]) || null; });
  var DEFAULT_RELAY = 'https://jarvis-relay-next-of-kin.vercel.app';

  var P = Storage.prototype, get = P.getItem, set = P.setItem, del = P.removeItem, clear = P.clear;
  function local(o) { try { return o === window.localStorage; } catch (e) { return false; } }
  function warn(t) { try { D.ui.toast('Keychain', t); } catch (e) {} }
  /* the toast alone is easy to miss; tell the Settings panel the real, confirmed outcome so it
     never keeps showing "a key is saved" after the Keychain write actually failed */
  function fire(k, ok) { try { window.dispatchEvent(new CustomEvent('kin:secretsaved', { detail: { key: k, ok: ok } })); } catch (e) {} }

  P.getItem = function (k) {
    if (local(this) && SECRET[k]) return have[k] || null;
    return get.call(this, k);
  };
  P.setItem = function (k, v) {
    if (local(this) && SECRET[k]) {
      v = String(v);
      if (k === 'kin.hf.tok') return;                 /* not offered in the Mac app: dropped, never stored */
      if (v === have[k]) return;
      var before = have[k];
      have[k] = PH[k];
      D.setSecret(k, v).then(function (r) {
        if (!r || !r.ok) {
          have[k] = before;
          warn('macOS would not save that key in the Keychain. Try again, or check Keychain Access.');
          fire(k, false);
        } else fire(k, true);
      }, function () { have[k] = before; warn('The key could not be saved.'); fire(k, false); });
      return;
    }
    if (local(this) && k === 'kin.gb.url') D.relayUrl(String(v || '') || DEFAULT_RELAY);
    return set.call(this, k, v);
  };
  P.removeItem = function (k) {
    if (local(this) && SECRET[k]) { if (have[k]) D.delSecret(k); have[k] = null; return; }
    if (local(this) && k === 'kin.gb.url') D.relayUrl(DEFAULT_RELAY);
    return del.call(this, k);
  };
  P.clear = function () {
    if (local(this)) { Object.keys(SECRET).forEach(function (k) { if (have[k]) D.delSecret(k); have[k] = null; }); D.relayUrl(DEFAULT_RELAY); }
    return clear.call(this);
  };
  /* keys typed into an earlier build of this window are moved into the Keychain and wiped here */
  Object.keys(SECRET).forEach(function (k) {
    try { var old = get.call(window.localStorage, k); if (old) { del.call(window.localStorage, k); if (k !== 'kin.hf.tok' && old !== PH[k]) window.localStorage.setItem(k, old); } } catch (e) {}
  });
  try { D.relayUrl(get.call(window.localStorage, 'kin.gb.url') || DEFAULT_RELAY); } catch (e) {}
  window.Kin = window.Kin || {};
  window.Kin.desktop = true;
})();
