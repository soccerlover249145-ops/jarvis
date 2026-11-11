'use strict';
/* keychain.js: Jarvis keeps every key in the macOS Keychain, never in a file.

   It drives Apple's own /usr/bin/security tool. Nothing is installed and nothing is compiled.
   - Writing: the secret travels over stdin to `security -i` as hex (-X), so it never appears in
     the process list (argv) and needs no quoting.
   - Reading: `security find-generic-password -w` prints it to our stdout pipe.
   - Items are generic passwords under the service "com.jarvis.desktop", account = the key's name.

   Only the names in NAMES can be stored. The window never receives a stored key: it gets a
   placeholder, and the real key is put on the request as it leaves the app (see secrets.js). */

const { execFile, spawn } = require('child_process');

const SERVICE = 'com.jarvis.desktop';  /* one word, so nothing on the stdin line needs quoting */
const SECURITY = '/usr/bin/security';
/** every secret Jarvis may keep, and the host each one may ever be sent to */
const NAMES = {
  anthropic: { label: 'Claude API key', hosts: ['api.anthropic.com'] },
  elevenlabs: { label: 'ElevenLabs voice key', hosts: ['api.elevenlabs.io'] },
  relay: { label: 'Grok Bot bridge device token', hosts: [] /* the owner's relay host, set at run time */ }
};

function check(name) {
  if (!Object.prototype.hasOwnProperty.call(NAMES, name)) throw new Error('Unknown secret name');
}
function toHex(s) { return Buffer.from(String(s), 'utf8').toString('hex'); }

/** make a Keychain store. run/feed are injectable so tests can stand in for /usr/bin/security. */
function makeKeychain(opts) {
  opts = opts || {};
  const run = opts.run || function (args) {
    return new Promise(function (resolve) {
      execFile(SECURITY, args, { timeout: 10000, maxBuffer: 1 << 20 }, function (err, stdout, stderr) {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    });
  };
  const feed = opts.feed || function (line) {
    return new Promise(function (resolve) {
      const p = spawn(SECURITY, ['-i'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';
      const t = setTimeout(function () { try { p.kill(); } catch (e) {} }, 10000);
      p.stdout.on('data', function (d) { out += d; });
      p.stderr.on('data', function (d) { err += d; });
      p.on('close', function (code) { clearTimeout(t); resolve({ code: code || 0, stdout: out, stderr: err }); });
      p.on('error', function () { clearTimeout(t); resolve({ code: 1, stdout: '', stderr: 'security not available' }); });
      p.stdin.end(line + '\nquit\n');
    });
  };
  const cache = new Map(); /* in the main process only; cleared on quit */

  return {
    NAMES,
    async get(name) {
      check(name);
      if (cache.has(name)) return cache.get(name);
      const r = await run(['find-generic-password', '-s', SERVICE, '-a', name, '-w']);
      const v = r.code === 0 ? r.stdout.replace(/\n$/, '') : null;
      if (v) cache.set(name, v);
      return v || null;
    },
    async set(name, value) {
      check(name);
      value = String(value == null ? '' : value);
      if (!value || value.length > 8192 || /[\r\n\0]/.test(value)) return { ok: false, why: 'shape' };
      /* -U updates an existing item; the account and service are fixed words, the secret is hex */
      const r = await feed('add-generic-password -U -s ' + SERVICE + ' -a ' + name + ' -X ' + toHex(value));
      /* security -i reports failures on stderr but may still exit 0, so read the item back */
      cache.delete(name);
      const back = await this.get(name);
      if (back !== value) return { ok: false, why: 'keychain', detail: String(r.stderr || '').slice(0, 200) };
      return { ok: true };
    },
    async del(name) {
      check(name);
      cache.delete(name);
      const r = await run(['delete-generic-password', '-s', SERVICE, '-a', name]);
      return { ok: r.code === 0 || /could not be found/i.test(r.stderr) };
    },
    /** which secrets exist, without revealing any */
    async which() {
      const out = {};
      for (const n of Object.keys(NAMES)) out[n] = !!(await this.get(n));
      return out;
    },
    forget() { cache.clear(); }
  };
}

module.exports = { makeKeychain, NAMES, SERVICE, toHex };
