// ── Simtek 10-0581-02 — F-16 Vertical Velocity Indicator ────────────────────
//
// Source: Simtek 10-0581-02 spec sheet (Dropbox/Viper Pit/Gauges/Simtek/),
// Calibration Data Table on sheet 4 of 4. DC servo gauge with 9 spec
// test points covering -6000..+6000 FPM. Tolerance ±0.1 V.
//
// Notes from the spec:
//   - 0 FPM is at +1.83 V, NOT 0 V. The dial's "zero volts" reference
//     is at -400 FPM (likely the gauge's at-rest or natural-trim point).
//   - The dial is asymmetric — the upper half covers 0..6000 FPM (one
//     full range) while the lower half covers 0..-6000 FPM with finer
//     subdivisions visible on the front face. The spec table's voltage
//     points reflect that.
//
// The gauge also has a digital POWER-OFF input (VVI_Power_Off_Flag) that
// overrides the analog output to -10 V when true. That override stays
// hardcoded in the HSM (not user-calibratable; it's gauge mechanism).
// Same pattern as 10-0582-01 AoA.

GAUGE_CALIBRATION_DEFAULTS['10-0581-02'] = Object.freeze({
  channels: [
    {
      id: '10058102_Vertical_Velocity_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -6000, volts: -6.37 },  // lower mechanical stop
        { input: -3000, volts: -4.71 },
        { input: -1000, volts: -1.81 },
        { input:  -400, volts:  0.00 },  // electrical zero (not 0 FPM!)
        { input:     0, volts:  1.83 },  // dial's "0 FPM" mark
        { input:  1000, volts:  5.48 },
        { input:  3000, volts:  8.38 },
        { input:  6000, volts: 10.00 },  // upper mechanical stop
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
