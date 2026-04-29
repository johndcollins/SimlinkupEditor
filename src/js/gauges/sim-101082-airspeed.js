// ── Simtek 10-1082 — F-16 Airspeed/Mach Indicator (v2) ──────────────────────
//
// Source: Simtek 10-1082 spec sheet (Dropbox/Viper Pit/Gauges/Simtek/),
// Calibration Data Table 1 on sheet 4. Same family as 10-0194 (same dial
// geometry, same airspeed curve, same Mach cross-coupling math); the C#
// encoding of Mach is just coarser — 6 spec points vs 10-0194's 36-point
// reference table.
//
// Two output channels:
//
//  1. Airspeed (piecewise) — pin J in, pin T out (signal output to A/S
//     index). 43 spec breakpoints from 0 kts (−10 V) to 850 kts (+10 V).
//     The dial pointer angle is non-linear vs airspeed (denser tick
//     spacing at low end), reflected in the curve's varying slope.
//     Below 0 clamps to −10 V; above 850 clamps to +10 V.
//
//  2. Mach (piecewise + cross-coupled) — pin K (Mach input). The Mach
//     pointer is a sub-dial that rotates relative to the airspeed needle
//     so that "Mach 1" aligns with the current airspeed at the current
//     altitude/temperature. The piecewise table here produces a REFERENCE
//     VOLTAGE; the C# HSM combines that with the current airspeed output
//     voltage and the gauge's geometry (Mach 1 reference angle = 131°,
//     262° angular range) to compute the final DAC voltage. coupledTo
//     points the C# loader at the airspeed channel that drives the
//     coupling math.

GAUGE_CALIBRATION_DEFAULTS['10-1082'] = Object.freeze({
  channels: [
    // ── Airspeed (piecewise) ────────────────────────────────────────────
    {
      id: '101082_Airspeed_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:   0, volts: -10.00 },
        { input:  80, volts:  -8.82 },
        { input:  90, volts:  -8.24 },
        { input: 100, volts:  -7.65 },
        { input: 110, volts:  -7.06 },
        { input: 120, volts:  -6.47 },
        { input: 130, volts:  -5.88 },
        { input: 140, volts:  -5.29 },
        { input: 150, volts:  -4.71 },
        { input: 160, volts:  -4.12 },
        { input: 170, volts:  -3.53 },
        { input: 180, volts:  -2.94 },
        { input: 190, volts:  -2.35 },
        { input: 200, volts:  -1.77 },
        { input: 210, volts:  -1.47 },
        { input: 220, volts:  -1.18 },
        { input: 230, volts:  -0.88 },
        { input: 240, volts:  -0.59 },
        { input: 250, volts:  -0.29 },
        { input: 260, volts:   0.00 },  // electrical zero (REF angle 150°)
        { input: 270, volts:   0.29 },
        { input: 280, volts:   0.59 },
        { input: 290, volts:   0.88 },
        { input: 300, volts:   1.18 },
        { input: 310, volts:   1.41 },
        { input: 320, volts:   1.65 },
        { input: 330, volts:   1.88 },
        { input: 340, volts:   2.12 },
        { input: 350, volts:   2.35 },
        { input: 360, volts:   2.58 },
        { input: 370, volts:   2.82 },
        { input: 380, volts:   3.06 },
        { input: 390, volts:   3.29 },
        { input: 400, volts:   3.53 },
        { input: 450, volts:   4.41 },
        { input: 500, volts:   5.29 },
        { input: 550, volts:   6.06 },
        { input: 600, volts:   6.82 },
        { input: 650, volts:   7.53 },
        { input: 700, volts:   8.24 },
        { input: 750, volts:   8.82 },
        { input: 800, volts:   9.53 },
        { input: 850, volts:  10.00 },  // full scale (REF angle 340°)
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Mach (piecewise reference voltage + cross-coupled) ─────────────
    // The 6-point Mach reference voltage table from
    // Simtek101082HardwareSupportModule.cs:UpdateMachOutputValues() lines
    // 439-466. Below Mach 0.5 the C# does NOT produce a hard discontinuity
    // (unlike 10-0194); the 0.0 → -10.0 V endpoint anchors the curve.
    // The cross-coupling math (gauge geometry: Mach 1 ref angle = 131°,
    // angular range = 262°) stays hardcoded in the C# HSM.
    {
      id: '101082_Mach_To_Instrument',
      kind: 'piecewise',
      coupledTo: '101082_Airspeed_To_Instrument',
      breakpoints: [
        { input: 0.00, volts: -10.00 },
        { input: 0.50, volts:  -6.56 },
        { input: 1.00, volts:   0.00 },
        { input: 1.50, volts:   4.69 },
        { input: 2.00, volts:   8.05 },
        { input: 2.50, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
