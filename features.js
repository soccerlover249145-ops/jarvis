/* features.js: which optional parts of Kin are deployed on this site.
   The Grok Bot bridge is deployed (approved by the owner). It is still off on every device until the owner turns it on
   in Settings with two taps and pastes a device token; until then "ask Grok Bot ..." gets a local reply and nothing is sent.
   With bridge:false the script would not load at all, and "ask Grok Bot ..." would get a plain local reply. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var F = Kin.features = { bridge: true };
  var ASK = new RegExp('^(?:(?:hey|ok|okay)\\s+)?(?:(?:jarvis|kin)[,!.:]?\\s+)?(?:please\\s+|can you\\s+|could you\\s+|go\\s+)?ask\\s+(?:my\\s+)?grok\\s*-?\\s*bot(?=$|[\\s,:;.!?\\-])', 'i');
  /** true when a sentence starts by asking Grok Bot (same rule as the bridge's own intent) */
  F.grokAsked = function (text) { var t = String(text || '').replace(/\s+/g, ' ').trim(); return !!t && ASK.test(t); };
  if (F.bridge) document.write('<script src="grok-bridge.js"><\/script>');
})();
