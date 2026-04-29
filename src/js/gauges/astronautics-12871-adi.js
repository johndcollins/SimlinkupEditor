// ── Astronautics 12871 — F-16 Standby ADI ───────────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Astronautics/
//         Astronautics12871HardwareSupportModule.cs.
//
// Larger ADI variant with 8 calibratable channels:
//
//   1. Pitch SIN/COS pair (piecewise_resolver, identity ±90°)
//   2. Roll SIN/COS pair  (piecewise_resolver, identity ±180°)
//   3. OFF flag           (digital_invert, default true)
//   4. GS flag            (digital_invert, default true)
//   5. LOC flag           (digital_invert, default true)
//   6. AUX flag           (digital_invert, default true)
//   7. Horizontal command bar (piecewise — with caveat below)
//   8. Vertical command bar   (piecewise — with caveat below)
//   9. Inclinometer       (piecewise — pure linear, ±100% × 10 V)
//  10. Rate of turn       (piecewise — pure linear, ±100% × 10 V)
//
// Caveat on command bars: the C# UpdateHorizontal/VerticalCommandBarOutputValues
// gates the output by a SECOND digital input (`Show_Command_Bars_From_Sim`).
// When that flag is FALSE the bars are forced to +10 V (parked off-screen).
// The editor's piecewise table can only express the input → output curve,
// so the override path applies the calibration table only when the bars
// are SHOWN; the show/hide gating stays in the C#.
//
// Caveat on inclinometer / rate-of-turn: the C# fallback math has a clamp
// bug — `if (output > 10) output = 0` (should be `= 10`). Driving these
// inputs above 100% sends the needle to zero instead of pegging at full
// scale. The override path uses ApplyTrim which clamps correctly. The
// rewritten HSM fixes the fallback path too.

GAUGE_CALIBRATION_DEFAULTS['12871'] = Object.freeze({
  channels: [
    // ── Pitch resolver pair (piecewise_resolver, identity) ──────────────
    {
      id: '12871_Pitch_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '12871_Pitch_COS_To_Instrument',
      inputMin: -90,
      inputMax:  90,
      breakpoints: [
        { input: -90, angle: -90 },
        { input: -45, angle: -45 },
        { input: -30, angle: -30 },
        { input: -10, angle: -10 },
        { input:   0, angle:   0 },
        { input:  10, angle:  10 },
        { input:  30, angle:  30 },
        { input:  45, angle:  45 },
        { input:  90, angle:  90 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '12871_Pitch_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '12871_Pitch_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Roll resolver pair (piecewise_resolver, identity ±180°) ────────
    {
      id: '12871_Roll_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '12871_Roll_COS_To_Instrument',
      inputMin: -180,
      inputMax:  180,
      breakpoints: [
        { input: -180, angle: -180 },
        { input: -150, angle: -150 },
        { input: -120, angle: -120 },
        { input:  -90, angle:  -90 },
        { input:  -60, angle:  -60 },
        { input:  -30, angle:  -30 },
        { input:    0, angle:    0 },
        { input:   30, angle:   30 },
        { input:   60, angle:   60 },
        { input:   90, angle:   90 },
        { input:  120, angle:  120 },
        { input:  150, angle:  150 },
        { input:  180, angle:  180 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '12871_Roll_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '12871_Roll_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── 4 digital flags ─────────────────────────────────────────────────
    { id: '12871_OFF_Flag_To_Instrument', kind: 'digital_invert', invert: true },
    { id: '12871_GS_Flag_To_Instrument',  kind: 'digital_invert', invert: true },
    { id: '12871_LOC_Flag_To_Instrument', kind: 'digital_invert', invert: true },
    { id: '12871_AUX_Flag_To_Instrument', kind: 'digital_invert', invert: true },

    // ── Command bars (piecewise; show/hide gating stays in C#) ─────────
    // Default: input × 2.25, with full deflection at ~±4.44% (then clamp).
    {
      id: '12871_Horizontal_Command_Bar_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -100, volts: -10.00 },
        { input:  -50, volts:  -10.00 },
        { input:   -4.44, volts:  -10.00 },
        { input:    0,    volts:   0.00 },
        { input:    4.44, volts:  10.00 },
        { input:   50,    volts:  10.00 },
        { input:  100,    volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '12871_Vertical_Command_Bar_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -100, volts: -10.00 },
        { input:  -50, volts:  -10.00 },
        { input:   -4.44, volts:  -10.00 },
        { input:    0,    volts:   0.00 },
        { input:    4.44, volts:  10.00 },
        { input:   50,    volts:  10.00 },
        { input:  100,    volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Inclinometer (piecewise, ±100% → ±10 V) ─────────────────────────
    {
      id: '12871_Inclinometer_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -1.00, volts: -10.00 },
        { input: -0.75, volts:  -7.50 },
        { input: -0.50, volts:  -5.00 },
        { input: -0.25, volts:  -2.50 },
        { input:  0.00, volts:   0.00 },
        { input:  0.25, volts:   2.50 },
        { input:  0.50, volts:   5.00 },
        { input:  0.75, volts:   7.50 },
        { input:  1.00, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Rate of turn (piecewise, ±100% → ±10 V) ─────────────────────────
    {
      id: '12871_Rate_Of_Turn_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -1.00, volts: -10.00 },
        { input: -0.75, volts:  -7.50 },
        { input: -0.50, volts:  -5.00 },
        { input: -0.25, volts:  -2.50 },
        { input:  0.00, volts:   0.00 },
        { input:  0.25, volts:   2.50 },
        { input:  0.50, volts:   5.00 },
        { input:  0.75, volts:   7.50 },
        { input:  1.00, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
