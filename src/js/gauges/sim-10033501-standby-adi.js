// ── Simtek 10-0335-01 — F-16 Standby ADI ─────────────────────────────────────
//
// Source: Simtek 10-0335-01 spec sheet (Dropbox/Viper Pit/Gauges/Simtek/),
// Calibration Data tables on sheet 3 of 3. Two synchro pairs plus an
// OFF flag digital output. Mechanically simpler than the 10-1084 SAI v2:
// no piecewise non-linearity in either axis — both pitch and roll use a
// straight identity mapping (input degrees → resolver angle degrees).
//
// Three logical channels:
//
//  1. Pitch (piecewise_resolver) — 11 spec test points covering -90..+90°.
//     Input pitch degrees ARE the resolver angle. The dial drum is
//     mechanically geared 2:1 to the resolver, which is why the spec's
//     "DRUM ACTUAL DEGREES" column shows 2× the indicated value — that's
//     gauge geometry, not anything our DAC drive needs to know about.
//     The SINE/COSINE INPUT columns are what we care about: at input
//     pitch 10°, sin = +1.736 V = 10·sin(10°).
//
//  2. Roll (piecewise_resolver) — 9 spec test points covering R90..L90
//     (i.e. ±90°). Identity mapping; L values are negative angles
//     (L10 = -10° = the SINE = -1.736 V row).
//
//  3. OFF flag (digital_invert) — single line of C#:
//     `_offFlagOutputSignal.State = !_offFlagInputSignal.State`. Same as
//     10-1084: input "visible (1=visible)" inverts to output "hidden
//     (1=hidden)" because the synchro driver expects active-low logic.

GAUGE_CALIBRATION_DEFAULTS['10-0335-01'] = Object.freeze({
  channels: [
    // ── Pitch resolver pair (piecewise_resolver, identity) ──────────────
    {
      id: '10033501_Pitch_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '10033501_Pitch_COS_To_Instrument',
      // 11 spec test points from -90° to +90°, asymmetrically denser at
      // small angles (extra points at ±20, ±30, ±45). Identity mapping —
      // the resolver angle equals the input pitch in degrees.
      // inputMin/inputMax bound the editor's scrub slider only.
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
      id: '10033501_Pitch_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '10033501_Pitch_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Roll resolver pair (piecewise_resolver, identity) ───────────────
    // 9 spec test points from L90..R90 (i.e. -90..+90°). The spec's "DIAL
    // DEGREES" column shows the L values mapped onto 270/300/330/350 —
    // that's how the gauge dial face is painted (L wraps past 180° on the
    // analog dial). For the resolver inputs themselves, BMS publishes
    // signed degrees (-180..+180) and the C# uses 10·sin(input°) directly,
    // so identity mapping with NEGATIVE angles for L values is correct.
    {
      id: '10033501_Roll_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '10033501_Roll_COS_To_Instrument',
      inputMin: -180,
      inputMax:  180,
      breakpoints: [
        { input: -90, angle: -90 },   // L90
        { input: -60, angle: -60 },   // L60
        { input: -30, angle: -30 },   // L30
        { input: -10, angle: -10 },   // L10
        { input:   0, angle:   0 },
        { input:  10, angle:  10 },   // R10
        { input:  30, angle:  30 },   // R30
        { input:  60, angle:  60 },   // R60
        { input:  90, angle:  90 },   // R90
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
      id: '10033501_Roll_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '10033501_Roll_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── OFF flag (digital_invert) ───────────────────────────────────────
    {
      id: '10033501_OFF_Flag_To_Instrument',
      kind: 'digital_invert',
      invert: true,
    },
  ],
});
