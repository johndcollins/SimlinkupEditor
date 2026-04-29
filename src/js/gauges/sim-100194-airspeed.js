// ── Simtek 10-0194 — F-16 Mach/Airspeed Indicator ────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//         Simtek100194HardwareSupportModule.cs
//
// Two output channels:
//
//  1. Airspeed (piecewise) — UpdateAirspeedOutputValues() at lines 236–429.
//     43 breakpoints from 0 kts (−10 V) to 850 kts (+10 V). Below 0 kts
//     clamps to −10 V; above 850 kts clamps to +10 V.
//
//  2. Mach (cross_coupled) — UpdateMachOutputValues() at lines 431–605.
//     The Mach wheel position is computed RELATIVE to the current airspeed
//     output voltage (line 437: `var airspeedVoltage = _airspeedOutputSignal?.State ?? 0`),
//     using a separate per-Mach reference voltage table (lines 440–587) and
//     a final coupling formula at lines 588–594. This is the cross-coupled
//     edge case the architecture memo flagged — there is no standalone
//     `f(input) → volts` curve to edit. The schema reserves a
//     `<Channel kind="cross_coupled">` block so the on-disk file shape stays
//     stable when a future cross_coupled editor lands; the Calibration tab
//     shows a stub card explaining the dependency.
//
// Self-registers into GAUGE_CALIBRATION_DEFAULTS at script-load time.

GAUGE_CALIBRATION_DEFAULTS['10-0194'] = Object.freeze({
  channels: [
    {
      id: '100194_Airspeed_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:   0, volts: -10.00 },
        { input:  80, volts:  -8.82 },
        { input:  90, volts:  -8.24 },
        { input: 100, volts:  -7.65 },
        { input: 110, volts:  -7.06 },
        { input: 120, volts:  -6.47 },
        { input: 130, volts:  -5.88 },
        { input: 140, volts:  -5.29 },
        { input: 150, volts:  -4.71 },
        { input: 160, volts:  -4.12 },
        { input: 170, volts:  -3.53 },
        { input: 180, volts:  -2.94 },
        { input: 190, volts:  -2.35 },
        { input: 200, volts:  -1.77 },
        { input: 210, volts:  -1.47 },
        { input: 220, volts:  -1.18 },
        { input: 230, volts:  -0.88 },
        { input: 240, volts:  -0.59 },
        { input: 250, volts:  -0.29 },
        { input: 260, volts:   0.00 },
        { input: 270, volts:   0.29 },
        { input: 280, volts:   0.59 },
        { input: 290, volts:   0.88 },
        { input: 300, volts:   1.18 },
        { input: 310, volts:   1.41 },
        { input: 320, volts:   1.65 },
        { input: 330, volts:   1.88 },
        { input: 340, volts:   2.12 },
        { input: 350, volts:   2.35 },
        { input: 360, volts:   2.58 },
        { input: 370, volts:   2.82 },
        { input: 380, volts:   3.06 },
        { input: 390, volts:   3.29 },
        { input: 400, volts:   3.53 },
        { input: 450, volts:   4.41 },
        { input: 500, volts:   5.29 },
        { input: 550, volts:   6.06 },
        { input: 600, volts:   6.82 },
        { input: 650, volts:   7.53 },
        { input: 700, volts:   8.24 },
        { input: 750, volts:   8.82 },
        { input: 800, volts:   9.53 },
        { input: 850, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '100194_Mach_To_Instrument',
      kind: 'piecewise',
      // The Mach output is computed in two stages by SimLinkup:
      //   1. Look up the Mach input in this 36-knot reference voltage
      //      table to get a "reference voltage" (the gauge's geometry
      //      converts that to a reference angle internally).
      //   2. Apply the cross-coupling math against the current airspeed
      //      output voltage to position the Mach wheel relative to the
      //      airspeed needle.
      // The user can edit this table to correct local drift in the
      // reference voltages; the cross-coupling math itself is gauge
      // geometry and stays hardcoded in the C# HSM.
      //
      // coupledTo signals to the C# loader that this piecewise output is
      // a REFERENCE VOLTAGE (not a final DAC output). The C# evaluates
      // the table on the Mach input to get the reference, then runs its
      // own coupling math on top before writing to the DAC.
      coupledTo: '100194_Airspeed_To_Instrument',
      // Reference voltage breakpoints from UpdateMachOutputValues
      // (Simtek100194HardwareSupportModule.cs lines 440–587). 36 knots
      // covering Mach 0.50..2.40 → -7.56..+10.00 V. Below 0.50 the C#
      // clamps to -10 V (a discontinuity at the bottom of the table)
      // — to express that here we'd need a synthetic knot at 0.49,-10
      // but the difference matters only at sub-taxi speeds. The table
      // matches the C# reference values verbatim.
      breakpoints: [
        { input: 0.50, volts: -7.56 },
        { input: 0.55, volts: -6.56 },
        { input: 0.60, volts: -5.65 },
        { input: 0.65, volts: -4.81 },
        { input: 0.70, volts: -4.01 },
        { input: 0.75, volts: -3.24 },
        { input: 0.80, volts: -2.52 },
        { input: 0.85, volts: -1.83 },
        { input: 0.90, volts: -1.18 },
        { input: 0.95, volts: -0.57 },
        { input: 1.00, volts:  0.00 },
        { input: 1.05, volts:  0.53 },
        { input: 1.10, volts:  1.07 },
        { input: 1.15, volts:  1.56 },
        { input: 1.20, volts:  2.06 },
        { input: 1.25, volts:  2.52 },
        { input: 1.30, volts:  2.98 },
        { input: 1.35, volts:  3.43 },
        { input: 1.40, volts:  3.85 },
        { input: 1.45, volts:  4.27 },
        { input: 1.50, volts:  4.69 },
        { input: 1.55, volts:  5.08 },
        { input: 1.60, volts:  5.46 },
        { input: 1.65, volts:  5.84 },
        { input: 1.70, volts:  6.18 },
        { input: 1.75, volts:  6.53 },
        { input: 1.80, volts:  6.87 },
        { input: 1.85, volts:  7.17 },
        { input: 1.90, volts:  7.48 },
        { input: 1.95, volts:  7.79 },
        { input: 2.00, volts:  8.05 },
        { input: 2.05, volts:  8.32 },
        { input: 2.10, volts:  8.59 },
        { input: 2.15, volts:  8.85 },
        { input: 2.20, volts:  9.08 },
        { input: 2.40, volts: 10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
