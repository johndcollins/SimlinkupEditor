// ── Simtek 10-0295 — F-16 Fuel Flow Indicator ────────────────────────────────
//
// Source: Simtek 10-0295 spec sheet (Dropbox/Viper Pit/Gauges/Simtek/), DC
// servo gauge with linear voltage→flow mapping:
//   −10 VDC = 0 PPH, +10 VDC = 9,900 PPH    (per spec note 7)
//
// 7 spec-sheet calibration test points from Table 1 on sheet 3 of the
// drawing. The mapping is approximately linear (slope ≈ 0.00202 V/PPH);
// the test points are checkpoints for hardware calibration and the
// editable values give users the right place to nudge if their gauge
// reads off at a specific PPH.
//
// NOTE: lightningstools' Simtek100295HardwareSupportModule.cs has extra
// "high-flow" branches above 10000 PPH that produce a discontinuity at
// 9900→10000. Those branches don't match the spec sheet (max range is
// 9900 PPH per note 7) and look like dead/buggy code — possibly leftover
// from a different gauge variant. We encode the spec, not the C#. Once
// the editor's piecewise table feeds SimLinkup, the buggy fallback
// branches no longer matter.

GAUGE_CALIBRATION_DEFAULTS['10-0295'] = Object.freeze({
  channels: [
    {
      id: '100295_Fuel_Flow_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:    0, volts: -10.00 },
        { input: 2000, volts:  -5.96 },
        { input: 4000, volts:  -1.92 },
        { input: 4950, volts:   0.00 },
        { input: 6000, volts:   2.12 },
        { input: 8000, volts:   6.16 },
        { input: 9900, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
