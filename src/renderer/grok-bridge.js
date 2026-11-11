/* grok-bridge.js: ask the founder's own Grok Bot a question, through the founder's relay.

   Phase one is request and reply, on the founder's explicit say-so only ("ask Grok Bot ..."):
     1. POST /v1/requests to the relay with a fresh UUID, the question and nothing else unless the founder
        picked pack excerpts for it. The relay files it in a private mailbox and wakes Grok Bot.
     2. POST /v1/result with the signed receipt ("handle") until Grok Bot's reply is there.
   Nothing here talks to Claude. A reply is shown as text, labelled Grok Bot, and is never fed back in as
   a question, so nothing can bounce between the two on its own.

   What is kept on this device:
     - the device token: for this browser tab session only, unless the founder ticks "keep on this device";
     - the receipts (handles) and the founder's own questions and Grok Bot's replies, so a wait can resume
       after the page is reopened. They are never put in an address, a log, the conversation sent to Claude
       or anything spoken. Erase everything removes all of it.
   Nothing is kept at an address shared with another site, over plain http or inside a frame (guard.js). */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var DEFAULT_RELAY = 'https://jarvis-relay-next-of-kin.vercel.app';
  var K = { on: 'kin.gb.on', url: 'kin.gb.url', keep: 'kin.gb.keep', tok: 'kin.gb.tok', jobs: 'kin.gb.jobs', ctx: 'kin.gb.ctx' };
  var TERMINAL = { answered: 1, needs_owner_approval: 1, error: 1 };
  var MAX_MSG = 4000, MAX_CTX = 8, MAX_CTX_LEN = 1000, MAX_BODY = 8192, MAX_REPLY = 8000, KEEP_DAYS = 7, MAX_JOBS = 12;
  var T = function (k, d) { var v = Kin.T && Kin.T[k]; return typeof v === 'number' ? v : d; };

  var ls = {
    get: function (k) { if (Kin.shared) return null; try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { if (Kin.shared) return false; try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var ss = {
    get: function (k) { if (Kin.shared) return null; try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { if (Kin.shared) return false; try { sessionStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  };

  var subs = [], timers = {}, live = {};
  function emit(job, extra) { var ev = Object.assign({ type: 'job', job: view(job) }, extra || {}); subs.forEach(function (f) { try { f(ev); } catch (e) {} }); }
  /** what the page may show of a job: never the handle */
  function view(j) { return j && { id: j.id, q: j.q, st: j.st, ds: j.ds, reply: j.reply || '', err: j.err || '', retryAt: j.retryAt || 0, at: j.at, exp: j.exp || '', ctx: j.ctx || 0, waiting: !!timers[j.id], local: j.local || '', here: !!live[j.id], seen: !!j.seen }; }

  /* ---------------------------------------------------------------- settings */
  function available() { return !Kin.shared && typeof fetch === 'function' && !!(window.crypto && (crypto.randomUUID || crypto.getRandomValues)); }
  function enabled() { return available() && ls.get(K.on) === '1'; }
  function setEnabled(on) { if (!available()) return false; if (on) ls.set(K.on, '1'); else { ls.del(K.on); stopAll(); } return enabled(); }
  function relay() { var u = ls.get(K.url); return u || DEFAULT_RELAY; }
  /** only a bare https origin is accepted: no path, no query, no credentials in the address */
  function setRelay(url) {
    url = String(url || '').trim().replace(/\/+$/, '');
    if (!url) { ls.del(K.url); return { ok: true, url: DEFAULT_RELAY }; }
    var u; try { u = new URL(url); } catch (e) { return { ok: false, why: 'That is not a web address.' }; }
    if (u.protocol !== 'https:') return { ok: false, why: 'The relay must be an https address.' };
    if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) return { ok: false, why: 'Give only the relay’s base address, like ' + DEFAULT_RELAY + '.' };
    if (u.origin === DEFAULT_RELAY) ls.del(K.url); else ls.set(K.url, u.origin);
    return { ok: true, url: u.origin, other: u.origin !== DEFAULT_RELAY };
  }
  function kept() { return ls.get(K.keep) === '1'; }
  function token() { return kept() ? ls.get(K.tok) : ss.get(K.tok); }
  function hasToken() { return !!token(); }
  /** The device token. It is checked for shape only here; the relay decides whether it is valid. */
  function setToken(tok, keep) {
    if (!available()) return { ok: false, why: 'shared' };
    tok = String(tok || '').trim();
    if (tok.length < 32 || tok.length > 512 || !/^[A-Za-z0-9._~+\/=-]+$/.test(tok)) return { ok: false, why: 'shape' };
    dropToken();
    if (keep) { ls.set(K.keep, '1'); if (!ls.set(K.tok, tok)) return { ok: false, why: 'storage' }; }
    else { ls.del(K.keep); if (!ss.set(K.tok, tok)) return { ok: false, why: 'storage' }; }
    return { ok: true };
  }
  function dropToken() { ls.del(K.tok); ss.del(K.tok); ls.del(K.keep); }
  function ctxOn() { return ls.get(K.ctx) === '1'; }
  function setCtx(on) { if (on) ls.set(K.ctx, '1'); else ls.del(K.ctx); return ctxOn(); }

  /* ---------------------------------------------------------------- jobs kept on this device */
  function load() { var a; try { a = JSON.parse(ls.get(K.jobs) || '[]'); } catch (e) { a = []; } if (!Array.isArray(a)) a = []; var cut = Date.now() - KEEP_DAYS * 864e5; return a.filter(function (j) { return j && j.id && j.at > cut; }); }
  var jobs = load();
  function save() { jobs = jobs.slice(-MAX_JOBS); ls.set(K.jobs, JSON.stringify(jobs)); }
  function find(id) { for (var i = 0; i < jobs.length; i++) if (jobs[i].id === id) return jobs[i]; return null; }
  function pending() { return jobs.filter(function (j) { return !TERMINAL[j.st] && j.h; }); }

  /* ---------------------------------------------------------------- the deterministic intent
     Only a sentence that begins by addressing Grok Bot counts. "I was going to ask Grok Bot" does not.
     Speech recognisers write the name a few ways, so those are accepted too. */
  var NAME = 'gr(?:o|ou|a)(?:k|ck|c|q|g)(?:\\s*-?\\s*bot)?';
  var ASK = new RegExp('^(?:(?:hey|ok|okay|yo)\\s+)?(?:(?:jarvis|kin)[,!.:]?\\s+)?(?:please\\s+|can you\\s+|could you\\s+|go\\s+)?(?:ask|tell|message|text|check with)\\s+(?:my\\s+)?' + NAME + '\\b[\\s,:;.\\-]*(.*)$', 'i');
  var ADDRESS = new RegExp('^(?:hey\\s+)?' + NAME + '\\s*[,:]\\s*(.+)$', 'i');
  /** null when the words are not for Grok Bot; otherwise { q } with the question (possibly empty) */
  function intent(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim(); if (!t) return null;
    var m = ASK.exec(t) || ADDRESS.exec(t); if (!m) return null;
    var q = (m[1] || '').trim().replace(/^(?:to|whether|if|about)\s+/i, function (w) { return /^to\s/i.test(w) ? '' : w; }).trim();
    return { q: q };
  }
  /** words from a reply that must never be spoken back, so an open mic cannot hear Kin ask Grok Bot something */
  function unaddress(text) { return String(text || '').replace(new RegExp('\\b(?:ask|tell|message|text|check with)\\s+(?:my\\s+)?' + NAME + '\\b', 'gi'), 'Grok Bot').replace(new RegExp('^\\s*' + NAME + '\\s*[,:]', 'i'), ''); }

  /* ---------------------------------------------------------------- talking to the relay */
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID().toLowerCase();
    var b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function bytes(s) { return new TextEncoder().encode(s).length; }
  /** POST JSON with the device token; no cookies, nothing cached, the token only in the Authorization header */
  function post(path, body, ms) {
    var tok = token(); if (!tok) return Promise.resolve({ net: false, status: 0, code: 'no_token' });
    var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, ms);
    return fetch(relay() + path, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal })
      .then(function (r) {
        clearTimeout(tm);
        var ra = parseFloat(r.headers.get('Retry-After')); ra = isFinite(ra) && ra >= 0 ? Math.min(ra, 3600) * 1000 : 0;
        return r.text().then(function (txt) { var j = null; if (txt && txt.length < 64000) { try { j = JSON.parse(txt); } catch (e) {} } return { net: true, status: r.status, j: j, retry: ra }; });
      }, function (e) { clearTimeout(tm); return { net: false, status: 0, code: ctl.signal.aborted ? 'timeout' : 'network' }; });
  }
  var REASON = {
    no_token: 'There is no device token on this device. Paste it in Settings > Grok Bot bridge.',
    token: 'The relay refused the device token (it is missing, wrong or revoked). Paste a new one in Settings > Grok Bot bridge.',
    forbidden: 'The relay refused this request: the receipt or this device is not allowed to read it.',
    gone: 'That receipt has expired, so the answer can no longer be read from here.',
    conflict: 'The relay already holds a different question under this request, or does not know whether it was registered. I have not resent anything. Check with Grok Bot in its own chat.',
    too_big: 'That was too long for the bridge. Ask a shorter question.',
    bad: 'The relay did not accept the request.',
    disabled: 'The bridge is switched off on the relay.',
    not_configured: 'The relay is not set up yet.',
    busy: 'The relay is busy.',
    rate: 'Grok Bot takes one question at a time through the bridge.',
    unknown: 'I could not tell whether the relay received it. I have not resent it. You can send it again safely: it is the same request, so it cannot be delivered twice.',
    unreachable: 'The relay could not be reached.',
    malformed: 'The relay sent back something I could not read, so I am not showing it.',
    mismatch: 'An answer arrived for a different question, so I am not showing it.',
    window: 'Stopped waiting after ten minutes. Grok Bot may still answer. Tap Resume to check.',
    stopped: 'Stopped waiting here. A run Grok Bot already started may still finish. Tap Resume to check.',
    expired: 'Grok Bot did not answer before the request expired.'
  };
  function httpCode(r) {
    if (r.status === 401) return 'token'; if (r.status === 403) return 'forbidden'; if (r.status === 410) return 'gone'; if (r.status === 409) return 'conflict';
    if (r.status === 413) return 'too_big'; if (r.status === 429) return 'rate';
    if (r.status === 503) { var e = r.j && r.j.error; return e === 'bridge_disabled' ? 'disabled' : e === 'bridge_not_configured' ? 'not_configured' : 'busy'; }
    return 'bad';
  }

  /** Send a question. context: pack excerpts the founder chose for this question, or none. Never resends by itself. */
  function submit(q, context, again) {
    if (!enabled()) return Promise.resolve({ ok: false, code: 'off' });
    if (!hasToken()) return Promise.resolve({ ok: false, code: 'no_token' });
    q = String(q || '').trim(); if (!q) return Promise.resolve({ ok: false, code: 'empty' });
    if (q.length > MAX_MSG) return Promise.resolve({ ok: false, code: 'too_big' });
    var busy = pending().filter(function (j) { return j.id !== again; });
    if (busy.length) return Promise.resolve({ ok: false, code: 'in_flight', job: view(busy[0]) });
    var ctx = (context || []).filter(function (s) { return typeof s === 'string' && s.trim(); }).slice(0, MAX_CTX).map(function (s) { return s.slice(0, MAX_CTX_LEN); });
    var j = again ? find(again) : null;
    if (!j) { j = { id: uuid(), q: q, ctx: ctx.length, at: Date.now(), st: 'sending', ds: '', h: '', reply: '', err: '' }; jobs.push(j); }
    else { q = j.q; ctx = j.ctxv || []; j.err = ''; j.st = 'sending'; }
    var body = { version: 1, request_id: j.id, message: q, context: ctx };
    while (bytes(JSON.stringify(body)) > MAX_BODY && body.context.length) body.context.pop();
    if (bytes(JSON.stringify(body)) > MAX_BODY) { j.st = 'error'; j.local = 'too_big'; j.err = REASON.too_big; save(); emit(j); return Promise.resolve({ ok: false, code: 'too_big', job: view(j) }); }
    j.ctx = body.context.length; j.ctxv = body.context; save(); live[j.id] = true; emit(j);
    return post('/v1/requests', body, T('gbSubmit', 20000)).then(function (r) {
      if (!r.net) { j.st = 'unknown'; j.local = r.code === 'no_token' ? 'no_token' : 'unknown'; j.err = REASON[j.local]; save(); emit(j); return { ok: false, code: j.local, job: view(j) }; }
      if (r.status === 202 && r.j && r.j.version === 1 && r.j.request_id === j.id && typeof r.j.handle === 'string' && r.j.handle) {
        j.h = r.j.handle; j.st = r.j.status === 'accepted' ? 'accepted' : 'queued'; j.ds = String(r.j.dispatch_status || ''); j.exp = String(r.j.expires_at || ''); j.local = '';
        j.err = /^(unknown|retryable_failure)$/.test(j.ds) ? 'The relay saved it but could not confirm Grok Bot started (' + j.ds.replace('_', ' ') + '). I will keep checking for an answer; I will not resend it.' : '';
        delete j.ctxv; save(); emit(j); poll(j.id, r.j.poll_after_ms); return { ok: true, job: view(j) };
      }
      if (r.status === 202) { j.st = 'unknown'; j.local = 'malformed'; j.err = REASON.malformed + ' ' + REASON.unknown; save(); emit(j); return { ok: false, code: 'malformed', job: view(j) }; }
      var c = httpCode(r); j.st = c === 'conflict' ? 'unknown' : 'not_sent'; j.local = c; j.err = REASON[c] || REASON.bad;
      /* Retry-After is only readable when the relay exposes it to the page (Access-Control-Expose-Headers); without it, assume a few minutes */
      if (c === 'rate' || c === 'busy') { var wait = r.retry || 180000; j.retryAt = Date.now() + wait; j.err += r.retry ? ' Try again in about ' + Math.max(1, Math.round(r.retry / 60000)) + (r.retry >= 90000 ? ' minutes.' : ' minute.') : ' Try again in a few minutes.'; }
      save(); emit(j); return { ok: false, code: c, job: view(j) };
    });
  }

  /** Check for the answer while it is pending: 5 seconds, then slower, up to 15; stop waiting here after ten minutes. */
  function poll(id, firstMs) {
    var j = find(id); if (!j || !j.h || TERMINAL[j.st]) return false;
    clearTimeout(timers[id]); var started = Date.now(), gap = Math.max(T('gbFirst', 5000), +firstMs || 0), fails = 0;
    j.local = ''; if (j.st === 'unknown' || j.st === 'not_sent') j.st = 'queued';
    function next(ms) { timers[id] = setTimeout(tick, ms); }
    function stop(code) { clearTimeout(timers[id]); delete timers[id]; if (code) { j.local = code; j.err = REASON[code] || ''; } save(); emit(j); }
    function tick() {
      if (!find(id) || TERMINAL[j.st]) { stop(); return; }
      if (Date.now() - started > T('gbWindow', 600000)) { stop('window'); return; }
      post('/v1/result', { version: 1, handle: j.h }, T('gbPollT', 15000)).then(function (r) {
        if (!timers[id]) return;
        if (!r.net) { if (r.code === 'no_token') { stop('no_token'); return; } if (++fails >= 6) { stop('unreachable'); return; } next(Math.min(T('gbMax', 15000), gap = Math.round(gap * 1.5))); return; }
        fails = 0;
        if (r.status === 200) {
          var x = r.j;
          if (!x || x.version !== 1 || typeof x.status !== 'string') { stop('malformed'); return; }
          if (x.request_id !== j.id) { stop('mismatch'); return; }
          if (x.status === 'pending') {
            j.st = 'pending'; j.ds = String(x.dispatch_status || j.ds || ''); if (x.expires_at) j.exp = String(x.expires_at);
            if (/^(unknown|retryable_failure)$/.test(j.ds)) j.err = 'The relay could not confirm Grok Bot started (' + j.ds.replace('_', ' ') + '). I am not resending it; check with Grok Bot in its own chat.'; else j.err = '';
            save(); emit(j);
            gap = Math.min(T('gbMax', 15000), Math.max(+x.poll_after_ms || 0, Math.round(gap * 1.5)));
            next(gap); return;
          }
          if (TERMINAL[x.status]) {
            j.st = x.status; j.reply = typeof x.reply === 'string' ? x.reply.slice(0, MAX_REPLY) : '';
            j.err = x.status === 'error' ? (x.error === 'request_expired' ? REASON.expired : '') : '';
            if (x.status === 'error' && !j.reply) j.reply = j.err || 'Grok Bot reported an error.';
            j.local = ''; clearTimeout(timers[id]); delete timers[id]; save(); emit(j, { arrived: true }); return;
          }
          stop('malformed'); return;
        }
        if (r.status === 429 || (r.status === 503 && !(r.j && /^bridge_(disabled|not_configured)$/.test(r.j.error)))) { next(Math.max(r.retry || 0, Math.min(T('gbMax', 15000), gap = Math.round(gap * 1.5)))); return; }
        if (r.status >= 500) { if (++fails >= 6) { stop('unreachable'); return; } next(Math.min(T('gbMax', 15000), gap = Math.round(gap * 1.5))); return; }
        var c = httpCode(r); if (c === 'gone') j.st = 'error'; stop(c);
      });
    }
    j.st = j.st === 'sending' ? 'queued' : j.st; save(); next(gap); emit(j); return true;
  }
  /** stop waiting here; Grok Bot may still answer, and Resume picks it up */
  function stop(id) { var j = find(id); if (!j || !timers[id]) return false; clearTimeout(timers[id]); delete timers[id]; j.local = 'stopped'; j.err = REASON.stopped; save(); emit(j); return true; }
  function stopAll() { Object.keys(timers).forEach(stop); }
  function resume(id) { var j = find(id); if (!j || !j.h || TERMINAL[j.st] || !hasToken() || !enabled()) return false; live[id] = true; j.err = ''; return poll(id, T('gbFirst', 5000) / 10); }
  /** after the page is opened again: carry on waiting for anything still pending, if the token is here */
  function restore() { if (!enabled() || !hasToken()) return pending().map(view); pending().forEach(function (j) { if (!timers[j.id] && j.local !== 'stopped' && j.local !== 'window') poll(j.id, 1000); }); return pending().map(view); }
  function markSeen(id) { var j = find(id); if (j && !j.seen) { j.seen = true; save(); } }
  function forgetJob(id) { stop(id); jobs = jobs.filter(function (j) { return j.id !== id; }); save(); }
  /** the relay's health check: unauthenticated, it only shows the relay runs and answers this address */
  function health() {
    var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 10000);
    return fetch(relay() + '/v1/health', { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: ctl.signal })
      .then(function (r) { clearTimeout(tm); return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok && !!(j && j.ok === true), status: r.status }; }); }, function () { clearTimeout(tm); return { ok: false, status: 0 }; });
  }
  function wipe() { Object.keys(timers).forEach(function (id) { clearTimeout(timers[id]); delete timers[id]; }); jobs = []; [K.on, K.url, K.keep, K.tok, K.jobs, K.ctx].forEach(ls.del); ss.del(K.tok); }

  Kin.bridge = {
    DEFAULT_RELAY: DEFAULT_RELAY, REASON: REASON,
    available: available, enabled: enabled, setEnabled: setEnabled, relay: relay, setRelay: setRelay,
    hasToken: hasToken, kept: kept, setToken: setToken, dropToken: dropToken, ctxOn: ctxOn, setCtx: setCtx,
    intent: intent, unaddress: unaddress, submit: submit, stop: stop, stopAll: stopAll, resume: resume, restore: restore,
    jobs: function () { return jobs.map(view); }, job: function (id) { return view(find(id)); }, pending: function () { return pending().map(view); },
    markSeen: markSeen, forget: forgetJob, health: health, wipe: wipe,
    on: function (f) { subs.push(f); }, terminal: function (st) { return !!TERMINAL[st]; }
  };
})();
