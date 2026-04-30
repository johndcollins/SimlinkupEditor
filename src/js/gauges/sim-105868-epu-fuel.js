// ── Simtek 10-5868 — F-16 EPU Fuel Quantity Indicator ────────────────────────
//
// Source: PL20-5868 Table 1.
// Companion HSM: Simtek105868HardwareSupportModule.cs
//
// Single-channel piecewise EPU fuel gauge. Input remain % 0..100 maps
// linearly to -10..+10 V (2 V per 10% step). Drive type: single meter.
// 11 spec-sheet test points let users tune local meter drift.

GAUGE_CALIBRATION_DEFAULTS['10-5868'] = Object.freeze({
  channels: [
    {
      id: '105868_EPU_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:   0, volts: -10 },
        { input:  10, volts:  -8 },
        { input:  20, volts:  -6 },
        { input:  30, volts:  -4 },
        { input:  40, volts:  -2 },
        { input:  50, volts:   0 },
        { input:  60, volts:   2 },
        { input:  70, volts:   4 },
        { input:  80, volts:   6 },
        { input:  90, volts:   8 },
        { input: 100, volts:  10 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
