// ── Lilbern 3239 — F-16A Fuel Flow Indicator ────────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Lilbern/
//         Lilbern3239HardwareSupportModule.cs UpdateFuelFlowOutputValues().
//
// Single-channel linear: 0 lbs/hr → -10 V, 80000 lbs/hr → +10 V.
// The C# clamps inputs ≤ 0 to -10 V and ≥ 80000 to +10 V.
//
// 80000 lbs/hr is unusually high (Simtek 10-0295 caps at 9900 lbs/hr).
// The wide range probably reflects an early F-16A engine variant where
// the gauge full-scale was set to a generous value to avoid pegging. The
// editor breakpoints sample every 8000 lbs/hr so users can see the
// curve and correct individual bands.

GAUGE_CALIBRATION_DEFAULTS['3239'] = Object.freeze({
  channels: [
    {
      id: '3239_Fuel_Flow_Pounds_Per_Hour_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:     0, volts: -10.00 },
        { input:  8000, volts:  -8.00 },
        { input: 16000, volts:  -6.00 },
        { input: 24000, volts:  -4.00 },
        { input: 32000, volts:  -2.00 },
        { input: 40000, volts:   0.00 },  // electrical zero
        { input: 48000, volts:   2.00 },
        { input: 56000, volts:   4.00 },
        { input: 64000, volts:   6.00 },
        { input: 72000, volts:   8.00 },
        { input: 80000, volts:  10.00 },  // full scale
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
