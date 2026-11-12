'use strict';
/* config.js: the owner's Mac settings. Nothing secret lives here (keys are in the Keychain).
   Saved as JSON in the app's own folder (~/Library/Application Support/Jarvis/settings.json).
   Every value is checked on the way in, so a hand-edited or damaged file cannot widen what
   Jarvis may do. */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  hotkey: 'Alt+Space',
  launchAtLogin: true,         /* open Jarvis as a window when the owner logs in (on from the first run) */
  seenLoginNote: false,        /* the one-time "Jarvis will open when you log in" note has been shown */
  alwaysListen: true,          /* listen for the wake phrase whenever the app runs */
  onDeviceOnly: true,          /* refuse speech recognition that would leave the Mac */
  searchEngine: 'google',
  apps: [
    { name: 'Safari', path: '/Applications/Safari.app' },
    { name: 'Google Chrome', path: '/Applications/Google Chrome.app' },
    { name: 'Notes', path: '/System/Applications/Notes.app' },
    { name: 'Calendar', path: '/System/Applications/Calendar.app' },
    { name: 'Music', path: '/System/Applications/Music.app' }
  ],
  folders: [],                 /* folders the owner picked; empty until they pick some */
  caps: { steps: 40, dollars: 2, minutes: 15 },
  relayUrl: '',
  compactBounds: null,
  source: 'live',              /* 'live': the full window shows https://jarvis.unwebbed.app (bundled copy if offline); 'bundled': the copy inside the app */
  alwaysAllow: []              /* kinds the owner ticked "Always allow" for (see desk.js); empty means every action asks first */
};
const ALWAYABLE = ['openUrl', 'openApp', 'revealFile', 'openFile', 'emailDraft',
  /* the mac.js "oomph" reads and non-destructive writes; file moves and Trash are deliberately absent */
  'readMail', 'readCalendar', 'readReminders', 'readNotes', 'listFolder', 'readClipboard', 'readSelection',
  'screenLook', 'addEvent', 'addReminder', 'appendNote', 'setClipboard'];

function clean(raw) {
  const c = JSON.parse(JSON.stringify(DEFAULTS));
  if (!raw || typeof raw !== 'object') return c;
  if (typeof raw.hotkey === 'string' && /^[A-Za-z0-9+]{3,40}$/.test(raw.hotkey)) c.hotkey = raw.hotkey;
  ['launchAtLogin', 'seenLoginNote', 'alwaysListen', 'onDeviceOnly'].forEach(function (k) { if (typeof raw[k] === 'boolean') c[k] = raw[k]; });
  if (['google', 'duckduckgo', 'bing'].indexOf(raw.searchEngine) >= 0) c.searchEngine = raw.searchEngine;
  if (Array.isArray(raw.apps)) {
    c.apps = raw.apps.filter(function (a) { return a && typeof a.name === 'string' && typeof a.path === 'string' && /^\/[^\0]*\.app$/i.test(a.path) && a.name.length <= 80; })
      .slice(0, 100).map(function (a) { return { name: a.name.trim(), path: path.normalize(a.path) }; });
  }
  if (Array.isArray(raw.folders)) {
    c.folders = raw.folders.filter(function (f) { return typeof f === 'string' && path.isAbsolute(f) && f !== '/' && !/\0/.test(f); })
      .map(function (f) { return path.normalize(f); }).slice(0, 50);
  }
  if (raw.caps && typeof raw.caps === 'object') {
    const n = function (v, lo, hi, d) { v = Number(v); return isFinite(v) && v >= lo && v <= hi ? v : d; };
    c.caps = { steps: Math.round(n(raw.caps.steps, 1, 200, 40)), dollars: n(raw.caps.dollars, 0.05, 50, 2), minutes: n(raw.caps.minutes, 1, 120, 15) };
  }
  if (typeof raw.relayUrl === 'string' && (raw.relayUrl === '' || /^https:\/\/[^\s/@]+(\/[^\s]*)?$/.test(raw.relayUrl))) c.relayUrl = raw.relayUrl.slice(0, 300);
  if (raw.source === 'live' || raw.source === 'bundled') c.source = raw.source;
  if (Array.isArray(raw.alwaysAllow)) c.alwaysAllow = raw.alwaysAllow.filter(function (k, i, a) { return ALWAYABLE.indexOf(k) >= 0 && a.indexOf(k) === i; });
  if (raw.compactBounds && ['x', 'y'].every(function (k) { return isFinite(raw.compactBounds[k]); })) c.compactBounds = { x: Math.round(raw.compactBounds.x), y: Math.round(raw.compactBounds.y) };
  return c;
}

function makeConfig(dir) {
  const file = path.join(dir, 'settings.json');
  let cur;
  try { cur = clean(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { cur = clean(null); }
  return {
    get() { return cur; },
    set(patch) {
      cur = clean(Object.assign({}, cur, patch || {}));
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(cur, null, 2), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); } catch (e) {}
      return cur;
    },
    file
  };
}

module.exports = { makeConfig, clean, DEFAULTS, ALWAYABLE };
