// ── Malwin 1956-3 — F-16 Liquid Oxygen Quantity Indicator ───────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Malwin/
//         Malwin19563HardwareSupportModule.cs UpdateOutputValues().
//
// Resolver pair driving the LOX quantity needle. The C# math is
// `degrees = (input / 5) × 180`, so:
//   0 liters   →   0°
//   5 liters   → 180°  (= ½ revolution)
//   10 liters  → 360°  (= full revolution)
//
// That's a multi-turn resolver with `unitsPerRevolution = 10` liters.
// The dial face only displays 0..5 liters (per the F-16 LOX system's
// operating range), but the underlying resolver has the full 360°
// span available — the second half is for hardware test/cal use.
//
// Same C# bug as Malwin 1956-2: the sin/cos output is missing the × 10
// multiplier so legacy installs get ±1 V. The override path here uses
// peakVolts = 10 consistently. The matching HSM rewrite fixes the
// fallback path.

GAUGE_CALIBRATION_DEFAULTS['1956-3'] = Object.freeze({
  channels: [
    {
      id: '19563_LOX_SIN_To_Instrument',
      kind: 'multi_resolver',
      role: 'sin',
      partnerChannel: '19563_LOX_COS_To_Instrument',
      unitsPerRevolution: 10,
      peakVolts: 10,
      // Editor scrub slider bounds — match the C# input signal range.
      inputMin: 0,
      inputMax: 5,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '19563_LOX_COS_To_Instrument',
      kind: 'multi_resolver',
      role: 'cos',
      partnerChannel: '19563_LOX_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
