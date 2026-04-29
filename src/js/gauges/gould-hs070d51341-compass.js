// ── Gould HS070D51341 — F-16 Standby Compass ────────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Gould/
//         GouldHS070D51341HardwareSupportModule.cs.
//
// Resolver pair, continuous 360° dial: input is magnetic heading in
// degrees (0..360), output is sin(heading) × 10 V and cos(heading) × 10 V.
// Identical math to Simtek 10-1079 — the gauge mechanism is the same
// resolver-driven standby compass, just from a different manufacturer.
//
// Channel IDs use the named prefix `HS070D51341_` (no digit prefix —
// the gauge HSM uses the part-number string directly in port IDs). This
// is the only Gould gauge in the catalog.

GAUGE_CALIBRATION_DEFAULTS['HS070D51341'] = Object.freeze({
  channels: [
    {
      id: 'HS070D51341_Compass__SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: 'HS070D51341_Compass__COS_To_Instrument',
      // Identity table — input degrees == reference angle degrees, every
      // 30°. The runtime applies % 360 before sin/cos so 360 wraps to 0
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
      id: 'HS070D51341_Compass__COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: 'HS070D51341_Compass__SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
