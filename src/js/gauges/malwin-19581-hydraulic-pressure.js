// ── Malwin 19581 — F-16 Hydraulic Pressure Indicator ────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Malwin/
//         Malwin19581HardwareSupportModule.cs UpdateHydA/BOutputValues().
//
// Two independent identical channels (A and B systems). Each takes a
// PSI input 0..4000 and drives a sin/cos resolver pair. The C# math:
//   degrees = (input / 4000) × 320°
//   sin/cos × 10 V
//
// The dial has 320° of mechanical sweep over 0..4000 PSI. Below 0 PSI
// the C# parks both outputs at 0 V (rest position, like the nozzle).
// Above 4000 PSI the C# clamps to sin/cos(320°) ≈ (-7.66, +7.66) V.
//
// We ship as two piecewise_resolver pairs — identity-style table mapping
// PSI to resolver angle in degrees, every 500 PSI. Users can drift each
// segment for hardware compensation, and the two systems calibrate
// independently (real installs often have one needle drift before the
// other).

(function () {
  const breakpoints = [
    { input:    0, angle:   0 },
    { input:  500, angle:  40 },
    { input: 1000, angle:  80 },
    { input: 1500, angle: 120 },
    { input: 2000, angle: 160 },
    { input: 2500, angle: 200 },
    { input: 3000, angle: 240 },
    { input: 3500, angle: 280 },
    { input: 4000, angle: 320 },
  ];

  GAUGE_CALIBRATION_DEFAULTS['19581'] = Object.freeze({
    channels: [
      // ── Hydraulic Pressure A (sin/cos resolver pair) ────────────────
      {
        id: '19581_Hydraulic_Pressure_A_SIN_To_Instrument',
        kind: 'piecewise_resolver',
        role: 'sin',
        partnerChannel: '19581_Hydraulic_Pressure_A_COS_To_Instrument',
        inputMin: 0,
        inputMax: 4000,
        breakpoints,
        peakVolts: 10,
        zeroTrim: 0,
        gainTrim: 1,
      },
      {
        id: '19581_Hydraulic_Pressure_A_COS_To_Instrument',
        kind: 'piecewise_resolver',
        role: 'cos',
        partnerChannel: '19581_Hydraulic_Pressure_A_SIN_To_Instrument',
        zeroTrim: 0,
        gainTrim: 1,
      },

      // ── Hydraulic Pressure B (independent sin/cos pair) ────────────
      {
        id: '19581_Hydraulic_Pressure_B_SIN_To_Instrument',
        kind: 'piecewise_resolver',
        role: 'sin',
        partnerChannel: '19581_Hydraulic_Pressure_B_COS_To_Instrument',
        inputMin: 0,
        inputMax: 4000,
        breakpoints,
        peakVolts: 10,
        zeroTrim: 0,
        gainTrim: 1,
      },
      {
        id: '19581_Hydraulic_Pressure_B_COS_To_Instrument',
        kind: 'piecewise_resolver',
        role: 'cos',
        partnerChannel: '19581_Hydraulic_Pressure_B_SIN_To_Instrument',
        zeroTrim: 0,
        gainTrim: 1,
      },
    ],
  });
})();
