'use strict';
/* guard.js: what Jarvis must never do on its own while it has the mouse and keyboard.

   Checked before EVERY action, because one batch from Claude can finish a whole multistep job.
   Three answers: allow, confirm (ask the owner first, with a native dialog) or deny.

   - Deny while the front app is a terminal, a script runner, an installer, a password manager or
     System Settings, and while the front window looks like a bank, broker or payments site or a
     password manager, unless the owner ticked "Allow sensitive apps and sites" for THIS task.
     Terminals and script runners are denied even then: typing in them is a shell, and the model
     gets no shell.
   - Deny shortcuts that lock the Mac, log out, shut down or empty the Trash.
   - Confirm shortcuts that delete or force quit, and typing that looks like a card number,
     an ID number, a password-like secret or a shell command.
   The model is also told to ask the owner (the ask_owner tool) before anything that types a
   password, sends, buys, books, deletes, installs or agrees to terms. This file is the backstop
   for when it does not. */

const SHELLS = new Set(['com.apple.Terminal', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable', 'dev.warp.Warp', 'io.alacritty', 'net.kovidgoyal.kitty',
  'com.github.wez.wezterm', 'co.zeit.hyper', 'com.mitchellh.ghostty', 'com.apple.ScriptEditor2', 'com.apple.Automator', 'com.apple.shortcuts',
  'com.apple.Terminal.shell', 'org.tabby', 'com.raphaelamorim.rio']);
const SENSITIVE_APPS = new Set(['com.apple.systempreferences', 'com.apple.SystemSettings', 'com.apple.Settings', 'com.apple.keychainaccess', 'com.apple.Passwords',
  'com.1password.1password', 'com.agilebits.onepassword7', 'com.agilebits.onepassword-osx', 'com.bitwarden.desktop', 'com.lastpass.LastPass',
  'com.dashlane.dashlanephonefinal', 'com.callpod.keepermac', 'org.keepassxc.keepassxc', 'com.apple.installer', 'com.apple.DiskUtility',
  'com.apple.ActivityMonitor', 'com.apple.MigrateAssistant', 'com.apple.BootCampAssistant', 'com.apple.Console', 'com.apple.securityagent']);
const SENSITIVE_TITLE = new RegExp('\\b(' + [
  'bank', 'banking', 'credit union', 'chase', 'wells fargo', 'bank of america', 'citibank', 'capital one', 'schwab', 'fidelity', 'vanguard',
  'robinhood', 'e\\*?trade', 'ameritrade', 'merrill', 'paypal', 'venmo', 'cash app', 'zelle', 'coinbase', 'kraken', 'binance', 'american express',
  'amex', 'discover card', 'ally', 'sofi', 'chime', 'monzo', 'revolut', 'wise\\.com', 'brokerage', 'wire transfer', 'routing number',
  '1password', 'bitwarden', 'lastpass', 'dashlane', 'keeper', 'keepass', 'password manager', 'passwords', 'keychain',
  'system settings', 'system preferences', 'apple account', 'apple id', 'icloud settings'
].join('|') + ')\\b', 'i');

/* shortcuts by "mods|key" after keys.parseCombo, mods sorted */
const DENY_KEYS = new Set(['cmd+ctrl|q' /* lock */, 'cmd+shift|q' /* log out */, 'alt+cmd+shift|q', 'cmd+ctrl|power', 'alt+cmd|eject',
  'alt+cmd+shift|backspace' /* empty trash, no prompt */, 'cmd+shift|backspace' /* empty trash */]);
const CONFIRM_KEYS = new Map([
  ['cmd|backspace', 'move the selected items to the Trash'],
  ['alt+cmd|backspace', 'delete the selected items immediately'],
  ['alt+cmd|escape', 'open Force Quit'],
  ['alt+cmd+shift|escape', 'force quit the front app'],
  ['cmd|delete', 'delete the selection'],
  ['cmd+shift|delete', 'delete the selection']
]);

function luhn(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let n = digits.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
/** why typing this text needs the owner's yes, or '' */
function typingConcern(text) {
  const t = String(text || '');
  const cards = t.match(/(?:\d[ -]?){13,19}/g) || [];
  if (cards.some(function (c) { const d = c.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); })) return 'type what looks like a card number';
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(t)) return 'type what looks like a Social Security number';
  if (/(^|[\s;|&])(sudo|rm\s+-|chmod|chown|curl\s|wget\s|bash\s|sh\s+-c|osascript|launchctl|defaults\s+write|diskutil|csrutil|spctl|xattr\s+-d)\b/.test(t)) return 'type what looks like a shell command';
  if (/\b(sk-ant-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[bpa]-[A-Za-z0-9-]{10,})/.test(t)) return 'type what looks like a secret key';
  /* one long word with letters, digits and symbols mixed reads like a password */
  if (/^\S{8,64}$/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t) && /\d/.test(t) && /[^A-Za-z0-9]/.test(t) && !/^https?:\/\//.test(t) && !/@.*\./.test(t)) return 'type what looks like a password';
  return '';
}

/**
 * Decide one action. front: { bundleId, name, title } of the frontmost app and window (may be partial).
 * task: { allowSensitive: bool }. combo: parsed key combo for key/hold_key, else null.
 * Returns { verdict: 'allow'|'confirm'|'deny', why }.
 */
function judge(action, input, front, task, combo) {
  front = front || {}; task = task || {};
  const passive = action === 'screenshot' || action === 'zoom' || action === 'cursor_position' || action === 'wait' || action === 'mouse_move';
  if (!passive) {
    const bid = String(front.bundleId || '');
    if (SHELLS.has(bid)) return { verdict: 'deny', why: (front.name || 'A terminal') + ' is in front. Jarvis never types or clicks in terminals or script runners.' };
    const sensitive = SENSITIVE_APPS.has(bid) || SENSITIVE_TITLE.test(String(front.title || '')) || SENSITIVE_TITLE.test(String(front.name || ''));
    if (sensitive && !task.allowSensitive) return { verdict: 'deny', why: 'The front window (' + (front.title || front.name || bid) + ') looks like banking, payments, a password manager or system settings. Jarvis stays out unless you allow sensitive apps for this task.' };
  }
  if ((action === 'key' || action === 'hold_key') && combo) {
    const id = combo.mods.slice().sort().join('+') + '|' + combo.key;
    if (DENY_KEYS.has(id)) return { verdict: 'deny', why: 'That shortcut locks the Mac, logs out or empties the Trash. Jarvis never presses it.' };
    if (CONFIRM_KEYS.has(id)) return { verdict: 'confirm', why: 'Jarvis wants to ' + CONFIRM_KEYS.get(id) + '.' };
  }
  if (action === 'type') {
    const c = typingConcern(input && input.text);
    if (c) return { verdict: 'confirm', why: 'Jarvis wants to ' + c + ' into ' + (front.title || front.name || 'the front window') + '.' };
  }
  return { verdict: 'allow', why: '' };
}

module.exports = { judge, typingConcern, luhn, SHELLS, SENSITIVE_APPS, SENSITIVE_TITLE, DENY_KEYS, CONFIRM_KEYS };
