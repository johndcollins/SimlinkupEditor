// ── Simtek 10-5860 — F-16 Fuel Flow Indicator ────────────────────────────────
//
// Source: PL20-5860 Table 1.
// Companion HSM: Simtek105860HardwareSupportModule.cs
//
// Single-channel piecewise fuel flow gauge. PPH 0..80,000 maps linearly
// to -10..+10 V. The dial is a 5-digit counter showing 0..80000 with the
// two least-significant digits fixed at "00". Drive type: single DC servo.
//
// 9 spec-sheet test points let users tune local servo drift; defaults
// match a perfectly linear gauge.

GAUGE_CALIBRATION_DEFAULTS['10-5860'] = Object.freeze({
  channels: [
    {
      id: '105860_Fuel_Flow_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:     0, volts: -10.00 },
        { input: 10000, volts:  -7.50 },
        { input: 20000, volts:  -5.00 },
        { input: 30000, volts:  -2.50 },
        { input: 40000, volts:   0.00 },
        { input: 50000, volts:   2.50 },
        { input: 60000, volts:   5.00 },
        { input: 70000, volts:   7.50 },
        { input: 80000, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
