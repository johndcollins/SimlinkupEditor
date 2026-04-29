// ── Simtek 10-0285 — F-16 Altimeter ─────────────────────────────────────────
//
// Source: Simtek 10-0285 spec sheet (Dropbox/Viper Pit/Gauges/Simtek/),
// Calibration Data Table on sheet 3 of 3. Two sin/cos resolver pairs:
//   - Fine input  : 4,000 ft per resolver revolution
//   - Coarse input: 100,000 ft per resolver revolution
// Both are ±10 V peak, no power-off flag (pin K is "Spare").
//
// The four spec test points at 1000 / 4000 / 25000 / 100000 ft confirm the
// per-revolution constants:
//   1000 ft    → fine angle 90°  → sin +10, cos  0     (1000/4000 = 0.25 rev)
//   4000 ft    → fine angle 0°   → sin   0, cos +10    (4000/4000 = 1.00 rev)
//   25000 ft   → coarse angle 90° → sin +10, cos  0    (25000/100000 = 0.25 rev)
//   100000 ft  → coarse angle 0°  → sin   0, cos +10   (100000/100000 = 1 rev)
//
// Note: the existing on-disk Simtek100285HardwareSupportModule.config files
// in the wild carry four bare baro fields (MinBaroPressureInHg,
// MaxBaroPressureInHg, IndicatedAltitudeDifferenceInFeetFromMinBaroToMaxBaro,
// AltitudeZeroOffsetInFeet). Newer SimLinkup builds use BMS's already-baro-
// compensated altitude directly, so when this calibration file's <Channels>
// block is present the baro fields are bypassed by the HSM. They round-trip
// safely (preserved on save) so existing user installs keep working until
// the user explicitly removes them via the calibration card.

GAUGE_CALIBRATION_DEFAULTS['10-0285'] = Object.freeze({
  channels: [
    // ── Fine altitude (multi_resolver, 4000 ft/rev) ──────────────────────
    {
      id: '100285_Altitude_Fine_SIN_To_Instrument',
      kind: 'multi_resolver',
      role: 'sin',
      partnerChannel: '100285_Altitude_Fine_COS_To_Instrument',
      unitsPerRevolution: 4000,
      peakVolts: 10,
      inputMin: -1000,
      inputMax: 80000,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '100285_Altitude_Fine_COS_To_Instrument',
      kind: 'multi_resolver',
      role: 'cos',
      partnerChannel: '100285_Altitude_Fine_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Coarse altitude (multi_resolver, 100000 ft/rev) ──────────────────
    {
      id: '100285_Altitude_Coarse_SIN_To_Instrument',
      kind: 'multi_resolver',
      role: 'sin',
      partnerChannel: '100285_Altitude_Coarse_COS_To_Instrument',
      unitsPerRevolution: 100000,
      peakVolts: 10,
      inputMin: -1000,
      inputMax: 80000,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '100285_Altitude_Coarse_COS_To_Instrument',
      kind: 'multi_resolver',
      role: 'cos',
      partnerChannel: '100285_Altitude_Coarse_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
