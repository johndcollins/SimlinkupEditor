// ── Simtek 10-1088 — F-16 Nozzle Position Indicator ──────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//         Simtek101088HardwareSupportModule.cs UpdateOutputValues()
//         (lines 192–238).
//
// Input 0..100% nozzle position drives a 300° clockwise sweep on the
// physical dial: 0% at the 1 o'clock position (30°), 100% at the 11
// o'clock position (330°). Sin/cos × peakVolts (10 V) drive the synchro
// windings.
//
// Note: the C# source's UpdateOutputValues encodes angle 0..225° (input
// 100% → sin(225°)) which assumes 0% is at top (12 o'clock) and the gauge
// sweeps to the bottom-left. That's a different mounting convention from
// the physical hardware photographed during this gauge's calibration —
// the values below match the *real* hardware, not the C# defaults. The
// C# fallback path stays intact for users who haven't run the editor yet.
//
// We ship it as 'piecewise_resolver' (not the simpler 'resolver' kind)
// with breakpoints every 10% input. Default mapping is a straight line
// (input × 3 + 30 = angle), but a worn nozzle synchro can develop dead
// spots at specific positions — the editable table lets users correct
// each segment independently. A plain 'resolver' encoding would only
// have allowed scaling/shifting the whole sweep uniformly.
//
// Self-registers into GAUGE_CALIBRATION_DEFAULTS at script-load time.

GAUGE_CALIBRATION_DEFAULTS['10-1088'] = Object.freeze({
  channels: [
    {
      id: '101088_Nozzle_Position_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '101088_Nozzle_Position_COS_To_Instrument',
      // 11 breakpoints, one every 10% input. Defaults are the linear
      // mapping 0%→30°, 100%→330° (slope 3°/%). Edit individual rows to
      // correct local synchro drift.
      // inputMin/inputMax bound the editor's scrub slider only.
      inputMin: 0,
      inputMax: 100,
      breakpoints: [
        { input:   0, angle:  30 },
        { input:  10, angle:  60 },
        { input:  20, angle:  90 },
        { input:  30, angle: 120 },
        { input:  40, angle: 150 },
        { input:  50, angle: 180 },
        { input:  60, angle: 210 },
        { input:  70, angle: 240 },
        { input:  80, angle: 270 },
        { input:  90, angle: 300 },
        { input: 100, angle: 330 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '101088_Nozzle_Position_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '101088_Nozzle_Position_SIN_To_Instrument',
      // No transform body on COS — SIN partner carries it.
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
