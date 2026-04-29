// ── Simtek 10-0207 — F-16 RPM Tachometer ─────────────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//         Simtek100207HardwareSupportModule.cs UpdateOutputValues()
//         (lines 167–247).
//
// Single channel: RPM% input (0..110) → ±10 V output. Piecewise-linear from a
// 16-knot table; the C# clamps the output to ±10 V. The last segment uses
// Math.Min(1, …) so anything above 100% RPM clamps to +10 V — we encode the
// breakpoint at exactly 100 → +10.000.
//
// Self-registers into GAUGE_CALIBRATION_DEFAULTS at script-load time. See
// calibration-defaults.js for the index-and-helpers contract.

GAUGE_CALIBRATION_DEFAULTS['10-0207'] = Object.freeze({
  channels: [
    {
      id: '100207_RPM_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:   0, volts: -10.000 },
        { input:  10, volts:  -8.750 },
        { input:  20, volts:  -7.500 },
        { input:  30, volts:  -6.250 },
        { input:  40, volts:  -5.000 },
        { input:  50, volts:  -3.750 },
        { input:  60, volts:  -2.500 },
        { input:  65, volts:  -0.938 },
        { input:  68, volts:   0.000 },
        { input:  70, volts:   0.625 },
        { input:  75, volts:   2.188 },
        { input:  80, volts:   3.750 },
        { input:  85, volts:   5.313 },
        { input:  90, volts:   6.875 },
        { input:  95, volts:   8.438 },
        { input: 100, volts:  10.000 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
