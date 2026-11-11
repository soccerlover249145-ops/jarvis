/* pack.js: what Kin knows. A "Kin pack" is one JSON file exported from the Atlas.
   It is kept in this browser (IndexedDB) and never leaves the device except as
   context in the requests this device makes to the Anthropic API.

   Pack shape (version 1):
   {
     "kind": "kin-pack", "version": 1,
     "name": "…",                    // shown in the top bar
     "exported": "2026-11-10T19:00:00Z",
     "rules": "…",                   // Kin's standing rules, plain text
     "brief": "…",                   // a few lines every answer may lean on
     "stats": { "label": value, … }, // small numbers for the spoken brief
     "skills": [ { "id", "name", "when", "body" } ],
     "nodes":  [ { "id", "p": parentId|null, "t": title, "k": kind,
                   "s": summary, "f": [facts], "st": status, "d": "YYYY-MM-DD"|null } ]
   } */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var DB = 'kin', STORE = 'kv', pack = null, index = [];

  function open() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no storage'));
      var rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error || new Error('storage failed')); };
    });
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode), out = fn(t.objectStore(STORE));
        t.oncomplete = function () { db.close(); res(out && out.result); };
        t.onerror = t.onabort = function () { db.close(); rej(t.error || new Error('storage failed')); };
      });
    });
  }
  var kv = {
    get: function (k) { return tx('readonly', function (s) { return s.get(k); }); },
    set: function (k, v) { return tx('readwrite', function (s) { return s.put(v, k); }); },
    del: function (k) { return tx('readwrite', function (s) { return s.delete(k); }); },
    wipe: function () { return new Promise(function (res) { try { var rq = indexedDB.deleteDatabase(DB); rq.onsuccess = rq.onerror = rq.onblocked = function () { res(); }; } catch (e) { res(); } }); }
  };

  function words(s) { return String(s || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9#]+/g, ' ').trim().split(' ').filter(function (w) { return w.length > 1; }); }
  var STOP = { the: 1, and: 1, for: 1, what: 1, whats: 1, is: 1, are: 1, of: 1, to: 1, in: 1, on: 1, me: 1, my: 1, about: 1, tell: 1, show: 1, with: 1, do: 1, we: 1, it: 1, this: 1, that: 1, how: 1, when: 1, who: 1, sir: 1 };

  function build() {
    index = [];
    if (!pack) return;
    (pack.nodes || []).forEach(function (n, i) {
      index.push({ i: i, t: words(n.t), s: words((n.s || '') + ' ' + (n.f || []).join(' ') + ' ' + (n.k || '') + ' ' + (n.st || '')) });
    });
  }

  /** Check a parsed file is a pack and trim anything unexpected. Throws with a plain message. */
  function clean(raw) {
    if (!raw || typeof raw !== 'object' || raw.kind !== 'kin-pack') throw new Error('That file is not a Kin pack.');
    if (raw.version !== 1) throw new Error('This pack is version ' + raw.version + '. This page reads version 1.');
    var str = function (v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; };
    var obj = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };
    /* a handful of plain numbers or short words, nothing nested: they are sent with every question */
    var stats = function (v) { var out = {}; if (!obj(v)) return out; Object.keys(v).slice(0, 40).forEach(function (k) { var x = v[k]; if (typeof x === 'number' && isFinite(x)) out[k.slice(0, 60)] = x; else if (typeof x === 'string') out[k.slice(0, 60)] = x.slice(0, 80); }); return out; };
    var nodes = Array.isArray(raw.nodes) ? raw.nodes.slice(0, 20000) : [];
    return {
      kind: 'kin-pack', version: 1, name: str(raw.name, 60) || 'Kin pack', exported: str(raw.exported, 40),
      rules: str(raw.rules, 60000), brief: str(raw.brief, 6000),
      stats: stats(raw.stats),
      skills: (Array.isArray(raw.skills) ? raw.skills.slice(0, 200) : []).filter(obj).map(function (s) { return { id: str(s.id, 60), name: str(s.name, 80), when: str(s.when, 300), body: str(s.body, 8000) }; }),
      nodes: nodes.filter(obj).map(function (n) {
        return { id: str(n.id, 120), p: n.p == null ? null : str(n.p, 120), t: str(n.t, 200), k: str(n.k, 30), s: str(n.s, 1200),
          f: (Array.isArray(n.f) ? n.f.slice(0, 24) : []).map(function (x) { return str(x, 300); }), st: str(n.st, 30), d: /^\d{4}-\d{2}-\d{2}$/.test(n.d || '') ? n.d : null };
      }).filter(function (n) { return n.id && n.t; })
    };
  }

  Kin.pack = {
    get: function () { return pack; },
    load: function () { if (Kin.shared) return Promise.resolve(null); return kv.get('pack').then(function (p) { pack = p || null; build(); return pack; }).catch(function () { pack = null; return null; }); },
    importFile: function (file) {
      if (Kin.shared) return Promise.reject(new Error(Kin.SHARED_TEXT));
      if (file.size > 30 * 1024 * 1024) return Promise.reject(new Error('That file is larger than 30 MB.'));
      return file.text().then(function (txt) {
        var raw; try { raw = JSON.parse(txt); } catch (e) { throw new Error('That file is not valid JSON.'); }
        var p = clean(raw); return kv.set('pack', p).then(function () { pack = p; build(); return p; });
      });
    },
    remove: function () { return kv.del('pack').then(function () { pack = null; build(); }); },
    /** best matches for a few words: title hits count most */
    search: function (query, limit) {
      var q = words(query).filter(function (w) { return !STOP[w]; }), out = [];
      if (!pack || !q.length) return out;
      index.forEach(function (e) {
        var sc = 0;
        q.forEach(function (w) {
          if (e.t.indexOf(w) >= 0) sc += 5; else if (e.t.some(function (x) { return x.indexOf(w) === 0; })) sc += 3;
          if (e.s.indexOf(w) >= 0) sc += 1.5; else if (e.s.some(function (x) { return x.indexOf(w) === 0; })) sc += 0.7;
        });
        if (sc > 0) out.push({ n: pack.nodes[e.i], sc: sc / Math.sqrt(4 + e.t.length) });
      });
      out.sort(function (a, b) { return b.sc - a.sc; });
      return out.slice(0, limit || 6).map(function (o) { return o.n; });
    },
    node: function (id) { if (!pack) return null; for (var i = 0; i < pack.nodes.length; i++) if (pack.nodes[i].id === id) return pack.nodes[i]; return null; },
    kids: function (id) { return pack ? pack.nodes.filter(function (n) { return n.p === id; }) : []; },
    /** dated things from today forward, soonest first */
    dates: function (days) {
      if (!pack) return [];
      var now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), t1 = t0 + (days || 14) * 864e5;
      return pack.nodes.filter(function (n) { if (!n.d || /^(done|archived|cancelled)$/.test(n.st)) return false; var t = new Date(n.d + 'T00:00:00').getTime(); return t >= t0 && t <= t1; })
        .sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    },
    kv: kv, words: words
  };

  /** "Fri Nov 13" from "2026-11-13"; spoken form "Friday the thirteenth of November" is left to the voice */
  Kin.day = function (iso) { var d = new Date(iso + 'T00:00:00'); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getDate(); };
  Kin.daysTo = function (iso) { var now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); return Math.round((new Date(iso + 'T00:00:00').getTime() - t0) / 864e5); };
})();
