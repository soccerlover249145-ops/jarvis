/* move.js: move what Jarvis has learned and made on this device to another computer, as one file.
   Export: an explicit allow-list of this page's own settings, plus memory, the Made shelf and the logbook.
   Keys, tokens, sign-ins and bridge receipts are never on the list, and the file is checked for every saved
   secret before it is offered. Nothing is uploaded: the file is handed to the browser to save.
   Import: the file is read and checked here, a preview says what would change, and nothing changes until a tap.
   Settings are replaced; memory, the Made shelf and the logbook are merged without duplicates.
   At a shared or plain-http address (guard.js) nothing is read or written. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};

  var KIND = 'kin-device', VERSION = 1, MAX_BYTES = 20 * 1024 * 1024, MAX_VALUE = 4 * 1024 * 1024;
  /* what may move, by name; anything not named here stays on this device */
  var ALLOW = {
    'kin.wake': 'Wake phrase', 'kin.vmode': 'Backup voice', 'kin.voice': 'Backup voice',
    'kin.tts.voice': 'Voice choice', 'kin.tts.voiceName': 'Voice choice', 'kin.tts.model': 'Voice model',
    'kin.bb.settings': 'Morning brief settings', 'kin.bb.ticks': 'Brief priorities ticked', 'kin.bb.started': 'Brief jobs started today',
    'kin.away': 'Away mode and both contact lists', 'kin.calls': 'Calls settings and booking name',
    'kin.gauntlet': 'Last Gauntlet results', 'kin.gauntlet.cap': 'Gauntlet budget cap',
    'kin.place': 'Weather place', 'kin.units': 'Weather units',
    'kin.limH': 'Hourly question limit', 'kin.limD': 'Daily question limit', 'kin.webcap': 'Daily web search limit'
  };
  var OPTIONAL = { 'kin.turns': 'Recent conversation' };
  var JSONISH = { 'kin.bb.settings': 1, 'kin.bb.ticks': 1, 'kin.bb.started': 1, 'kin.away': 1, 'kin.calls': 1, 'kin.gauntlet': 1, 'kin.turns': 1 };
  /* where secrets live, only so the export can be checked for them */
  var SECRET_KEYS = /^kin\.(key|tts\.key|hf\..*|gb\.tok|gb\.jobs)$/;

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fail(msg) { var e = new Error(msg); e.plain = true; return e; }

  /** every secret value saved in this browser, and the bridge's receipt handles inside its job list */
  function secrets() {
    var out = [];
    [window.localStorage, window.sessionStorage].forEach(function (st) {
      try {
        for (var i = 0; i < st.length; i++) {
          var k = st.key(i); if (!SECRET_KEYS.test(k)) continue;
          var v = st.getItem(k); if (!v) continue;
          if (k === 'kin.gb.jobs') { try { (JSON.parse(v) || []).forEach(function (j) { if (j && typeof j.h === 'string' && j.h.length >= 8) out.push(j.h); }); } catch (e) {} }
          else if (v.length >= 8) out.push(v);
          try { var o = JSON.parse(v); if (o && typeof o === 'object') Object.keys(o).forEach(function (x) { if (typeof o[x] === 'string' && o[x].length >= 12) out.push(o[x]); }); } catch (e) {}
        }
      } catch (e) {}
    });
    return out;
  }
  var KEYISH = /sk-ant-[A-Za-z0-9_-]{10,}|\bsk_[A-Za-z0-9]{24,}|\bxi-[A-Za-z0-9]{16,}|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/;

  /** Build the export. opts.turns adds the recent conversation (off by default). */
  function build(opts) {
    if (Kin.shared) return Promise.reject(fail(Kin.SHARED_TEXT));
    var mind = Kin.mind;
    return Promise.resolve(mind && !mind.loaded() ? mind.load() : null).then(function () {
      var local = {}, names = Object.keys(ALLOW).concat(opts && opts.turns ? Object.keys(OPTIONAL) : []);
      names.forEach(function (k) { var v = ls(k); if (v != null && v.length <= MAX_VALUE) local[k] = v; });
      var file = { kind: KIND, version: VERSION, exported: new Date().toISOString(), local: local,
        mind: { memory: mind ? mind.memory() : [], made: mind ? mind.made() : [], log: mind ? mind.log() : [] } };
      var text = JSON.stringify(file);
      var leak = secrets().some(function (s) { return text.indexOf(s) >= 0; }) || KEYISH.test(text);
      if (leak) throw fail('A key or token turned up in what would be saved, so nothing was saved. Remove it from what Kin remembers or made, then try again.');
      if (text.length > MAX_BYTES) throw fail('This device holds more than 20 MB to move. Remove some large pieces from the Made shelf first.');
      return { text: text, name: 'kin-device-' + today() + '.json', counts: { settings: Object.keys(local).length, memory: file.mind.memory.length, made: file.mind.made.length, log: file.mind.log.length, turns: !!local['kin.turns'] } };
    });
  }
  function exportNow(opts) {
    return build(opts).then(function (r) {
      if (!Kin.mind.download(r.name, r.text, 'application/json')) throw fail('This browser would not save the file.');
      return r;
    });
  }

  /** Read and check a file from another device; returns a plan to preview. Changes nothing. */
  function read(file) {
    if (Kin.shared) return Promise.reject(fail(Kin.SHARED_TEXT));
    if (!file) return Promise.reject(fail('No file was picked.'));
    if (file.size > MAX_BYTES) return Promise.reject(fail('That file is larger than 20 MB.'));
    return file.text().then(function (txt) {
      var raw; try { raw = JSON.parse(txt); } catch (e) { throw fail('That file is not valid JSON.'); }
      if (!raw || typeof raw !== 'object' || raw.kind !== KIND) throw fail(raw && raw.kind === 'kin-pack' ? 'That is a Kin pack. Import it under Brain & keys, Kin pack.' : 'That file is not a Jarvis device file.');
      if (raw.version !== VERSION) throw fail('This device file is version ' + String(raw.version).slice(0, 10) + '. This page reads version ' + VERSION + '.');
      var local = {}, rejected = 0, src = raw.local && typeof raw.local === 'object' && !Array.isArray(raw.local) ? raw.local : {};
      Object.keys(src).forEach(function (k) {
        var v = src[k];
        if (!ALLOW[k] && !OPTIONAL[k]) { rejected++; return; }
        if (typeof v !== 'string' || v.length > MAX_VALUE) { rejected++; return; }
        if (JSONISH[k]) { try { var o = JSON.parse(v); if (!o || typeof o !== 'object') throw 0; } catch (e) { rejected++; return; } }
        else if (v.length > 400) { rejected++; return; }
        local[k] = v;
      });
      var m = raw.mind && typeof raw.mind === 'object' ? raw.mind : {};
      var inc = { memory: Array.isArray(m.memory) ? m.memory : [], made: Array.isArray(m.made) ? m.made : [], log: Array.isArray(m.log) ? m.log : [] };
      var mind = Kin.mind;
      return Promise.resolve(mind && !mind.loaded() ? mind.load() : null).then(function () {
        var norm = function (t) { return Kin.ears ? Kin.ears.norm(String(t || '')) : String(t || '').toLowerCase(); };
        var memHave = {}, madeHave = {}, logHave = {};
        if (mind) { mind.memory().forEach(function (x) { memHave[norm(x.text)] = 1; }); mind.made().forEach(function (x) { madeHave[x.id] = x; }); mind.log().forEach(function (x) { logHave[x.id] = 1; }); }
        var newMem = inc.memory.filter(function (x) { return x && typeof x.text === 'string' && x.text.trim() && !memHave[norm(x.text)]; }).length;
        var newMade = inc.made.filter(function (x) { if (!x || !/^(document|plan|table|design|chart)$/.test(x.kind)) return false; return typeof x.id === 'string' && madeHave[x.id] ? (madeHave[x.id].at || 0) < (x.at || 0) : true; }).length;
        var newLog = inc.log.filter(function (x) { return x && !logHave[x.id]; }).length;
        var replaced = [], added = [];
        Object.keys(local).forEach(function (k) { var label = ALLOW[k] || OPTIONAL[k]; var list = ls(k) != null ? replaced : added; if (list.indexOf(label) < 0) list.push(label); });
        return { local: local, mind: inc, exported: typeof raw.exported === 'string' ? raw.exported.slice(0, 40) : '', rejected: rejected,
          preview: { replaced: replaced, added: added, memory: newMem, made: newMade, log: newLog, turns: !!local['kin.turns'] } };
      });
    });
  }

  /** Apply a checked plan: replace the named settings, merge the rest. Only from a tap. */
  function apply(plan) {
    if (Kin.shared) return Promise.reject(fail(Kin.SHARED_TEXT));
    if (!plan || !plan.local) return Promise.reject(fail('Nothing to apply.'));
    var wrote = 0;
    Object.keys(plan.local).forEach(function (k) { if (!ALLOW[k] && !OPTIONAL[k]) return; try { localStorage.setItem(k, plan.local[k]); wrote++; } catch (e) {} });
    var got = Kin.mind ? Kin.mind.mergeIn(plan.mind) : { memory: 0, made: 0, log: 0, refused: 0 };
    return (Kin.mind ? Kin.mind.flush() : Promise.resolve()).then(function () { return { settings: wrote, memory: got.memory, made: got.made, log: got.log, refused: got.refused }; });
  }

  Kin.move = { build: build, exportNow: exportNow, read: read, apply: apply, ALLOW: ALLOW, OPTIONAL: OPTIONAL, JSONISH: JSONISH, MAX_BYTES: MAX_BYTES };
})();
