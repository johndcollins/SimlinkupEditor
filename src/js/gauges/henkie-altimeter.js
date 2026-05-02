// HenkieF16Altimeter — F-16 altimeter drive board
//
// Drives the altitude pointer/drum on the F-16 altimeter via the Henkie
// board. Single calibration channel — input is altitude mod 10000 ft
// (after upstream baro compensation), output is raw DAC counts (0..4095)
// to the synchro stator driver.
//
// The baro-compensation triangle (MinBaroPressureInHg / MaxBaroPressureInHg
// / IndicatedAltitudeDifferenceInFeetFromMinBaroToMaxBaro) is intentionally
// NOT in the editor — it's a per-installation tuning value that lives in
// the legacy HenkieF16Altimeter.config alongside identity and stator base
// angles. The calibration table here only sees post-baro-compensated
// altitude.
//
// Defaults are extracted from the C# fallback math in
//   src/SimLinkup/HardwareSupport/Henk/Altimeter/HenkieF16AltimeterHardwareSupportModule.cs
// (CalibratedPosition — used when the legacy CalibrationData array is
// absent). Three breakpoints: 0 ft → 0 DAC, 5000 ft → 2047.5 DAC,
// 10000 ft → 4095 DAC. Users add intermediate breakpoints to compensate
// for stator non-linearities on their specific board.
GAUGE_CALIBRATION_DEFAULTS['HenkieF16Altimeter'] = Object.freeze({
  channels: [
    {
      id: 'HenkieF16Altimeter_Indicator_Position_To_Instrument',
      kind: 'piecewise',
      outputUnit: 'dac',
      outputMin: 0,
      outputMax: 4095,
      outputLabel: 'DAC',
      outputStep: 1,
      breakpoints: [
        { input:     0, output:    0 },
        { input:  5000, output: 2047.5 },
        { input: 10000, output: 4095 },
      ],
    },
  ],
});
