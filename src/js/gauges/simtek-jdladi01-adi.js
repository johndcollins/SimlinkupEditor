// ── Simtek JDL-ADI01 — F-16 Primary ADI ─────────────────────────────────────
//
// Source: JDL-ADI01 spec sheet (FSCM 65311) — connector pinout only;
// no calibration tables supplied. Channel set is identical to
// Astronautics 12871, so we ship the same defaults verbatim under
// the JDLADI01 prefix.
//
// 10 calibratable channels:
//
//   1. Pitch SIN/COS pair (piecewise_resolver, identity ±90°)
//   2. Roll SIN/COS pair  (piecewise_resolver, identity ±180°)
//   3. OFF flag           (digital_invert, default true)
//   4. GS flag            (digital_invert, default true)
//   5. LOC flag           (digital_invert, default true)
//   6. AUX flag           (digital_invert, default true)
//   7. Horizontal command bar (piecewise — show/hide gating in C#)
//   8. Vertical command bar   (piecewise — show/hide gating in C#)
//   9. Inclinometer       (piecewise — pure linear, ±100% × 10 V)
//  10. Rate of turn       (piecewise — pure linear, ±100% × 10 V)
//
// JDL connector labels the command bars as "horizontal pointer" /
// "vertical pointer". The port IDs use Command_Bar for consistency
// with the rest of the F-16 ADI catalog.

GAUGE_CALIBRATION_DEFAULTS['JDL-ADI01'] = Object.freeze({
  channels: [
    // ── Pitch resolver pair (piecewise_resolver, identity) ──────────────
    {
      id: 'JDLADI01_Pitch_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: 'JDLADI01_Pitch_COS_To_Instrument',
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
      id: 'JDLADI01_Pitch_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: 'JDLADI01_Pitch_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Roll resolver pair (piecewise_resolver, identity ±180°) ────────
    {
      id: 'JDLADI01_Roll_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: 'JDLADI01_Roll_COS_To_Instrument',
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

    // ── Command bars (piecewise; show/hide gating stays in C#) ─────────
    {
      id: 'JDLADI01_Horizontal_Command_Bar_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -100,    volts: -10.00 },
        { input:  -50,    volts: -10.00 },
        { input:   -4.44, volts: -10.00 },
        { input:    0,    volts:   0.00 },
        { input:    4.44, volts:  10.00 },
        { input:   50,    volts:  10.00 },
        { input:  100,    volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: 'JDLADI01_Vertical_Command_Bar_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -100,    volts: -10.00 },
        { input:  -50,    volts: -10.00 },
        { input:   -4.44, volts: -10.00 },
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
      id: 'JDLADI01_Inclinometer_To_Instrument',
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
      id: 'JDLADI01_Rate_Of_Turn_To_Instrument',
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
