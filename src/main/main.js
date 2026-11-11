'use strict';
/* main.js: the Jarvis Mac app.

   - A menu bar icon (the orb), a compact floating pill and the full window (the Jarvis web UI).
   - The global shortcut (Option+Space by default) brings up the pill and wakes Jarvis to listen.
   - Always-on listening through JarvisEars (Swift, Apple's speech recognizer, on the Mac).
   - Allowlisted open actions over IPC, a screen snapshot on request, and "take control".
   - Keys in the macOS Keychain; the web UI only ever sees placeholders (see secrets.js).
   The web UI is served from inside the app at app://jarvis/, never from the internet. */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const electron = require('electron');
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, dialog, Notification, nativeImage,
  protocol, net, session, screen: eScreen, desktopCapturer, systemPreferences } = electron;

const { makeKeychain } = require('./keychain');
const { STORE_MAP, PLACEHOLDER, injectHeaders, watchUrls } = require('./secrets');
const { makeActions } = require('./actions');
const { makeScreen } = require('./screen');
const { makeConfig } = require('./config');
const { makeEars } = require('./ears');
const { makeHands } = require('./control/hands');
const { makeSession } = require('./control/session');

const ORIGIN = 'app://jarvis';
const ROOT = path.join(__dirname, '..');                       /* src/ */
const SERVE = { '': path.join(ROOT, 'renderer'), compact: path.join(ROOT, 'compact'), overlay: path.join(ROOT, 'overlay') };
const BIN = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(ROOT, '..', 'native', 'bin');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

let cfg, keychain, actions, screenCap, ears, hands, control;
let mainWin = null, compactWin = null, overlayWin = null, tray = null;
let unseen = 0, quitting = false, earsState = 'off';

/* ---------- serving the UI from inside the app ---------- */
function serve() {
  protocol.handle('app', function (req) {
    const u = new URL(req.url);
    if (u.host !== 'jarvis') return new Response('Not found', { status: 404 });
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    const area = parts[0] === 'compact' || parts[0] === 'overlay' ? parts.shift() : '';
    const base = SERVE[area];
    const file = path.normalize(path.join(base, parts.join('/') || 'index.html'));
    if (file !== base && !file.startsWith(base + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

/* ---------- keys: placeholders in, real keys out ---------- */
/* For the automated smoke test on a machine without a Keychain only: an in-memory stand-in, never
   used by a packaged app. */
function devFakeKeychain() {
  if (app.isPackaged || process.env.JARVIS_FAKE_KEYCHAIN !== '1') return undefined;
  const mem = new Map();
  return {
    run: async function (args) { const a = args[args.indexOf('-a') + 1]; if (args[0] === 'find-generic-password') return mem.has(a) ? { code: 0, stdout: mem.get(a) + '\n', stderr: '' } : { code: 44, stdout: '', stderr: 'not found' }; mem.delete(a); return { code: 0, stdout: '', stderr: '' }; },
    feed: async function (line) { const m = /-a (\S+) -X ([0-9a-f]+)$/.exec(line); if (m) mem.set(m[1], Buffer.from(m[2], 'hex').toString('utf8')); return { code: 0, stdout: '', stderr: '' }; }
  };
}
const DEBUG = !app.isPackaged && process.env.JARVIS_DEBUG === '1';
let secretCache = {};
async function loadSecrets() {
  secretCache = {};
  for (const n of ['anthropic', 'elevenlabs', 'relay']) { const v = await keychain.get(n); if (v) secretCache[n] = v; }
}
function installInjector() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeSendHeaders({ urls: watchUrls(cfg.get().relayUrl) }, function (details, cb) {
    const r = injectHeaders(details.url, details.requestHeaders, secretCache, cfg.get().relayUrl);
    if (DEBUG) console.log('[secrets] ' + new URL(details.url).host + ' injected=' + (r.injected || 'none'));
    cb({ requestHeaders: r.headers });
  });
}

/* ---------- windows ---------- */
function webPrefs(preload) {
  return { preload: path.join(ROOT, 'preload', preload), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
    spellcheck: false, devTools: !app.isPackaged, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' };
}
function lockDown(win) {
  win.webContents.setWindowOpenHandler(function (d) { actions.openUrl({ url: d.url }).catch(function () {}); return { action: 'deny' }; });
  win.webContents.on('will-navigate', function (e, url) { if (!url.startsWith(ORIGIN + '/')) e.preventDefault(); });
  win.webContents.on('will-attach-webview', function (e) { e.preventDefault(); });
}
function createMain() {
  mainWin = new BrowserWindow({ width: 1180, height: 820, minWidth: 420, minHeight: 600, show: false, title: 'Jarvis', backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 }, webPreferences: webPrefs('preload.js') });
  lockDown(mainWin);
  mainWin.loadURL(ORIGIN + '/index.html');
  mainWin.on('close', function (e) { if (!quitting) { e.preventDefault(); mainWin.hide(); } });
  mainWin.on('focus', function () { unseen = 0; badge(); });
}
function createCompact() {
  const b = cfg.get().compactBounds, wa = eScreen.getPrimaryDisplay().workArea;
  compactWin = new BrowserWindow({ width: 640, height: 132, x: b ? b.x : Math.round(wa.x + (wa.width - 640) / 2), y: b ? b.y : wa.y + 12,
    frame: false, transparent: true, resizable: false, movable: true, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, vibrancy: undefined, webPreferences: webPrefs('preload.js') });
  compactWin.setAlwaysOnTop(true, 'floating');
  compactWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lockDown(compactWin);
  compactWin.loadURL(ORIGIN + '/compact/compact.html');
  compactWin.on('moved', function () { const p = compactWin.getBounds(); cfg.set({ compactBounds: { x: p.x, y: p.y } }); });
  compactWin.on('close', function (e) { if (!quitting) { e.preventDefault(); compactWin.hide(); } });
}
function showMain() { if (!mainWin) return; mainWin.show(); mainWin.focus(); unseen = 0; badge(); }
function toggleCompact(summon) {
  if (!compactWin) return;
  if (compactWin.isVisible() && !summon) { compactWin.hide(); return; }
  compactWin.show(); compactWin.focus();
  send(mainWin, 'desktop:summon', {});
}

/* the red border and status pill while Jarvis has control */
const overlay = {
  show(info) {
    const d = eScreen.getPrimaryDisplay();
    overlayWin = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, transparent: true,
      resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false,
      enableLargerThanScreen: true, webPreferences: webPrefs('overlay-preload.js') });
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
    overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWin.setIgnoreMouseEvents(true);
    overlayWin.setContentProtection(true);     /* kept out of screenshots where macOS allows it */
    lockDown(overlayWin);
    overlayWin.loadURL(ORIGIN + '/overlay/overlay.html');
    overlayWin.once('ready-to-show', function () { overlayWin && overlayWin.showInactive(); send(overlayWin, 'overlay:info', info); });
    if (app.dock) app.dock.setBadge('●');
    rebuildTray();
  },
  update(o) { send(overlayWin, 'overlay:update', o); },
  hide() { if (overlayWin) { overlayWin.destroy(); overlayWin = null; } badge(); rebuildTray(); }
};

function send(win, ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
function badge() { if (app.dock) app.dock.setBadge(control && control.active() ? '●' : unseen > 0 ? String(unseen) : ''); }
function toast(title, body) {
  const shown = (compactWin && compactWin.isVisible()) || (mainWin && mainWin.isVisible() && mainWin.isFocused());
  if (shown) { send(compactWin, 'ui:toast', { title: title, body: body }); send(mainWin, 'ui:toast', { title: title, body: body }); }
  else if (Notification.isSupported()) new Notification({ title: title, body: String(body || '').slice(0, 200), silent: true }).show();
}

/* ---------- menu bar ---------- */
function rebuildTray() {
  if (!tray) return;
  const c = cfg.get(), hk = c.hotkey.replace('Alt', '⌥').replace('Space', 'Space');
  const busy = control && control.active();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Talk to Jarvis', accelerator: c.hotkey, click: function () { toggleCompact(true); } },
    { label: 'Open Jarvis', click: showMain },
    { type: 'separator' },
    { label: earsState === 'listening' ? 'Listening for "hey Jarvis"' : 'Not listening', enabled: false },
    { label: ears && ears.wanted() ? 'Stop listening' : 'Start listening', click: function () { if (ears.wanted()) ears.stop(); else ears.start(); rebuildTray(); } },
    { type: 'separator' },
    { label: 'Look at my screen…', click: function () { showMain(); send(mainWin, 'desktop:ask', { text: 'Look at my screen and tell me what you see.' }); } },
    busy ? { label: 'Stop control (Esc)', click: function () { control.stop('You chose Stop.'); } }
      : { label: 'Take control…', click: function () { toggleCompact(true); send(compactWin, 'compact:control', {}); } },
    { type: 'separator' },
    { label: 'Settings…', click: function () { showMain(); send(mainWin, 'desktop:settings', {}); } },
    { label: 'Open at login', type: 'checkbox', checked: c.launchAtLogin, click: function (i) { cfg.set({ launchAtLogin: i.checked }); loginItem(); } },
    { type: 'separator' },
    { label: 'Quit Jarvis', accelerator: 'Cmd+Q', click: function () { quitting = true; app.quit(); } }
  ]));
  tray.setToolTip('Jarvis' + (busy ? ' (has control)' : '') + ' · ' + hk);
}
function loginItem() { try { app.setLoginItemSettings({ openAtLogin: cfg.get().launchAtLogin, openAsHidden: true }); } catch (e) {} }
function registerSummon() {
  const hk = cfg.get().hotkey;
  try { if (!globalShortcut.isRegistered(hk)) globalShortcut.register(hk, function () { toggleCompact(false); }); } catch (e) {}
}

/* ---------- IPC: every message is checked, and only our own pages may send ---------- */
function ours(e) {
  const url = e.senderFrame && e.senderFrame.url || '';
  return url.startsWith(ORIGIN + '/');
}
function handle(ch, fn) {
  ipcMain.handle(ch, async function (e, arg) {
    if (!ours(e)) throw new Error('refused');
    return fn(arg || {}, e);
  });
}
function wireIpc() {
  /* the shim asks at start which keys exist; it gets placeholders, never keys */
  ipcMain.on('secrets:state', function (e) {
    if (!ours(e)) { e.returnValue = null; return; }
    const have = {};
    Object.keys(STORE_MAP).forEach(function (k) { const m = STORE_MAP[k]; have[k] = m.mode === 'inject' && secretCache[m.name] ? PLACEHOLDER[m.name] : null; });
    e.returnValue = { have: have, placeholders: PLACEHOLDER };
  });
  handle('secrets:set', async function (a) {
    const m = STORE_MAP[a.key];
    if (!m || m.mode !== 'inject') return { ok: false };
    const v = String(a.value || '');
    if (m.mode === 'inject' && v === PLACEHOLDER[m.name]) return { ok: true };   /* writing back the placeholder changes nothing */
    const r = await keychain.set(m.name, v);
    if (r.ok) secretCache[m.name] = v;
    return { ok: r.ok };
  });
  handle('secrets:del', async function (a) {
    const m = STORE_MAP[a.key];
    if (!m || m.mode !== 'inject') return { ok: false };
    await keychain.del(m.name);
    delete secretCache[m.name];
    return { ok: true };
  });
  handle('relay:url', async function (a) { cfg.set({ relayUrl: String(a.url || '') }); installInjector(); return { ok: true }; });

  handle('ears:start', async function () { return { ok: ears.start() }; });
  handle('ears:stop', async function () { ears.stop(); return { ok: true }; });
  handle('ears:hold', async function (a) { ears.hold(!!a.on); return { ok: true }; });
  handle('ears:state', async function () { return { state: earsState, wanted: ears.wanted() }; });

  handle('act:openUrl', function (a) { return actions.openUrl(a); });
  handle('act:search', function (a) { return actions.searchWeb(a); });
  handle('act:openApp', function (a) { return actions.openApp(a); });
  handle('act:openFile', function (a) { return actions.openFile(a); });
  handle('act:listFiles', function (a) { return actions.listFiles(a); });

  handle('screen:look', async function () {
    const p = screenCap.permission();
    if (p !== 'granted' && p !== 'unknown') return { ok: false, permission: 'screen', why: 'Allow Screen Recording for Jarvis in System Settings, Privacy & Security, then quit and reopen Jarvis.' };
    const wasVisible = compactWin && compactWin.isVisible();
    if (wasVisible) compactWin.hide();          /* Jarvis's own pill is not part of what you want looked at */
    try {
      const s = await screenCap.capture();
      toast('Jarvis looked at your screen', 'One picture, sent to Claude with your question.');
      return { ok: true, data: s.data, media_type: s.media_type, width: s.geo.shot.width, height: s.geo.shot.height };
    } catch (e) { return { ok: false, why: e.message }; }
    finally { if (wasVisible) compactWin.showInactive(); }
  });

  handle('control:start', function (a) { return control.start(a.task, { from: a.from === 'jarvis' ? 'jarvis' : 'you' }); });
  handle('control:stop', async function () { return { ok: control.stop('You chose Stop.') }; });

  handle('config:get', async function () {
    const c = cfg.get();
    return { hotkey: c.hotkey, launchAtLogin: c.launchAtLogin, alwaysListen: c.alwaysListen, onDeviceOnly: c.onDeviceOnly, searchEngine: c.searchEngine,
      apps: c.apps, folders: c.folders, caps: c.caps, perms: perms() };
  });
  handle('config:set', async function (a) {
    const allowed = {};
    ['launchAtLogin', 'alwaysListen', 'onDeviceOnly', 'searchEngine', 'caps', 'hotkey'].forEach(function (k) { if (a[k] !== undefined) allowed[k] = a[k]; });
    if (Array.isArray(a.removeApps)) allowed.apps = cfg.get().apps.filter(function (x) { return a.removeApps.indexOf(x.path) < 0; });
    if (Array.isArray(a.removeFolders)) allowed.folders = cfg.get().folders.filter(function (f) { return a.removeFolders.indexOf(f) < 0; });
    const before = cfg.get().hotkey;
    cfg.set(allowed);
    if (allowed.hotkey && allowed.hotkey !== before) { try { globalShortcut.unregister(before); } catch (e) {} registerSummon(); }
    loginItem(); rebuildTray();
    return { ok: true };
  });
  /* folders and apps are only ever added by the owner through a macOS picker */
  handle('config:pickFolder', async function () {
    const r = await dialog.showOpenDialog(mainWin, { title: 'Share a folder with Jarvis', buttonLabel: 'Share with Jarvis', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    cfg.set({ folders: cfg.get().folders.concat([r.filePaths[0]]).filter(function (v, i, s) { return s.indexOf(v) === i; }) });
    return { ok: true, folder: r.filePaths[0] };
  });
  handle('config:pickApp', async function () {
    const r = await dialog.showOpenDialog(mainWin, { title: 'An app Jarvis may open', buttonLabel: 'Allow', defaultPath: '/Applications', properties: ['openFile'], filters: [{ name: 'Apps', extensions: ['app'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    const p = r.filePaths[0];
    cfg.set({ apps: cfg.get().apps.concat([{ name: path.basename(p, '.app'), path: p }]).filter(function (v, i, s) { return s.findIndex(function (x) { return x.path === v.path; }) === i; }) });
    return { ok: true, app: path.basename(p, '.app') };
  });
  handle('perm:open', async function (a) {
    const PANES = { screen: 'Privacy_ScreenCapture', accessibility: 'Privacy_Accessibility', microphone: 'Privacy_Microphone', speech: 'Privacy_SpeechRecognition' };
    if (!PANES[a.which]) return { ok: false };
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?' + PANES[a.which]);
    return { ok: true };
  });

  /* the pill talks to the full window, which holds Jarvis's brain */
  handle('compact:ask', async function (a) { const t = String(a.text || '').slice(0, 4000); if (t) send(mainWin, 'desktop:ask', { text: t }); return { ok: true }; });
  handle('compact:open', async function () { showMain(); return { ok: true }; });
  handle('compact:hide', async function () { compactWin.hide(); return { ok: true }; });
  handle('compact:mic', async function () { send(mainWin, 'desktop:mic', {}); return { ok: true }; });
  handle('ui:state', async function (a) {
    send(compactWin, 'ui:state', a);
    if (a.answered && !(mainWin.isVisible() && mainWin.isFocused()) && !(compactWin && compactWin.isVisible())) { unseen++; badge(); }
    return { ok: true };
  });
  handle('ui:toast', async function (a) { toast(String(a.title || '').slice(0, 80), String(a.body || '').slice(0, 200)); return { ok: true }; });
}
function perms() {
  const g = function (k) { try { return systemPreferences.getMediaAccessStatus(k); } catch (e) { return 'unknown'; } };
  let ax = false; try { ax = systemPreferences.isTrustedAccessibilityClient(false); } catch (e) {}
  return { microphone: g('microphone'), screen: g('screen'), accessibility: ax ? 'granted' : 'not-determined' };
}

/* ---------- start ---------- */
app.whenReady().then(async function () {
  if (app.dock) app.dock.setIcon(nativeImage.createFromPath(path.join(ROOT, 'renderer', 'icon-512.png')));
  cfg = makeConfig(app.getPath('userData'));
  keychain = makeKeychain(devFakeKeychain());
  await loadSecrets();
  actions = makeActions({ shell: shell, getConfig: function () { return cfg.get(); }, toast: toast });
  screenCap = makeScreen({ desktopCapturer: desktopCapturer, screen: eScreen, systemPreferences: systemPreferences });
  ears = makeEars(path.join(BIN, 'JarvisEars'), { onDeviceOnly: function () { return cfg.get().onDeviceOnly; } });
  hands = makeHands(path.join(BIN, 'JarvisHands'));
  ears.on(function (ev) { if (ev.type === 'state') { earsState = ev.state; rebuildTray(); } send(mainWin, 'ears:event', ev); send(compactWin, 'ears:event', ev); });

  /* nothing in the windows may ask for the camera, location, notifications and so on: the helpers do the hearing */
  session.defaultSession.setPermissionRequestHandler(function (wc, perm, cb) { cb(false); });
  session.defaultSession.setPermissionCheckHandler(function () { return false; });
  serve();
  installInjector();
  wireIpc();

  let anthropic = null, anthropicKey = '';
  const Anthropic = require('@anthropic-ai/sdk');
  const AnthropicClass = Anthropic.default || Anthropic;
  control = makeSession({
    client: function () {
      const k = secretCache.anthropic; if (!k) return null;
      if (!anthropic || anthropicKey !== k) { anthropic = new AnthropicClass({ apiKey: k, maxRetries: 2, timeout: 120000 }); anthropicKey = k; }
      return anthropic;
    },
    screen: screenCap, hands: hands, overlay: overlay,
    shortcuts: {
      register: function (acc, fn) { try { globalShortcut.unregister(acc); return globalShortcut.register(acc, fn); } catch (e) { return false; } },
      unregister: function (acc) { try { globalShortcut.unregister(acc); } catch (e) {} }
    },
    hotkey: function () { return cfg.get().hotkey; },
    caps: function () { return cfg.get().caps; },
    askStart: async function (t) {
      app.focus({ steal: true });
      const r = await dialog.showMessageBox({
        type: 'warning', buttons: ['Let Jarvis take control', 'Cancel'], defaultId: 1, cancelId: 1,
        message: 'Let Jarvis use your mouse and keyboard?',
        detail: 'Task: ' + t.text + '\n\nA red border shows while Jarvis has control. Press Esc, press ' + cfg.get().hotkey.replace('Alt', 'Option') + ', or move the mouse to stop it at once.\n\nLimits: ' + t.caps.steps + ' steps, $' + Number(t.caps.dollars).toFixed(2) + ', ' + t.caps.minutes + ' minutes. Jarvis asks you before passwords, sending, buying, booking, deleting or installing.',
        checkboxLabel: 'Allow banking, password manager and settings windows for this task only', checkboxChecked: false
      });
      return { ok: r.response === 0, allowSensitive: r.checkboxChecked };
    },
    confirm: async function (text) {
      app.focus({ steal: true });
      const r = await dialog.showMessageBox({ type: 'question', buttons: ['Allow once', 'No'], defaultId: 1, cancelId: 1, message: 'Jarvis is asking first', detail: text });
      return r.response === 0;
    },
    stepAside: async function () { if (compactWin) compactWin.hide(); if (mainWin) mainWin.hide(); },
    restore: function () { registerSummon(); rebuildTray(); },
    notify: function (title, body) { toast(title, body); send(mainWin, 'control:done', { title: title, body: body }); send(compactWin, 'control:done', { title: title, body: body }); }
  });

  createMain();
  createCompact();
  tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'assets', 'trayTemplate.png')));
  rebuildTray();
  registerSummon();
  loginItem();
  if (cfg.get().alwaysListen && fs.existsSync(path.join(BIN, 'JarvisEars'))) ears.start();
  const hidden = app.getLoginItemSettings().wasOpenedAsHidden;
  if (!hidden) mainWin.once('ready-to-show', showMain);
});

app.on('second-instance', showMain);
app.on('activate', showMain);
app.on('before-quit', function () { quitting = true; try { ears.stop(); } catch (e) {} try { hands.stop(); } catch (e) {} try { keychain.forget(); } catch (e) {} });
app.on('will-quit', function () { globalShortcut.unregisterAll(); });
app.on('window-all-closed', function () { /* stays in the menu bar */ });
