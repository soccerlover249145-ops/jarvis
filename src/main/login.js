'use strict';
/* login.js: Jarvis opens when the owner logs in to the Mac, as a normal window (not hidden in the
   menu bar), unless they switch it off in Settings > Mac or the menu bar orb. The first time the app
   runs it says so once, so the owner knows where to change it. */

const NOTE = {
  title: 'Jarvis will open when you log in',
  detail: 'Change it any time in Settings > Mac ("Open Jarvis when I log in"), or from the menu bar orb.'
};

/** The settings handed to app.setLoginItemSettings for the owner's current choice. */
function loginOptions(c) {
  return { openAtLogin: !!(c && c.launchAtLogin), openAsHidden: false };
}

/** Whether the one-time note should show now: only while opening at login is on and it has not been shown. */
function needsNote(c) {
  return !!(c && c.launchAtLogin && !c.seenLoginNote);
}

/** Apply the owner's choice to macOS; never throws (an unsigned or moved app can refuse). */
function applyLogin(app, c) {
  try { app.setLoginItemSettings(loginOptions(c)); return true; } catch (e) { return false; }
}

module.exports = { loginOptions, needsNote, applyLogin, NOTE };
