/* hf.js: the founder's Higgsfield account, connected from this browser.

   Higgsfield's tools are reached through Anthropic's MCP connector: the Messages API itself talks to
   Higgsfield's MCP server, and this page only hands it a sign-in token. The token comes from Higgsfield's
   own sign-in service (Clerk) with OAuth 2.1, PKCE and a client this page registers for itself, all from
   the browser, because Clerk allows calls from this address. Nothing goes through a server of ours.

   The token is kept only on this device, under the same rules as the other keys: never at an address
   shared with another site, never over plain http (see guard.js). */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var AS = 'https://clerk.higgsfield.ai', MCP_URL = 'https://mcp.higgsfield.ai/mcp';
  var EP = { authorize: AS + '/oauth/authorize', token: AS + '/oauth/token', register: AS + '/oauth/register', revoke: AS + '/oauth/token/revoke' };
  var SCOPE = 'openid email offline_access';
  var K = { client: 'kin.hf.client', tok: 'kin.hf.tok', cap: 'kin.hf.cap', used: 'kin.hf.used', state: 'kin.hf.state', err: 'kin.hf.err', cimd: 'kin.hf.cimd' };
  /* Higgsfield's sign-in can also accept a client named by a public document (a client ID metadata document) instead of a
     registered one. This page publishes one; it is used only when the founder picks "Try the other sign-in". */
  var CIMD_URL = location.origin + '/oauth-client.json';
  /* the image hosts Higgsfield returns finished pictures from; the page fetches them (they allow it) and
     keeps each picture inside the design as data, so nothing is fetched again when it is drawn */
  var IMG_HOSTS = ['d8j0ntlcm91z4.cloudfront.net', 'cdn.higgsfield.ai'];

  var ls = {
    get: function (k) { if (Kin.shared) return null; try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { if (Kin.shared) return false; try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var ss = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  };
  function json(k) { try { return JSON.parse(ls.get(k) || 'null'); } catch (e) { return null; } }
  function redirectUri() { return location.origin + '/'; }
  function rand(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
  function b64url(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function sha256(text) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (d) { return b64url(new Uint8Array(d)); }); }
  function form(o) { return Object.keys(o).filter(function (k) { return o[k] != null; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
  var status = { last: '', why: '' };
  function note(s, why) { status.last = s; status.why = why || ''; try { if (Kin.onHf) Kin.onHf(); } catch (e) {} }

  /** Register this page as a public client once (no secret: a browser cannot keep one). */
  function client() {
    if (ls.get(K.cimd) === '1') return Promise.resolve({ client_id: CIMD_URL, redirect_uri: redirectUri(), cimd: true });
    var c = json(K.client);
    if (c && c.client_id && c.redirect_uri === redirectUri()) return Promise.resolve(c);
    return fetch(EP.register, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Kin', redirect_uris: [redirectUri()], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPE }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.client_id) throw new Error('register ' + r.status + (j.error ? ' ' + j.error : '')); return j; }); })
      .then(function (j) { var c2 = { client_id: j.client_id, redirect_uri: redirectUri(), at: Date.now() }; ls.set(K.client, JSON.stringify(c2)); return c2; });
  }

  /** Step 1, inside the founder's tap: go to Higgsfield's sign-in page. */
  function connect() {
    if (Kin.shared) return Promise.reject(new Error(Kin.SHARED_TEXT));
    if (!window.crypto || !crypto.subtle) return Promise.reject(new Error('This browser cannot do a secure sign-in here.'));
    note('Asking Higgsfield for a sign-in page…');
    return client().then(function (c) {
      var verifier = rand(48), state = rand(16);
      return sha256(verifier).then(function (challenge) {
        ss.set(K.state, JSON.stringify({ state: state, verifier: verifier, client_id: c.client_id, at: Date.now() }));
        location.assign(EP.authorize + '?' + form({ response_type: 'code', client_id: c.client_id, redirect_uri: c.redirect_uri, scope: SCOPE, state: state, code_challenge: challenge, code_challenge_method: 'S256', resource: MCP_URL }));
      });
    }).catch(function (e) { note('', 'Higgsfield did not let this page register for sign-in (' + (e && e.message) + ').'); throw e; });
  }

  function saveTok(j) {
    if (!j || !j.access_token) throw new Error('no token');
    var old = json(K.tok) || {};
    var t = { access: j.access_token, refresh: j.refresh_token || old.refresh || '', exp: Date.now() + Math.max(60, (+j.expires_in || 3600) - 60) * 1000, at: Date.now() };
    if (!ls.set(K.tok, JSON.stringify(t))) throw new Error('storage');
    return t;
  }
  function tokenCall(body) {
    return fetch(EP.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error('token ' + r.status + (j.error ? ' ' + j.error : '')); e.oauth = j.error || ''; throw e; } return j; }); });
  }

  /** Step 2, when Higgsfield sends the founder back here: trade the code for a token. Runs at page start. */
  function finish() {
    var q = new URLSearchParams(location.search), code = q.get('code'), st = q.get('state'), err = q.get('error');
    if (!code && !err) return Promise.resolve(null);
    var saved = null; try { saved = JSON.parse(ss.get(K.state) || 'null'); } catch (e) {}
    function clean() { try { history.replaceState(null, '', location.pathname); } catch (e) {} ss.del(K.state); }
    if (!saved || !st || st !== saved.state || Date.now() - saved.at > 15 * 60000) { clean(); if (code || err) note('', 'That sign-in did not start on this page, so it was ignored.'); return Promise.resolve(null); }
    if (err) { clean(); note('', 'Higgsfield sign-in was cancelled (' + err + ').'); return Promise.resolve(null); }
    if (Kin.shared) { clean(); note('', Kin.SHARED_TEXT); return Promise.resolve(null); }
    note('Finishing the Higgsfield sign-in…');
    return tokenCall({ grant_type: 'authorization_code', code: code, redirect_uri: redirectUri(), client_id: saved.client_id, code_verifier: saved.verifier, resource: MCP_URL })
      .then(function (j) { clean(); saveTok(j); note('Higgsfield is connected.'); return true; },
        function (e) { clean(); note('', 'Higgsfield did not hand over a token (' + (e && e.message) + ').'); return false; });
  }

  var refreshing = null;
  /** A token that is still good, refreshed if it is about to run out. Resolves null when not connected. */
  function token() {
    var t = json(K.tok), c = json(K.client); if (!t || !t.access) return Promise.resolve(null);
    if (Date.now() < t.exp) return Promise.resolve(t.access);
    if (!t.refresh || !c) { note('', 'The Higgsfield sign-in ran out and cannot be refreshed. Connect again.'); return Promise.resolve(null); }
    if (!refreshing) refreshing = tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: c.client_id, resource: MCP_URL })
      .then(function (j) { return saveTok(j).access; }, function (e) {
        noteErr('refreshing the sign-in: ' + ((e && e.message) || e));
        if (e && /invalid_grant|invalid_client/.test(e.oauth || e.message)) { ls.del(K.tok); note('', 'The Higgsfield sign-in expired. Connect again in settings.'); }
        else note('', 'The Higgsfield sign-in could not be refreshed (' + ((e && e.message) || 'network') + '). Try again, or Reconnect.');
        return null; })
      .then(function (v) { refreshing = null; return v; });
    return refreshing;
  }
  function disconnect() {
    var t = json(K.tok), c = json(K.client);
    ls.del(K.tok);
    note('Higgsfield is disconnected on this device.');
    if (t && c) { [t.refresh, t.access].filter(Boolean).forEach(function (v) { fetch(EP.revoke, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ token: v, client_id: c.client_id }) }).catch(function () {}); }); }
  }
  /** the server has turned the token down: forget it so the founder is asked to connect again */
  function rejected(why) { ls.del(K.tok); note('', 'Higgsfield did not accept the sign-in from this page' + (why ? ' (' + why + ')' : '') + '. Connect again; if it keeps failing, Higgsfield may only accept sign-ins from Claude\'s own apps.'); }

  /* the last thing Higgsfield said when something failed, without the token, for the card and the Last error line */
  function noteErr(msg) {
    var m = String(msg || '').replace(/eyJ[A-Za-z0-9_.-]{10,}/g, '[token]').replace(/Bearer\s+\S+/gi, 'Bearer [token]').slice(0, 300);
    ls.set(K.err, JSON.stringify({ at: Date.now(), message: m }));
    try { if (Kin.brain && Kin.brain.noteError) Kin.brain.noteError({ type: 'higgsfield', message: m }); } catch (e) {}
  }
  function lastErr() { return json(K.err); }
  /** Is the sign-in usable: a token that has not run out, or one that can be refreshed */
  function live() { var t = json(K.tok); return !!(t && t.access && (Date.now() < t.exp || t.refresh)); }

  /* ---- credits: a cap per day, counted on this device from the price checks of jobs the founder approved ---- */
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function used() { var u = json(K.used); return u && u.day === today() ? u.credits : 0; }
  function addUsed(n) { var c = used() + (+n || 0); ls.set(K.used, JSON.stringify({ day: today(), credits: Math.round(c * 1000) / 1000 })); return c; }
  function refund(n) { var c = Math.max(0, used() - (+n || 0)); ls.set(K.used, JSON.stringify({ day: today(), credits: Math.round(c * 1000) / 1000 })); return c; }
  function cap() { var v = parseFloat(ls.get(K.cap)); return v > 0 && v <= 10000 ? v : 20; }
  function setCap(v) { v = parseFloat(v); if (v > 0 && v <= 10000) ls.set(K.cap, String(Math.round(v * 100) / 100)); }

  /** Is this URL one of Higgsfield's picture hosts? */
  function okHost(u) { try { var x = new URL(u); return x.protocol === 'https:' && IMG_HOSTS.indexOf(x.hostname) >= 0; } catch (e) { return false; } }
  /** Fetch a finished picture and shrink it into a JPEG data URL (long side at most max px). */
  function toData(url, max) {
    if (!okHost(url)) return Promise.reject(new Error('not a Higgsfield picture host'));
    return fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) { if (!r.ok) throw new Error('picture ' + r.status); return r.blob(); })
      .then(function (blob) {
        return new Promise(function (res, rej) {
          var u = URL.createObjectURL(blob), img = new Image();
          img.onload = function () {
            try {
              var k = Math.min(1, (max || 1600) / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
              var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
              URL.revokeObjectURL(u); res({ data: c.toDataURL('image/jpeg', 0.86), w: w, h: h });
            } catch (e) { URL.revokeObjectURL(u); rej(e); }
          };
          img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('not a picture')); };
          img.src = u;
        });
      });
  }

  Kin.hf = {
    MCP_URL: MCP_URL, IMG_HOSTS: IMG_HOSTS,
    connected: live,
    noteErr: noteErr, lastErr: lastErr, refund: refund,
    usingCimd: function () { return ls.get(K.cimd) === '1'; },
    /** switch the sign-in to the published client document (or back), then sign in again */
    useCimd: function (on) { if (on) ls.set(K.cimd, '1'); else ls.del(K.cimd); ls.del(K.tok); },
    /** One check that makes nothing: Claude asks Higgsfield for the price of one picture (get_cost). Shows Higgsfield's exact reply. */
    test: function () {
      if (Kin.shared) return Promise.resolve({ ok: false, text: Kin.SHARED_TEXT });
      var c = Kin.brain && Kin.brain.client && Kin.brain.client();
      if (!c) return Promise.resolve({ ok: false, text: 'Add your Claude key first: the test runs through Claude.' });
      return token().then(function (tok) {
        if (!tok) return { ok: false, text: 'Not connected, or the sign-in could not be refreshed. Tap Connect Higgsfield.' };
        return c.beta.messages.create({ model: Kin.brain.QUICK || Kin.brain.MAIN, max_tokens: 600, betas: ['mcp-client-2026-09-15'],
          mcp_servers: [{ type: 'url', url: MCP_URL, name: 'higgsfield', authorization_token: tok }],
          tools: [{ type: 'mcp_toolset', mcp_server_name: 'higgsfield', default_config: { enabled: false }, configs: { generate_image: { enabled: true } } }],
          messages: [{ role: 'user', content: 'PRICE CHECK ONLY. Call generate_image once with params { model: "gpt_image_2_6", prompt: "a plain grey square", aspect_ratio: "1:1", get_cost: true, use_unlim: false }. Do not call anything else. Reply with the result exactly.' }] })
          .then(function (m) {
            var res = (m.content || []).filter(function (b) { return b.type === 'mcp_tool_result'; })[0];
            var txt = res ? (Array.isArray(res.content) ? res.content.map(function (x) { return x.text || ''; }).join(' ') : String(res.content || '')) : (m.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join(' ');
            var cost = 0; try { cost = Kin.mind.costOf(m.model, m.usage); Kin.mind.addSpend(cost); } catch (e) {}
            if (!res || res.is_error) { noteErr(txt || 'no reply from Higgsfield'); return { ok: false, text: 'Higgsfield said: ' + (txt || 'nothing (the tool was not reached)').slice(0, 400), cost: cost }; }
            return { ok: true, text: 'Higgsfield answered and nothing was made: ' + txt.slice(0, 300), cost: cost };
          }, function (e) { var msg = String((e && e.message) || e); noteErr(msg); return { ok: false, text: 'The test failed: ' + msg.slice(0, 400) }; });
      });
    },
    connect: connect, finish: finish, token: token, disconnect: disconnect, rejected: rejected,
    status: function () { return status; },
    cap: cap, setCap: setCap, used: used, addUsed: addUsed,
    okHost: okHost, toData: toData,
    wipe: function () { [K.client, K.tok, K.cap, K.used, K.err, K.cimd].forEach(ls.del); ss.del(K.state); }
  };
})();
