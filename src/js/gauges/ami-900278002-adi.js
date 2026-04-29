// ── AMI 9002780-02 — F-16 Standby ADI (linear pitch variant) ────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/AMI/
//         AMI9002780-02HardwareSupportModule.cs.
//
// Smaller ADI variant with a SINGLE-channel linear pitch output (vs the
// sin/cos pair in Astronautics 12871). Channels:
//
//   1. Pitch                  (piecewise — single channel, linear ±90° → ±10 V)
//   2. Roll SIN/COS pair      (piecewise_resolver, ±180°)
//   3. OFF / GS / LOC / AUX flags  (digital_invert × 4)
//   4. Horizontal command bar (piecewise, gated by show_command_bars)
//   5. Vertical command bar   (piecewise, gated by show_command_bars)
//   6. Rate of turn           (piecewise, ±100% × 10 V)
//
// Notable: the C# UpdateRollOutputValues subtracts a hardcoded `-15°`
// offset before computing sin/cos:
//   `var rollInputDegrees = _rollInputSignal.State - 15;`
// with the inline comment "HACK: compensating for lack of ability to
// calibrate devices in software right now, so hard-coding this offset
// for Dave R. instrument."
//
// With the editor's per-channel ZeroTrim, users can finally calibrate
// their own gauge's offset. The default roll table here is identity (no
// hardcoded offset), so out-of-the-box behavior matches a freshly-zeroed
// gauge. Dave R.'s install (or any with a similar drift) tunes via the
// per-channel ZeroTrim slider, NOT a hardcoded -15°. The C# fallback
// keeps the -15 to preserve legacy behavior for installs running older
// SimLinkup builds.
//
// Same C# bug as Astronautics 12871: rate-of-turn clamp returns 0 instead
// of 10 when the input pegs full-scale. Override path uses ApplyTrim
// which clamps correctly.

GAUGE_CALIBRATION_DEFAULTS['9002780-02'] = Object.freeze({
  channels: [
    // ── Pitch (single-channel piecewise, linear ±90° → ±10 V) ──────────
    {
      id: '900278002_Pitch_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -90, volts: -10.00 },
        { input: -60, volts:  -6.67 },
        { input: -30, volts:  -3.33 },
        { input: -10, volts:  -1.11 },
        { input:   0, volts:   0.00 },
        { input:  10, volts:   1.11 },
        { input:  30, volts:   3.33 },
        { input:  60, volts:   6.67 },
        { input:  90, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Roll resolver pair (piecewise_resolver, identity ±180°) ────────
    // Defaults are identity. Users compensating for the gauge's natural
    // zero offset (e.g. the Dave R. "-15°" instrument) tune via the
    // per-channel ZeroTrim slider rather than a hardcoded offset in
    // the breakpoint table.
    {
      id: '900278002_Roll_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '900278002_Roll_COS_To_Instrument',
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
      id: '900278002_Roll_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '900278002_Roll_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── 4 digital flags ─────────────────────────────────────────────────
    { id: '900278002_OFF_Flag_To_Instrument', kind: 'digital_invert', invert: true },
    { id: '900278002_GS_Flag_To_Instrument',  kind: 'digital_invert', invert: true },
    { id: '900278002_LOC_Flag_To_Instrument', kind: 'digital_invert', invert: true },
    { id: '900278002_AUX_Flag_To_Instrument', kind: 'digital_invert', invert: true },

    // ── Command bars (gated; same shape as Astronautics 12871) ─────────
    {
      id: '900278002_Horizontal_Command_Bar_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -100, volts: -10.00 },
        { input:   -4.44, volts: -10.00 },
        { input:    0,    volts:   0.00 },
        { input:    4.44, volts:  10.00 },
        { input:  100, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '900278002_Vertical_Command_Bar_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -100, volts: -10.00 },
        { input:   -4.44, volts: -10.00 },
        { input:    0,    volts:   0.00 },
        { input:    4.44, volts:  10.00 },
        { input:  100, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Rate of turn (piecewise, ±100% × 10 V) ─────────────────────────
    {
      id: '900278002_Rate_Of_Turn_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -1.00, volts: -10.00 },
        { input: -0.50, volts:  -5.00 },
        { input:  0.00, volts:   0.00 },
        { input:  0.50, volts:   5.00 },
        { input:  1.00, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
