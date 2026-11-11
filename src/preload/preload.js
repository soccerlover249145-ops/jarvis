'use strict';
/* preload.js: the only door between Jarvis's windows and the Mac. Each function sends one fixed
   message; the main process checks every argument again. No Node, no shell, no file access here. */
const { contextBridge, ipcRenderer } = require('electron');

function inv(ch) { return function (arg) { return ipcRenderer.invoke(ch, arg || {}); }; }
function on(ch) { return function (cb) { if (typeof cb !== 'function') return; ipcRenderer.on(ch, function (_e, data) { cb(data); }); }; }

contextBridge.exposeInMainWorld('jarvisDesktop', {
  version: 1,
  platform: process.platform,
  /* keys: the window learns which exist (as placeholders), and can hand a new one to the Keychain */
  secretsState: function () { return ipcRenderer.sendSync('secrets:state'); },
  setSecret: function (key, value) { return ipcRenderer.invoke('secrets:set', { key: String(key), value: String(value) }); },
  delSecret: function (key) { return ipcRenderer.invoke('secrets:del', { key: String(key) }); },
  relayUrl: function (url) { return ipcRenderer.invoke('relay:url', { url: String(url || '') }); },
  ears: { start: inv('ears:start'), stop: inv('ears:stop'), hold: function (on) { return ipcRenderer.invoke('ears:hold', { on: !!on }); }, state: inv('ears:state'), onEvent: on('ears:event') },
  act: {
    openUrl: function (url) { return ipcRenderer.invoke('act:openUrl', { url: String(url || '') }); },
    search: function (query) { return ipcRenderer.invoke('act:search', { query: String(query || '') }); },
    openApp: function (name) { return ipcRenderer.invoke('act:openApp', { name: String(name || '') }); },
    openFile: function (p, reveal) { return ipcRenderer.invoke('act:openFile', { path: String(p || ''), reveal: !!reveal }); },
    listFiles: function (query, limit) { return ipcRenderer.invoke('act:listFiles', { query: String(query || ''), limit: Number(limit) || 40 }); }
  },
  look: inv('screen:look'),
  control: {
    start: function (task, from) { return ipcRenderer.invoke('control:start', { task: String(task || ''), from: from === 'jarvis' ? 'jarvis' : 'you' }); },
    stop: inv('control:stop'),
    onDone: on('control:done')
  },
  config: {
    get: inv('config:get'), set: inv('config:set'), pickFolder: inv('config:pickFolder'), pickApp: inv('config:pickApp'),
    openPerm: function (which) { return ipcRenderer.invoke('perm:open', { which: String(which) }); }
  },
  ui: {
    state: inv('ui:state'), toast: function (title, body) { return ipcRenderer.invoke('ui:toast', { title: String(title || ''), body: String(body || '') }); },
    onToast: on('ui:toast'), onAsk: on('desktop:ask'), onSummon: on('desktop:summon'), onSettings: on('desktop:settings'), onMic: on('desktop:mic')
  },
  compact: {
    ask: function (text) { return ipcRenderer.invoke('compact:ask', { text: String(text || '') }); },
    open: inv('compact:open'), hide: inv('compact:hide'), mic: inv('compact:mic'),
    onState: on('ui:state'), onControl: on('compact:control')
  }
});
