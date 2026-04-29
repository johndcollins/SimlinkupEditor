// ── Simtek 10-0216 — F-16 FTIT Indicator ─────────────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//         Simtek100216HardwareSupportModule.cs UpdateOutputValues()
//         (lines 168–209).
//
// Single channel: Fan Turbine Inlet Temperature in °C → ±10 V output.
// Piecewise-linear with 4 segments. Below 200°C clamps to −10 V; above
// 1200°C clamps to +10 V. The middle segment (700→1000°C) has a much
// steeper slope than the others — that's the "operating" range where
// the needle moves fastest in response to temperature changes.
//
// Self-registers into GAUGE_CALIBRATION_DEFAULTS at script-load time.

GAUGE_CALIBRATION_DEFAULTS['10-0216'] = Object.freeze({
  channels: [
    {
      id: '100216_FTIT_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:  200, volts: -10.00 },
        { input:  700, volts:  -3.75 },
        { input: 1000, volts:   7.50 },
        { input: 1200, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
