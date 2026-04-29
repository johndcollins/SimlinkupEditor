// ── Westin 521993 — F-16 EPU Fuel Quantity Indicator ────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Westin/
//         Westin521993HardwareSupportModule.cs UpdateOutputValues().
//
// Single-channel piecewise. Output range is 0.1 V .. 2.0 V (NOT ±10 V),
// driving a low-voltage hot-wire EPU fuel hydrazine gauge directly:
//
//   input <  0  →  0.1 V (gauge dead-stop low)
//   0..100%      →  0.1 .. 2.0 V (linear)
//   input > 100  →  2.0 V (gauge dead-stop high)
//
// EPU hydrazine quantity is published by BMS as 0..100%. The narrow
// 0.1..2.0 V output range is what the gauge mechanism expects — this is
// the only Simtek/AMI-family gauge in the catalog that DOESN'T use the
// standard ±10 V DAC swing. Editor breakpoints sample every 10% so users
// can correct each segment individually.

GAUGE_CALIBRATION_DEFAULTS['521993'] = Object.freeze({
  channels: [
    {
      id: '521993_EPU_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:   0, volts: 0.10 },   // dead-stop low
        { input:  10, volts: 0.29 },
        { input:  20, volts: 0.48 },
        { input:  30, volts: 0.67 },
        { input:  40, volts: 0.86 },
        { input:  50, volts: 1.05 },
        { input:  60, volts: 1.24 },
        { input:  70, volts: 1.43 },
        { input:  80, volts: 1.62 },
        { input:  90, volts: 1.81 },
        { input: 100, volts: 2.00 },   // dead-stop high
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
