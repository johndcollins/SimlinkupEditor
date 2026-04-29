// ── Simtek 10-1090 — F-16 EPU Fuel Quantity Indicator ────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//         Simtek101090HardwareSupportModule.cs UpdateOutputValues()
//         (line 175).
//
// Single channel: EPU fuel % input (0..100) → ±10 V output. The C#
// computes `epuInput / 100 * 20 - 10` with hard clamps outside the
// range — mathematically a single straight line.
//
// We ship it as 'piecewise' (not 'linear') with intermediate breakpoints
// every 25%. The straight-line defaults match the C# behaviour exactly,
// but a user with a worn or non-linear hardware gauge can edit the
// intermediate points to correct local drift. A 'linear' encoding would
// have only allowed scaling the whole curve uniformly via inputMin/Max
// — the wrong knob when only one segment of the gauge is misreading.
//
// Self-registers into GAUGE_CALIBRATION_DEFAULTS at script-load time.

GAUGE_CALIBRATION_DEFAULTS['10-1090'] = Object.freeze({
  channels: [
    {
      id: '101090_EPU_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:   0, volts: -10 },
        { input:  25, volts:  -5 },
        { input:  50, volts:   0 },
        { input:  75, volts:   5 },
        { input: 100, volts:  10 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
