// HenkF16HSIBoard1 — F-16 HSI Interface Board #1
//
// Drives the heading rose, bearing pointer, and the three range digits
// on the F-16 HSI. All five outputs are raw DAC counts (0..1023) sent
// to synchro stator drivers on the indicator. None are voltages.
//
// Defaults are extracted from the C# fallback math in
//   src/SimLinkup/HardwareSupport/Henk/HSI/Board1/HenkF16HSIBoard1HardwareSupportModule.cs
// (Calibrated*Value helpers — used when the legacy *CalibrationData
// arrays are absent). Three breakpoints per channel: input min,
// midpoint, max. Users add intermediate breakpoints to compensate
// for stator non-linearities on their specific board.
//
// Channel ids match the HSM's output signal Id literals exactly so the
// SimLinkup-side TryLoadUnifiedOverrides FindChannel calls hit them.
GAUGE_CALIBRATION_DEFAULTS['Henk_F16_HSI_Board1'] = Object.freeze({
  channels: [
    {
      id: 'Henk_F16_HSI_Board1_Magnetic_Heading_To_Instrument',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 0,
      outputMax: 1023,
      outputLabel: 'DAC',
      outputStep: 1,
      breakpoints: [
        { input:   0, output:    0 },
        { input: 180, output:  511.5 },
        { input: 360, output: 1023 },
      ],
    },
    {
      id: 'Henk_F16_HSI_Board1_Bearing_To_Instrument',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 0,
      outputMax: 1023,
      outputLabel: 'DAC',
      outputStep: 1,
      breakpoints: [
        { input:   0, output:    0 },
        { input: 180, output:  511.5 },
        { input: 360, output: 1023 },
      ],
    },
    {
      id: 'Henk_F16_HSI_Board1_Range_x100_To_Instrument',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 0,
      outputMax: 1023,
      outputLabel: 'DAC',
      outputStep: 1,
      breakpoints: [
        { input:  0, output:    0 },
        { input:  5, output:  511.5 },
        { input: 10, output: 1023 },
      ],
    },
    {
      id: 'Henk_F16_HSI_Board1_Range_x10_To_Instrument',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 0,
      outputMax: 1023,
      outputLabel: 'DAC',
      outputStep: 1,
      breakpoints: [
        { input:  0, output:    0 },
        { input:  5, output:  511.5 },
        { input: 10, output: 1023 },
      ],
    },
    {
      id: 'Henk_F16_HSI_Board1_Range_x1_To_Instrument',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 0,
      outputMax: 1023,
      outputLabel: 'DAC',
      outputStep: 1,
      breakpoints: [
        { input:  0, output:    0 },
        { input:  5, output:  511.5 },
        { input: 10, output: 1023 },
      ],
    },
  ],
});
