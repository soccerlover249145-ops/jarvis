/* sync.js: keep what Jarvis has learned and made the same on every computer, through the founder's Google Drive.

   Off by default. Turning it on takes a tap, the Google Client ID already saved for Email, and a sync passphrase.
   - Where: one file in Drive's hidden app folder (scope drive.appdata). Jarvis cannot see any other Drive file,
     and the file does not appear in the founder's Drive list.
   - What: exactly Kin.move's allow-list of settings, plus memory, the Made shelf and the logbook (sync-core.js).
     Never keys, tokens, sign-ins, bridge receipts, the Kin pack or the conversation. The payload is checked for
     every saved secret before it leaves, and nothing is sent if one turns up.
   - How: encrypted on this computer with AES-GCM before upload; the key comes from the passphrase (PBKDF2,
     600,000 rounds) and is kept in this browser's IndexedDB as a non-extractable key. The passphrase itself is never
     stored and never sent. Google holds only ciphertext.
   - When: on a tap of Sync now; on open and after changes (30 s after the last one) while this visit already has
     Google's permission. Google's permission comes from a popup, which browsers only allow from a tap, so a fresh
     visit shows "Tap to sync" until the founder taps once.
   - Conflicts are shown and the losing value is kept, so nothing is lost silently.
   At a shared or plain-http address (Kin.shared) nothing is read, written or sent. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var C = window.KinSyncCore;
  var SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  var GIS = 'https://accounts.google.com/gsi/client';
  var FILES = 'https://www.googleapis.com/drive/v3/files';
  var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  var NAME = 'jarvis-sync.v1.enc.json';
  /* a rehearsal may shorten these through Kin.T (set before this file loads) */
  var DEBOUNCE = (Kin.T && Kin.T.syncDebounce) || 30000, POLL = (Kin.T && Kin.T.syncPoll) || 10000;
  var LS = { on: 'kin.sync.on', dev: 'kin.sync.dev', last: 'kin.sync.last', conf: 'kin.sync.conf' };
  var CID = 'kin.mail.cid', CID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;

  function ls(k) { if (Kin.shared) return null; try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { if (Kin.shared) return false; try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function fail(msg, code) { var e = new Error(msg); e.plain = true; if (code) e.code = code; return e; }
  function sharedFail() { return Promise.reject(fail(Kin.SHARED_TEXT || 'This address is shared with another website, so sync is off here.', 'shared')); }
  function allowList() { return (Kin.move && Kin.move.ALLOW) || null; }
  function ready() { var a = allowList(); if (!C || !a) return false; C.configure(a, Kin.move.JSONISH); return true; }

  /* ------------------------------------------------------------ the key, kept in IndexedDB (never the passphrase) */
  var DB = 'kin-sync', STORE = 'k';
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function kvGet(k) { return idb().then(function (db) { return new Promise(function (res) { var q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(undefined); }; }); }); }
  function kvSet(k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }
  function kvDel(k) { return idb().then(function (db) { return new Promise(function (res) { var t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(k); t.oncomplete = function () { res(); }; t.onerror = function () { res(); }; }); }).catch(function () {}); }

  /* ------------------------------------------------------------ Google permission (memory only) */
  var token = null, gisP = null;
  function clientId() { var v = ls(CID) || ''; return CID_RE.test(v) ? v : ''; }
  function loadGis() {
    if (Kin.shared || !clientId()) return Promise.resolve(false);
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve(true);
    if (gisP) return gisP;
    gisP = new Promise(function (res) { var s = document.createElement('script'); s.src = GIS; s.async = true; s.onload = function () { res(true); }; s.onerror = function () { gisP = null; res(false); }; document.head.appendChild(s); });
    return gisP;
  }
  function haveToken() { return !!(token && Date.now() < token.exp); }
  /* asks Google; must run inside a tap because Google's window is a popup */
  function askToken() {
    if (haveToken()) return Promise.resolve(token.v);
    if (!(window.google && google.accounts && google.accounts.oauth2)) return Promise.reject(fail('Google sign-in has not loaded yet. Tap again in a moment.', 'gis'));
    return new Promise(function (res, rej) {
      var tc = google.accounts.oauth2.initTokenClient({ client_id: clientId(), scope: SCOPE, prompt: '',
        callback: function (r) {
          if (!r || r.error || !r.access_token) { rej(fail('Google did not give Jarvis its sync folder (' + ((r && (r.error_description || r.error)) || 'cancelled') + ').', 'denied')); return; }
          if (r.scope && String(r.scope).split(' ').indexOf(SCOPE) < 0) { rej(fail('Google gave a different permission than the sync folder, so nothing was synced.', 'scope')); return; }
          token = { v: r.access_token, exp: Date.now() + Math.max(60, (+r.expires_in || 3600) - 60) * 1000 }; res(token.v);
        },
        error_callback: function (e) { rej(fail('Google sign-in closed (' + ((e && e.type) || 'cancelled') + ').', 'closed')); } });
      tc.requestAccessToken();
    });
  }

  /* ------------------------------------------------------------ Drive: one file in the hidden app folder */
  function drive(url, opt) {
    opt = opt || {};
    var headers = Object.assign({ Authorization: 'Bearer ' + token.v }, opt.headers || {});
    return fetch(url, { method: opt.method || 'GET', headers: headers, body: opt.body, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' }).then(function (r) {
      if (r.status === 401) { token = null; throw fail('Google\'s permission for this visit ran out. Tap Sync now.', 'expired'); }
      if (!r.ok) return r.text().then(function (t) { var m = ''; try { m = JSON.parse(t).error.message; } catch (e) {} throw fail('Google Drive answered ' + r.status + (m ? ': ' + String(m).slice(0, 160) : '') + '.', 'drive'); });
      return opt.text ? r.text() : r.json();
    });
  }
  function findFile() {
    var q = encodeURIComponent("name = '" + NAME + "' and trashed = false");
    return drive(FILES + '?spaces=appDataFolder&q=' + q + '&fields=files(id,version,modifiedTime)&pageSize=10').then(function (j) {
      var f = (j.files || []).sort(function (a, b) { return String(b.modifiedTime).localeCompare(String(a.modifiedTime)); });
      return f[0] || null;
    });
  }
  function download(id) { return drive(FILES + '/' + encodeURIComponent(id) + '?alt=media', { text: true }); }
  function create(body) {
    var b = 'jarvis' + Math.random().toString(36).slice(2);
    var meta = JSON.stringify({ name: NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
    var data = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + b + '--';
    return drive(UPLOAD + '?uploadType=multipart&fields=id,version,modifiedTime', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: data });
  }
  function update(id, body) { return drive(UPLOAD + '/' + encodeURIComponent(id) + '?uploadType=media&fields=id,version,modifiedTime', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body }); }
  function remove(id) { return drive(FILES + '/' + encodeURIComponent(id), { method: 'DELETE', text: true }); }

  /* ------------------------------------------------------------ this computer's state */
  function device() { var d = ls(LS.dev); if (!d) { d = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); lsSet(LS.dev, d); } return d; }
  function state() {
    var mind = Kin.mind;
    return Promise.resolve(mind && !mind.loaded() ? mind.load() : null).then(function () {
      var local = {}; Object.keys(allowList()).forEach(function (k) { var v = ls(k); if (v != null) local[k] = v; });
      return { local: local, mind: { memory: mind ? mind.memory() : [], made: mind ? mind.made() : [], log: mind ? mind.log() : [] } };
    });
  }
  function fingerprint(st) {
    var parts = Object.keys(st.local).sort().map(function (k) { return k + '=' + C.digest(st.local[k]); });
    ['memory', 'made', 'log'].forEach(function (n) { parts.push(n + ':' + st.mind[n].map(function (x) { return x.id + '@' + (x.at || 0); }).sort().join(',')); });
    return C.digest(parts.join('|'));
  }
  /** Put the merged result on this computer: replace settings, merge the rest, apply deletions that came as tombstones. */
  function applyHere(merged) {
    var allow = allowList(), wrote = 0;
    Object.keys(merged.local).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(allow, k)) return;
      var e = merged.local[k], cur = ls(k);
      if (e.v == null) { if (cur != null) { lsSet(k, null); wrote++; } }
      else if (cur !== e.v) { lsSet(k, e.v); wrote++; }
    });
    var mind = Kin.mind, got = { memory: 0, made: 0, log: 0, removed: 0 };
    if (mind) {
      var r = mind.mergeIn({ memory: merged.mind.memory, made: merged.mind.made, log: merged.mind.log }); got.memory = r.memory; got.made = r.made; got.log = r.log;
      /* only explicit deletions travel: never remove something just because the other side lacks it */
      mind.memory().forEach(function (x) { if (merged.tomb.memory[x.id] && (x.at || 0) <= merged.tomb.memory[x.id]) { mind.forget(x.id); got.removed++; } });
      mind.made().forEach(function (x) { if (merged.tomb.made[x.id] && (x.at || 0) <= merged.tomb.made[x.id]) { mind.dropMade(x.id); got.removed++; } });
      mind.log().forEach(function (x) { if (merged.tomb.log[x.id] && (x.at || 0) <= merged.tomb.log[x.id]) { mind.dropLog(x.id); got.removed++; } });
    }
    got.settings = wrote;
    return Promise.resolve(mind && mind.flush ? mind.flush() : null).then(function () { return got; });
  }

  /* ------------------------------------------------------------ status, for the page */
  var S = { status: 'off', note: '', last: ls(LS.last) || '', busy: false, lastFp: '', timer: null, poll: null };
  var subs = [];
  function set(status, note) { S.status = status; S.note = note || ''; subs.forEach(function (f) { try { f(view()); } catch (e) {} }); }
  function view() { return { status: S.status, note: S.note, last: S.last, enabled: enabled(), unlocked: !!S.key, conflicts: conflicts().length, tokenThisVisit: haveToken(), clientId: !!clientId() }; }
  function enabled() { return !Kin.shared && ls(LS.on) === '1'; }
  function conflicts() { try { var c = JSON.parse(ls(LS.conf) || '[]'); return Array.isArray(c) ? c : []; } catch (e) { return []; } }
  function addConflicts(list) { if (!list.length) return; var all = conflicts().concat(list).slice(-50); lsSet(LS.conf, JSON.stringify(all)); }

  /* ------------------------------------------------------------ one sync */
  function once(attempt) {
    var fp0;
    return Promise.all([state(), kvGet('base'), kvGet('salt')]).then(function (r) {
      var st = r[0], base = r[1] || C.emptyBase(), salt = r[2]; fp0 = fingerprint(st);
      var mine = C.snapshot(st, base, Date.now(), device());
      return findFile().then(function (f) {
        if (!f) return { f: null, theirs: null, mine: mine, base: base, salt: salt };
        return download(f.id).then(function (txt) {
          var env = C.envelope(txt);
          if (salt && env.salt !== salt) throw fail('The sync file in Drive was made with a different passphrase setup. Turn sync off and on again with the passphrase from your other computer.', 'salt');
          return C.open(S.key, txt).then(function (theirs) { return { f: f, theirs: theirs, mine: mine, base: base, salt: env.salt }; });
        });
      });
    }).then(function (x) {
      var m = C.merge(x.mine, x.theirs, x.base, Date.now()), merged = m.merged;
      var text = JSON.stringify(merged);
      if (C.leaks(text, C.secretValues([window.localStorage, window.sessionStorage]))) throw fail('A key or token turned up in what would be synced, so nothing was sent. Remove it from what Jarvis remembers or made, then sync again.', 'leak');
      var unchanged = x.theirs && JSON.stringify(x.theirs) === text;
      var up = unchanged ? Promise.resolve(x.f) : C.seal(S.key, x.salt, merged).then(function (body) {
        /* someone else synced since we read: start over once rather than overwrite their change */
        return (x.f ? findFile() : Promise.resolve(null)).then(function (now) {
          if (x.f && now && String(now.version) !== String(x.f.version)) { if ((attempt || 0) < 2) throw fail('retry', 'race'); throw fail('Another computer kept syncing at the same moment. Tap Sync now again.', 'race-out'); }
          return x.f ? update(x.f.id, body) : create(body);
        });
      });
      return up.then(function () { return applyHere(merged); }).then(function (got) {
        addConflicts(m.conflicts);
        return kvSet('base', C.baseOf(merged)).then(function () {
          S.last = new Date().toISOString(); lsSet(LS.last, S.last);
          return state().then(function (st) { S.lastFp = fingerprint(st); return { got: got, conflicts: m.conflicts.length, uploaded: !unchanged, first: !x.f, changedDuring: fingerprint(st) !== fp0 }; });
        });
      });
    }).catch(function (e) { if (e && e.code === 'race') return once((attempt || 0) + 1); throw e; });
  }
  function run() {
    if (Kin.shared) return sharedFail();
    if (!enabled()) return Promise.reject(fail('Sync is off on this computer.', 'off'));
    if (!S.key) return Promise.reject(fail('Enter your sync passphrase on this computer first.', 'locked'));
    if (!haveToken()) { set('needs-tap', 'Tap Sync now to update.'); return Promise.reject(fail('Tap Sync now: Google asks once per visit.', 'needs-tap')); }
    if (S.busy) return S.busy;
    set('syncing', 'Syncing');
    S.busy = once(0).then(function (r) {
      S.busy = false;
      set(r.conflicts || conflicts().length ? 'conflict' : 'synced', r.conflicts ? r.conflicts + ' change' + (r.conflicts === 1 ? '' : 's') + ' differed between computers; the newer was kept and the other saved below.' : 'Up to date');
      return r;
    }, function (e) { S.busy = false; set(e.code === 'expired' ? 'needs-tap' : 'error', e.message); throw e; });
    return S.busy;
  }

  /* ------------------------------------------------------------ the founder's actions (each needs a real tap) */
  function trusted(ev) { return !!(ev && ev.isTrusted); }
  /** Turn sync on here. ev: the click event; pass: the passphrase; confirm: the passphrase again (first computer only). */
  function turnOn(ev, pass, confirm) {
    if (Kin.shared) return sharedFail();
    if (!trusted(ev)) return Promise.reject(fail('Sync turns on only from a tap.', 'tap'));
    if (!ready()) return Promise.reject(fail('Sync needs this version of Jarvis\'s move-to-another-computer list. Update the page.', 'move'));
    if (!clientId()) return Promise.reject(fail('Add your Google Client ID in Settings, Email first. Sync uses the same one.', 'cid'));
    if (String(pass || '').length < 10) return Promise.reject(fail('Use a sync passphrase of at least 10 characters.', 'short'));
    set('working', 'Asking Google for Jarvis\'s private sync folder');
    return askToken().then(findFile).then(function (f) {
      if (f) {
        /* another computer already syncs: use its salt; a wrong passphrase stops here and changes nothing */
        return download(f.id).then(function (txt) {
          var env = C.envelope(txt);
          return C.deriveKey(pass, env.salt).then(function (key) { return C.open(key, txt).then(function () { return { key: key, salt: env.salt }; }); });
        });
      }
      if (confirm !== undefined && confirm !== pass) throw fail('The two passphrases do not match.', 'mismatch');
      var salt = C.newSalt();
      return C.deriveKey(pass, salt).then(function (key) { return { key: key, salt: salt }; });
    }).then(function (k) {
      S.key = k.key;
      return kvSet('key', k.key).then(function () { return kvSet('salt', k.salt); }).then(function () { return kvSet('base', C.emptyBase()); });
    }).then(function () { lsSet(LS.on, '1'); start(); return run(); }).catch(function (e) { if (!S.key) set('off', e.message); else set('error', e.message); throw e; });
  }
  /** Sync now, from a tap (also asks Google for this visit's permission). */
  function syncNow(ev) {
    if (Kin.shared) return sharedFail();
    if (!trusted(ev)) return Promise.reject(fail('Sync now runs only from a tap.', 'tap'));
    if (!enabled()) return Promise.reject(fail('Sync is off on this computer.', 'off'));
    return loadGis().then(function () { return askToken(); }).then(run);
  }
  /** Turn sync off here. The copy in Drive and this computer's data stay. */
  function turnOff(ev) {
    if (!trusted(ev)) return Promise.reject(fail('Sync turns off only from a tap.', 'tap'));
    stop(); lsSet(LS.on, null); S.key = null; token = null;
    return Promise.all([kvDel('key'), kvDel('salt'), kvDel('base')]).then(function () { set('off', 'Sync is off on this computer. Your data here and the copy in Drive are untouched.'); });
  }
  /** Delete the encrypted copy in Drive (every computer keeps its own data). Needs two taps on the page. */
  function deleteCopy(ev) {
    if (Kin.shared) return sharedFail();
    if (!trusted(ev)) return Promise.reject(fail('The Drive copy is deleted only from a tap.', 'tap'));
    if (!haveToken()) return Promise.reject(fail('Tap Sync now first so Google gives permission for this visit.', 'needs-tap'));
    return findFile().then(function (f) { return f ? remove(f.id) : null; }).then(function () { return kvSet('base', C.emptyBase()); }).then(function () { set('synced', 'The copy in Drive was deleted. Each computer keeps its own data.'); });
  }
  /** Use the other computer's value for a conflicting setting (from a tap). */
  function useOther(ev, i) {
    if (!trusted(ev)) return Promise.reject(fail('Only from a tap.', 'tap'));
    var all = conflicts(), c = all[i]; if (!c) return Promise.resolve(false);
    if (c.type === 'setting' && Object.prototype.hasOwnProperty.call(allowList(), c.key)) lsSet(c.key, c.other);
    all.splice(i, 1); lsSet(LS.conf, JSON.stringify(all));
    set(all.length ? 'conflict' : S.status === 'conflict' ? 'synced' : S.status, S.note);
    if (haveToken()) schedule(1000);
    return Promise.resolve(true);
  }
  function dismiss(ev, i) {
    if (!trusted(ev)) return Promise.reject(fail('Only from a tap.', 'tap'));
    var all = conflicts(); all.splice(i, 1); lsSet(LS.conf, JSON.stringify(all)); set(all.length ? 'conflict' : 'synced', all.length ? S.note : 'Up to date'); return Promise.resolve(true);
  }

  /* ------------------------------------------------------------ automatic syncs during a visit */
  function schedule(ms) {
    clearTimeout(S.timer);
    S.timer = setTimeout(function () { if (enabled() && S.key && haveToken() && !document.hidden) run().catch(function () {}); }, ms == null ? DEBOUNCE : ms);
  }
  /** The app calls this after it saves something; also noticed by a light check every 10 seconds. */
  function touch() { if (enabled() && S.key && haveToken()) schedule(); }
  function start() {
    if (S.poll || Kin.shared) return;
    S.poll = setInterval(function () {
      if (!enabled() || !S.key || document.hidden || S.busy) return;
      state().then(function (st) { var fp = fingerprint(st); if (S.lastFp && fp !== S.lastFp) { S.lastFp = fp; if (haveToken()) schedule(); else set('needs-tap', 'Changed here. Tap Sync now to send it to your other computers.'); } });
    }, POLL);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && enabled() && S.key && haveToken()) schedule(2000); });
  }
  function stop() { clearInterval(S.poll); S.poll = null; clearTimeout(S.timer); }
  /** On open: load the key kept on this computer; sync straight away if this visit already has Google's permission. */
  function boot() {
    if (Kin.shared || !enabled() || !ready()) { set(enabled() ? 'error' : 'off', ''); return Promise.resolve(view()); }
    return kvGet('key').then(function (k) {
      if (!k) { set('locked', 'Enter your sync passphrase on this computer.'); return view(); }
      S.key = k; start(); loadGis();
      return state().then(function (st) { if (!S.lastFp) S.lastFp = fingerprint(st); }).then(function () {
        if (haveToken()) { schedule(0); set('syncing', 'Syncing'); } else set('needs-tap', 'Tap to sync. Google asks once per visit.');
        return view();
      });
    }).catch(function () { set('error', 'This browser would not open its sync storage.'); return view(); });
  }

  /* ------------------------------------------------------------ what syncs, in plain words */
  function disclosure() {
    var labels = []; Object.keys(allowList() || {}).forEach(function (k) { var l = Kin.move.ALLOW[k]; if (labels.indexOf(l) < 0) labels.push(l); });
    return {
      syncs: ['What Jarvis remembers', 'The Made shelf', 'The logbook'].concat(labels),
      never: ['Your Claude key', 'Your ElevenLabs key', 'Your Higgsfield sign-in', 'Your Grok Bot token and its receipts', 'Google sign-ins and your Client ID', 'Your Kin pack (load it on each computer)', 'The conversation', 'Your sync passphrase'],
      where: 'One encrypted file in a hidden folder of your Google Drive that only Jarvis can open. It is locked on this computer with your passphrase before it leaves, so Google stores only scrambled data. If you forget the passphrase the Drive copy cannot be opened, but every computer keeps its own data.'
    };
  }

  /* ------------------------------------------------------------ the settings card (textContent only) */
  function el(t, c, txt) { var e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; }
  function pill(label, kind) { var b = el('button', 'sy-pill ' + (kind || '')); b.type = 'button'; b.textContent = label; return b; }
  var LABEL = { off: 'Off', working: 'Working', locked: 'Needs your passphrase', 'needs-tap': 'Tap to sync', syncing: 'Syncing', synced: 'Up to date', conflict: 'Check differences', error: 'Not synced' };
  function when(iso) { if (!iso) return 'Never synced'; var d = new Date(iso), s = (Date.now() - d) / 1000; return 'Last synced ' + (s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })); }
  /** Build the "Sync across computers" card into a container. Returns a function that removes the listener. */
  function render(box) {
    box.textContent = ''; box.classList.add('sy');
    var head = el('div', 'sy-head'), title = el('h3', 'sy-title', 'Sync across computers'), chip = el('span', 'sy-chip');
    head.appendChild(title); head.appendChild(chip); box.appendChild(head);
    var sub = el('p', 'sy-sub'); box.appendChild(sub);
    var body = el('div', 'sy-body'); box.appendChild(body);
    var d = disclosure();
    var disc = el('details', 'sy-disc'); var sm = el('summary', null, 'What syncs, and what never does'); disc.appendChild(sm);
    var cols = el('div', 'sy-cols');
    [['Syncs', d.syncs, 'yes'], ['Never syncs', d.never, 'no']].forEach(function (c) { var col = el('div', 'sy-col ' + c[2]); col.appendChild(el('div', 'sy-label', c[0])); var ul = el('ul'); c[1].forEach(function (t) { ul.appendChild(el('li', null, t)); }); col.appendChild(ul); cols.appendChild(col); });
    disc.appendChild(cols); disc.appendChild(el('p', 'sy-where', d.where)); box.appendChild(disc);
    var msg = el('p', 'sy-msg'); msg.setAttribute('role', 'status'); box.appendChild(msg);

    function say(t, bad) { msg.textContent = t || ''; msg.classList.toggle('bad', !!bad); }
    function draw(v) {
      v = v || view();
      chip.textContent = LABEL[v.status] || v.status; chip.className = 'sy-chip ' + (v.status === 'synced' ? 'ok' : v.status === 'conflict' || v.status === 'error' ? 'warn' : v.status === 'syncing' || v.status === 'working' ? 'live' : '');
      body.textContent = '';
      if (Kin.shared) { sub.textContent = Kin.SHARED_TEXT || 'Sync is off at this address.'; return; }
      if (!v.enabled) {
        sub.textContent = 'Keep what Jarvis remembers, makes and is set to the same on every computer, through your Google Drive. Off until you turn it on.';
        if (!v.clientId) { body.appendChild(el('p', 'sy-note', 'Sync uses the Google Client ID from Settings, Email. Add it there first, then come back.')); return; }
        var p1 = el('input', 'sy-input'); p1.type = 'password'; p1.autocomplete = 'off'; p1.placeholder = 'Sync passphrase (10+ characters)'; p1.setAttribute('aria-label', 'Sync passphrase');
        var p2 = el('input', 'sy-input'); p2.type = 'password'; p2.autocomplete = 'off'; p2.placeholder = 'Same passphrase again'; p2.setAttribute('aria-label', 'Sync passphrase again');
        var go = pill('Turn on sync', 'primary');
        body.appendChild(p1); body.appendChild(p2); body.appendChild(el('p', 'sy-note', 'The second box is only needed on your first computer. On the others, use the same passphrase. It is never stored or sent; this computer keeps only a locked key made from it.')); body.appendChild(go);
        go.addEventListener('click', function (ev) {
          go.disabled = true; say('');
          turnOn(ev, p1.value, p2.value || undefined).then(function () { p1.value = ''; p2.value = ''; say('Sync is on.'); }, function (e) { say(e.message, true); }).then(function () { go.disabled = false; draw(); });
        });
        return;
      }
      sub.textContent = when(v.last) + (v.note ? ' · ' + v.note : '');
      if (!v.unlocked) {
        var p = el('input', 'sy-input'); p.type = 'password'; p.autocomplete = 'off'; p.placeholder = 'Sync passphrase'; p.setAttribute('aria-label', 'Sync passphrase');
        var un = pill('Unlock', 'primary'); body.appendChild(p); body.appendChild(un);
        un.addEventListener('click', function (ev) { un.disabled = true; turnOn(ev, p.value).then(function () { p.value = ''; say('Unlocked.'); }, function (e) { say(e.message, true); }).then(function () { un.disabled = false; draw(); }); });
        return;
      }
      var row = el('div', 'sy-row'), now = pill(v.status === 'syncing' ? 'Syncing…' : 'Sync now', 'primary'), off = pill('Turn off here', 'ghost');
      now.disabled = v.status === 'syncing';
      row.appendChild(now); row.appendChild(off); body.appendChild(row);
      now.addEventListener('click', function (ev) { now.disabled = true; say(''); syncNow(ev).then(function (r) { say(r.uploaded || r.got.memory || r.got.made || r.got.log || r.got.settings || r.got.removed ? 'Synced: ' + [r.got.memory && r.got.memory + ' memories', r.got.made && r.got.made + ' made', r.got.log && r.got.log + ' log entries', r.got.settings && r.got.settings + ' settings', r.got.removed && r.got.removed + ' removed'].filter(Boolean).join(', ') + (r.uploaded ? (r.got.memory || r.got.made || r.got.log || r.got.settings || r.got.removed ? '; ' : '') + 'changes from here sent' : '') + '.' : 'Already up to date.'); }, function (e) { say(e.message, true); }).then(function () { draw(); }); });
      var armed = false;
      off.addEventListener('click', function (ev) { if (!armed) { armed = true; off.textContent = 'Tap again to turn off'; setTimeout(function () { armed = false; off.textContent = 'Turn off here'; }, 6000); return; } turnOff(ev).then(function () { say('Sync is off on this computer.'); draw(); }); });
      var cf = conflicts();
      if (cf.length) {
        var list = el('div', 'sy-conf'); list.appendChild(el('div', 'sy-label', 'Different on your other computer'));
        cf.forEach(function (c, i) {
          var r = el('div', 'sy-crow');
          var t = el('div', 'sy-ctext');
          if (c.type === 'setting') { t.appendChild(el('div', 'sy-cname', c.label)); var ov = c.other == null ? '(cleared)' : /^[\[{]/.test(c.other) ? 'a different set of choices' : String(c.other).slice(0, 80); t.appendChild(el('div', 'sy-cval', 'Kept the newer value. From ' + c.otherFrom + ': ' + ov + '.')); }
          else { t.appendChild(el('div', 'sy-cname', c.title)); t.appendChild(el('div', 'sy-cval', 'Changed on both computers. Both versions are on your Made shelf; the older is marked "(other computer)".')); }
          r.appendChild(t);
          var acts = el('div', 'sy-cacts');
          if (c.type === 'setting') { var u = pill('Use the other', 'ghost'); u.addEventListener('click', function (ev) { useOther(ev, i).then(function () { draw(); }); }); acts.appendChild(u); }
          var k = pill('OK', 'ghost'); k.addEventListener('click', function (ev) { dismiss(ev, i).then(function () { draw(); }); }); acts.appendChild(k);
          r.appendChild(acts); list.appendChild(r);
        });
        body.appendChild(list);
      }
      var del = el('button', 'sy-link', 'Delete the copy in Drive'); del.type = 'button'; var dArm = false;
      del.addEventListener('click', function (ev) { if (!dArm) { dArm = true; del.textContent = 'Tap again to delete the Drive copy (each computer keeps its data)'; setTimeout(function () { dArm = false; del.textContent = 'Delete the copy in Drive'; }, 6000); return; } deleteCopy(ev).then(function () { say('The copy in Drive was deleted.'); }, function (e) { say(e.message, true); }).then(function () { draw(); }); });
      body.appendChild(del);
    }
    var sub2 = function (v) { draw(v); }; subs.push(sub2); draw();
    return function () { subs = subs.filter(function (f) { return f !== sub2; }); };
  }

  Kin.sync = { boot: boot, turnOn: turnOn, turnOff: turnOff, syncNow: syncNow, deleteCopy: deleteCopy, useOther: useOther, dismiss: dismiss, touch: touch,
    view: view, conflicts: conflicts, disclosure: disclosure, render: render, onChange: function (f) { subs.push(f); return function () { subs = subs.filter(function (g) { return g !== f; }); }; },
    SCOPE: SCOPE, NAME: NAME, wipe: function () { stop(); S.key = null; token = null; ['on', 'dev', 'last', 'conf'].forEach(function (k) { try { localStorage.removeItem(LS[k]); } catch (e) {} }); return Promise.all([kvDel('key'), kvDel('salt'), kvDel('base')]); } };
})();
