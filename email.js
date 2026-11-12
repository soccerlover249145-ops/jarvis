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
  var K = { cid: 'kin.mail.cid', cap: 'kin.mail.cap', sent: 'kin.mail.sent', box: 'kin.mail.outbox' };
  var SCOPE = 'https://www.googleapis.com/auth/gmail.send';
  var READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  var CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
  var PEOPLE_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';
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
    if (!v) { ls.del(K.cid); tokens = {}; return { ok: true }; }
    if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(v)) return { ok: false, why: 'That does not look like a Google OAuth Client ID. It ends in .apps.googleusercontent.com.' };
    ls.set(K.cid, v); tokens = {}; loadGis(); return { ok: true };
  }

  /* ---- the outbox: every draft Kin writes is kept here until it is sent or removed, so a batch of
     emails can be reviewed and sent one after another instead of vanishing with the conversation ---- */
  var SENT_MAX = 30, SENT_DAYS = 7;
  function outbox() { try { var a = JSON.parse(ls.get(K.box) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  /* drafts still waiting are never dropped; sent ones are kept for a week, thirty at most */
  var BOX_CAP = 200;
  function saveBox(a) {
    var old = Date.now() - SENT_DAYS * 864e5;
    /* sent ones: the newest sends first, a week at most, thirty at most */
    var keepSent = a.filter(function (m) { return m.status === 'sent' && (m.sentAt || m.at || 0) >= old; }).sort(function (x, y) { return (y.sentAt || y.at || 0) - (x.sentAt || x.at || 0); }).slice(0, SENT_MAX);
    var out = a.filter(function (m) { return m.status !== 'sent' || keepSent.indexOf(m) >= 0; });
    /* a hard ceiling so storage cannot grow forever: the oldest drafts already opened in Gmail go first */
    while (out.length > BOX_CAP) { var gone = out.filter(function (m) { return m.status === 'opened'; }).pop() || out[out.length - 1]; out.splice(out.indexOf(gone), 1); }
    ls.set(K.box, JSON.stringify(out));
  }
  function same(x, y) { return String(x || '').replace(/\s+/g, ' ').trim().toLowerCase() === String(y || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  /** a new draft. A rewrite from a later answer ("make it shorter") replaces the one still waiting with the same To and
      Subject, as long as it has an address and the founder has not edited it; drafts written in the same answer never merge */
  function saveDraft(d, ask) {
    var a = outbox(), to = String(d.to || ''), su = String(d.subject || ''), x = /@/.test(to) ? a.filter(function (m) { return m.status === 'draft' && !m.edited && m.ask !== ask && same(m.to, to) && same(m.subject, su); })[0] : null;
    if (x) { a = a.filter(function (m) { return m !== x; }); x.body = String(d.body || ''); x.at = Date.now(); x.ask = ask; a.unshift(x); saveBox(a); tell(x.id, { body: x.body }); return x.id; }
    var id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    a.unshift({ id: id, to: to, subject: su, body: String(d.body || ''), at: Date.now(), status: 'draft', ask: ask });
    saveBox(a); return id;
  }
  function getDraft(id) { return outbox().filter(function (m) { return m.id === id; })[0] || null; }
  /* every card showing the same draft (in the conversation and in the Outbox) hears about a change */
  function tell(id, patch) { [].forEach.call(document.querySelectorAll('.mailcard[data-draft]'), function (c) { if (c.dataset.draft === id) { try { c.dispatchEvent(new CustomEvent('kin:draft', { detail: { id: id, patch: patch } })); } catch (e) {} } }); }
  function updateDraft(id, patch) {
    var a = outbox(), x = a.filter(function (m) { return m.id === id; })[0]; if (!x) return;
    Object.keys(patch).forEach(function (k) { x[k] = patch[k]; }); if (patch.status === 'sent') x.sentAt = Date.now(); saveBox(a);
    if (patch.status) tell(id, { status: patch.status });
  }
  function dropDraft(id) { saveBox(outbox().filter(function (m) { return m.id !== id; })); }
  function clearSent() { saveBox(outbox().filter(function (m) { return m.status !== 'sent'; })); }
  function waiting() { return outbox().filter(function (m) { return m.status !== 'sent'; }); }

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
    return 'https://mail.google.com/mail/?' + q;
  }
  /* an RFC 2822 message, base64url, for the Gmail API (UTF-8 subject in encoded-word form) */
  function b64url(str) { var bytes = new TextEncoder().encode(str), s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function encWord(s) { return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + btoa(String.fromCharCode.apply(null, new TextEncoder().encode(s))) + '?='; }
  function raw(d) {
    var head = ['To: ' + splitAddrs(d.to).join(', ')];
    head.push('Subject: ' + encWord(String(d.subject).replace(/[\r\n]+/g, ' ')), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit');
    return b64url(head.join('\r\n') + '\r\n\r\n' + String(d.body).replace(/\r?\n/g, '\r\n'));
  }

  /* ---- Google sign-in for sending: Google Identity Services, the gmail.send scope only, token in memory ---- */
  var tokens = {}, gisP = null;
  function loadGis() {
    if (Kin.shared || !clientId()) return Promise.resolve(false);
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve(true);
    if (gisP) return gisP;
    gisP = new Promise(function (res) { var s = document.createElement('script'); s.src = GIS; s.async = true; s.onload = function () { res(true); }; s.onerror = function () { gisP = null; res(false); }; document.head.appendChild(s); });
    return gisP;
  }
  /* must run inside the founder's tap: the Google window is a popup. Sending and reading are separate
     permissions with separate tokens, so allowing one never quietly grants the other; both live in memory only. */
  var WHAT = {}; WHAT[SCOPE] = 'send email'; WHAT[READ_SCOPE] = 'read your inbox'; WHAT[CAL_SCOPE] = 'read your calendar'; WHAT[PEOPLE_SCOPE] = 'look up your contacts';
  function getToken(scope) {
    var cur = tokens[scope];
    if (cur && Date.now() < cur.exp) return Promise.resolve(cur.v);
    if (!(window.google && google.accounts && google.accounts.oauth2)) return Promise.reject(new Error('Google sign-in did not load yet. Tap again in a moment.'));
    return new Promise(function (res, rej) {
      /* a window that never answers (closed behind another, blocked) must not leave a panel on "Reading…" */
      var done = false, tt = setTimeout(function () { if (!done) { done = true; rej(new Error('Google sign-in did not finish. Tap again.')); } }, 120000);
      function fin(f, v) { if (done) return; done = true; clearTimeout(tt); f(v); }
      /* include_granted_scopes off: a read token never quietly carries the send permission, or the other way round */
      var tc = google.accounts.oauth2.initTokenClient({ client_id: clientId(), scope: scope, prompt: '', include_granted_scopes: false,
        callback: function (r) {
          if (!r || r.error || !r.access_token) { fin(rej, new Error('Google did not give permission to ' + (WHAT[scope] || 'do that') + ' (' + ((r && (r.error_description || r.error)) || 'cancelled') + ').')); return; }
          var o2 = google.accounts.oauth2;
          if (o2.hasGrantedAllScopes && !o2.hasGrantedAllScopes(r, scope)) { fin(rej, new Error('Google gave a different permission than asked: tick the box to ' + (WHAT[scope] || 'allow it') + ' and try again.')); return; }
          tokens[scope] = { v: r.access_token, exp: Date.now() + Math.max(60, (+r.expires_in || 3600) - 60) * 1000 }; fin(res, tokens[scope].v);
        },
        error_callback: function (e) { fin(rej, new Error('Google sign-in closed (' + ((e && e.type) || 'cancelled') + ').')); } });
      tc.requestAccessToken();
    });
  }

  /** a refusal from Google: forget the token (it may lack the permission) and say why, in Google's words */
  function refused(r, scope, what) {
    if (r.status === 401 || r.status === 403) delete tokens[scope];
    return r.json().catch(function () { return {}; }).then(function (j) {
      var why = j && j.error && j.error.message ? String(j.error.message).slice(0, 220) : '';
      throw new Error(what + ' (' + r.status + (why ? ': ' + why : '') + ').' + (r.status === 403 && /not been used|disabled|enable/i.test(why) ? ' Turn that API on in Google Cloud (Settings, Email has the steps).' : ''));
    });
  }
  /* ---- reading the inbox: unread mail, newest first, From / Subject / Date / snippet only. Read on a tap,
     kept in memory for this visit, never stored on the device. ---- */
  var LIST_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
  function hdr(m, name) { var h = ((m.payload && m.payload.headers) || []).filter(function (x) { return String(x.name).toLowerCase() === name; })[0]; return h ? String(h.value) : ''; }
  function inbox(opts) {
    opts = opts || {};
    if (Kin.shared) return Promise.reject(new Error(Kin.SHARED_TEXT));
    if (!clientId()) return Promise.reject(new Error('Reading your inbox needs a Google Client ID in Settings, Email.'));
    /* a search uses Gmail's own search words (from:lee invoice), across all mail; otherwise the inbox */
    var q = opts.q ? String(opts.q).slice(0, 300) : opts.all ? 'in:inbox' : 'in:inbox is:unread', n = Math.min(25, opts.max || 15);
    return getToken(READ_SCOPE).then(function (tok) {
      var auth = { credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Authorization: 'Bearer ' + tok } };
      if (!mailbox) fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', auth).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.emailAddress) mailbox = String(j.emailAddress); }).catch(function () {});
      return fetch(LIST_URL + '?maxResults=' + n + '&q=' + encodeURIComponent(q), auth).then(function (r) {
        if (!r.ok) return refused(r, READ_SCOPE, 'Gmail would not list the inbox');
        return r.json();
      }).then(function (j) {
        var ids = (j.messages || []).map(function (m) { return m.id; });
        return Promise.all(ids.map(function (id) {
          return fetch(LIST_URL + '/' + encodeURIComponent(id) + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date', auth)
            .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
        }));
      }).then(function (list) {
        return list.filter(Boolean).map(function (m) {
          return { id: m.id, thread: m.threadId, from: hdr(m, 'from'), subject: hdr(m, 'subject') || '(no subject)', date: +m.internalDate || Date.parse(hdr(m, 'date')) || 0,
            snippet: unent(m.snippet), unread: (m.labelIds || []).indexOf('UNREAD') >= 0 };
        });
      });
    });
  }
  function unent(x) {
    return String(x || '').replace(/&#(\d{1,6});/g, function (a, n) { return String.fromCodePoint(Math.min(+n, 0x10FFFF)); }).replace(/&#x([0-9a-f]{1,6});/gi, function (a, h) { return String.fromCodePoint(Math.min(parseInt(h, 16), 0x10FFFF)); })
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }
  /** a Gmail link that opens this message in the right account, when several are signed in */
  var mailbox = '';
  function threadUrl(m) { return 'https://mail.google.com/mail/' + (mailbox ? '?authuser=' + encodeURIComponent(mailbox) : 'u/0/') + '#all/' + encodeURIComponent(m.thread || m.id); }

  /* ---- the calendar: the next few days of the primary calendar, read on a tap with a separate read-only
     permission, kept in memory for this visit, never stored ---- */
  var CAL_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  function calendar(opts) {
    opts = opts || {};
    if (Kin.shared) return Promise.reject(new Error(Kin.SHARED_TEXT));
    if (!clientId()) return Promise.reject(new Error('Reading your calendar needs a Google Client ID in Settings, Email.'));
    var days = Math.min(14, Math.max(1, opts.days || 3)), start = new Date(); start.setHours(0, 0, 0, 0);
    var end = new Date(start.getTime() + days * 864e5);
    var q = '?singleEvents=true&orderBy=startTime&maxResults=40&timeMin=' + encodeURIComponent(start.toISOString()) + '&timeMax=' + encodeURIComponent(end.toISOString());
    return getToken(CAL_SCOPE).then(function (tok) {
      return fetch(CAL_URL + q, { credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Authorization: 'Bearer ' + tok } }).then(function (r) {
        if (!r.ok) return refused(r, CAL_SCOPE, 'Google Calendar would not answer');
        return r.json();
      }).then(function (j) {
        return (j.items || []).filter(function (e) { return e.status !== 'cancelled'; }).map(function (e) {
          var allDay = !!(e.start && e.start.date && !e.start.dateTime);
          return { id: e.id, title: String(e.summary || '(no title)'), allDay: allDay,
            start: allDay ? Date.parse(e.start.date + 'T00:00:00') : Date.parse((e.start && e.start.dateTime) || ''),
            end: allDay ? Date.parse(((e.end && e.end.date) || e.start.date) + 'T00:00:00') : Date.parse((e.end && e.end.dateTime) || ''),
            where: String(e.location || ''), link: String(e.htmlLink || ''), meet: String(e.hangoutLink || ''),
            who: (e.attendees || []).filter(function (a) { return !a.self; }).map(function (a) { return a.displayName || a.email; }).slice(0, 6) };
        });
      });
    });
  }
  /* ---- contacts: names and email addresses only, read on a tap with their own read-only permission, held in
     memory for ten minutes, never stored and never sent to Claude ---- */
  var PEOPLE_URL = 'https://people.googleapis.com/v1/people/me/connections', people = null;
  function contacts() {
    if (Kin.shared) return Promise.reject(new Error(Kin.SHARED_TEXT));
    if (!clientId()) return Promise.reject(new Error('Looking up contacts needs a Google Client ID in Settings, Email.'));
    if (people && Date.now() - people.at < 600000) return Promise.resolve(people.list);
    return getToken(PEOPLE_SCOPE).then(function (tok) {
      var auth = { credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Authorization: 'Bearer ' + tok } }, out = [];
      function page(next, n) {
        return fetch(PEOPLE_URL + '?personFields=names,emailAddresses&pageSize=1000' + (next ? '&pageToken=' + encodeURIComponent(next) : ''), auth).then(function (r) {
          if (!r.ok) return refused(r, PEOPLE_SCOPE, 'Google Contacts would not answer');
          return r.json();
        }).then(function (j) {
          (j.connections || []).forEach(function (pp) {
            var nm = String((((pp.names || [])[0]) || {}).displayName || '');
            (pp.emailAddresses || []).forEach(function (e) { var v = String((e && e.value) || '').trim(); if (ADDR.test(v)) out.push({ name: nm || v, email: v }); });
          });
          if (j.nextPageToken && n < 3) return page(j.nextPageToken, n + 1);
        });
      }
      return page('', 1).then(function () { people = { at: Date.now(), list: out }; return out; });
    });
  }
  function fold(x) { return String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  /** the name asked for is a whole word of this person's name or address, not just the start of one */
  function exactPerson(q, pp) { var hay = ' ' + fold(pp.name) + ' ' + fold(pp.email.split('@')[0]) + ' '; return fold(q).split(' ').filter(Boolean).every(function (w) { return hay.indexOf(' ' + w + ' ') >= 0; }); }
  /** everyone whose name (or the part of the address before the @) has every word asked for */
  function findPeople(q, list) {
    var words = fold(q).split(' ').filter(Boolean); if (!words.length) return [];
    var seen = {};
    return (list || []).filter(function (pp) {
      var hay = ' ' + fold(pp.name) + ' ' + fold(pp.email.split('@')[0]) + ' ';
      if (seen[pp.email.toLowerCase()] || !words.every(function (w) { return hay.indexOf(' ' + w) >= 0; })) return false;
      return (seen[pp.email.toLowerCase()] = true);
    }).slice(0, 6);
  }
  /** the parts of a To line that are names, not addresses: "Sam Lee, kai@x.com" gives ["Sam Lee"] */
  function bareNames(s) { return String(s || '').split(/[,;]+/).map(function (x) { return x.trim(); }).filter(function (x) { return x && !/@/.test(x); }); }

  /** Send one email. Call only from the founder's tap on Send now. */
  function send(d, tapped) {
    if (!tapped) return Promise.reject(new Error('Not sent: an email goes only on a tap of Send now.'));
    if (Kin.shared) return Promise.reject(new Error(Kin.SHARED_TEXT));
    if (!clientId()) return Promise.reject(new Error('Sending from here is not set up. Use Open in Gmail, or add a Google Client ID in Settings, Email.'));
    var why = check(d); if (why) return Promise.reject(new Error(why));
    if (sentToday() >= cap()) return Promise.reject(new Error('Today\'s limit of ' + cap() + ' emails sent from here is reached. Change it in Settings, Email, or use Open in Gmail.'));
    return getToken(SCOPE).then(function (tok) {
      return fetch(SEND_URL, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: raw(d) }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { if (r.status === 401 || r.status === 403) delete tokens[SCOPE]; throw new Error('Gmail did not send it (' + r.status + (j && j.error && j.error.message ? ': ' + j.error.message : '') + ').'); }
          countSent(); return { ok: true, id: j.id || '' };
        }); });
    });
  }

  /* ---- the card ---- */
  function el(t, c, txt) { var e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; }
  function pill(label, kind) { var b = el('button', 'pill ' + kind); b.type = 'button'; b.appendChild(el('span', 'pl', label)); return b; }
  var CHIP = { draft: ['Draft · not sent', 'chip warn'], opened: ['Opened in Gmail', 'chip ghost'], sent: ['Sent', 'chip on'] };
  /** An email card. opts: { onSay(text), id (its outbox entry: edits and status are kept there), status, onChange() } */
  function card(d, opts) {
    opts = opts || {};
    var status = opts.status || 'draft', box = el('div', 'mailcard'), st = { sent: status === 'sent' };
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Email draft');
    var head = el('div', 'mhead'); head.appendChild(el('span', CHIP[status][1], CHIP[status][0])); head.appendChild(el('span', 'chip ghost', 'Email')); box.appendChild(head);
    function show(s) { status = s; head.firstChild.textContent = CHIP[s][0]; head.firstChild.className = CHIP[s][1]; }
    function mark(s) { show(s); if (opts.id) updateDraft(opts.id, { status: s }); if (opts.onChange) opts.onChange(); }
    /* sent from its other copy (the conversation or the Outbox): this copy can no longer send it again */
    function stale() {
      if (!opts.id || st.sent) return st.sent;
      var cur = getDraft(opts.id); if (!cur || cur.status !== 'sent') return false;
      sentHere(); msg.textContent = 'Already sent, from the Outbox or the conversation.'; return true;
    }
    function sentHere() { if (box.disarm) box.disarm(); st.sent = true; show('sent'); [to, su, bo].forEach(function (i) { i.readOnly = true; }); if (box.sendBtn) { box.sendBtn.disabled = true; box.sendBtn.querySelector('.pl').textContent = 'Sent'; } fr.hidden = true; }
    if (opts.id) {
      box.dataset.draft = opts.id;
      box.addEventListener('kin:draft', function (ev) {
        var d0 = ev.detail || {}; if (!d0.patch) return;
        if (d0.patch.status === 'sent') sentHere(); else if (d0.patch.status && !st.sent) show(d0.patch.status);
        if (typeof d0.patch.body === 'string' && document.activeElement !== bo && !st.sent) { bo.value = d0.patch.body; if (box.disarm) box.disarm(); }
      });
    }
    function field(lbl, val, multi) {
      var w = el('label', 'mrow'); w.appendChild(el('span', 'mlbl', lbl));
      var i = el(multi ? 'textarea' : 'input', 'minput'); if (!multi) { i.type = 'text'; i.autocomplete = 'off'; } else i.rows = Math.min(14, Math.max(5, String(val || '').split('\n').length + 1));
      i.value = val || ''; i.spellcheck = true; w.appendChild(i); box.appendChild(w); return i;
    }
    var to = field('To', d.to), fr = el('div', 'mfind'); fr.hidden = true; box.appendChild(fr);
    var su = field('Subject', d.subject), bo = field('Body', d.body, true);
    var msg = el('p', 'note mnote'); box.appendChild(msg);
    var acts = el('div', 'mact'); box.appendChild(acts);
    function draft() { return { to: to.value, subject: su.value, body: bo.value }; }
    /* edits are kept in the outbox, so a fixed address or a reworded line survives a reload */
    if (opts.id) { var saveT = 0; [to, su, bo].forEach(function (i) { i.addEventListener('input', function () { clearTimeout(saveT); saveT = setTimeout(function () { var x = draft(); x.edited = true; updateDraft(opts.id, x); }, 400); }); }); }
    /* a change after the read-back means the next tap must read it back again */
    [to, su, bo].forEach(function (i) { i.addEventListener('input', function () { if (box.disarm && box.armedNow && box.armedNow()) { box.disarm(); msg.textContent = 'Changed. Tap Send now again to read it back first.'; } }); });
    if (!st.sent && opts.id) { var c0 = getDraft(opts.id); if (c0 && c0.status === 'sent') { st.sent = true; status = 'sent'; head.firstChild.textContent = CHIP.sent[0]; head.firstChild.className = CHIP.sent[1]; } }
    if (st.sent) [to, su, bo].forEach(function (i) { i.readOnly = true; });
    /* a name in To instead of an address: one tap looks it up in Google Contacts (read-only, on this page only) */
    function findRow() {
      fr.textContent = ''; var names = bareNames(to.value);
      fr.hidden = st.sent || Kin.shared || !clientId() || !names.length; if (fr.hidden) return;
      loadGis(); var fb = el('button', 'lnk', 'Find ' + names[0] + ' in Contacts'); fb.type = 'button'; fr.appendChild(fb);
      fb.addEventListener('click', function () {
        fb.disabled = true; fb.textContent = 'Looking in your contacts…';
        loadGis().then(function () { return contacts(); }).then(function (list) {
          var hits = findPeople(names[0], list);
          if (hits.length === 1 && exactPerson(names[0], hits[0])) { use(names[0], hits[0]); return; }
          fr.textContent = '';
          if (!hits.length) { fr.appendChild(el('span', 'mfnote', 'No one called ' + names[0] + ' in your contacts. Type the address instead.')); return; }
          fr.appendChild(el('span', 'mfnote', hits.length === 1 ? 'Do you mean' : 'Which ' + names[0] + '?'));
          hits.forEach(function (h) { var b = el('button', 'mfpick'); b.type = 'button'; b.appendChild(el('b', '', h.name)); b.appendChild(el('span', '', h.email)); b.addEventListener('click', function () { use(names[0], h); }); fr.appendChild(b); });
        }, function (err) { fb.disabled = false; fb.textContent = 'Find ' + names[0] + ' in Contacts'; msg.textContent = String((err && err.message) || err); });
      });
    }
    function use(name, h) {
      to.value = to.value.split(/([,;]+)/).map(function (part) { return part.trim() === name ? (/^\s/.test(part) ? ' ' : '') + h.email : part; }).join('');
      to.dispatchEvent(new Event('input', { bubbles: true })); msg.textContent = 'To: ' + h.name + ' (' + h.email + ').';
    }
    to.addEventListener('input', function () { var n = bareNames(to.value)[0] || ''; if (n !== fr.dataset.n) { fr.dataset.n = n; findRow(); } });
    fr.dataset.n = bareNames(to.value)[0] || ''; findRow();
    var gm = pill('Open in Gmail', 'go'), cp = pill('Copy', 'alt');
    gm.addEventListener('click', function () { if (st.sent) { msg.textContent = 'Already sent. Use Copy if you need the words again.'; return; } if (stale()) return; var w = check(draft()); if (w && !/subject|empty/i.test(w)) { msg.textContent = w; return; } window.open(composeUrl(draft()), '_blank', 'noopener,noreferrer'); msg.textContent = 'Opened in Gmail. Press Send there when it looks right.'; if (!st.sent) mark('opened'); });
    box.openInGmail = function () { gm.click(); };
    cp.addEventListener('click', function () { var x = draft(), t = 'To: ' + x.to + '\nSubject: ' + x.subject + '\n\n' + x.body; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { msg.textContent = 'Copied.'; }, function () { msg.textContent = 'This browser would not copy it; select the text instead.'; }); });
    acts.appendChild(gm); acts.appendChild(cp);
    if (!Kin.shared && clientId()) {
      loadGis();
      var sn = pill('Send now', 'warn'), armed = false, armT = 0;
      box.sendBtn = sn;
      box.disarm = function () { armed = false; clearTimeout(armT); if (!st.sent) sn.querySelector('.pl').textContent = 'Send now'; };
      box.armedNow = function () { return armed; };
      sn.addEventListener('click', function (e) {
        if (!e.isTrusted || st.sent || stale()) return;
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
          st.sent = true; sn.querySelector('.pl').textContent = 'Sent'; if (opts.id) updateDraft(opts.id, x); mark('sent');
          [to, su, bo].forEach(function (i) { i.readOnly = true; }); msg.textContent = 'Sent from your Gmail. ' + (cap() - sentToday()) + ' of ' + cap() + ' left today.';
          if (opts.onSay) opts.onSay('Sent, sir.');
        }, function (err) { sn.disabled = false; sn.querySelector('.pl').textContent = 'Send now'; msg.textContent = String((err && err.message) || err); });
      });
      acts.insertBefore(sn, acts.firstChild);
      msg.textContent = 'Check it, then Send now (twice: once to read it back, once to send), or Open in Gmail.';
    } else msg.textContent = Kin.shared ? 'Open in Gmail to send it.' : 'Check it, then Open in Gmail and press Send there. To send from here instead, set up Settings, Email.';
    return box;
  }

  /* ---- calendar event drafts: a card the founder adds with a tap. Google Calendar's own page opens filled in
     (they press Save there), or a .ics file goes to Apple Calendar or Outlook. Nothing is added from here. ---- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function evCheck(e) {
    if (!String(e.title || '').trim()) return 'Add a title.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') || isNaN(Date.parse(e.date + 'T00:00:00'))) return 'Pick a date.';
    if (!e.allDay) {
      if (!/^\d{2}:\d{2}$/.test(e.start || '')) return 'Add a start time, or make it all day.';
      if (e.end && !/^\d{2}:\d{2}$/.test(e.end)) return 'The end time is not a time.';
      if (e.end && e.end === e.start) return 'It ends when it starts: change the end time.';
    }
    return '';
  }
  function stampLocal(d) { return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + pad2(d.getMinutes()) + '00'; }
  /** start and end in calendar form: YYYYMMDD for all day (the end is the next day), else local YYYYMMDDTHHMMSS */
  /* clock arithmetic, not milliseconds: an hour later and the next day stay right across a daylight-saving change */
  function evTimes(e) {
    var y = +e.date.slice(0, 4), mo = +e.date.slice(5, 7) - 1, d = +e.date.slice(8, 10);
    if (e.allDay) { var nx = new Date(y, mo, d + 1); return { allDay: true, s: e.date.replace(/-/g, ''), t: nx.getFullYear() + pad2(nx.getMonth() + 1) + pad2(nx.getDate()) }; }
    var sh = +e.start.slice(0, 2), sm = +e.start.slice(3, 5), a = new Date(y, mo, d, sh, sm), b;
    if (!e.end) b = new Date(y, mo, d, sh + 1, sm);
    else { var eh = +e.end.slice(0, 2), em = +e.end.slice(3, 5); b = new Date(y, mo, e.end < e.start ? d + 1 : d, eh, em); }
    return { allDay: false, s: stampLocal(a), t: stampLocal(b), overnight: !!(e.end && e.end < e.start) };
  }
  function eventUrl(e) {
    var t = evTimes(e), q = 'action=TEMPLATE&text=' + encodeURIComponent(String(e.title).trim()) + '&dates=' + t.s + '/' + t.t, tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (x) {}
    if (tz && !t.allDay) q += '&ctz=' + encodeURIComponent(tz);
    if (e.details) q += '&details=' + encodeURIComponent(e.details);
    if (e.location) q += '&location=' + encodeURIComponent(e.location);
    var g = splitAddrs(e.guests).filter(function (x) { return ADDR.test(x); });
    if (g.length) q += '&add=' + encodeURIComponent(g.join(','));
    return 'https://calendar.google.com/calendar/render?' + q;
  }
  function icsText(x) { return String(x || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  /* lines of at most 75 bytes of UTF-8, broken between characters, never inside one (an emoji or a Korean letter) */
  function icsFold(line) {
    var out = [], cur = '', n = 0, max = 75;
    Array.from(line).forEach(function (ch) {
      var c = ch.codePointAt(0), b = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
      if (n + b > max) { out.push(cur); cur = ' '; n = 1; }
      cur += ch; n += b;
    });
    out.push(cur); return out.join('\r\n');
  }
  /** an iCalendar file for Apple Calendar, Outlook or a phone. Times are local ("floating"); guests are listed in
      the notes rather than invited, so opening the file never sends anyone an invitation. */
  function ics(e) {
    var t = evTimes(e), n = new Date(), stamp = n.getUTCFullYear() + pad2(n.getUTCMonth() + 1) + pad2(n.getUTCDate()) + 'T' + pad2(n.getUTCHours()) + pad2(n.getUTCMinutes()) + pad2(n.getUTCSeconds()) + 'Z';
    var uid = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)) + '@jarvis';
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jarvis//Event draft//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp,
      (t.allDay ? 'DTSTART;VALUE=DATE:' : 'DTSTART:') + t.s, (t.allDay ? 'DTEND;VALUE=DATE:' : 'DTEND:') + t.t, 'SUMMARY:' + icsText(String(e.title).trim())];
    if (e.location) L.push('LOCATION:' + icsText(e.location));
    var gs = splitAddrs(e.guests), notes = [e.details || '', gs.length ? 'Guests: ' + gs.join(', ') : ''].filter(Boolean).join('\n\n');
    if (notes) L.push('DESCRIPTION:' + icsText(notes));
    L.push('END:VEVENT', 'END:VCALENDAR');
    return L.map(icsFold).join('\r\n') + '\r\n';
  }
  var ECHIP = { draft: ['Event · not added', 'chip warn'], opened: ['Opened in Google Calendar', 'chip ghost'], saved: ['Downloaded', 'chip ghost'] };
  /** An event card. opts: { onSay(text) } */
  function eventCard(e0, opts) {
    opts = opts || {};
    var box = el('div', 'mailcard evcard'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Calendar event draft');
    var head = el('div', 'mhead'), chip = el('span', ECHIP.draft[1], ECHIP.draft[0]); head.appendChild(chip); head.appendChild(el('span', 'chip ghost', 'Calendar')); box.appendChild(head);
    function mark(k) { chip.textContent = ECHIP[k][0]; chip.className = ECHIP[k][1]; }
    function inp(type, val) { var i = el('input', 'minput'); i.type = type; i.value = val || ''; i.autocomplete = 'off'; return i; }
    function row(lbl, i) { var w = el('label', 'mrow'); w.appendChild(el('span', 'mlbl', lbl)); w.appendChild(i); box.appendChild(w); return i; }
    var ti = row('Title', inp('text', e0.title)), dt = row('Date', inp('date', e0.date));
    var st = inp('time', e0.allDay ? '' : e0.start), en = inp('time', e0.allDay ? '' : e0.end), ad = el('input'); ad.type = 'checkbox'; ad.checked = !!e0.allDay;
    st.setAttribute('aria-label', 'Starts'); en.setAttribute('aria-label', 'Ends');
    var tr = el('div', 'mrow evtimes'), tb = el('div', 'evt'), al = el('label', 'evall'); tr.appendChild(el('span', 'mlbl', 'Time'));
    tb.appendChild(st); tb.appendChild(el('span', 'evto', 'to')); tb.appendChild(en); al.appendChild(ad); al.appendChild(document.createTextNode('All day')); tb.appendChild(al); tr.appendChild(tb); box.appendChild(tr);
    function syncAll() { st.disabled = en.disabled = ad.checked; tr.classList.toggle('isall', ad.checked); }
    ad.addEventListener('change', syncAll); syncAll();
    [st, en].forEach(function (i) { i.addEventListener('input', function () { if (!ad.checked && st.value && en.value && en.value < st.value) msg.textContent = 'It runs past midnight and ends the next day.'; }); });
    var wh = row('Where', inp('text', e0.location)), gu = row('Guests', inp('text', e0.guests)); gu.placeholder = 'Email addresses, comma separated';
    var no = el('textarea', 'minput'); no.rows = 3; no.value = e0.details || ''; var nw = el('label', 'mrow'); nw.appendChild(el('span', 'mlbl', 'Notes')); nw.appendChild(no); box.appendChild(nw);
    var msg = el('p', 'note mnote'), acts = el('div', 'mact'); box.appendChild(msg); box.appendChild(acts);
    function draft() { return { title: ti.value, date: dt.value, start: st.value, end: en.value, allDay: ad.checked, location: wh.value, guests: gu.value, details: no.value }; }
    var add = pill('Add to Google Calendar', 'go'), dl = pill('Download .ics', 'alt'), cp = pill('Copy', 'alt');
    add.addEventListener('click', function () {
      var x = draft(), w = evCheck(x); if (w) { msg.textContent = w; return; }
      window.open(eventUrl(x), '_blank', 'noopener,noreferrer'); mark('opened');
      msg.textContent = 'Opened Google Calendar with it filled in. Press Save there to add it.'; if (opts.onSay) opts.onSay('It is open in Google Calendar, sir. Press Save there.');
    });
    dl.addEventListener('click', function () {
      var x = draft(), w = evCheck(x); if (w) { msg.textContent = w; return; }
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics(x)], { type: 'text/calendar' }));
      a.download = (String(x.title).trim().replace(/[^\w\- ]+/g, '').trim().slice(0, 40).replace(/\s+/g, '-') || 'event') + '.ics';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); mark('saved');
      msg.textContent = 'Downloaded. Open the file to add it to Apple Calendar or Outlook.';
    });
    cp.addEventListener('click', function () {
      var x = draft(), t = x.title + '\n' + x.date + (x.allDay ? ', all day' : ', ' + x.start + (x.end ? '\u2013' + x.end : '')) + (x.location ? '\n' + x.location : '') + (x.guests ? '\nGuests: ' + x.guests : '') + (x.details ? '\n\n' + x.details : '');
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { msg.textContent = 'Copied.'; }, function () { msg.textContent = 'Copy failed.'; });
    });
    acts.appendChild(add); acts.appendChild(dl); acts.appendChild(cp);
    msg.textContent = evCheck(draft()) || 'Check it, then add it with a tap. Nothing is added until you do.';
    return box;
  }

  Kin.email = { eventCard: eventCard, eventUrl: eventUrl, ics: ics, evCheck: evCheck, contacts: contacts, findPeople: findPeople, bareNames: bareNames, composeUrl: composeUrl, raw: raw, check: check, send: send, card: card, clientId: clientId, setClientId: setClientId, cap: cap, setCap: setCap, sentToday: sentToday, loadGis: loadGis,
    outbox: outbox, saveDraft: saveDraft, updateDraft: updateDraft, dropDraft: dropDraft, clearSent: clearSent, waiting: waiting,
    inbox: inbox, threadUrl: threadUrl, calendar: calendar,
    canSend: function () { return !Kin.shared && !!clientId(); },
    canRead: function () { return !Kin.shared && !!clientId(); },
    wipe: function () { [K.cid, K.cap, K.sent, K.box].forEach(ls.del); tokens = {}; } };
})();
