// ── Simtek 10-0582-01 — F-16 Angle of Attack Indicator ──────────────────────
//
// Source: Simtek 10-0582-01 spec sheet (Dropbox/Viper Pit/Gauges/Simtek/),
// Table 1 calibration data (sheet 4 of 4):
//
//   Dial test point  | Input voltage
//   -----------------|--------------
//   Below word "OFF" | -10.00 V       (power-off override; not a piecewise point)
//   +13°             |   0.00 V
//   +40°             | +10.00 V
//
// Single AoA channel — DC servo, linear-ish mapping with manufacturer-
// specified calibration test points at +13° (the on-speed AoA mark for
// landing) and +40° (upper mechanical stop). The lower mechanical stop
// (-5°, -6.37 V per the C# implementation) is encoded as a third
// breakpoint so users can see the full active range; below -5° clamps
// to -6.37 V automatically (piecewise clamps to first volts below first
// input).
//
// The "Below OFF" test point is the gauge's POWER-OFF flag behaviour,
// not a piecewise breakpoint. When the digital OFF flag input is true,
// SimLinkup overrides the analog output to -10 V regardless of the AoA
// value — that logic stays hardcoded in the C# HSM (it's not a user
// calibratable property; the gauge mechanism does it).

GAUGE_CALIBRATION_DEFAULTS['10-0582-01'] = Object.freeze({
  channels: [
    {
      id: '10058201_AOA_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:  -5, volts:  -6.37 },  // lower mechanical stop (C# clamp value)
        { input:  13, volts:   0.00 },  // spec test point: +13° on-speed
        { input:  40, volts:  10.00 },  // spec test point: +40° upper stop
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
