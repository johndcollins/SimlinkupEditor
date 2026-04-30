// ── Simtek 10-5866 — F-16 Fuel Quantity Indicator (multi-pointer) ────────────
//
// Source: PL20-5866 Tables 1 & 2.
// Companion HSM: Simtek105866HardwareSupportModule.cs
//
// Multi-pointer fuel quantity indicator with remote electronics box
// (50-4363-01). Three logical channels:
//
//  1. A/L pointer (piecewise) — Table 1, 0..4200 LBS → -10..+10 V linear.
//  2. F/R pointer (piecewise) — Table 1 again (same calibration as A/L;
//     cockpit selector switch routes whichever signal drives SEL pointer).
//  3. TOTAL counter (piecewise) — Table 2, 0..20000 LBS → -10..+10 V linear.
//
// All three are exactly linear in the spec; we ship them as piecewise
// tables so users can correct local servo drift on individual ranges.
// Drive type: multiple DC servo. Modeled on 10-1089-02.

GAUGE_CALIBRATION_DEFAULTS['10-5866'] = Object.freeze({
  channels: [
    {
      id: '105866_AL_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:    0, volts: -10.00 },
        { input:  500, volts:  -7.62 },
        { input: 1000, volts:  -5.24 },
        { input: 1500, volts:  -2.86 },
        { input: 2000, volts:  -0.48 },
        { input: 2100, volts:   0.00 },
        { input: 2500, volts:   1.90 },
        { input: 3000, volts:   4.29 },
        { input: 3500, volts:   6.67 },
        { input: 4000, volts:   9.05 },
        { input: 4200, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '105866_FR_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:    0, volts: -10.00 },
        { input:  500, volts:  -7.62 },
        { input: 1000, volts:  -5.24 },
        { input: 1500, volts:  -2.86 },
        { input: 2000, volts:  -0.48 },
        { input: 2100, volts:   0.00 },
        { input: 2500, volts:   1.90 },
        { input: 3000, volts:   4.29 },
        { input: 3500, volts:   6.67 },
        { input: 4000, volts:   9.05 },
        { input: 4200, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '105866_Counter_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:     0, volts: -10.00 },
        { input:  2000, volts:  -8.00 },
        { input:  4000, volts:  -6.00 },
        { input:  6000, volts:  -4.00 },
        { input:  8000, volts:  -2.00 },
        { input: 10000, volts:   0.00 },
        { input: 12000, volts:   2.00 },
        { input: 14000, volts:   4.00 },
        { input: 16000, volts:   6.00 },
        { input: 18000, volts:   8.00 },
        { input: 20000, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
