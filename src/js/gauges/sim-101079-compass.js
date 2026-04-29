// ── Simtek 10-1079 — F-16 Standby Compass ────────────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//         Simtek101079HardwareSupportModule.cs UpdateOutputValues()
//         (lines 192–225).
//
// Resolver pair, continuous 360° dial: input is magnetic heading in
// degrees (0..360), output is sin(heading) × 10 V and cos(heading) × 10 V.
// The C# applies `Math.Abs(input % 360)` so any input wraps cleanly.
//
// We ship it as 'piecewise_resolver' (not the simpler 'resolver' kind)
// with cardinal-direction breakpoints every 30°. The defaults are a
// straight 1:1 line matching the C# behaviour exactly, but a user with
// a worn synchro that develops dead spots at certain headings can
// correct each direction independently. A plain 'resolver' encoding
// would only have allowed scaling/shifting the whole compass uniformly
// — the wrong knob when north reads correctly but east is off by 5°.
//
// Self-registers into GAUGE_CALIBRATION_DEFAULTS at script-load time.

GAUGE_CALIBRATION_DEFAULTS['10-1079'] = Object.freeze({
  channels: [
    {
      id: '101079_Compass__SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '101079_Compass__COS_To_Instrument',
      // Identity table — input degrees == reference angle degrees, every
      // 30°. The runtime applies `% 360` before sin/cos so 360 wraps to 0
      // cleanly. inputMin/inputMax bound the editor's scrub slider only.
      inputMin: 0,
      inputMax: 360,
      breakpoints: [
        { input:   0, angle:   0 },
        { input:  30, angle:  30 },
        { input:  60, angle:  60 },
        { input:  90, angle:  90 },
        { input: 120, angle: 120 },
        { input: 150, angle: 150 },
        { input: 180, angle: 180 },
        { input: 210, angle: 210 },
        { input: 240, angle: 240 },
        { input: 270, angle: 270 },
        { input: 300, angle: 300 },
        { input: 330, angle: 330 },
        { input: 360, angle: 360 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '101079_Compass__COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '101079_Compass__SIN_To_Instrument',
      // No transform body on COS — SIN partner carries it.
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
