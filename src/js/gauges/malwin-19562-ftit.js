// ── Malwin 1956-2 — F-16 FTIT Indicator ─────────────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Malwin/
//         Malwin19562HardwareSupportModule.cs UpdateOutputValues().
//
// Resolver pair driving the FTIT (Forward Turbine Inlet Temperature)
// needle. The C# computes the dial pointer angle from input °C via three
// linear segments:
//
//     0..200 °C  → 0°        (dead-band — needle parked at minimum)
//   200..700 °C  → 0..100°
//   700..1000°C  → 100..280° (steep slope; this is the operating band)
//  1000..1200°C  → 280..320°
//
// The dead-band below 200°C reflects that the gauge mechanism doesn't
// move until the engine has spooled up enough to register meaningful
// turbine temperature. We ship breakpoints at every spec-equivalent
// inflection so users can edit each segment independently.
//
// Note: the C# source has a bug — the sin/cos output values are computed
// as `Math.Sin(degrees * RADIANS_PER_DEGREE)` WITHOUT the `× 10`
// multiplier the matching Malwin gauges use, so on legacy installs the
// output ranges ±1 V instead of the intended ±10 V. The override path
// here always uses peakVolts = 10, so editor-authored configs produce
// correct ±10 V output. Existing user installs running the old C# get
// ±1 V; rebuilding lightningstools with this gauge's HSM rewrite (see
// the matching Malwin19562HardwareSupportModule.cs patch) fixes the
// fallback path too.

GAUGE_CALIBRATION_DEFAULTS['1956-2'] = Object.freeze({
  channels: [
    {
      id: '19562_FTIT_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '19562_FTIT_COS_To_Instrument',
      inputMin: 0,
      inputMax: 1200,
      breakpoints: [
        { input:    0, angle:   0 },
        { input:  200, angle:   0 },   // dead-band end / first live point
        { input:  300, angle:  20 },   // (300-200)/100 × 20
        { input:  400, angle:  40 },
        { input:  500, angle:  60 },
        { input:  600, angle:  80 },
        { input:  700, angle: 100 },
        { input:  800, angle: 160 },   // 100 + (100/300)×180? No — C# is 60°/100°C from 700
        { input:  900, angle: 220 },
        { input: 1000, angle: 280 },
        { input: 1100, angle: 300 },
        { input: 1200, angle: 320 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '19562_FTIT_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '19562_FTIT_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
