// ── Simtek 10-0672-02 — F-16 Standby ADI ─────────────────────────────────────
//
// Same gauge family as Simtek 10-0335-015 (F-16 Standby ADI). The 10-0672-02
// has a 2.12×-geared synchro on the pitch axis: 1° of pitch input drives the
// resolver shaft ~2.12° so the painted ball rotates through its full
// "nose-up-through-inverted" arc within the ±90° pitch range that F4
// publishes. The C# fallback (preserved verbatim in the HSM) encodes this
// with a per-10° band table; we mirror it here with breakpoints derived from
// atan2(sin, cos) at each spec test point.
//
// Roll is straight 10·sin/cos (identity), full ±180° range so steep banks
// and inverted flight roll the dial through.
//
// Three logical channels — same shape as 10-0335-015:
//
//  1. Pitch (piecewise_resolver) — 19 breakpoints from -90° to +90° at
//     10° spacing. Resolver angles encoded MONOTONICALLY past 180° so
//     EvaluatePiecewiseResolver's linear interp stays continuous (the
//     `% 360` at the end of evaluation handles the wrap). Without
//     monotonic encoding, a positive-to-negative angle jump would make
//     the interp lerp BACKWARDS through 0° and the ball would freeze
//     or run reverse at the boundary.
//  2. Roll (piecewise_resolver) — 9 breakpoints from -180° to +180°,
//     identity. Roll dial mechanically wraps; F4 publishes signed degrees
//     across the full circle.
//  3. OFF flag (digital_invert) — input "visible (1=visible)" inverts to
//     output "hidden (1=hidden)", same as 10-0335-015.

GAUGE_CALIBRATION_DEFAULTS['10-0672-02'] = Object.freeze({
  channels: [
    // ── Pitch resolver pair (piecewise_resolver, 2.12× synchro gearing) ──
    //
    // Resolver angles derived from atan2(sinVolts, cosVolts) at each input
    // band of the legacy C# fallback. Slope is ~2.118° resolver per degree
    // input. Angles are encoded MONOTONICALLY past 180° (190° at input=90)
    // so the C# EvaluatePiecewiseResolver applies `% 360` AFTER interp;
    // a non-monotonic table would lerp through 0° and freeze the ball.
    {
      id: '10067202_Pitch_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '10067202_Pitch_COS_To_Instrument',
      inputMin: -90,
      inputMax:  90,
      breakpoints: [
        { input: -90, angle: -190 },
        { input: -80, angle: -166 },
        { input: -70, angle: -148 },
        { input: -60, angle: -127 },
        { input: -50, angle: -106 },
        { input: -40, angle:  -85 },
        { input: -30, angle:  -64 },
        { input: -20, angle:  -42 },
        { input: -10, angle:  -21 },
        { input:   0, angle:    0 },
        { input:  10, angle:   21 },
        { input:  20, angle:   42 },
        { input:  30, angle:   64 },
        { input:  40, angle:   85 },
        { input:  50, angle:  106 },
        { input:  60, angle:  127 },
        { input:  70, angle:  148 },
        { input:  80, angle:  166 },
        { input:  90, angle:  190 },
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

    // ── Roll resolver pair (piecewise_resolver, identity, full circle) ───
    // Roll dial wraps continuously; F4 publishes signed degrees across
    // the full ±180° circle. Breakpoints span the full range so steep
    // banks and inverted flight drive the dial through 180° cleanly.
    {
      id: '10067202_Roll_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '10067202_Roll_COS_To_Instrument',
      inputMin: -180,
      inputMax:  180,
      breakpoints: [
        { input: -180, angle: -180 },
        { input:  -90, angle:  -90 },
        { input:  -60, angle:  -60 },
        { input:  -30, angle:  -30 },
        { input:    0, angle:    0 },
        { input:   30, angle:   30 },
        { input:   60, angle:   60 },
        { input:   90, angle:   90 },
        { input:  180, angle:  180 },
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
