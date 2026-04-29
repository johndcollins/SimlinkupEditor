// ── Simtek 10-1078 — F-16 Cabin Pressure Altimeter ───────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//         Simtek101078HardwareSupportModule.cs UpdateOutputValues()
//         (lines 169–229).
//
// Single channel: cabin pressure altitude (feet) → ±10 V output. The C#
// is written as 10 piecewise segments every 5000 ft from 0 to 50000 ft;
// every segment has the SAME slope (2 V per 5000 ft = 0.0004 V/ft),
// so the spec-sheet behaviour is mathematically linear.
//
// We ship it as 'piecewise' (not 'linear'), encoding the 11 endpoints
// from the C# table verbatim. This lets a user with a worn or
// non-linear gauge edit individual breakpoints to correct local drift
// — a 'linear' encoding would have only allowed scaling the whole
// curve uniformly, which is the wrong knob for a gauge that reads
// correctly in the middle but drifts at the high end. The default
// values produce identical voltages to the C# until the user
// intervenes.
//
// Self-registers into GAUGE_CALIBRATION_DEFAULTS at script-load time.

GAUGE_CALIBRATION_DEFAULTS['10-1078'] = Object.freeze({
  channels: [
    {
      id: '101078_CabinAlt_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:     0, volts: -10 },
        { input:  5000, volts:  -8 },
        { input: 10000, volts:  -6 },
        { input: 15000, volts:  -4 },
        { input: 20000, volts:  -2 },
        { input: 25000, volts:   0 },
        { input: 30000, volts:   2 },
        { input: 35000, volts:   4 },
        { input: 40000, volts:   6 },
        { input: 45000, volts:   8 },
        { input: 50000, volts:  10 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
