'use strict';
/* fileops.js: the few file changes Jarvis can make, and only inside the folders the owner shared.

   Reading and finding files lives in actions.js. This file is the small, separate place for the two
   changes that move a file: moving it to another shared folder, and resolving a destination folder.
   Both canonicalize every path (links followed) and refuse anything that lands outside the shared
   folders. Nothing here overwrites a file, and nothing here deletes: the Trash is done by the Finder
   (shell.trashItem) in main.js, behind a confirm. */

const path = require('path');
const fsp = require('fs').promises;

/** real path p is inside one of the (already real) folders? */
function inside(p, folders) {
  return (folders || []).some(function (f) {
    const rel = path.relative(f, p);
    return rel === '' || (rel && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
  });
}

/** resolve a destination FOLDER the model named; must exist and be inside a shared folder */
async function resolveDir(raw, folders, fs) {
  fs = fs || fsp;
  const want = String(raw || '').trim();
  if (!want || want.length > 2048 || /\0/.test(want)) return { ok: false, why: 'No folder given.' };
  const real = [];
  for (const f of folders || []) { try { real.push(await fs.realpath(f)); } catch (e) {} }
  if (!real.length) return { ok: false, why: 'No folders are shared with Jarvis yet.' };
  const tries = path.isAbsolute(want) ? [want] : real.map(function (f) { return path.join(f, want); });
  for (const t of tries) {
    let r;
    try { r = await fs.realpath(t); } catch (e) { continue; }
    let st;
    try { st = await fs.stat(r); } catch (e) { continue; }
    if (!st.isDirectory()) return { ok: false, why: 'That is a file, not a folder.' };
    if (!inside(r, real)) return { ok: false, why: 'That folder is outside the folders you shared with Jarvis.' };
    return { ok: true, path: r };
  }
  return { ok: false, why: 'I could not find that folder in your shared folders.' };
}

/** move realFrom to target (already inside a shared folder); never overwrites an existing file */
async function move(realFrom, target, fs) {
  fs = fs || fsp;
  let clash = false;
  try { await fs.access(target); clash = true; } catch (e) {}
  if (clash) throw new Error('a file with that name is already there');
  await fs.rename(realFrom, target);
  return { ok: true };
}

module.exports = { resolveDir, move, inside };
