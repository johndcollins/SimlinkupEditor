// ── Simtek 10-5859 — F-16 Standby Attitude Indicator ─────────────────────────
//
// Source: PL20-5859 (gauge spec sheet) Tables 1 & 2.
// Companion HSM: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//                Simtek105859HardwareSupportModule.cs
//
// Two logical channels:
//
//  1. Pitch (piecewise_resolver) — Table 1 reference angles.
//     Input -90..+90° pitch maps non-linearly to a reference angle 0..360°
//     via 11 spec-sheet test points; sin/cos × 10 V drives the dual DC
//     servo. Both ±90° map to the inverted "DOT" position at 194.82°
//     (the back-of-drum zero — drum is opposite the index when fully
//     inverted).
//
//     Angles are encoded MONOTONICALLY (values exceed 360° so linear
//     interpolation works across the 360°→0° wrap at input=0); the C#
//     evaluator applies % 360 before sin/cos so the wrap is invisible
//     to the synchro hardware. Same convention as 10-1084.
//
//  2. Roll (piecewise_resolver) — Table 2 reference angles.
//     Input -90L..+90R degrees maps linearly to reference angle
//     (90L→270°, 0→0/360°, 90R→90°). Encoded monotonically as
//     270..450° in the breakpoint table. 13 breakpoints every 15°
//     give users fine-grained control over local synchro drift.

GAUGE_CALIBRATION_DEFAULTS['10-5859'] = Object.freeze({
  channels: [
    // ── Pitch resolver pair (piecewise_resolver) ────────────────────────
    {
      id: '105859_Pitch_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '105859_Pitch_COS_To_Instrument',
      // 11 monotonic breakpoints. Reference angles match PL20-5859 Table 1
      // exactly for input ≥ 0; negative-pitch entries are the spec's
      // own dive-side angles (which already lie in 194..360°).
      breakpoints: [
        { input: -90, angle: 194.82 },
        { input: -60, angle: 232.94 },
        { input: -30, angle: 296.47 },
        { input: -20, angle: 317.65 },
        { input: -10, angle: 338.82 },
        { input:   0, angle: 360.00 },
        { input:  10, angle: 381.18 }, // raw  21.18 + 360
        { input:  20, angle: 402.35 }, // raw  42.35 + 360
        { input:  30, angle: 423.53 }, // raw  63.53 + 360
        { input:  60, angle: 487.10 }, // raw 127.10 + 360
        { input:  90, angle: 554.82 }, // raw 194.82 + 360 (DOT inverted)
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '105859_Pitch_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '105859_Pitch_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Roll resolver pair (piecewise_resolver) ─────────────────────────
    {
      id: '105859_Roll_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '105859_Roll_COS_To_Instrument',
      // PL20-5859 Table 2 — 9 explicit test points covering 90L..90R.
      // Encoded monotonically: 90L is the lowest input (-90°), reference
      // angle 270°; rolling clockwise through 0°, the angle increases to
      // 360 (=0) then wraps past to 450 (=90) at full 90R. Runtime % 360
      // before sin/cos. Defaults match the spec exactly.
      inputMin: -90,
      inputMax:  90,
      breakpoints: [
        { input: -90, angle: 270 },
        { input: -60, angle: 300 },
        { input: -30, angle: 330 },
        { input: -10, angle: 350 },
        { input:   0, angle: 360 },
        { input:  10, angle: 370 },
        { input:  30, angle: 390 },
        { input:  60, angle: 420 },
        { input:  90, angle: 450 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '105859_Roll_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '105859_Roll_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
