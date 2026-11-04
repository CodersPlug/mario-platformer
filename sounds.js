/* Cute synthesized SFX for Azulín (Web Audio, no external assets). */
(function (global) {
  "use strict";

  let ctx = null;

  function audio() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, gainVal, when) {
    const ac = audio();
    if (!ac) return;
    const t0 = (when || 0) + ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainVal || 0.12, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const SFX = {
    unlock: function () {
      audio();
    },
    select: function () {
      tone(660, 0.08, "triangle", 0.08);
      tone(880, 0.1, "sine", 0.06, 0.04);
    },
    place: function () {
      tone(520, 0.09, "square", 0.07);
      tone(780, 0.12, "triangle", 0.09, 0.05);
      tone(1040, 0.1, "sine", 0.05, 0.1);
    },
    grab: function () {
      tone(300, 0.07, "sine", 0.06);
    },
    throw: function () {
      tone(240, 0.08, "sawtooth", 0.05);
      tone(420, 0.12, "triangle", 0.07, 0.04);
    },
    erase: function () {
      tone(420, 0.08, "triangle", 0.07);
      tone(280, 0.12, "sine", 0.06, 0.05);
      tone(180, 0.14, "sine", 0.04, 0.1);
    },
    restart: function () {
      tone(523, 0.1, "triangle", 0.08);
      tone(659, 0.1, "triangle", 0.08, 0.08);
      tone(784, 0.14, "sine", 0.09, 0.16);
      tone(1046, 0.16, "sine", 0.06, 0.26);
    },
    /** Footstep: pass true for run (faster / brighter). */
    step: function (running) {
      if (running) {
        tone(220, 0.05, "triangle", 0.07);
        tone(440, 0.04, "sine", 0.04, 0.02);
      } else {
        tone(160, 0.06, "sine", 0.06);
        tone(240, 0.05, "triangle", 0.035, 0.025);
      }
    },
  };

  global.MelonSFX = SFX;
})(window);
