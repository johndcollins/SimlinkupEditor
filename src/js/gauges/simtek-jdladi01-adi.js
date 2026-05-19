// ── Simtek JDL-ADI01 — F-16 Primary ADI ─────────────────────────────────────
//
// Source: JDL F-16 ADI calibration sheets (Simtek WO 10-7840) — 6 tables
// covering pitch, roll, vertical pointer (horizontal GS bar), horizontal
// pointer (vertical GS bar), rate of turn, and skid ball (inclinometer).
//
// 10 calibratable channels:
//
//   1. Pitch SIN/COS pair (piecewise_resolver, 1.5×-geared synchro)
//   2. Roll  SIN/COS pair (piecewise_resolver, identity ±180°)
//   3. OFF flag           (digital_invert)
//   4. GS flag            (digital_invert)
//   5. LOC flag           (digital_invert)
//   6. AUX flag           (digital_invert)
//   7. Horizontal command bar — vertical pointer  (piecewise, ±1 → ±2.22 V)
//   8. Vertical command bar   — horizontal pointer (piecewise, ±1 → ±2.22 V)
//   9. Rate of turn       (piecewise, ±1 → ±10 V)
//  10. Inclinometer       (piecewise, ±1 → ±10 V)
//
// Pitch axis is geared 1.5° resolver per 1° input pitch — the spec table
// encodes the test points in 0..360° form (e.g. 10 DIVE → 345° = -15°),
// which we mirror here in signed-degree form. EvaluatePiecewiseResolver
// applies `% 360` AFTER linear interp so angles past ±180° interpolate
// smoothly across the wrap.
//
// Command bars: at runtime the C# clamps the bar to +10 V when the
// show-bars input is low, regardless of any breakpoint table. The
// breakpoint table only fires while bars are shown. Spec: ±0.62"
// deflection (full scale) corresponds to ±2.220 V; ±0.75" (off-spec
// overswing) at ±2.550 V; HIDES at +10 V (handled in C#).

GAUGE_CALIBRATION_DEFAULTS['JDL-ADI01'] = Object.freeze({
  channels: [
    // ── Pitch resolver pair (piecewise_resolver, 1.5× gearing) ──────────
    // Spec sheet Table 1: pitch input × 1.5 = resolver angle (with the
    // gauge's 0° reference at 0°, climb positive, dive wrapping past
    // 180°). Angles encoded MONOTONICALLY past 180° so the C# linear
    // interp stays smooth — the final `% 360` in EvaluatePiecewiseResolver
    // wraps cleanly into the synchro's electrical domain.
    {
      id: 'JDLADI01_Pitch_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: 'JDLADI01_Pitch_COS_To_Instrument',
      inputMin: -90,
      inputMax:  90,
      breakpoints: [
        { input: -90, angle: -135 },  // spec: 90 DIVE → 225° = -135°
        { input: -60, angle:  -90 },  // spec: 60 DIVE → 270° = -90°
        { input: -30, angle:  -45 },  // spec: 30 DIVE → 315° = -45°
        { input: -20, angle:  -30 },  // spec: 20 DIVE → 330° = -30°
        { input: -10, angle:  -15 },  // spec: 10 DIVE → 345° = -15°
        { input:   0, angle:    0 },
        { input:  10, angle:   15 },  // spec: 10 CLIMB → 15°
        { input:  20, angle:   30 },  // spec: 20 CLIMB → 30°
        { input:  30, angle:   45 },  // spec: 30 CLIMB → 45°
        { input:  60, angle:   90 },  // spec: 60 CLIMB → 90°
        { input:  90, angle:  135 },  // spec: 90 CLIMB → 135°
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: 'JDLADI01_Pitch_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: 'JDLADI01_Pitch_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Roll resolver pair (piecewise_resolver, identity ±180°) ────────
    // Spec sheet Table 2: roll input = resolver angle. LEFT values map
    // to 270°/300°/330°/340°/350° = -90/-60/-30/-20/-10. RIGHT side is
    // pure identity 10..90.
    {
      id: 'JDLADI01_Roll_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: 'JDLADI01_Roll_COS_To_Instrument',
      inputMin: -180,
      inputMax:  180,
      breakpoints: [
        { input: -180, angle: -180 },
        { input:  -90, angle:  -90 },
        { input:  -60, angle:  -60 },
        { input:  -30, angle:  -30 },
        { input:  -20, angle:  -20 },
        { input:  -10, angle:  -10 },
        { input:    0, angle:    0 },
        { input:   10, angle:   10 },
        { input:   20, angle:   20 },
        { input:   30, angle:   30 },
        { input:   60, angle:   60 },
        { input:   90, angle:   90 },
        { input:  180, angle:  180 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: 'JDLADI01_Roll_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: 'JDLADI01_Roll_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── 4 digital flags ─────────────────────────────────────────────────
    { id: 'JDLADI01_OFF_Flag_To_Instrument', kind: 'digital_invert', invert: true },
    { id: 'JDLADI01_GS_Flag_To_Instrument',  kind: 'digital_invert', invert: true },
    { id: 'JDLADI01_LOC_Flag_To_Instrument', kind: 'digital_invert', invert: true },
    { id: 'JDLADI01_AUX_Flag_To_Instrument', kind: 'digital_invert', invert: true },

    // ── Horizontal command bar (vertical pointer)  ──────────────────────
    // Spec sheet Table 3: vertical pointer scale. Input is normalized
    // ±1.0 (F4 signal F4_ADI__ILS_VERTICAL_BAR_POSITION publishes
    // glideslope deviation / limit, range -1..+1). ±1.0 input → ±2.220 V
    // at the dial's full-deflection position (0.62"). HIDES (off-screen
    // park) is +10 V; gated in C# by the show-bars input, NOT via this
    // breakpoint table.
    {
      id: 'JDLADI01_Horizontal_Command_Bar_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -1.00, volts: -2.220 },
        { input:  0.00, volts:  0.000 },
        { input:  1.00, volts:  2.220 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Vertical command bar (horizontal pointer) ───────────────────────
    // Spec sheet Table 4: same scale as the horizontal command bar.
    {
      id: 'JDLADI01_Vertical_Command_Bar_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -1.00, volts: -2.220 },
        { input:  0.00, volts:  0.000 },
        { input:  1.00, volts:  2.220 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Rate of turn (piecewise, ±1 → ±10 V) ───────────────────────────
    // Spec sheet Table 5: linear ±10 V over ±1.0 input. Pointer-width
    // test points (1 ptr width = ±0.41 V, 2 ptr widths = ±8.2 V) are
    // mechanical position references for the calibration tech and don't
    // imply any non-linearity in the input→voltage relationship.
    {
      id: 'JDLADI01_Rate_Of_Turn_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -1.00, volts: -10.00 },
        { input:  0.00, volts:   0.00 },
        { input:  1.00, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Inclinometer / skid ball (piecewise, ±1 → ±10 V) ────────────────
    // Spec sheet Table 6: linear ±10 V over ±1.0 input (full ball
    // deflection ±0.375").
    {
      id: 'JDLADI01_Inclinometer_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -1.00, volts: -10.00 },
        { input:  0.00, volts:   0.00 },
        { input:  1.00, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
