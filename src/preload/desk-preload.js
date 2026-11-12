'use strict';
/* desk-preload.js: the preload for the live Jarvis page (https://jarvis.unwebbed.app) inside the Mac app.
   It exposes only window.jarvisDesk (see src/main/desk.js and WEB-SHIM.md): no real keys (keys.get answers with
   stand-ins), no settings,
   no screen picture. Each call sends one fixed message; the main process checks the sender's origin and every
   argument again, and asks the owner in a native dialog before anything changes. */
const { contextBridge, ipcRenderer } = require('electron');

function call(ch) { return function (arg) { return ipcRenderer.invoke(ch, arg && typeof arg === 'object' ? arg : {}); }; }
function sub(ch) { return function (cb) { if (typeof cb !== 'function') return function () {}; const f = function (_e, d) { cb(d); }; ipcRenderer.on(ch, f); return function () { ipcRenderer.removeListener(ch, f); }; }; }

contextBridge.exposeInMainWorld('jarvisDesk', Object.freeze({
  version: 3,
  capabilities: call('desk:capabilities'),
  openUrl: function (url) { return ipcRenderer.invoke('desk:openUrl', { url: String(url || '') }); },
  openApp: function (name) { return ipcRenderer.invoke('desk:openApp', { name: String(name || '') }); },
  revealFile: function (p) { return ipcRenderer.invoke('desk:revealFile', { path: String(p || '') }); },
  openFile: function (p) { return ipcRenderer.invoke('desk:openFile', { path: String(p || '') }); },
  newEmailDraft: function (d) { d = d || {}; return ipcRenderer.invoke('desk:emailDraft', { to: d.to, cc: d.cc, subject: String(d.subject || ''), body: String(d.body || '') }); },
  runTask: function (text) { return ipcRenderer.invoke('desk:runTask', { text: String(text || '') }); },
  stop: call('desk:stop'),
  /* ---- version 2: macOS-automation "oomph" ---- */
  readMail: function (o) { o = o || {}; return ipcRenderer.invoke('desk:readMail', { limit: o.limit }); },
  readCalendar: function (o) { o = o || {}; return ipcRenderer.invoke('desk:readCalendar', { days: o.days }); },
  readReminders: function (o) { o = o || {}; return ipcRenderer.invoke('desk:readReminders', { limit: o.limit }); },
  readNotes: function (o) { o = o || {}; return ipcRenderer.invoke('desk:readNotes', { name: String(o.name || ''), limit: o.limit }); },
  listFolder: function (o) { o = o || {}; return ipcRenderer.invoke('desk:listFolder', { query: String(o.query || ''), limit: o.limit }); },
  readClipboard: call('desk:readClipboard'),
  readSelection: call('desk:readSelection'),
  screenLook: call('desk:screenLook'),
  addEvent: function (o) { o = o || {}; return ipcRenderer.invoke('desk:addEvent', { title: String(o.title || ''), start: String(o.start || ''), end: String(o.end || ''), notes: String(o.notes || ''), location: String(o.location || ''), calendar: String(o.calendar || '') }); },
  addReminder: function (o) { o = o || {}; return ipcRenderer.invoke('desk:addReminder', { name: String(o.name || ''), due: String(o.due || ''), list: String(o.list || ''), notes: String(o.notes || '') }); },
  appendNote: function (o) { o = o || {}; return ipcRenderer.invoke('desk:appendNote', { name: String(o.name || ''), text: String(o.text || '') }); },
  setClipboard: function (o) { o = o || {}; return ipcRenderer.invoke('desk:setClipboard', { text: String(o.text || '') }); },
  moveFile: function (o) { o = o || {}; return ipcRenderer.invoke('desk:moveFile', { from: String(o.from || ''), to: String(o.to || '') }); },
  trashFile: function (o) { o = o || {}; return ipcRenderer.invoke('desk:trashFile', { path: String(o.path || '') }); },
  /* keys kept in this Mac's Keychain: the page only ever gets stand-ins (placeholders), never a real key */
  keys: Object.freeze({
    get: function () { return ipcRenderer.invoke('desk:keys:get', {}); },
    saveFromPage: function (kind, value) { return ipcRenderer.invoke('desk:keys:save', { kind: String(kind || ''), value: String(value || '') }); }
  }),
  onTaskDone: sub('control:done'),
  onHeard: sub('desk:heard'),
  /* ---- version 3: hearing through the Mac's own listener (JarvisEars), with its state, and the pill ---- */
  ears: Object.freeze({
    start: call('desk:ears:start'),
    stop: call('desk:ears:stop'),
    hold: function (on) { return ipcRenderer.invoke('desk:ears:hold', { on: !!on }); },
    state: call('desk:ears:state'),
    onEvent: sub('desk:ears')
  }),
  /* what the owner typed in the floating pill or picked from the menu bar, the pill's mic button, and the shortcut */
  onAsk: sub('desktop:ask'),
  onMic: sub('desktop:mic'),
  onSummon: sub('desktop:summon'),
  /* the page tells the pill what Jarvis is doing and the caption it shows */
  ui: Object.freeze({
    state: function (s) { s = s && typeof s === 'object' ? s : {}; return ipcRenderer.invoke('desk:ui:state', { state: String(s.state || ''), caption: String(s.caption || ''), small: String(s.small || ''), answered: !!s.answered }); }
  })
}));
