// ── Simtek 10-0672-02 — F-16 Standby ADI ─────────────────────────────────────
//
// Same gauge family as Simtek 10-0335-015 (F-16 Standby ADI). The C#
// fallback uses a hand-authored per-10° band table for pitch that approximates
// a 2.1×-geared resolver; for the editor-authored defaults we use the cleaner
// identity mapping (input pitch° == resolver angle°) so users have a sane
// starting point and can tune the breakpoints against their actual gauge.
// Roll is straight 10·sin/cos (identity).
//
// Three logical channels — same shape as 10-0335-015:
//
//  1. Pitch (piecewise_resolver) — 11 breakpoints from -90° to +90°,
//     identity by default.
//  2. Roll (piecewise_resolver) — 9 breakpoints from -90° to +90°, identity.
//     (Input range ±180° to cover BMS's full signed-degree publish, but
//     the breakpoints only define behaviour out to ±90° — the rest
//     extrapolates.)
//  3. OFF flag (digital_invert) — input "visible (1=visible)" inverts to
//     output "hidden (1=hidden)", same as 10-0335-015.

GAUGE_CALIBRATION_DEFAULTS['10-0672-02'] = Object.freeze({
  channels: [
    // ── Pitch resolver pair (piecewise_resolver, identity) ──────────────
    {
      id: '10067202_Pitch_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '10067202_Pitch_COS_To_Instrument',
      inputMin: -90,
      inputMax:  90,
      breakpoints: [
        { input: -90, angle: -90 },
        { input: -45, angle: -45 },
        { input: -30, angle: -30 },
        { input: -20, angle: -20 },
        { input: -10, angle: -10 },
        { input:   0, angle:   0 },
        { input:  10, angle:  10 },
        { input:  20, angle:  20 },
        { input:  30, angle:  30 },
        { input:  45, angle:  45 },
        { input:  90, angle:  90 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
      // Caged-rest behaviour: when the OFF flag input is visible
      // (gauge spinning down or unpowered), drive the synchro to a
      // random rest angle within ±20° pitch. Opt-in (cagedRestEnabled
      // defaults to false) so existing profiles are unchanged.
      cagedRestEnabled: false,
      cagedRestRangeMinDegrees: -20,
      cagedRestRangeMaxDegrees:  20,
    },
    {
      id: '10067202_Pitch_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '10067202_Pitch_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Roll resolver pair (piecewise_resolver, identity) ───────────────
    {
      id: '10067202_Roll_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '10067202_Roll_COS_To_Instrument',
      inputMin: -180,
      inputMax:  180,
      breakpoints: [
        { input: -90, angle: -90 },
        { input: -60, angle: -60 },
        { input: -30, angle: -30 },
        { input: -10, angle: -10 },
        { input:   0, angle:   0 },
        { input:  10, angle:  10 },
        { input:  30, angle:  30 },
        { input:  60, angle:  60 },
        { input:  90, angle:  90 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
      // Caged-rest: ±40° roll. Opt-in.
      cagedRestEnabled: false,
      cagedRestRangeMinDegrees: -40,
      cagedRestRangeMaxDegrees:  40,
    },
    {
      id: '10067202_Roll_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '10067202_Roll_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── OFF flag (digital_invert) ───────────────────────────────────────
    {
      id: '10067202_OFF_Flag_To_Instrument',
      kind: 'digital_invert',
      invert: true,
    },
  ],
});
