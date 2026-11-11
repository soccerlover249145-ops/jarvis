'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeKeychain, SERVICE, toHex } = require('../src/main/keychain');

function fakeSecurity() {
  const store = new Map(), calls = [];
  return {
    calls, store,
    run: async (args) => {
      calls.push({ argv: args });
      const acct = args[args.indexOf('-a') + 1];
      if (args[0] === 'find-generic-password') return store.has(acct) ? { code: 0, stdout: store.get(acct) + '\n', stderr: '' } : { code: 44, stdout: '', stderr: 'The specified item could not be found in the keychain.' };
      if (args[0] === 'delete-generic-password') { const had = store.delete(acct); return had ? { code: 0, stdout: '', stderr: '' } : { code: 44, stdout: '', stderr: 'could not be found' }; }
      return { code: 1, stdout: '', stderr: '' };
    },
    feed: async (line) => {
      calls.push({ stdin: line });
      const m = /^add-generic-password -U -s (\S+) -a (\S+) -X ([0-9a-f]+)$/.exec(line);
      if (!m) return { code: 0, stdout: '', stderr: 'bad line' };
      store.set(m[2], Buffer.from(m[3], 'hex').toString('utf8'));
      return { code: 0, stdout: '', stderr: '' };
    }
  };
}

test('a key is written over stdin as hex, never in argv, and read back', async () => {
  const f = fakeSecurity(), kc = makeKeychain(f);
  const key = 'sk-ant-api03-' + 'x'.repeat(40) + '"; rm -rf ~ #';
  assert.deepEqual(await kc.set('anthropic', key), { ok: true });
  const add = f.calls.find((c) => c.stdin);
  assert.ok(add.stdin.includes(toHex(key)));
  assert.ok(!add.stdin.includes('sk-ant'), 'the secret itself never appears on the command line');
  assert.ok(add.stdin.includes('-s ' + SERVICE + ' -a anthropic'));
  assert.ok(f.calls.filter((c) => c.argv).every((c) => !c.argv.join(' ').includes('sk-ant')));
  kc.forget();
  assert.equal(await kc.get('anthropic'), key);
});

test('unknown names are refused; empty, multi-line and huge values are refused', async () => {
  const kc = makeKeychain(fakeSecurity());
  await assert.rejects(() => kc.get('ssh'), /Unknown secret name/);
  await assert.rejects(() => kc.set('../../etc', 'x'), /Unknown secret name/);
  assert.equal((await kc.set('anthropic', '')).ok, false);
  assert.equal((await kc.set('anthropic', 'a\nb')).ok, false);
  assert.equal((await kc.set('anthropic', 'a'.repeat(9000))).ok, false);
});

test('a write the Keychain did not keep is reported as failed', async () => {
  const f = fakeSecurity(); f.feed = async () => ({ code: 0, stdout: '', stderr: 'User interaction is not allowed.' });
  const r = await makeKeychain(f).set('elevenlabs', 'abcdefghijklmnopqrstuvwxyz');
  assert.equal(r.ok, false); assert.equal(r.why, 'keychain');
});

test('delete, missing items and which()', async () => {
  const f = fakeSecurity(), kc = makeKeychain(f);
  assert.equal(await kc.get('relay'), null);
  await kc.set('relay', 'T'.repeat(40));
  assert.deepEqual(await kc.which(), { anthropic: false, elevenlabs: false, relay: true });
  assert.deepEqual(await kc.del('relay'), { ok: true });
  assert.equal(await kc.get('relay'), null);
  assert.deepEqual(await kc.del('relay'), { ok: true }, 'deleting twice is fine');
});
