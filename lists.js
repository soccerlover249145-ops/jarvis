/* lists.js: lists kept on this device (shopping, to-do, packing, or any name you give).
   "add oat milk and eggs to my shopping list", "put call Sam on my to-do list", "what's on my shopping list",
   "remove eggs from my shopping list", "tick off eggs", "clear my shopping list", "what lists do I have".
   Understood here, with no call to Claude. Claude can add to one with the add_to_list tool (brain.js), for things
   like "add what I need for lasagna to my shopping list". The Lists tab on the shelf shows them (app.js).
   Nothing is sent anywhere.
   Public surface (window.Kin.lists): instant(text), all(), names(), get(name), add(name, items), remove(name, id),
   toggle(name, id), clear(name, doneOnly), undo(u), restore(list), drop(name), key(name), title(name), split(text),
   text(name), onChange(fn), findItem(words, name, strict), error() */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var KEY = 'kin.lists', MAX_LISTS = 30, MAX_ITEMS = 300, subs = [];
  /* the usual names, so "groceries", "grocery list" and "shopping" are one list */
  var ALIAS = { shopping: 'shopping', grocery: 'shopping', groceries: 'shopping', 'grocery shopping': 'shopping', food: 'shopping',
    'to-do': 'to-do', 'to do': 'to-do', todo: 'to-do', todos: 'to-do', 'to-dos': 'to-do', task: 'to-do', tasks: 'to-do', 'things to do': 'to-do', packing: 'packing' };
  /* "mac and cheese" is one thing, not two */
  var BOTH = ['salt and vinegar', 'ben and jerry\'s', 'surf and turf', 'needle and thread', 'lock and key', 'mac and cheese', 'macaroni and cheese', 'salt and pepper', 'fish and chips', 'bread and butter', 'peanut butter and jelly', 'pb and j', 'half and half', 'sweet and sour', 'ham and cheese', 'rice and beans', 'chips and salsa', 'cookies and cream', 'oil and vinegar', 'pen and paper', 'nuts and bolts', 'bits and pieces', 'black and white', 'cheese and crackers', 'spaghetti and meatballs', 'bacon and eggs', 'sour cream and onion', 'shampoo and conditioner', 'law and order', 'pros and cons', 'research and development', 'r and d', 'q and a', 'p and l', 'b and b'];

  /* at an address shared with other pages nothing private is written down: lists live in memory only (guard.js) */
  var mem = null, lastErr = '';
  function read() {
    var raw = '{}'; if (Kin.shared) raw = JSON.stringify(mem || {}); else { try { raw = localStorage.getItem(KEY) || '{}'; } catch (e) { raw = '{}'; } }
    try { var d = JSON.parse(raw); return d && Array.isArray(d.lists) ? d : { lists: [] }; } catch (e) { return { lists: [] }; }
  }
  function write(d) {
    var ok = true;
    if (Kin.shared) mem = d; else { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { ok = false; } }
    lastErr = ok ? '' : 'storage';
    subs.forEach(function (f) { try { f(); } catch (x) {} });
    return ok;
  }
  /* own names only: a list called "constructor" is just a name */
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clean(t, n) { return String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\]\s*\(/g, '] (').replace(/\s+/g, ' ').trim().slice(0, n || 160); }
  /** "my Grocery list" -> "shopping"; "the hardware store" -> "hardware store" */
  function key(name) {
    var k = clean(name, 60).toLowerCase().replace(/[‘’]/g, "'").replace(/^(?:my|the|our|a)\s+/, '').replace(/\s+list$/, '').replace(/['’]s$/, '').trim();
    return own(ALIAS, k) || k;
  }
  function title(name) { var k = key(name); return k === 'to-do' ? 'To-do' : k.charAt(0).toUpperCase() + k.slice(1); }
  function all() { return read().lists; }
  function names() { return all().map(function (l) { return l.name; }); }
  function get(name) { var k = key(name); return all().filter(function (l) { return l.name === k; })[0] || null; }
  /* "eggs" -> "Eggs"; "iPhone charger" and "eBay return" stay as said */
  function cap(s) { return !s || /^[a-z]+[A-Z]/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1); }
  /** "eggs, milk and bread" -> ["Eggs", "Milk", "Bread"]; "mac and cheese" stays one */
  function split(text) {
    var t = clean(text, 600).replace(/[.!?]+$/, '');
    if (!t) return [];
    var keep = [], i = 0;
    BOTH.forEach(function (b) { t = t.replace(new RegExp('\\b' + b.replace(/ /g, '\\s+') + '\\b', 'gi'), function (m) { keep.push(m); return '\u0001' + (keep.length - 1) + '\u0001'; }); });
    var parts = t.split(/\s*,\s*(?:and\s+|&\s+)?|\s+(?:and|&|plus)\s+/i);
    return parts.map(function (p) { return p.replace(/\u0001(\d+)\u0001/g, function (m, n) { return keep[+n]; }).replace(/^(?:some|a few|a couple of|a|an)\s+/i, '').trim(); })
      .filter(function (p) { return p && p.length <= 160; }).map(cap).slice(0, 40);
  }
  /** adds items (a string to split, or an array); duplicates (same words) are not added twice, and a ticked-off one is
      opened again. Returns { list, added: [items, new or opened again], fresh: [ids of new ones], reopened: [ids] } */
  function add(name, items) {
    var k = key(name); if (!k) return null;
    var d = read(), l = d.lists.filter(function (x) { return x.name === k; })[0];
    if (!l) { if (d.lists.length >= MAX_LISTS) return null; l = { id: uid('L'), name: k, items: [], made: Date.now() }; d.lists.push(l); }
    var arr = Array.isArray(items) ? items.map(function (x) { return cap(clean(x)); }).filter(Boolean) : split(items), added = [], fresh = [], reopened = [];
    arr.forEach(function (text) {
      var same = l.items.filter(function (it) { return it.text.toLowerCase() === text.toLowerCase(); })[0];
      if (same) { if (same.done && reopened.indexOf(same.id) < 0) { same.done = 0; added.push(same); reopened.push(same.id); } return; }
      if (l.items.length >= MAX_ITEMS) return;
      var it = { id: uid('i'), text: text, at: Date.now() }; l.items.push(it); added.push(it); fresh.push(it.id);
    });
    l.at = Date.now(); if (!write(d)) return null; return { list: l, added: added, fresh: fresh, reopened: reopened };
  }
  function edit(name, f) { var k = key(name), d = read(), l = d.lists.filter(function (x) { return x.name === k; })[0]; if (!l) return null; var r = f(l, d); l.at = Date.now(); write(d); return r; }
  function remove(name, id) { return edit(name, function (l) { var n = l.items.length; l.items = l.items.filter(function (it) { return it.id !== id; }); return n !== l.items.length; }); }
  function toggle(name, id) { return edit(name, function (l) { var it = l.items.filter(function (x) { return x.id === id; })[0]; if (!it) return null; it.done = it.done ? 0 : Date.now(); return it; }); }
  /** clears a list (or only what is ticked off); returns what to hand undo() to put those items back */
  function clear(name, doneOnly) { return edit(name, function (l) { var gone = l.items.filter(function (it) { return !doneOnly || it.done; }); l.items = doneOnly ? l.items.filter(function (it) { return !it.done; }) : []; return { name: l.name, put: JSON.parse(JSON.stringify(gone)) }; }); }
  /** Undo, one change at a time, leaving everything else on the list as it is now: { name, put: [items], drop: [ids],
      untick: [ids], retick: [ids] }, or an array of them */
  function undo(u) {
    (Array.isArray(u) ? u : [u]).forEach(function (x) {
      if (!x || !x.name) return;
      var d = read(), l = d.lists.filter(function (y) { return y.name === x.name; })[0];
      if (!l) { if (!(x.put && x.put.length) || d.lists.length >= MAX_LISTS) return; l = { id: uid('L'), name: x.name, items: [], made: Date.now() }; d.lists.push(l); }
      var ids = function (a) { return Array.isArray(a) ? a : []; };
      l.items = l.items.filter(function (it) { return ids(x.drop).indexOf(it.id) < 0; });
      l.items.forEach(function (it) { if (ids(x.untick).indexOf(it.id) >= 0) it.done = 0; if (ids(x.retick).indexOf(it.id) >= 0) it.done = it.done || Date.now(); });
      ids(x.put).forEach(function (it) { if (it && typeof it.id === 'string' && typeof it.text === 'string' && !l.items.some(function (y) { return y.id === it.id || y.text.toLowerCase() === it.text.toLowerCase(); }) && l.items.length < MAX_ITEMS) l.items.push(it); });
      l.items.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
      l.at = Date.now(); write(d);
    });
  }
  function restore(copy) { if (!copy || !copy.name) return; var d = read(), i = -1; d.lists.forEach(function (x, j) { if (x.name === copy.name) i = j; }); if (i >= 0) d.lists[i] = copy; else d.lists.push(copy); write(d); }
  function drop(name) { var k = key(name), d = read(), n = d.lists.length; d.lists = d.lists.filter(function (x) { return x.name !== k; }); if (d.lists.length !== n) write(d); return d.lists.length !== n; }
  /** finds an item by its words ("eggs" finds "Eggs, a dozen"); in one list, or in any. strict: the same words, or the
      words at the start of the item ("I got the eggs" never ticks off "Look for eggs"), and not on the to-do list
      unless it is named */
  function findItem(words, name, strict) {
    var w = clean(words).toLowerCase().replace(/^(?:the|some|my|a|an)\s+/, ''); if (!w || w.length < 2) return null;
    /* "I got it" and "tick that off" name nothing */
    if (/^(?:it|them|this|that|these|those|one|that one|this one|everything|all|all of it|all of them|some|stuff|the lot)$/.test(w)) return null;
    var pool = name ? [get(name)].filter(Boolean) : all().filter(function (l) { return !strict || l.name !== 'to-do'; }), hit = null, esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), whole = new RegExp('(?:^|[^a-z0-9])' + esc + '(?:$|[^a-z0-9])', 'i');
    /* the same words first, then the words inside an item ("eggs" finds "Eggs, a dozen", but "egg" does not find "Eggplant") */
    var bare = function (x) { return x.toLowerCase().replace(/^(?:the|a|an|some)\s+/, ''); };
    pool.forEach(function (l) { l.items.forEach(function (it) { if (!hit && bare(it.text) === w) hit = { list: l, item: it }; }); });
    var start = new RegExp('^(?:(?:the|a|an|some)\\s+)?' + esc + '(?:$|[^a-z0-9])', 'i');
    if (!hit) pool.forEach(function (l) { l.items.forEach(function (it) { if (!hit && !it.done && (strict ? start : whole).test(it.text)) hit = { list: l, item: it }; }); });
    return hit;
  }

  /* ---------------------------------------------------------------- the words Jarvis answers to */
  function joinWords(a) { return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function low(s) { return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  var COMMON = { shopping: 1, 'to-do': 1, packing: 1 };
  var LIST = '((?:my|the|our)\\s+[^,.!?]{1,40}?)\\s+list';
  var RE = {
    add: new RegExp('^(?:add|put|stick|throw|pop|jot down|note down)\\s+(.+?)\\s+(?:to|on|onto|in|into)\\s+' + LIST + '$', 'i'),
    addTo: new RegExp('^(?:on|to)\\s+' + LIST + ',?\\s+(?:add|put)\\s+(.+)$', 'i'),
    read: new RegExp('^(?:(?:tell me|remind me|show me)\\s+)?(?:what\'?s|what is|what are|what do i have|what have i got|anything)\\s+(?:on|in)\\s+' + LIST + '$|^(?:read|show|read me|show me|tell me|open|check|give me)\\s+' + LIST + '$|^' + LIST + '$', 'i'),
    remove: new RegExp('^(?:remove|delete|take|drop|erase)\\s+(.+?)\\s+(?:off|from|out of)\\s+' + LIST + '$', 'i'),
    tick: new RegExp('^(?:tick|check|cross|mark)\\s+(?:off\\s+(.+?)|(.+?)\\s+(?:off|as done|done))(?:\\s+(?:on|from)\\s+' + LIST + ')?$', 'i'),
    got: new RegExp('^i\\s+(?:got|bought|picked up|have got|have bought)\\s+(?:the\\s+)?(.+?)(?:\\s+(?:on|from)\\s+' + LIST + ')?$', 'i'),
    clear: new RegExp('^(?:clear|empty|wipe|delete|reset)(?:\\s+out)?\\s+' + LIST + '$', 'i'),
    clearDone: new RegExp('^(?:clear|remove|delete)\\s+(?:the\\s+)?(?:ticked|checked|done|crossed off|finished)(?:\\s+(?:off\\s+)?(?:items|things|ones))?(?:\\s+(?:from|on)\\s+' + LIST + ')?$', 'i'),
    lists: /^(?:what|which) lists (?:do i have|have i got)(?: here)?$|^(?:(?:show|open|read)\s+)?(?:me\s+)?(?:all\s+)?(?:of\s+)?my lists$/i
  };
  function tidy(raw) {
    return String(raw || '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '')
      .replace(/^(?:(?:hey|ok|okay)\s+)?(?:jarvis|kin)[,!.]?\s+/i, '').replace(/^(?:(?:please|can you|could you|would you|will you|kindly)[,]?\s+)+/i, '').replace(/,?\s+(?:please|jarvis|sir)$/i, '').trim();
  }
  function lines(l) {
    var open = l.items.filter(function (it) { return !it.done; }), done = l.items.length - open.length;
    return { open: open, done: done };
  }
  function instant(raw) {
    var t = tidy(raw); if (!t || t.length > 300) return null;
    var m;
    if (RE.lists.test(t)) {
      var ls = all(); if (!ls.length) return { say: 'You have no lists yet, sir.', show: 'No lists yet. Say "add eggs to my shopping list".', open: 'lists' };
      return { say: 'You have ' + (ls.length === 1 ? 'one list' : ls.length + ' lists') + ', sir: ' + joinWords(ls.map(function (l) { return title(l.name).toLowerCase(); })) + '.', show: ls.map(function (l) { return '- ' + title(l.name) + ': ' + lines(l).open.length + ' to go'; }).join('\n'), open: 'lists' };
    }
    if ((m = RE.add.exec(t)) || (m = RE.addTo.exec(t))) {
      var lname = RE.add.test(t) ? m[2] : m[1], what = RE.add.test(t) ? m[1] : m[2];
      if (/\b(?:calendar|outbox|inbox|reminders?)\b/i.test(lname)) return null;
      /* "add what I need for lasagna to my shopping list" needs Claude to work out the items (add_to_list) */
      if (/^(?:what|whatever|everything|anything|all (?:the|that|of)|the ingredients|ingredients|the stuff|stuff|the things|things|the items|items|the rest|the usual|this|that|these|those|it|them|up|together)\b/i.test(what.trim())) return null;
      /* "add ideas for the trip", "a few snacks", "ingredients for tacos", "a column": Claude works those out (add_to_list) */
      if (/\b(?:ideas?|suggestions?|ingredients|recipes?|columns?|rows?|a few|a couple of things|some things|each|every)\b/i.test(what)) return null;
      var r = add(lname, what); if (!r) return lastErr === 'storage' ? { say: 'I could not save that on this device, sir.', show: 'The list could not be saved: this browser\'s storage for Jarvis is full or blocked.' } : { say: 'I can keep up to thirty lists, sir.', show: 'Too many lists. Remove one in the Lists tab first.' };
      var nm = title(r.list.name).toLowerCase();
      if (!r.added.length) return { say: 'That is already on your ' + nm + ' list, sir.', show: 'Already on your ' + nm + ' list.', open: 'lists' };
      return { say: 'Added ' + joinWords(r.added.map(function (x) { return low(x.text); })) + ' to your ' + nm + ' list, sir.', show: 'Added to your ' + nm + ' list: ' + r.added.map(function (x) { return x.text; }).join(', ') + '.', list: { name: r.list.name }, undoList: { name: r.list.name, drop: r.fresh, retick: r.reopened } };
    }
    if ((m = RE.clearDone.exec(t))) {
      var targets = m[1] ? [get(m[1])].filter(Boolean) : all(), n0 = 0, back = [];
      targets.forEach(function (l) { var nd = l.items.length - lines(l).open.length; if (!nd) return; n0 += nd; back.push(clear(l.name, true)); });
      return n0 ? { say: 'Cleared ' + n0 + ' ticked-off ' + (n0 === 1 ? 'item' : 'items') + ', sir.', show: 'Cleared ' + n0 + ' ticked-off ' + (n0 === 1 ? 'item' : 'items') + '.', undoList: back } : { say: 'Nothing is ticked off, sir.', show: 'Nothing ticked off.' };
    }
    if ((m = RE.clear.exec(t))) {
      var cl = get(m[1]); if (!cl) return own(COMMON, key(m[1])) ? { say: 'Your ' + key(m[1]) + ' list is already empty, sir.', show: 'Nothing to clear.' } : null;
      var n1 = cl.items.length; if (!n1) return { say: 'Your ' + title(cl.name).toLowerCase() + ' list is already empty, sir.', show: 'Nothing to clear.' };
      var copy = clear(cl.name, false);
      return { say: 'Cleared your ' + title(cl.name).toLowerCase() + ' list, sir.', show: 'Cleared your ' + title(cl.name).toLowerCase() + ' list (' + n1 + (n1 === 1 ? ' item' : ' items') + ').', undoList: copy };
    }
    if ((m = RE.remove.exec(t))) {
      if (!get(m[2]) && !own(COMMON, key(m[2]))) return null;
      var hr = findItem(m[1], m[2]); if (!hr) return { say: 'I can\'t find that on your ' + key(m[2]) + ' list, sir.', show: 'Not on your ' + title(m[2]).toLowerCase() + ' list: ' + m[1] + '.' };
      var gone = JSON.parse(JSON.stringify(hr.item)); remove(hr.list.name, hr.item.id);
      return { say: 'Removed ' + low(hr.item.text) + ', sir.', show: 'Removed from your ' + title(hr.list.name).toLowerCase() + ' list: ' + hr.item.text + '.', undoList: { name: hr.list.name, put: [gone] } };
    }
    if ((m = RE.read.exec(t))) {
      var rn = m[1] || m[2] || m[3], rl = get(rn);
      /* "check the guest list" with no such list here is a question for Claude */
      if (!rl && !own(COMMON, key(rn))) return null;
      if (!rl || !rl.items.length) return { say: 'Your ' + key(rn) + ' list is empty, sir.', show: 'Your ' + title(rn).toLowerCase() + ' list is empty. Say "add eggs to my ' + key(rn) + ' list".', open: 'lists' };
      var L = lines(rl), op = L.open.map(function (x) { return x.text; });
      if (!op.length) return { say: 'Everything on your ' + title(rl.name).toLowerCase() + ' list is ticked off, sir.', show: 'All ' + L.done + ' ticked off.', open: 'lists' };
      return { say: (op.length === 1 ? 'One thing' : op.length + ' things') + ' on your ' + title(rl.name).toLowerCase() + ' list, sir: ' + joinWords(op.slice(0, 12).map(low)) + (op.length > 12 ? ', and ' + (op.length - 12) + ' more' : '') + '.',
        show: op.map(function (x) { return '- ' + x; }).join('\n') + (L.done ? '\n\n' + L.done + ' ticked off.' : ''), open: 'lists' };
    }
    /* "tick off eggs" and "I got the eggs" only when the thing is on a list; otherwise they are ordinary chat */
    var tk = RE.tick.exec(t), gt = tk ? null : RE.got.exec(t);
    if (tk || gt) {
      if (!all().length) return null;
      var hit = tk ? findItem(tk[1] || tk[2], tk[3]) : findItem(gt[1], gt[2], true); if (!hit) return null;
      var was = !!hit.item.done; if (!was) toggle(hit.list.name, hit.item.id);
      return { say: 'Ticked off ' + low(hit.item.text) + ', sir.', show: 'Ticked off on your ' + title(hit.list.name).toLowerCase() + ' list: ' + hit.item.text + '.', undoList: was ? null : { name: hit.list.name, untick: [hit.item.id] } };
    }
    return null;
  }
  /** lists from another device (move.js): items not on a list yet (the same id or the same words), each cleaned,
      ticked ones still ticked; a list is made only for an item that comes in. dry: nothing changes, and the items that
      would come in are returned ({ list, text }). Otherwise returns how many came in */
  function mergeIn(lists, dry) {
    if (!Array.isArray(lists)) return dry ? [] : 0;
    var d = read(), adds = [];
    lists.slice(0, MAX_LISTS).forEach(function (x) {
      if (!x || typeof x !== 'object' || typeof x.name !== 'string' || !Array.isArray(x.items)) return;
      var k = key(x.name); if (!k) return;
      var l = d.lists.filter(function (y) { return y.name === k; })[0];
      x.items.slice(0, MAX_ITEMS).forEach(function (it) {
        if (!it || typeof it !== 'object' || typeof it.text !== 'string') return;
        var t = cap(clean(it.text)); if (!t) return;
        if (!l) { if (d.lists.length >= MAX_LISTS) return; l = { id: uid('L'), name: k, items: [], made: Date.now() }; d.lists.push(l); }
        if (l.items.length >= MAX_ITEMS || l.items.some(function (y) { return y.id === it.id || y.text.toLowerCase() === t.toLowerCase(); })) return;
        l.items.push({ id: typeof it.id === 'string' && /^i[a-z0-9]{4,40}$/.test(it.id) ? it.id : uid('i'), text: t, at: isFinite(it.at) && Math.abs(+it.at) <= 8.64e15 ? Math.round(+it.at) : Date.now(), done: it.done ? (isFinite(it.done) && +it.done > 0 && +it.done <= 8.64e15 ? Math.round(+it.done) : Date.now()) : 0 });
        adds.push({ list: title(k), text: t });
      });
    });
    if (dry) return adds;
    if (adds.length) write(d);
    return adds.length;
  }
  /** a list in plain words, for Claude when the founder asks about it (read_list in brain.js): open items first */
  function text(name) {
    var l = get(name); if (!l) return null;
    var L = lines(l);
    return { name: title(l.name), open: L.open.slice(0, 80).map(function (x) { return x.text; }), done: l.items.filter(function (x) { return x.done; }).slice(0, 40).map(function (x) { return x.text; }), more: Math.max(0, L.open.length - 80) };
  }
  function onChange(f) { subs.push(f); }
  try { window.addEventListener('storage', function (e) { if (e.key === KEY) subs.forEach(function (f) { try { f(); } catch (x) {} }); }); } catch (e) {}

  Kin.lists = { error: function () { return lastErr; }, mergeIn: mergeIn, instant: instant, all: all, names: names, get: get, add: add, remove: remove, toggle: toggle, clear: clear, undo: undo, restore: restore, drop: drop, key: key, title: title, split: split, text: text, onChange: onChange, findItem: findItem };
})();
