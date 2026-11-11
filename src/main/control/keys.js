'use strict';
/* keys.js: Claude names keys the way xdotool does ("Return", "ctrl+s", "alt+Tab", "super+l").
   macOS input events need a virtual key code and modifier flags. This turns one into the other,
   so the Swift helper stays a dumb pair of hands. */

const CODES = {
  a: 0x00, s: 0x01, d: 0x02, f: 0x03, h: 0x04, g: 0x05, z: 0x06, x: 0x07, c: 0x08, v: 0x09, b: 0x0B, q: 0x0C, w: 0x0D, e: 0x0E, r: 0x0F,
  y: 0x10, t: 0x11, 1: 0x12, 2: 0x13, 3: 0x14, 4: 0x15, 6: 0x16, 5: 0x17, '=': 0x18, 9: 0x19, 7: 0x1A, '-': 0x1B, 8: 0x1C, 0: 0x1D,
  ']': 0x1E, o: 0x1F, u: 0x20, '[': 0x21, i: 0x22, p: 0x23, l: 0x25, j: 0x26, "'": 0x27, k: 0x28, ';': 0x29, '\\': 0x2A, ',': 0x2B,
  '/': 0x2C, n: 0x2D, m: 0x2E, '.': 0x2F, '`': 0x32,
  return: 0x24, enter: 0x24, kp_enter: 0x4C, tab: 0x30, space: 0x31, backspace: 0x33, escape: 0x35, delete: 0x75, forwarddelete: 0x75,
  home: 0x73, end: 0x77, page_up: 0x74, prior: 0x74, page_down: 0x79, next: 0x79, left: 0x7B, right: 0x7C, down: 0x7D, up: 0x7E,
  f1: 0x7A, f2: 0x78, f3: 0x63, f4: 0x76, f5: 0x60, f6: 0x61, f7: 0x62, f8: 0x64, f9: 0x65, f10: 0x6D, f11: 0x67, f12: 0x6F,
  help: 0x72, capslock: 0x39
};
/* other names for the same keys */
const ALIAS = {
  esc: 'escape', ret: 'return', bksp: 'backspace', back_space: 'backspace', del: 'delete', pgup: 'page_up', pageup: 'page_up', pgdn: 'page_down', pagedown: 'page_down',
  arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down', left_arrow: 'left', right_arrow: 'right', up_arrow: 'up', down_arrow: 'down',
  minus: '-', equal: '=', equals: '=', plus: '=', comma: ',', period: '.', slash: '/', backslash: '\\', semicolon: ';', apostrophe: "'", quote: "'",
  grave: '`', bracketleft: '[', bracketright: ']', spacebar: 'space', kp_return: 'kp_enter', caps_lock: 'capslock'
};
const MODS = {
  shift: 0x20000, ctrl: 0x40000, control: 0x40000, alt: 0x80000, option: 0x80000, opt: 0x80000,
  super: 0x100000, cmd: 0x100000, command: 0x100000, meta: 0x100000, win: 0x100000, fn: 0x800000
};
const MOD_CANON = { 0x20000: 'shift', 0x40000: 'ctrl', 0x80000: 'alt', 0x100000: 'cmd', 0x800000: 'fn' };
/* arrow and navigation keys carry the fn and keypad flags on a real Mac keyboard; some apps look for them */
const NAV = new Set([0x7B, 0x7C, 0x7D, 0x7E, 0x73, 0x77, 0x74, 0x79, 0x75]);

/** "ctrl+shift+Tab" -> { code, flags, mods: ['ctrl','shift'], key: 'tab' } ; throws on unknown keys */
function parseCombo(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('no key given');
  /* "+" itself as the last key: "cmd++" */
  const parts = raw === '+' ? ['+'] : raw.replace(/\+\+$/, '+plus').split('+').map(function (p) { return p.trim(); }).filter(Boolean);
  let flags = 0, key = null;
  parts.forEach(function (p, i) {
    const l = p.toLowerCase().replace(/^(super_l|super_r|meta_l|meta_r)$/, 'super').replace(/^(control_l|control_r)$/, 'ctrl').replace(/^(shift_l|shift_r)$/, 'shift').replace(/^(alt_l|alt_r)$/, 'alt');
    if (i < parts.length - 1) {
      if (!MODS[l]) throw new Error('"' + p + '" is not a modifier key');
      flags |= MODS[l];
    } else {
      key = l;
    }
  });
  /* a combination that is only modifiers ("shift") presses the modifier key itself */
  const MODKEY = { shift: 0x38, ctrl: 0x3B, control: 0x3B, alt: 0x3A, option: 0x3A, super: 0x37, cmd: 0x37, command: 0x37, meta: 0x37 };
  let code;
  if (MODKEY[key] !== undefined && parts.length === 1) code = MODKEY[key];
  else {
    const k = ALIAS[key] || key;
    code = CODES[k];
    if (code === undefined && k.length === 1 && /[A-Z]/.test(parts[parts.length - 1])) code = CODES[k.toLowerCase()];
    if (code === undefined) throw new Error('unknown key "' + parts[parts.length - 1] + '"');
    key = k;
  }
  if (NAV.has(code)) flags |= 0x800000 | 0x200000;
  const mods = Object.keys(MOD_CANON).map(Number).filter(function (m) { return flags & m; }).map(function (m) { return MOD_CANON[m]; });
  return { code: code, flags: flags, key: key, mods: mods.filter(function (m) { return !(m === 'fn' && NAV.has(code)); }) };
}

/** modifier text on clicks and scrolls ("shift", "ctrl+shift") -> flags */
function parseMods(text) {
  if (!text) return 0;
  return String(text).split('+').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean).reduce(function (f, m) {
    if (!MODS[m]) throw new Error('"' + m + '" is not a modifier key');
    return f | MODS[m];
  }, 0);
}

module.exports = { parseCombo, parseMods, CODES, MODS };
