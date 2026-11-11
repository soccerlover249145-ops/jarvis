'use strict';
/* Smoke test: launches the real Electron app (on Linux under xvfb here; on a Mac it runs as is),
   drives its windows with Playwright, and checks the wiring end to end: the app:// pages, the
   preload bridge, IPC, the Keychain shim, header injection, the Mac tools, the pill and the overlay.
   Run: xvfb-run -a node test/ui/run.js   (screenshots go to test/ui/shots/) */
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
let api = null;
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail: detail || '' }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : '')); }

setTimeout(() => { console.log('FAIL smoke test timed out'); process.exit(2); }, 150000).unref();
function apiStandIn() {
  /* a local https server that answers for api.anthropic.com and api.elevenlabs.io, so the test can see the exact headers that leave the app */
  const https = require('https'), { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=api.anthropic.com'], { stdio: 'ignore' });
  const seen = [];
  const srv = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', '*'); res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    if (req.method !== 'OPTIONS') seen.push({ host: req.headers.host, path: req.url, headers: req.headers });
    res.writeHead(req.method === 'OPTIONS' ? 204 : 401, { 'content-type': 'application/json' }); res.end(req.method === 'OPTIONS' ? '' : '{"type":"error"}');
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ port: srv.address().port, seen, srv })));
}

(async function () {
  api = await apiStandIn();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-home-'));
  const exe = require(path.join(ROOT, 'node_modules', 'electron'));
  const app = await electron.launch({ executablePath: exe, args: ['--no-sandbox', '--no-proxy-server', '--ignore-certificate-errors', '--host-resolver-rules=MAP api.anthropic.com 127.0.0.1:' + api.port + ', MAP api.elevenlabs.io 127.0.0.1:' + api.port, ROOT], cwd: ROOT,
    env: Object.assign({}, process.env, { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), JARVIS_FAKE_KEYCHAIN: '1', JARVIS_DEBUG: '1' }) });
  const logs = [];
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  try {
    await app.firstWindow({ timeout: 20000 });
    let win = null;
    for (let i = 0; i < 40 && !win; i++) { win = app.windows().find((w) => /^app:\/\/jarvis\/index\.html/.test(w.url())); if (!win) await new Promise((r) => setTimeout(r, 250)); }
    if (!win) throw new Error('the full window never appeared: ' + app.windows().map((w) => w.url()).join(', '));
    const errors = [];
    win.on('pageerror', (e) => errors.push(e.message));
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => window.Kin && window.Kin.ask && window.Kin.desktopTools, null, { timeout: 20000 });
    check('full window loads from app://jarvis', (await win.url()).startsWith('app://jarvis/'), await win.url());
    const k = await win.evaluate(() => ({ desktop: Kin.desktop, shared: Kin.shared, insecure: Kin.insecure, earsDesktop: !!Kin.ears.desktop, bridge: typeof window.jarvisDesktop, require: typeof window.require, process: typeof window.process }));
    check('the page knows it is the Mac app, at its own secure address', k.desktop && !k.shared && !k.insecure, JSON.stringify(k));
    check('ears come from the Swift helper bridge', k.earsDesktop);
    check('no Node in the page (only the bridge)', k.bridge === 'object' && k.require === 'undefined' && k.process === 'undefined');

    /* keys: type one into Settings, it goes to the Keychain, the page only sees a placeholder */
    await win.evaluate(() => localStorage.setItem('kin.key', 'sk-ant-api03-TESTKEY-not-real-0123456789abcdef'));
    await win.waitForTimeout(300);
    const after = await win.evaluate(() => ({ get: localStorage.getItem('kin.key'), raw: Object.keys(localStorage).filter((x) => /key|tok/.test(x)) }));
    check('a typed key is not kept in the page storage', after.raw.length === 0, JSON.stringify(after.raw));
    check('the page reads a placeholder, not the key', /PLACEHOLDER/.test(after.get || ''), after.get);
    const leveldb = path.join(home, '.config', 'Jarvis', 'Local Storage');
    await win.waitForTimeout(1200);
    let onDisk = false;
    if (fs.existsSync(leveldb)) for (const f of fs.readdirSync(path.join(leveldb, 'leveldb'))) { try { if (fs.readFileSync(path.join(leveldb, 'leveldb', f)).includes('TESTKEY')) onDisk = true; } catch (e) {} }
    check('the key is nowhere in the app\'s files on disk', !onDisk);

    /* the request leaves the app with the real key swapped in, and only to its own host */
    const fetchWith = (url, hdr) => win.evaluate(async (a) => { try { const h = {}; h[a.hdr] = localStorage.getItem('kin.key'); const r = await fetch(a.url, { headers: h }); return r.status; } catch (e) { return 'network: ' + e.message; } }, { url, hdr });
    const st1 = await fetchWith('https://api.anthropic.com/v1/models', 'x-api-key');
    const a1 = api.seen.find((x) => /anthropic/.test(x.host));
    check('the request to api.anthropic.com left with the Keychain key swapped in', a1 && a1.headers['x-api-key'] === 'sk-ant-api03-TESTKEY-not-real-0123456789abcdef', 'HTTP ' + st1 + ', server saw ' + (a1 ? a1.headers['x-api-key'] : 'nothing'));
    await fetchWith('https://api.elevenlabs.io/v1/models', 'x-api-key');
    const a2 = api.seen.find((x) => /elevenlabs/.test(x.host));
    check('the Claude key is not sent to another host (it gets the placeholder)', a2 && /PLACEHOLDER/.test(a2.headers['x-api-key'] || ''), a2 ? a2.headers['x-api-key'] : 'nothing seen');
    check('no request anywhere carried the key except to Anthropic', api.seen.filter((x) => JSON.stringify(x.headers).includes('TESTKEY')).every((x) => /anthropic/.test(x.host)));

    /* Mac tools the brain gets */
    const tools = await win.evaluate(() => Kin.desktopTools({}).map((t) => t.def.name));
    check('Jarvis\'s brain gets the Mac tools', ['open_website', 'search_in_browser', 'open_app', 'look_at_screen', 'take_control'].every((n) => tools.includes(n)), tools.join(', '));
    const refused = await win.evaluate(() => jarvisDesktop.act.openUrl('file:///etc/passwd'));
    check('opening a file:// address is refused over IPC', refused && refused.ok === false, JSON.stringify(refused));
    const noapp = await win.evaluate(() => jarvisDesktop.act.openApp('Terminal'));
    check('an app not on the list is refused', noapp && noapp.ok === false, noapp && noapp.why);
    const look = await win.evaluate(() => jarvisDesktop.look());
    check('look at the screen returns one JPEG picture', look && look.ok && look.media_type === 'image/jpeg' && look.data.length > 1000, look && (look.ok ? look.width + 'x' + look.height : look.why));
    const lookTool = await win.evaluate(async () => { const t = Kin.desktopTools({}).find((x) => x.def.name === 'look_at_screen'); const r = await t.run({}); return r.__blocks ? r.__blocks.map((b) => b.type) : r; });
    check('the look_at_screen tool hands Claude text plus an image block', JSON.stringify(lookTool) === '["text","image"]', JSON.stringify(lookTool));
    /* take control: stand in for the native dialog, first saying no, then yes */
    await app.evaluate(({ dialog }) => { global.__answer = 1; dialog.showMessageBox = async (o) => { global.__asked = (o && o.message) || ''; return { response: global.__answer, checkboxChecked: false }; }; });
    let ctl = await win.evaluate(() => jarvisDesktop.control.start('open youtube', 'jarvis'));
    check('take control asks the owner first, and a no stops it', ctl && ctl.declined === true && /mouse and keyboard/.test(await app.evaluate(() => global.__asked)), JSON.stringify(ctl));
    await app.evaluate(() => { global.__answer = 0; });
    ctl = await win.evaluate(() => jarvisDesktop.control.start('open youtube', 'jarvis'));
    check('with a yes but no input helper or Accessibility, it stops before touching anything', ctl && ctl.ok === false && ctl.permission === 'accessibility', JSON.stringify(ctl));

    /* settings, Mac */
    const sheetOpen = await win.evaluate(() => !document.getElementById('sheet').hidden);
    if (sheetOpen) { await win.click('#sheetx'); await win.waitForTimeout(300); }
    await win.click('#gear');
    await win.waitForSelector('#macSettings h3', { timeout: 5000 });
    const mac = await win.evaluate(() => ({ text: document.getElementById('macSettings').textContent, keyNote: document.getElementById('keyNote').textContent }));
    check('Settings has a Mac section with permissions, apps, folders and limits', /Screen Recording/.test(mac.text) && /Apps Jarvis may open/.test(mac.text) && /Folders shared/.test(mac.text) && /Dollars per task/i.test(mac.text));
    check('the key line says the key is in the Keychain', /Keychain/.test(mac.keyNote), mac.keyNote);
    await win.screenshot({ path: path.join(SHOTS, 'settings-mac.png') });
    await win.click('#sheetx');
    await win.waitForTimeout(400);
    await win.screenshot({ path: path.join(SHOTS, 'full-window.png') });

    /* the pill: show it, ask from it, the question reaches the full window */
    await app.evaluate(({ BrowserWindow }) => { const c = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/compact/')); c.show(); });
    let pill = null;
    for (let i = 0; i < 20 && !pill; i++) { pill = app.windows().find((w) => w.url().includes('/compact/')); if (!pill) await new Promise((r) => setTimeout(r, 250)); }
    check('the compact pill window exists', !!pill);
    if (pill) {
      await pill.waitForLoadState('domcontentloaded');
      await pill.fill('#q', 'what can you do on my mac');
      await pill.press('#q', 'Enter');
      await win.waitForFunction(() => Array.from(document.querySelectorAll('#thread *')).some((e) => /what can you do on my mac/.test(e.textContent)) || /what can you do on my mac/i.test(document.getElementById('capT').textContent), null, { timeout: 8000 }).then(() => check('a question typed in the pill reaches Jarvis in the full window', true), () => check('a question typed in the pill reaches Jarvis in the full window', false));
      await pill.waitForTimeout(800);
      await pill.screenshot({ path: path.join(SHOTS, 'pill.png') });
      await pill.click('#ctl');
      await pill.screenshot({ path: path.join(SHOTS, 'pill-control.png') });
    }

    /* the overlay, drawn as it is during take control */
    await app.evaluate(({ BrowserWindow }, preload) => {
      const w = new BrowserWindow({ width: 1280, height: 800, frame: false, transparent: true, show: true, webPreferences: { preload: preload, contextIsolation: true, sandbox: true } });
      w.loadURL('app://jarvis/overlay/overlay.html');
      w.webContents.once('did-finish-load', () => { w.webContents.send('overlay:info', { caps: { steps: 40, dollars: 2, minutes: 15 } }); w.webContents.send('overlay:update', { step: 6, steps: 40, spent: 0.31, cap: 2, last: 'Typing into the Shopify search box' }); });
    }, path.join(ROOT, 'src', 'preload', 'overlay-preload.js'));
    let ov = null;
    for (let i = 0; i < 20 && !ov; i++) { ov = app.windows().find((w) => w.url().includes('/overlay/')); if (!ov) await new Promise((r) => setTimeout(r, 250)); }
    if (ov) { await ov.waitForTimeout(900); await ov.screenshot({ path: path.join(SHOTS, 'overlay.png') }); check('the overlay shows step, spend and the last action', /step 6 \/ 40/.test(await ov.textContent('#steps')) && /\$0\.31/.test(await ov.textContent('#spend'))); }

    check('no script errors in the full window', errors.length === 0, errors.join(' | ').slice(0, 300));
  } catch (e) {
    check('smoke test ran to the end', false, e.message);
  } finally {
    await Promise.race([app.evaluate(({ app }) => { app.exit(0); }).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    const failed = results.filter((r) => !r.ok).length;
    fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
    try { api.srv.close(); } catch (e) {}
    process.exit(failed ? 1 : 0);
  }
})();
