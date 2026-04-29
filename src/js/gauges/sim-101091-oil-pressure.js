// ── Simtek 10-1091 — F-16 Engine Oil Pressure Indicator ──────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//         Simtek101091HardwareSupportModule.cs UpdateOutputValues()
//         (lines 193–238).
//
// Input 0..100 PSI drives a 320° clockwise sweep on the dial; sin/cos ×
// peakVolts (10 V) drive the synchro windings. The C# encodes 0% → angle
// 0° (top, 12 o'clock) and 100% → angle 320°.
//
// We ship it as 'piecewise_resolver' (not the simpler 'resolver' kind)
// with breakpoints every 10 PSI. Default mapping is a straight line
// (input × 3.2 = angle), but a worn 30+ year old oil pressure synchro
// can develop dead spots — the editable table lets users correct each
// segment independently.
//
// Self-registers into GAUGE_CALIBRATION_DEFAULTS at script-load time.

GAUGE_CALIBRATION_DEFAULTS['10-1091'] = Object.freeze({
  channels: [
    {
      id: '101091_Oil_Pressure_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '101091_Oil_Pressure_COS_To_Instrument',
      // 11 breakpoints, one every 10 PSI. Defaults are the linear mapping
      // 0%→0°, 100%→320° (slope 3.2°/%). Edit individual rows to correct
      // local synchro drift.
      // inputMin/inputMax bound the editor's scrub slider only.
      inputMin: 0,
      inputMax: 100,
      breakpoints: [
        { input:   0, angle:   0 },
        { input:  10, angle:  32 },
        { input:  20, angle:  64 },
        { input:  30, angle:  96 },
        { input:  40, angle: 128 },
        { input:  50, angle: 160 },
        { input:  60, angle: 192 },
        { input:  70, angle: 224 },
        { input:  80, angle: 256 },
        { input:  90, angle: 288 },
        { input: 100, angle: 320 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '101091_Oil_Pressure_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '101091_Oil_Pressure_SIN_To_Instrument',
      // No transform body on COS — SIN partner carries it.
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
