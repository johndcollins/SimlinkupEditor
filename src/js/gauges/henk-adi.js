// HenkF16ADISupportBoard — F-16 ADI Support Board for ARU-50/A primary ADI
//
// Five output channels, all driven directly by the Henk board (no
// AnalogDevices in front). Pitch and Roll write raw DAC counts to the
// board's stator drivers (0..1023 range; centered at ~424 / ~512). The two
// command bars and rate-of-turn write a normalized 0..1 position. None of
// these are voltages — they're board-level position numbers, so the
// outputUnit is 'dac' (skips the volts trim block, renders DAC headers in
// the table, round-trips as <Point input=".." output=".."/>).
//
// Defaults are extracted from the C# source's hardcoded math in
//   src/SimLinkup/HardwareSupport/Henk/ADI/HenkF16ADISupportBoardHardwareSupportModule.cs
// (Update*OutputValues methods). 3 breakpoints per channel — endpoints
// plus a center reference. Users add intermediate points if the
// mechanical linkage on their specific board doesn't match the spec.
//
// The two command bar channels carry an extra hiddenOutput field. When
// the board's commandBarsVisible digital input is low, the bar parks at
// hiddenOutput rather than being driven from the breakpoint table. Default
// values match the original hardcoded behaviour: horizontal bar parks at
// 1.0 (pushed off-screen in the upward direction); vertical bar parks at
// 0.0 (downward). Users override per-board if their ADI's mechanical park
// position is different.
//
// Channel ids match the C# HSM's output signal Id literals exactly so the
// SimLinkup-side loader's FindChannel calls hit them.
GAUGE_CALIBRATION_DEFAULTS['HenkF16ADISupportBoard'] = Object.freeze({
  channels: [
    {
      id: 'HenkF16ADISupportBoard_Pitch_To_SDI',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 140,
      outputMax: 700,
      outputLabel: 'DAC',
      outputStep: 1,
      breakpoints: [
        { input: -90, output: 169 },
        { input:   0, output: 424 },
        { input:  90, output: 679 },
      ],
    },
    {
      id: 'HenkF16ADISupportBoard_Roll_To_SDI',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 0,
      outputMax: 1023,
      outputLabel: 'DAC',
      outputStep: 1,
      breakpoints: [
        { input: -180, output:    0 },
        { input:    0, output:  512 },
        { input:  180, output: 1024 },
      ],
    },
    {
      id: 'HenkF16ADISupportBoard_Horizontal_GS_Bar_To_SDI',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 0,
      outputMax: 1,
      outputLabel: 'Position',
      outputStep: 0.01,
      // hiddenOutput: value driven when commandBarsVisible is FALSE.
      // 1.0 matches the C# hardcoded park position (pushes the bar off-
      // screen on bench-stock ADIs). Override per-board if the mechanical
      // park position differs.
      hiddenOutput: 1.0,
      supportsHiddenOutput: true,
      breakpoints: [
        { input: -1, output: 0   },
        { input:  0, output: 0.5 },
        { input:  1, output: 1   },
      ],
    },
    {
      id: 'HenkF16ADISupportBoard_Vertical_GS_Bar_To_SDI',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 0,
      outputMax: 1,
      outputLabel: 'Position',
      outputStep: 0.01,
      // 0.0 matches the C# hardcoded park position (drops the bar
      // downward off-screen). The breakpoint table is "inverted" relative
      // to horizontal — input -1 → 1.0, input +1 → 0.0 — to match the
      // original C# math (1.0 - (0.5 + 0.5 * input)).
      hiddenOutput: 0.0,
      supportsHiddenOutput: true,
      breakpoints: [
        { input: -1, output: 1   },
        { input:  0, output: 0.5 },
        { input:  1, output: 0   },
      ],
    },
    {
      id: 'HenkF16ADISupportBoard_Rate_Of_Turn_To_SDI',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 0,
      outputMax: 1,
      outputLabel: 'Position',
      outputStep: 0.01,
      breakpoints: [
        { input: -1, output: 0   },
        { input:  0, output: 0.5 },
        { input:  1, output: 1   },
      ],
    },
  ],
});
