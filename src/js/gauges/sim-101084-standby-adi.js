// ── Simtek 10-1084 — F-16 Standby ADI ────────────────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//         Simtek101084HardwareSupportModule.cs.
//
// Three logical channels:
//
//  1. Pitch (piecewise_resolver) — UpdatePitchOutputValues at lines 356–432.
//     Input -90..90° pitch maps non-linearly to a reference angle (0..360°)
//     via a 11-knot piecewise table, then sin/cos × 10 V drive the synchro
//     pair. The non-linearity gives the ADI ball more visual resolution
//     near level flight than at extreme pitch. The angles in the table
//     below are encoded MONOTONICALLY (values exceed 360° to keep linear
//     interpolation working across the 360°→0° wrap at input=0); the C#
//     evaluator applies % 360 before sin/cos so the wrap is invisible to
//     the synchro hardware.
//
//  2. Roll (piecewise_resolver) — UpdateRollOutputValues at lines 434–468.
//     Input -180..180° roll maps directly (1:1) to the reference angle,
//     then sin/cos × 10 V. Defaults are a straight identity line, but a
//     worn ADI roll synchro can develop dead spots — the editable
//     breakpoint table (every 30°) lets users correct each segment.
//
//  3. OFF flag (digital_invert) — UpdateOFFFlagOutputValue at lines 351–354.
//     Single line of C#: `_offFlagOutputSignal.State = !_offFlagInputSignal.State`.
//     Input is "OFF Flag Visible (1=visible)" and output is "OFF Flag
//     Hidden (1=hidden)" — the friendly names confirm the inversion is
//     intentional (the synchro driver expects active-low logic).
//
// Self-registers into GAUGE_CALIBRATION_DEFAULTS at script-load time.

GAUGE_CALIBRATION_DEFAULTS['10-1084'] = Object.freeze({
  channels: [
    // ── Pitch resolver pair (piecewise_resolver) ────────────────────────
    {
      id: '101084_Pitch_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '101084_Pitch_COS_To_Instrument',
      // Monotonic angles — see file header. Reference values (raw) at
      // input 10..90 wrap past 360°; we add 360 to keep linear interp
      // working. Runtime applies % 360 before sin/cos.
      breakpoints: [
        { input: -90, angle: 194.819 },
        { input: -60, angle: 232.941 },
        { input: -30, angle: 296.471 },
        { input: -20, angle: 317.647 },
        { input: -10, angle: 338.824 },
        { input:   0, angle: 360.000 },
        { input:  10, angle: 381.176 },  // raw 21.176 + 360
        { input:  20, angle: 402.353 },  // raw 42.353 + 360
        { input:  30, angle: 423.526 },  // raw 63.526 + 360
        { input:  60, angle: 487.059 },  // raw 127.059 + 360
        { input:  90, angle: 554.819 },  // raw 194.819 + 360
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
      id: '101084_Pitch_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '101084_Pitch_SIN_To_Instrument',
      // No transform body on COS — SIN partner carries it.
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Roll resolver pair (piecewise_resolver) ─────────────────────────
    {
      id: '101084_Roll_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '101084_Roll_COS_To_Instrument',
      // 13 breakpoints, one every 30° from -180 to +180. Defaults are
      // identity (input degrees == reference angle degrees). Edit
      // individual rows to correct local synchro drift.
      // inputMin/inputMax bound the editor's scrub slider only.
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
      // Caged-rest: ±40° roll. Opt-in.
      cagedRestEnabled: false,
      cagedRestRangeMinDegrees: -40,
      cagedRestRangeMaxDegrees:  40,
    },
    {
      id: '101084_Roll_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '101084_Roll_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── OFF flag (digital_invert) ───────────────────────────────────────
    {
      id: '101084_OFF_Flag_To_Instrument',
      kind: 'digital_invert',
      // Default true — input "visible" should yield output "hidden=false"
      // (i.e. the synchro driver shows the flag), and vice versa. Match
      // the C# default behaviour.
      invert: true,
    },
  ],
});
