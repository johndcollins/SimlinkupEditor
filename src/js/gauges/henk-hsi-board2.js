// HenkF16HSIBoard2 — F-16 HSI Interface Board #2
//
// Drives the course-deviation indicator (the lateral CDI bar). Single
// calibration channel — input is normalized deviation (-1..+1 = the
// raw deviation in degrees divided by the per-mode limit), output is
// raw DAC counts (0..1023) to the stator driver.
//
// Defaults are extracted from the C# fallback math in
//   src/SimLinkup/HardwareSupport/Henk/HSI/Board2/HenkF16HSIBoard2HardwareSupportModule.cs
// (CalibratedCourseDeviationIndicatorPositionValue — used when the
// legacy CourseDeviationIndicatorCalibrationData array is absent).
// Symmetric three-point default: -1 → 0, 0 → 511.5, +1 → 1023. The
// midpoint at 511.5 puts the bar dead-center when deviation is zero.
//
// Channel id matches the HSM's output signal Id literal exactly.
GAUGE_CALIBRATION_DEFAULTS['Henk_F16_HSI_Board2'] = Object.freeze({
  channels: [
    {
      id: 'Henk_F16_HSI_Board2_Course_Deviation_Indicator_Position_To_Instrument',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 0,
      outputMax: 1023,
      outputLabel: 'DAC',
      outputStep: 1,
      breakpoints: [
        { input: -1, output:    0 },
        { input:  0, output:  511.5 },
        { input:  1, output: 1023 },
      ],
    },
  ],
});
