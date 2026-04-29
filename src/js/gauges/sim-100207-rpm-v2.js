// ── Simtek 10-0207_110 — F-16 RPM Tachometer v2 ──────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//         Simtek100207_110HardwareSupportModule.cs UpdateOutputValues()
//         (lines 167–223).
//
// Same gauge family as 10-0207 but with a different transform table — looser
// breakpoint spacing and a wider input range (clamps at 110% RPM, not 100%).
// Single channel: RPM% input → ±10 V output, piecewise-linear from a 10-knot
// table; the C# clamps the output to ±10 V.
//
// Digit-prefix collision note: this gauge AND 10-0207 both emit port IDs
// prefixed "100207_". They have separate .config files (each is keyed by the
// gauge's class short name), so SimLinkup loads each independently. The
// chain-model parser disambiguates incoming mappings by registry context.
//
// Self-registers into GAUGE_CALIBRATION_DEFAULTS at script-load time.

GAUGE_CALIBRATION_DEFAULTS['10-0207_110'] = Object.freeze({
  channels: [
    {
      id: '100207_RPM_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:   0, volts: -10.00 },
        { input:  20, volts:  -8.11 },
        { input:  40, volts:  -6.23 },
        { input:  60, volts:  -4.35 },
        { input:  70, volts:  -1.48 },
        { input:  76, volts:   0.00 },
        { input:  80, volts:   1.39 },
        { input:  90, volts:   4.26 },
        { input: 100, volts:   7.13 },
        { input: 110, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
