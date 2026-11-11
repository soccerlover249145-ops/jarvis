'use strict';
/* desk-preload.js: the preload for the live Jarvis page (https://jarvis.unwebbed.app) inside the Mac app.
   It exposes only window.jarvisDesk (see src/main/desk.js and WEB-SHIM.md): no keys, no Keychain, no settings,
   no screen picture. Each call sends one fixed message; the main process checks the sender's origin and every
   argument again, and asks the owner in a native dialog before anything changes. */
const { contextBridge, ipcRenderer } = require('electron');

function call(ch) { return function (arg) { return ipcRenderer.invoke(ch, arg && typeof arg === 'object' ? arg : {}); }; }
function sub(ch) { return function (cb) { if (typeof cb !== 'function') return function () {}; const f = function (_e, d) { cb(d); }; ipcRenderer.on(ch, f); return function () { ipcRenderer.removeListener(ch, f); }; }; }

contextBridge.exposeInMainWorld('jarvisDesk', Object.freeze({
  version: 1,
  capabilities: call('desk:capabilities'),
  openUrl: function (url) { return ipcRenderer.invoke('desk:openUrl', { url: String(url || '') }); },
  openApp: function (name) { return ipcRenderer.invoke('desk:openApp', { name: String(name || '') }); },
  revealFile: function (p) { return ipcRenderer.invoke('desk:revealFile', { path: String(p || '') }); },
  openFile: function (p) { return ipcRenderer.invoke('desk:openFile', { path: String(p || '') }); },
  newEmailDraft: function (d) { d = d || {}; return ipcRenderer.invoke('desk:emailDraft', { to: d.to, cc: d.cc, subject: String(d.subject || ''), body: String(d.body || '') }); },
  runTask: function (text) { return ipcRenderer.invoke('desk:runTask', { text: String(text || '') }); },
  stop: call('desk:stop'),
  onTaskDone: sub('control:done'),
  onHeard: sub('desk:heard')
}));
