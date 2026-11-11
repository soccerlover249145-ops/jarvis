/* sync-core.js: the parts of Drive sync that do not touch the network or the page.
   - encryption: AES-GCM 256 with a key derived from the founder's sync passphrase (PBKDF2-SHA-256, 600,000 rounds).
     The passphrase is never stored or sent. The salt is not secret and travels with the file so every computer
     derives the same key from the same passphrase.
   - the payload: exactly Kin.move's allow-list of settings, plus memory, the Made shelf and the logbook.
     Never the conversation, keys, tokens, sign-ins or bridge receipts.
   - the merge: three-way, against what this computer last synced (the "base").
       settings: the side that changed wins; if both changed to different values, the newer wins and the other value
                 is kept as a conflict the founder can restore. Nothing is dropped silently.
       memory:   union, deduplicated by id and by wording; deletions travel as tombstones and win only over
                 copies that are not newer than the deletion.
       made:     by id, newer wins; if both computers changed the same piece, the older edit is kept as a separate
                 copy titled "(other computer)" and listed as a conflict.
       log:      union by id, with tombstones.
   Works in a browser (window.KinSyncCore) and in Node (module.exports) for the unit tests. */
(function (root) {
  'use strict';
  var subtle = (root.crypto && root.crypto.subtle) || null;
  var KIND = 'kin-sync', VERSION = 1, ROUNDS = 600000, TOMB_DAYS = 90, MAX_BYTES = 20 * 1024 * 1024;
  var enc = new TextEncoder(), dec = new TextDecoder();

  function b64(bytes) { var s = ''; bytes = new Uint8Array(bytes); for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')); }
  function unb64(str) { var s = typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary'); var out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  function rand(n) { var a = new Uint8Array(n); root.crypto.getRandomValues(a); return a; }
  function fail(msg, code) { var e = new Error(msg); e.plain = true; if (code) e.code = code; return e; }

  /* ------------------------------------------------------------ keys and encryption */
  /** A non-extractable AES-GCM key from the passphrase and salt. */
  function deriveKey(pass, saltB64) {
    pass = String(pass || '');
    if (pass.length < 10) return Promise.reject(fail('Use a sync passphrase of at least 10 characters.', 'short'));
    return subtle.importKey('raw', enc.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: ROUNDS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function newSalt() { return b64(rand(16)); }
  /** Encrypt a payload object into the file that is stored in Drive. */
  function seal(key, saltB64, payload) {
    var iv = rand(12), text = JSON.stringify(payload);
    if (text.length > MAX_BYTES) return Promise.reject(fail('There is more than 20 MB to sync. Remove some large pieces from the Made shelf first.', 'big'));
    var aad = enc.encode(KIND + ':' + VERSION);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: aad }, key, enc.encode(text)).then(function (ct) {
      return JSON.stringify({ kind: KIND, version: VERSION, salt: saltB64, iv: b64(iv), ct: b64(ct) });
    });
  }
  /** Read the file's outer wrapper without decrypting (to get the salt). */
  function envelope(fileText) {
    var o; try { o = JSON.parse(fileText); } catch (e) { throw fail('The sync file in Drive is damaged (not JSON).', 'damaged'); }
    if (!o || o.kind !== KIND) throw fail('The file in Drive is not a Jarvis sync file.', 'damaged');
    if (o.version !== VERSION) throw fail('The sync file is version ' + String(o.version).slice(0, 8) + '; this page reads version ' + VERSION + '. Update Jarvis on this computer.', 'version');
    if (typeof o.salt !== 'string' || typeof o.iv !== 'string' || typeof o.ct !== 'string') throw fail('The sync file in Drive is damaged.', 'damaged');
    return o;
  }
  /** Decrypt the Drive file. A wrong passphrase fails the authentication check and changes nothing. */
  function open(key, fileText) {
    var o; try { o = envelope(fileText); } catch (e) { return Promise.reject(e); }
    return subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv), additionalData: enc.encode(KIND + ':' + VERSION) }, key, unb64(o.ct)).then(function (pt) {
      var p; try { p = JSON.parse(dec.decode(pt)); } catch (e) { throw fail('The sync file decrypted but is damaged.', 'damaged'); }
      return clean(p);
    }, function () { throw fail('That passphrase does not open the sync file in your Drive. Use the same passphrase as on your other computer.', 'passphrase'); });
  }

  /* ------------------------------------------------------------ the payload */
  var JSONISH_DEFAULT = { 'kin.bb.settings': 1, 'kin.bb.ticks': 1, 'kin.bb.started': 1, 'kin.away': 1, 'kin.calls': 1, 'kin.gauntlet': 1 };
  var cfg = { allow: {}, jsonish: JSONISH_DEFAULT };
  /** The allow-list comes from Kin.move (one list for export and sync). Only the settings names are used here. */
  function configure(allow, jsonish) { cfg.allow = Object.assign({}, allow || {}); if (jsonish) cfg.jsonish = jsonish; }
  function allowed(k) { return Object.prototype.hasOwnProperty.call(cfg.allow, k); }
  function okValue(k, v) {
    if (typeof v !== 'string' || v.length > 4 * 1024 * 1024) return false;
    if (cfg.jsonish[k]) { try { var o = JSON.parse(v); return !!o && typeof o === 'object'; } catch (e) { return false; } }
    return v.length <= 400;
  }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  /* maps with no inherited names, so an id like "__proto__" or "constructor" is just an id */
  function D() { return Object.create(null); }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
  /** Drop anything that is not on the list or not the right shape. Applied to every payload read from Drive. */
  function clean(p) {
    if (!p || typeof p !== 'object' || p.kind !== 'kin-sync-data') throw fail('The sync file holds something other than Jarvis data.', 'damaged');
    var out = { kind: 'kin-sync-data', version: VERSION, at: num(p.at, 0), device: str(p.device, 40), local: D(), mind: { memory: [], made: [], log: [] }, tomb: { memory: D(), made: D(), log: D() } };
    var L = p.local && typeof p.local === 'object' ? p.local : D();
    Object.keys(L).forEach(function (k) {
      var e = own(L, k) ? L[k] : null; if (!allowed(k) || !e || typeof e !== 'object') return;
      if (e.v === null) { out.local[k] = { v: null, at: num(e.at, 0) }; return; }
      if (okValue(k, e.v)) out.local[k] = { v: e.v, at: num(e.at, 0) };
    });
    var M = p.mind && typeof p.mind === 'object' ? p.mind : {};
    ['memory', 'made', 'log'].forEach(function (n) { if (Array.isArray(M[n])) out.mind[n] = M[n].filter(function (x) { return x && typeof x === 'object' && typeof x.id === 'string' && x.id; }).slice(0, n === 'made' ? 400 : 5000); });
    var T = p.tomb && typeof p.tomb === 'object' ? p.tomb : D();
    ['memory', 'made', 'log'].forEach(function (n) { var t = own(T, n) && T[n] && typeof T[n] === 'object' ? T[n] : D(); Object.keys(t).slice(0, 20000).forEach(function (id) { out.tomb[n][String(id).slice(0, 80)] = num(t[id], 0); }); });
    return out;
  }

  /* ------------------------------------------------------------ change tracking */
  /** A short, stable digest of a string (not cryptographic; only to notice changes). */
  function h(s) { s = String(s); var a = 0x811c9dc5, b = 0x01000193 | 0; for (var i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 16777619) >>> 0; b = Math.imul(b ^ s.charCodeAt(i), 2246822519) >>> 0; } return a.toString(36) + '.' + b.toString(36) + '.' + s.length; }
  function itemDigest(x) { var c = Object.assign({}, x); delete c.uses; delete c.score; return h(JSON.stringify(c)); }

  /** What this computer holds now, in payload form, stamping each setting with when it last changed here. */
  function snapshot(state, base, now, device) {
    base = base || emptyBase();
    var local = D();
    Object.keys(cfg.allow).forEach(function (k) {
      var v = Object.prototype.hasOwnProperty.call(state.local, k) ? state.local[k] : null;
      if (v != null && !okValue(k, v)) v = null;
      var b = own(base.local, k) ? base.local[k] : null, dig = v == null ? 'null' : h(v);
      if (b && b.h === dig) { local[k] = { v: v, at: b.at }; return; }      /* unchanged since the last sync */
      if (!b && v == null) return;                                          /* never set anywhere */
      local[k] = { v: v, at: now };                                         /* changed (or cleared) here */
    });
    var tomb = { memory: Object.assign(D(), base.tomb.memory), made: Object.assign(D(), base.tomb.made), log: Object.assign(D(), base.tomb.log) };
    var mind = { memory: [], made: [], log: [] };
    ['memory', 'made', 'log'].forEach(function (n) {
      var have = D();
      (state.mind[n] || []).forEach(function (x) { if (x && typeof x.id === 'string') { have[x.id] = 1; mind[n].push(x); } });
      /* something this computer synced before and no longer has was deleted here */
      Object.keys(base.mind[n]).forEach(function (id) { if (!have[id]) tomb[n][id] = Math.max(tomb[n][id] || 0, now); });
    });
    return { kind: 'kin-sync-data', version: VERSION, at: now, device: device || '', local: local, mind: mind, tomb: tomb };
  }
  function emptyBase() { return { at: 0, local: D(), mind: { memory: D(), made: D(), log: D() }, tomb: { memory: D(), made: D(), log: D() } }; }
  /** What gets remembered after a sync, to tell later which side changed what. */
  function baseOf(payload) {
    var b = emptyBase(); b.at = payload.at;
    Object.keys(payload.local).forEach(function (k) { var e = payload.local[k]; b.local[k] = { h: e.v == null ? 'null' : h(e.v), at: e.at }; });
    ['memory', 'made', 'log'].forEach(function (n) { payload.mind[n].forEach(function (x) { b.mind[n][x.id] = itemDigest(x); }); b.tomb[n] = Object.assign(D(), payload.tomb[n]); });
    return b;
  }

  /* ------------------------------------------------------------ the merge */
  function normText(t) { return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  /**
   * Merge this computer's snapshot (mine) with the file from Drive (theirs), against the last synced base.
   * Returns { merged, conflicts } where every conflict keeps the value that lost, so nothing is lost silently.
   */
  function merge(mine, theirs, base, now) {
    base = base || emptyBase(); now = now || Date.now();
    if (!theirs) return { merged: mine, conflicts: [] };
    var conflicts = [], local = D();
    var keys = D(); Object.keys(mine.local).concat(Object.keys(theirs.local)).forEach(function (k) { if (allowed(k)) keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var a = own(mine.local, k) ? mine.local[k] : null, b = own(theirs.local, k) ? theirs.local[k] : null, bb = own(base.local, k) ? base.local[k] : null;
      var aDig = a ? (a.v == null ? 'null' : h(a.v)) : (bb ? bb.h : 'null'), bDig = b ? (b.v == null ? 'null' : h(b.v)) : (bb ? bb.h : 'null');
      var aChanged = !bb ? !!a : aDig !== bb.h, bChanged = !bb ? !!b : bDig !== bb.h;
      if (!a) { local[k] = b; return; }
      if (!b) { local[k] = a; return; }
      if (aDig === bDig) { local[k] = a.at >= b.at ? a : b; return; }
      if (aChanged && !bChanged) { local[k] = a; return; }
      if (bChanged && !aChanged) { local[k] = b; return; }
      /* both changed to different values: the newer wins, the other is kept */
      var win = a.at > b.at ? a : b.at > a.at ? b : a, lose = win === a ? b : a;
      local[k] = win;
      conflicts.push({ type: 'setting', key: k, label: cfg.allow[k] || k, kept: win.v, other: lose.v, otherFrom: win === a ? 'your other computer' : 'this computer', at: now });
    });

    var tomb = { memory: D(), made: D(), log: D() };
    ['memory', 'made', 'log'].forEach(function (n) {
      [base.tomb[n], mine.tomb[n], theirs.tomb[n]].forEach(function (t) { Object.keys(t || {}).forEach(function (id) { tomb[n][id] = Math.max(tomb[n][id] || 0, t[id]); }); });
      /* tombstones older than 90 days are forgotten */
      Object.keys(tomb[n]).forEach(function (id) { if (now - tomb[n][id] > TOMB_DAYS * 864e5) delete tomb[n][id]; });
    });
    function alive(n, x) { var t = tomb[n][x.id]; return !t || num(x.at, 0) > t; }

    var mind = { memory: [], made: [], log: [] };
    /* memory: by id, newer wins; then by wording */
    var byId = D();
    mine.mind.memory.concat(theirs.mind.memory).forEach(function (x) { var o = byId[x.id]; if (!o || num(x.at, 0) > num(o.at, 0)) byId[x.id] = x; });
    var byText = D();
    Object.keys(byId).map(function (id) { return byId[id]; }).filter(function (x) { return alive('memory', x); }).forEach(function (x) {
      var t = normText(x.text); if (!t) return; var o = byText[t];
      if (!o) { byText[t] = x; return; }
      var keep = num(x.at, 0) > num(o.at, 0) ? x : o; keep = Object.assign({}, keep, { uses: Math.max(num(x.uses, 0), num(o.uses, 0)) });
      byText[t] = keep;
    });
    mind.memory = Object.keys(byText).map(function (t) { return byText[t]; });

    /* made: by id; an edit on both sides keeps both */
    var mm = D(), tm = D(); mine.mind.made.forEach(function (x) { mm[x.id] = x; }); theirs.mind.made.forEach(function (x) { tm[x.id] = x; });
    var ids = D(); Object.keys(mm).concat(Object.keys(tm)).forEach(function (id) { ids[id] = 1; });
    Object.keys(ids).forEach(function (id) {
      var a = mm[id], b = tm[id], bd = own(base.mind.made, id) ? base.mind.made[id] : null;
      if (a && b && itemDigest(a) !== itemDigest(b) && bd && itemDigest(a) !== bd && itemDigest(b) !== bd) {
        var win = num(a.at, 0) >= num(b.at, 0) ? a : b, lose = win === a ? b : a;
        if (alive('made', win)) mind.made.push(win);
        var copy = Object.assign({}, lose, { id: lose.id + '-c' + h(String(lose.at)).slice(0, 6), title: str(lose.title, 180) + ' (other computer)' });
        mind.made.push(copy);
        conflicts.push({ type: 'made', id: id, title: str(win.title, 200), copyId: copy.id, at: now });
        return;
      }
      var pick = !a ? b : !b ? a : (num(a.at, 0) >= num(b.at, 0) ? a : b);
      if (alive('made', pick)) mind.made.push(pick);
    });
    mind.made.sort(function (x, y) { return num(y.at, 0) - num(x.at, 0); });

    /* log: union by id */
    var lg = D(); mine.mind.log.concat(theirs.mind.log).forEach(function (x) { var o = lg[x.id]; if (!o || num(x.at, 0) > num(o.at, 0)) lg[x.id] = x; });
    mind.log = Object.keys(lg).map(function (id) { return lg[id]; }).filter(function (x) { return alive('log', x); }).sort(function (x, y) { return num(y.at, 0) - num(x.at, 0); });

    /* a tombstone for something that is alive again (edited after the deletion) is dropped */
    ['memory', 'made', 'log'].forEach(function (n) { mind[n].forEach(function (x) { delete tomb[n][x.id]; }); });

    return { merged: { kind: 'kin-sync-data', version: VERSION, at: now, device: mine.device, local: local, mind: mind, tomb: tomb }, conflicts: conflicts };
  }

  /* ------------------------------------------------------------ secrets */
  var HF_SECRET_FIELDS = { access_token: 1, refresh_token: 1, id_token: 1, client_secret: 1, code_verifier: 1, verifier: 1, token: 1, refresh: 1 };
  var SECRET_KEYS = /^kin\.(key|tts\.key|hf\..*|gb\.tok|gb\.jobs|mail\.cid|sync\..*)$/;
  var KEYISH = /sk-ant-[A-Za-z0-9_-]{10,}|\bsk_[A-Za-z0-9]{24,}|\bxi-[A-Za-z0-9]{16,}|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|\bya29\.[A-Za-z0-9_-]{20,}|\b1\/\/[A-Za-z0-9_-]{30,}/;
  /** Secret values saved on this computer (keys, tokens, receipts, the Google Client ID), to make sure none leave. */
  function secretValues(stores) {
    var out = [];
    (stores || []).forEach(function (st) {
      try {
        for (var i = 0; i < st.length; i++) {
          var k = st.key(i); if (!SECRET_KEYS.test(k)) continue;
          var v = st.getItem(k); if (!v) continue;
          if (k === 'kin.gb.jobs') { try { (JSON.parse(v) || []).forEach(function (j) { if (j && typeof j.h === 'string' && j.h.length >= 8) out.push(j.h); }); } catch (e) {} continue; }
          if (/^kin\.sync\./.test(k)) continue; /* sync's own bookkeeping is not secret and never in the payload */
          /* the Higgsfield client record holds public values (its redirect address, client id): only its secret fields count */
          var pub = k === 'kin.hf.client';
          if (!pub && v.length >= 8) out.push(v);
          try { var o = JSON.parse(v); if (o && typeof o === 'object') Object.keys(o).forEach(function (x) { if (typeof o[x] !== 'string' || o[x].length < 12) return; if (pub && !Object.prototype.hasOwnProperty.call(HF_SECRET_FIELDS, x)) return; out.push(o[x]); }); } catch (e) {}
        }
      } catch (e) {}
    });
    return out;
  }
  /** True when the payload text contains a saved secret or anything shaped like a key or token. */
  function leaks(text, secrets) { return (secrets || []).some(function (s) { return text.indexOf(s) >= 0; }) || KEYISH.test(text); }

  var api = { KIND: KIND, VERSION: VERSION, ROUNDS: ROUNDS, MAX_BYTES: MAX_BYTES, configure: configure, deriveKey: deriveKey, newSalt: newSalt, seal: seal, open: open, envelope: envelope,
    clean: clean, snapshot: snapshot, baseOf: baseOf, emptyBase: emptyBase, merge: merge, secretValues: secretValues, leaks: leaks, digest: h, SECRET_KEYS: SECRET_KEYS };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.KinSyncCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
