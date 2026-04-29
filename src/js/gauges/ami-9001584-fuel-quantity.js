// ── AMI 9001584 — F-16 Fuel Quantity Indicator ──────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/AMI/
//         AMI9001584HardwareSupportModule.cs UpdateOutputValues().
//
// Same shape as Simtek 10-0294 / 10-1089-02 — three independent channels
// driving counter wheels + AL/FR pointers. Two notable differences from
// the Simtek family:
//
//   1. Counter denominator is 18000 lbs (not 9900 or 20100) — different
//      aircraft tank capacity for this AMI variant.
//
//   2. AL/FR pointers use ±7 V (not ±10 V) because Nigel's hardware
//      modification replaced the gauge's 1-turn pot with a 3-turn pot,
//      which widens the indicated range. Per the C# inline comment.
//      With our editor's per-channel `peakVolts` field… well, we use
//      piecewise here so the user just sets the breakpoint voltages
//      directly. Defaults reflect the Nigel-modded gauge geometry.
//
// No legacy bare-property fields on this gauge.

GAUGE_CALIBRATION_DEFAULTS['9001584'] = Object.freeze({
  channels: [
    // ── Counter (totalizer wheels), 0..18000 lbs ────────────────────────
    {
      id: '9001584_Counter_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:     0, volts: -10.00 },
        { input:  1800, volts:  -8.00 },
        { input:  3600, volts:  -6.00 },
        { input:  5400, volts:  -4.00 },
        { input:  7200, volts:  -2.00 },
        { input:  9000, volts:   0.00 },  // electrical zero (midpoint)
        { input: 10800, volts:   2.00 },
        { input: 12600, volts:   4.00 },
        { input: 14400, volts:   6.00 },
        { input: 16200, volts:   8.00 },
        { input: 18000, volts:  10.00 },  // full scale
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Aft/Left pointer (3-turn pot mod, ±7 V swing) ──────────────────
    // Range 0..4200 lbs; -7 V at zero, +7 V at full scale.
    {
      id: '9001584_AL_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:    0, volts: -7.00 },
        { input:  500, volts: -5.33 },
        { input: 1000, volts: -3.67 },
        { input: 1500, volts: -2.00 },
        { input: 2100, volts:  0.00 },   // electrical zero
        { input: 2500, volts:  1.33 },
        { input: 3000, volts:  3.00 },
        { input: 3500, volts:  4.67 },
        { input: 4200, volts:  7.00 },   // full scale
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Fore/Right pointer (independent of AL) ─────────────────────────
    {
      id: '9001584_FR_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:    0, volts: -7.00 },
        { input:  500, volts: -5.33 },
        { input: 1000, volts: -3.67 },
        { input: 1500, volts: -2.00 },
        { input: 2100, volts:  0.00 },
        { input: 2500, volts:  1.33 },
        { input: 3000, volts:  3.00 },
        { input: 3500, volts:  4.67 },
        { input: 4200, volts:  7.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
