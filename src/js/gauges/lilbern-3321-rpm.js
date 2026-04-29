// ── Lilbern 3321 — F-16 Tachometer (RPM) ────────────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Lilbern/
//         Lilbern3321HardwareSupportModule.cs UpdateOutputValues().
//
// Resolver pair driving the RPM needle. The C# computes the dial pointer
// angle from input RPM% via two linear segments:
//
//   0..60 % RPM   → 0..90°    (90° span over the lower 60% of dial)
//   60..110% RPM  → 90..330°  (240° span over the upper 50% of dial)
//
// The break at 60% reflects the dial's asymmetric scaling — the lower
// half of the gauge face has fewer divisions because engines operate
// near 100%. We ship 11 spec-style breakpoints matching the C# math
// exactly, with extras at 60 and 110 to anchor the slope change.

GAUGE_CALIBRATION_DEFAULTS['3321'] = Object.freeze({
  channels: [
    {
      id: '3321_RPM_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '3321_RPM_COS_To_Instrument',
      inputMin: 0,
      inputMax: 110,
      breakpoints: [
        { input:   0, angle:   0   },
        { input:  20, angle:  30   },   // 20/60 × 90
        { input:  40, angle:  60   },   // 40/60 × 90
        { input:  60, angle:  90   },   // slope-change anchor
        { input:  70, angle: 138   },   // 90 + (10/50)×240
        { input:  80, angle: 186   },   // 90 + (20/50)×240
        { input:  90, angle: 234   },   // 90 + (30/50)×240
        { input: 100, angle: 282   },   // 90 + (40/50)×240
        { input: 110, angle: 330   },   // full scale
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '3321_RPM_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '3321_RPM_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
