'use strict';
/* actions.js: the only things Jarvis can open on the Mac, outside "take control".

   There is no shell. Each action is a fixed function with its input checked here:
   - open a web address (http or https only, no passwords in the address)
   - search the web in a new browser tab
   - open an app the owner put on the allowlist (by name; the path comes from the list, not the model)
   - reveal or open a file inside a folder the owner picked (no way out through .. or links);
     anything that could run code is only ever revealed in Finder, never opened
   - list file names in those folders, so Jarvis can find the file you mean
   Nothing here deletes, moves, writes or sends anything. Every action shows a toast. */

const path = require('path');
const fsp = require('fs').promises;

const SEARCH = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q='
};

/* Opening any of these runs code or changes the system, so they are revealed in Finder instead. */
const RUNNABLE = new Set(['app', 'command', 'tool', 'sh', 'bash', 'zsh', 'csh', 'fish', 'py', 'rb', 'pl', 'php', 'js', 'mjs', 'cjs', 'jar',
  'pkg', 'mpkg', 'dmg', 'scpt', 'scptd', 'applescript', 'workflow', 'action', 'terminal', 'term', 'prefpane', 'kext', 'plugin', 'bundle',
  'mobileconfig', 'webloc', 'inetloc', 'fileloc', 'url', 'desktop', 'exe', 'bat', 'cmd', 'ps1', 'vbs', 'service', 'saver', 'shortcut',
  'osax', 'dylib', 'so', 'framework', 'xpc', 'qlgenerator', 'mdimporter', 'appex', 'definition', 'wflow']);

function cleanUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return { ok: false, why: 'That is not a web address.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, why: 'Only http and https addresses can be opened.' };
  if (u.username || u.password) return { ok: false, why: 'Addresses with a password in them are not opened.' };
  if (!u.hostname) return { ok: false, why: 'That address has no site.' };
  if (u.href.length > 4000) return { ok: false, why: 'That address is too long.' };
  return { ok: true, url: u.href };
}

function searchUrl(query, engine) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!q) return { ok: false, why: 'Nothing to search for.' };
  const base = SEARCH[engine] || SEARCH.google;
  return { ok: true, url: base + encodeURIComponent(q), query: q };
}

function norm(s) { return String(s || '').toLowerCase().replace(/\.app$/, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

/** find an allowlisted app by the name Jarvis gives. apps: [{ name, path }] from the owner's settings. */
function findApp(name, apps) {
  const n = norm(name);
  if (!n) return null;
  const list = (apps || []).filter(function (a) { return a && typeof a.path === 'string' && /^\/.*\.app$/i.test(a.path); });
  return list.find(function (a) { return norm(a.name) === n || norm(path.basename(a.path)) === n; }) ||
    list.find(function (a) { const an = norm(a.name); return an.length >= 3 && (an.indexOf(n) === 0 || n.indexOf(an) === 0); }) || null;
}

/** is real path p inside one of the owner's folders (also real paths)? */
function inside(p, folders) {
  return (folders || []).some(function (f) {
    const rel = path.relative(f, p);
    return rel === '' || (rel && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
  });
}

function runnable(p) {
  const parts = p.split(path.sep);
  /* a file inside an app bundle counts as the app */
  if (parts.some(function (seg) { return /\.(app|framework|bundle|plugin|prefpane|kext|xpc|appex)$/i.test(seg); })) return true;
  const ext = path.extname(p).slice(1).toLowerCase();
  return RUNNABLE.has(ext);
}

/**
 * Resolve a file Jarvis asked for. The model's path is untrusted: it may be relative to a folder
 * or absolute. Both are canonicalized (links followed) and must land inside an owner folder.
 */
async function resolveFile(raw, folders, fs) {
  fs = fs || fsp;
  const want = String(raw || '').trim();
  if (!want || want.length > 2048 || /\0/.test(want)) return { ok: false, why: 'No file given.' };
  const realFolders = [];
  for (const f of folders || []) { try { realFolders.push(await fs.realpath(f)); } catch (e) {} }
  if (!realFolders.length) return { ok: false, why: 'No folders are shared with Jarvis yet. Add one in Settings, Mac.' };
  const tries = path.isAbsolute(want) ? [want] : realFolders.map(function (f) { return path.join(f, want); });
  for (const t of tries) {
    let real;
    try { real = await fs.realpath(t); } catch (e) { continue; }
    if (!inside(real, realFolders)) return { ok: false, why: 'That file is outside the folders you shared with Jarvis.' };
    return { ok: true, path: real, runnable: runnable(real) };
  }
  return { ok: false, why: 'I could not find that file in your shared folders.' };
}

/** list names (not contents) in the shared folders, matching words, a few levels deep */
async function listFiles(query, folders, fs, limit) {
  fs = fs || fsp; limit = Math.min(limit || 40, 200);
  const words = norm(query).split(' ').filter(Boolean);
  const out = [];
  let seen = 0;
  async function walk(dir, depth, root) {
    if (out.length >= limit || seen > 5000 || depth > 4) return;
    let ents;
    try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (out.length >= limit || ++seen > 5000) return;
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const n = norm(e.name);
      if (!words.length || words.every(function (w) { return n.indexOf(w) >= 0; })) out.push({ path: full, folder: root, dir: e.isDirectory() });
      if (e.isDirectory() && !e.isSymbolicLink() && !/\.(app|bundle|framework|photoslibrary)$/i.test(e.name)) await walk(full, depth + 1, root);
    }
  }
  for (const f of folders || []) { let r; try { r = await fs.realpath(f); } catch (e) { continue; } await walk(r, 0, r); }
  return out;
}

/**
 * Make the action runner. deps: { shell, getConfig, toast, fs }
 * shell is Electron's shell (openExternal, openPath, showItemInFolder).
 */
function makeActions(deps) {
  const shell = deps.shell, toast = deps.toast || function () {}, cfg = deps.getConfig;
  return {
    async openUrl(input) {
      const c = cleanUrl(input && input.url);
      if (!c.ok) return c;
      await shell.openExternal(c.url, { activate: true });
      toast('Opened ' + new URL(c.url).hostname, c.url);
      return { ok: true, opened: c.url };
    },
    async searchWeb(input) {
      const s = searchUrl(input && input.query, cfg().searchEngine);
      if (!s.ok) return s;
      await shell.openExternal(s.url, { activate: true });
      toast('Searching the web', s.query);
      return { ok: true, opened: s.url };
    },
    async openApp(input) {
      const a = findApp(input && input.name, cfg().apps);
      if (!a) return { ok: false, why: 'That app is not on your list. Add it in Settings, Mac, Apps Jarvis may open.', allowed: (cfg().apps || []).map(function (x) { return x.name; }) };
      const err = await shell.openPath(a.path);
      if (err) return { ok: false, why: 'macOS could not open ' + a.name + '.' };
      toast('Opened ' + a.name, '');
      return { ok: true, opened: a.name };
    },
    async openFile(input) {
      const r = await resolveFile(input && input.path, cfg().folders, deps.fs);
      if (!r.ok) return r;
      const reveal = !!(input && input.reveal) || r.runnable;
      if (reveal) shell.showItemInFolder(r.path);
      else { const err = await shell.openPath(r.path); if (err) return { ok: false, why: 'macOS could not open that file.' }; }
      toast(reveal ? 'Showed in Finder' : 'Opened', path.basename(r.path));
      return { ok: true, path: r.path, revealed: reveal, note: r.runnable && !(input && input.reveal) ? 'That file could run code, so it was shown in Finder instead of opened.' : undefined };
    },
    async listFiles(input) {
      const files = await listFiles(input && input.query, cfg().folders, deps.fs, input && input.limit);
      return { ok: true, files: files };
    }
  };
}

module.exports = { makeActions, cleanUrl, searchUrl, findApp, resolveFile, listFiles, runnable, inside, RUNNABLE, SEARCH };
