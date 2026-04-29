// ── Malwin 246102 — F-16 Cabin Pressure Altimeter ───────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Malwin/
//         Malwin246102HardwareSupportModule.cs UpdateOutputValues().
//
// Resolver pair driving a cabin pressure altitude needle. The C# math:
//   degrees = (input / 50000) × 300
// So 50000 ft of cabin altitude maps to 300° of pointer rotation.
// Extrapolated to a full 360° revolution, that's 60000 ft per revolution.
// Outputs sin/cos × 10 V correctly (no missing-multiplier bug).
//
// We ship as `multi_resolver` (matching the C# linear pointer geometry)
// with unitsPerRevolution = 60000 ft. Inputs above 50000 ft get clamped
// to 300° in the C# fallback; the multi_resolver helper just keeps
// rotating, which is what real hardware does.

GAUGE_CALIBRATION_DEFAULTS['246102'] = Object.freeze({
  channels: [
    {
      id: '246102_Cabin_Pressure_Altitude_SIN_To_Instrument',
      kind: 'multi_resolver',
      role: 'sin',
      partnerChannel: '246102_Cabin_Pressure_Altitude_COS_To_Instrument',
      unitsPerRevolution: 60000,
      peakVolts: 10,
      inputMin: 0,
      inputMax: 50000,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '246102_Cabin_Pressure_Altitude_COS_To_Instrument',
      kind: 'multi_resolver',
      role: 'cos',
      partnerChannel: '246102_Cabin_Pressure_Altitude_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
