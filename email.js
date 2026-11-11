/* email.js: Kin drafts emails; the founder sends them.

   Every draft is shown as a card: To, Subject and Body, all editable. Nothing leaves this page by itself.
   - "Open in Gmail" opens Gmail's own compose window with the draft filled in (no setup). The founder presses Send there.
   - "Send now" sends straight from here through the Gmail API, only after the founder has pasted their own Google OAuth
     Client ID in Settings, Email, and only on a tap of Send now after the read-back on the card. One email per tap,
     a daily limit (10 by default). The Google access token lives in memory only and is never stored.
   At a shared or plain-http address (Kin.shared) nothing is stored and Send now is not offered. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var K = { cid: 'kin.mail.cid', cap: 'kin.mail.cap', sent: 'kin.mail.sent' };
  var SCOPE = 'https://www.googleapis.com/auth/gmail.send';
  var GIS = 'https://accounts.google.com/gsi/client';
  var SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  var ls = {
    get: function (k) { if (Kin.shared) return null; try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { if (Kin.shared) return false; try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function sentToday() { try { var s = JSON.parse(ls.get(K.sent) || 'null'); return s && s.day === today() ? s.n : 0; } catch (e) { return 0; } }
  function countSent() { ls.set(K.sent, JSON.stringify({ day: today(), n: sentToday() + 1 })); }
  function cap() { var v = parseInt(ls.get(K.cap), 10); return v > 0 && v <= 100 ? v : 10; }
  function setCap(v) { v = parseInt(v, 10); if (v > 0 && v <= 100) ls.set(K.cap, String(v)); }
  function clientId() { var v = ls.get(K.cid) || ''; return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(v) ? v : ''; }
  function setClientId(v) {
    v = String(v || '').trim();
    if (Kin.shared) return { ok: false, why: Kin.SHARED_TEXT };
    if (!v) { ls.del(K.cid); token = null; return { ok: true }; }
    if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(v)) return { ok: false, why: 'That does not look like a Google OAuth Client ID. It ends in .apps.googleusercontent.com.' };
    ls.set(K.cid, v); token = null; loadGis(); return { ok: true };
  }

  /* ---- addresses and the draft ---- */
  var ADDR = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
  function splitAddrs(s) { return String(s || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function check(d) {
    var to = splitAddrs(d.to);
    if (!to.length) return 'Add who it goes to.';
    var bad = to.filter(function (a) { return !ADDR.test(a); });
    if (bad.length) return 'Not an email address: ' + bad.join(', ');
    if (to.length > 10) return 'At most 10 people per email.';
    if (!String(d.subject || '').trim()) return 'Add a subject.';
    if (!String(d.body || '').trim()) return 'The email is empty.';
    if (String(d.body).length > 20000) return 'The email is too long to send from here.';
    return '';
  }
  /** Gmail's own compose window, filled in. Opened only when the founder taps it. */
  function composeUrl(d) {
    var q = 'view=cm&fs=1&to=' + encodeURIComponent(splitAddrs(d.to).join(',')) + '&su=' + encodeURIComponent(String(d.subject || '')) + '&body=' + encodeURIComponent(String(d.body || ''));
    if (d.cc) q += '&cc=' + encodeURIComponent(splitAddrs(d.cc).join(','));
    return 'https://mail.google.com/mail/?' + q;
  }
  /* an RFC 2822 message, base64url, for the Gmail API (UTF-8 subject in encoded-word form) */
  function b64url(str) { var bytes = new TextEncoder().encode(str), s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function encWord(s) { return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + btoa(String.fromCharCode.apply(null, new TextEncoder().encode(s))) + '?='; }
  function raw(d) {
    var head = ['To: ' + splitAddrs(d.to).join(', ')];
    if (d.cc) head.push('Cc: ' + splitAddrs(d.cc).join(', '));
    head.push('Subject: ' + encWord(String(d.subject).replace(/[\r\n]+/g, ' ')), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit');
    return b64url(head.join('\r\n') + '\r\n\r\n' + String(d.body).replace(/\r?\n/g, '\r\n'));
  }

  /* ---- Google sign-in for sending: Google Identity Services, the gmail.send scope only, token in memory ---- */
  var token = null, gisP = null;
  function loadGis() {
    if (Kin.shared || !clientId()) return Promise.resolve(false);
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve(true);
    if (gisP) return gisP;
    gisP = new Promise(function (res) { var s = document.createElement('script'); s.src = GIS; s.async = true; s.onload = function () { res(true); }; s.onerror = function () { gisP = null; res(false); }; document.head.appendChild(s); });
    return gisP;
  }
  /* must run inside the founder's tap: the Google window is a popup */
  function getToken() {
    if (token && Date.now() < token.exp) return Promise.resolve(token.v);
    if (!(window.google && google.accounts && google.accounts.oauth2)) return Promise.reject(new Error('Google sign-in did not load yet. Tap Send now again in a moment.'));
    return new Promise(function (res, rej) {
      var tc = google.accounts.oauth2.initTokenClient({ client_id: clientId(), scope: SCOPE, prompt: '',
        callback: function (r) { if (!r || r.error || !r.access_token) { rej(new Error('Google did not give permission to send (' + ((r && (r.error_description || r.error)) || 'cancelled') + ').')); return; } token = { v: r.access_token, exp: Date.now() + Math.max(60, (+r.expires_in || 3600) - 60) * 1000 }; res(token.v); },
        error_callback: function (e) { rej(new Error('Google sign-in closed (' + ((e && e.type) || 'cancelled') + ').')); } });
      tc.requestAccessToken();
    });
  }
  /** Send one email. Call only from the founder's tap on Send now. */
  function send(d, tapped) {
    if (!tapped) return Promise.reject(new Error('Not sent: an email goes only on a tap of Send now.'));
    if (Kin.shared) return Promise.reject(new Error(Kin.SHARED_TEXT));
    if (!clientId()) return Promise.reject(new Error('Sending from here is not set up. Use Open in Gmail, or add a Google Client ID in Settings, Email.'));
    var why = check(d); if (why) return Promise.reject(new Error(why));
    if (sentToday() >= cap()) return Promise.reject(new Error('Today\'s limit of ' + cap() + ' emails sent from here is reached. Change it in Settings, Email, or use Open in Gmail.'));
    return getToken().then(function (tok) {
      return fetch(SEND_URL, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: raw(d) }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { if (r.status === 401) token = null; throw new Error('Gmail did not send it (' + r.status + (j && j.error && j.error.message ? ': ' + j.error.message : '') + ').'); }
          countSent(); return { ok: true, id: j.id || '' };
        }); });
    });
  }

  /* ---- the card ---- */
  function el(t, c, txt) { var e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; }
  function pill(label, kind) { var b = el('button', 'pill ' + kind); b.type = 'button'; b.appendChild(el('span', 'pl', label)); return b; }
  /** An email card in the conversation. opts: { onSay(text) } */
  function card(d, opts) {
    opts = opts || {};
    var box = el('div', 'mailcard'), st = { sent: false };
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Email draft');
    var head = el('div', 'mhead'); head.appendChild(el('span', 'chip warn', 'Draft · not sent')); head.appendChild(el('span', 'chip ghost', 'Email')); box.appendChild(head);
    function field(lbl, val, multi) {
      var w = el('label', 'mrow'); w.appendChild(el('span', 'mlbl', lbl));
      var i = el(multi ? 'textarea' : 'input', 'minput'); if (!multi) { i.type = 'text'; i.autocomplete = 'off'; } else i.rows = Math.min(14, Math.max(5, String(val || '').split('\n').length + 1));
      i.value = val || ''; i.spellcheck = true; w.appendChild(i); box.appendChild(w); return i;
    }
    var to = field('To', d.to), su = field('Subject', d.subject), bo = field('Body', d.body, true);
    var msg = el('p', 'note mnote'); box.appendChild(msg);
    var acts = el('div', 'mact'); box.appendChild(acts);
    function draft() { return { to: to.value, subject: su.value, body: bo.value, cc: d.cc || '' }; }
    var gm = pill('Open in Gmail', 'go'), cp = pill('Copy', 'alt');
    gm.addEventListener('click', function () { var w = check(draft()); if (w && !/subject|empty/i.test(w)) { msg.textContent = w; return; } window.open(composeUrl(draft()), '_blank', 'noopener,noreferrer'); msg.textContent = 'Opened in Gmail. Press Send there when it looks right.'; });
    cp.addEventListener('click', function () { var x = draft(), t = 'To: ' + x.to + '\nSubject: ' + x.subject + '\n\n' + x.body; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { msg.textContent = 'Copied.'; }, function () { msg.textContent = 'This browser would not copy it; select the text instead.'; }); });
    acts.appendChild(gm); acts.appendChild(cp);
    if (!Kin.shared && clientId()) {
      loadGis();
      var sn = pill('Send now', 'warn'), armed = false, armT = 0;
      sn.addEventListener('click', function (e) {
        if (!e.isTrusted || st.sent) return;
        var x = draft(), w = check(x); if (w) { msg.textContent = w; return; }
        /* first tap: read it back; second tap within 10 seconds: send */
        if (!armed) {
          armed = true; clearTimeout(armT); armT = setTimeout(function () { armed = false; sn.querySelector('.pl').textContent = 'Send now'; }, 10000);
          sn.querySelector('.pl').textContent = 'Tap again to send';
          var rb = 'Sending to ' + splitAddrs(x.to).join(', ') + ': "' + x.subject.trim() + '". Tap again within 10 seconds to send.';
          msg.textContent = rb; if (opts.onSay) opts.onSay('Sending to ' + splitAddrs(x.to).length + (splitAddrs(x.to).length === 1 ? ' person' : ' people') + ', subject ' + x.subject.trim() + '. Tap again to send, sir.');
          return;
        }
        armed = false; clearTimeout(armT); sn.disabled = true; msg.textContent = 'Sending…';
        send(x, true).then(function () {
          st.sent = true; sn.querySelector('.pl').textContent = 'Sent'; head.firstChild.textContent = 'Sent'; head.firstChild.className = 'chip on';
          [to, su, bo].forEach(function (i) { i.readOnly = true; }); msg.textContent = 'Sent from your Gmail. ' + (cap() - sentToday()) + ' of ' + cap() + ' left today.';
          if (opts.onSay) opts.onSay('Sent, sir.');
        }, function (err) { sn.disabled = false; sn.querySelector('.pl').textContent = 'Send now'; msg.textContent = String((err && err.message) || err); });
      });
      acts.insertBefore(sn, acts.firstChild);
      msg.textContent = 'Check it, then Send now (twice: once to read it back, once to send), or Open in Gmail.';
    } else msg.textContent = Kin.shared ? 'Open in Gmail to send it.' : 'Check it, then Open in Gmail and press Send there. To send from here instead, set up Settings, Email.';
    return box;
  }

  Kin.email = { composeUrl: composeUrl, raw: raw, check: check, send: send, card: card, clientId: clientId, setClientId: setClientId, cap: cap, setCap: setCap, sentToday: sentToday, loadGis: loadGis,
    canSend: function () { return !Kin.shared && !!clientId(); },
    wipe: function () { [K.cid, K.cap, K.sent].forEach(ls.del); token = null; } };
})();
