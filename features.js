/* features.js: which optional parts of Kin are deployed on this site.
   The Grok Bot bridge is built but not switched on until the owner approves it, so its script is not loaded
   (and not published). With bridge:false, "ask Grok Bot ..." gets a plain local reply and nothing is sent. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var F = Kin.features = { bridge: false };
  var NAME = 'gr(?:o|ou|a)(?:k|ck|c|q|g)(?:\\s*-?\\s*bot)?';
  var ASK = new RegExp('^(?:(?:hey|ok|okay|yo)\\s+)?(?:(?:jarvis|kin)[,!.:]?\\s+)?(?:please\\s+|can you\\s+|could you\\s+|go\\s+)?(?:ask|tell|message|text|check with)\\s+(?:my\\s+)?' + NAME + '\\b', 'i');
  var ADDRESS = new RegExp('^(?:hey\\s+)?' + NAME + '\\s*[,:]\\s*\\S', 'i');
  /** true when a sentence is addressed to Grok Bot (same rule as the bridge's own intent) */
  F.grokAsked = function (text) { var t = String(text || '').replace(/\s+/g, ' ').trim(); return !!t && (ASK.test(t) || ADDRESS.test(t)); };
  if (F.bridge) document.write('<script src="grok-bridge.js"><\/script>');
})();
