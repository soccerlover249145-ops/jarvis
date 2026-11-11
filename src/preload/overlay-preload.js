'use strict';
/* overlay-preload.js: the red border only listens; it can send nothing. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jarvisOverlay', {
  onInfo: function (cb) { ipcRenderer.on('overlay:info', function (_e, d) { cb(d); }); },
  onUpdate: function (cb) { ipcRenderer.on('overlay:update', function (_e, d) { cb(d); }); }
});
