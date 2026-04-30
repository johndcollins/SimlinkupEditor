// ── Save: XML writers ────────────────────────────────────────────────────────
// State→XML serialisers for each output-driver `.config` file, plus the
// per-gauge `.mapping` file generators. Round-trip with the parsers in
// driver-parsers.js. Called from profile.js's saveProfile.

function generateDriverConfigs(p) {
  const out = {};
  for (const [driverId, decl] of Object.entries(p.drivers || {})) {
    if (driverId === 'analogdevices') {
      // Author from p.drivers state (edited via the Hardware Config tab).
      // createOnly is intentionally false: when the user edits values in the
      // Hardware Config tab, those edits must persist to disk on save. The
      // round-trip is: load → backfill defaults for any missing fields →
      // edit in Hardware Config tab → save (overwrite). Hand-edits made
      // outside the editor are lost on the next save in the editor — the
      // Hardware Config tab is now the canonical authoring surface.
      out['AnalogDevicesHardwareSupportModule.config'] = {
        content: renderAnalogDevicesConfig(decl),
        createOnly: false,
      };
    } else if (driverId === 'henksdi') {
      // Same authoring contract as AD: edits in the Hardware Config tab are
      // the source of truth. createOnly: false means the file is overwritten
      // on save, so hand-edits to henksdi.config outside the editor are lost.
      out['henksdi.config'] = {
        content: renderHenkSDIConfig(decl),
        createOnly: false,
      };
    } else if (driverId === 'henkquadsincos') {
      out['HenkieQuadSinCosHardwareSupportModule.config'] = {
        content: renderHenkQuadSinCosConfig(decl),
        createOnly: false,
      };
    } else if (driverId === 'phcc') {
      out['PhccHardwareSupportModule.config'] = {
        content: renderPhccConfig(decl),
        createOnly: false,
      };
    } else if (driverId === 'arduinoseat') {
      out['ArduinoSeatHardwareSupportModule.config'] = {
        content: renderArduinoSeatConfig(decl),
        createOnly: false,
      };
    } else if (driverId === 'teensyewmu') {
      out['TeensyEWMUHardwareSupportModule.config'] = {
        content: renderTeensyEWMUConfig(decl),
        createOnly: false,
      };
    } else if (driverId === 'teensyrwr') {
      out['TeensyRWRHardwareSupportModule.config'] = {
        content: renderTeensyRWRConfig(decl),
        createOnly: false,
      };
    } else if (driverId === 'teensyvectordrawing') {
      out['TeensyVectorDrawingHardwareSupportModule.config'] = {
        content: renderTeensyVectorDrawingConfig(decl),
        createOnly: false,
      };
    } else if (driverId === 'niclasmorindts') {
      out['DTSCardHardwareSupportModule.config'] = {
        content: renderNiclasMorinDTSConfig(decl),
        createOnly: false,
      };
    }
    // Other drivers: no auto-generation yet. The user adds them in the
    // Hardware tab → they appear in the registry, but the .config file (if
    // they need one) has to be hand-authored. This matches the existing
    // expectation: NiclasMorinDTS / Teensy* / etc. configs encode hardware
    // calibration that the editor doesn't yet model.
  }

  // Per-gauge calibration configs (Layer 1 — gauge HSM transform configs).
  // For every declared gauge that has an entry in GAUGE_CALIBRATION_DEFAULTS,
  // emit a Simtek<digits>HardwareSupportModule.config file. Always emit (even
  // for gauges the user hasn't touched yet) so the file appears on disk and
  // the user can hand-edit it.
  //
  // createOnly policy:
  //   - createOnly:true  when there's no p.gaugeConfigs[pn] entry (user
  //     hasn't touched the Calibration tab for this gauge). Protects any
  //     hand-edits made before the user discovered the editor.
  //   - createOnly:false when there IS an entry (user opened the card and
  //     either edited a field or already had a parsed-from-disk entry).
  //     The Calibration tab is now the canonical authoring surface, mirroring
  //     the same policy the Hardware Config AD card uses. Round trip:
  //     load → parse into p.gaugeConfigs[pn] → edit → save (overwrite).
  //     "Reset to defaults" deletes p.gaugeConfigs[pn] and re-renders, but
  //     the file ALREADY existed on disk from the previous save; the next
  //     save with no entry hits the createOnly:true branch above and the
  //     file isn't overwritten. To make reset actually rewrite the file, we
  //     set a `_resetPending` flag on the profile that this loop reads.
  //
  // The two configs SimLinkup actually consumes today (10-0285 baro range,
  // 10-0294 max fuel) deliberately don't appear in GAUGE_CALIBRATION_DEFAULTS
  // — those use a different bare-property schema and are written/read by
  // their own legacy paths. This loop never touches their files.
  for (const pn of (p.instruments || [])) {
    if (!gaugeCalibrationDefaultsFor(pn)) continue;
    const filename = gaugeConfigFilenameForPn(pn);
    if (!filename) continue;
    const entry = p.gaugeConfigs?.[pn];
    const content = renderGaugeConfigXml(pn, entry);
    if (!content) continue;
    const resetPending = (p._gaugeResetPending instanceof Set) && p._gaugeResetPending.has(pn);
    const userOwned = !!entry || resetPending;
    out[filename] = { content, createOnly: !userOwned };
  }
  // Clear the reset-pending flag after we've consumed it.
  if (p._gaugeResetPending instanceof Set) p._gaugeResetPending.clear();

  // Round-trip raw text for any per-gauge config we loaded but don't have a
  // structured editor for yet. Without this, opening then re-saving a profile
  // would silently delete the file (sweep-on-save policy in main.js for
  // .mapping files doesn't extend to .config files, but createOnly:true with
  // no entry would still leave them on disk — we re-emit them defensively so
  // a future main.js change can't lose them).
  for (const [filename, text] of Object.entries(p.gaugeConfigsRaw || {})) {
    if (!out[filename]) out[filename] = { content: text, createOnly: true };
  }

  return out;
}

// Build the AnalogDevicesHardwareSupportModule.config XML from the profile's
// AD declaration. `decl` is `p.drivers.analogdevices` — `{ devices: [{...}] }`
// where each device carries dacPrecision, OffsetDAC0..2, and 40 channel
// records (offset, gain, dataValueA, dataValueB).
//
// Element order per <Device>: DACPrecision, Calibration, DACChannelConfig.
// Matches Lightning's hand-authored sample so users diffing against the
// reference config see identical structure. SimLinkup reads the file with
// XmlSerializer (name-based, order-tolerant) so the actual order is for human
// readability, not parser correctness.
//
// We always emit the canonical <DACPrecision> casing (matches the C# property
// name). Lightning's sample has <DacPrecision> on Card #1, which is a typo —
// XmlSerializer treats element names case-sensitively, so the typo'd entry
// would silently be ignored on load. The editor normalises both casings on
// read but always writes the canonical form.
function renderAnalogDevicesConfig(decl) {
  const devices = (decl?.devices && decl.devices.length) ? decl.devices : [adDefaultDevice()];
  const lines = [
    '<?xml version="1.0"?>',
    '<AnalogDevices xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '  <Devices>',
  ];
  for (let d = 0; d < devices.length; d++) {
    const dev = devices[d];
    lines.push('    <Device>');
    lines.push(`      <!-- CARD #${d} (authored by SimLinkup Profile Editor — edit via Hardware Config tab) -->`);
    const prec = (dev.dacPrecision === 'FourteenBit' || dev.dacPrecision === 'SixteenBit')
      ? dev.dacPrecision : AD_DEVICE_DEFAULTS.dacPrecision;
    lines.push(`      <DACPrecision>${prec}</DACPrecision>`);
    lines.push('      <Calibration>');
    lines.push(`        <OffsetDAC0>${dev.offsetDAC0 ?? AD_DEVICE_DEFAULTS.offsetDAC0}</OffsetDAC0>`);
    lines.push(`        <OffsetDAC1>${dev.offsetDAC1 ?? AD_DEVICE_DEFAULTS.offsetDAC1}</OffsetDAC1>`);
    lines.push(`        <OffsetDAC2>${dev.offsetDAC2 ?? AD_DEVICE_DEFAULTS.offsetDAC2}</OffsetDAC2>`);
    lines.push('      </Calibration>');
    lines.push('      <DACChannelConfig>');
    const channels = (dev.channels && dev.channels.length === 40) ? dev.channels :
      Array.from({ length: 40 }, () => ({ ...AD_CHANNEL_DEFAULTS }));
    for (let c = 0; c < 40; c++) {
      const ch = channels[c];
      lines.push(`        <DAC${c}>`);
      lines.push('          <Calibration>');
      lines.push(`            <Offset>${ch.offset ?? AD_CHANNEL_DEFAULTS.offset}</Offset>`);
      lines.push(`            <Gain>${ch.gain ?? AD_CHANNEL_DEFAULTS.gain}</Gain>`);
      lines.push('          </Calibration>');
      lines.push('          <InitialState>');
      lines.push(`            <DataValueA>${ch.dataValueA ?? AD_CHANNEL_DEFAULTS.dataValueA}</DataValueA>`);
      lines.push(`            <DataValueB>${ch.dataValueB ?? AD_CHANNEL_DEFAULTS.dataValueB}</DataValueB>`);
      lines.push('          </InitialState>');
      lines.push(`        </DAC${c}>`);
    }
    lines.push('      </DACChannelConfig>');
    lines.push('    </Device>');
  }
  lines.push('  </Devices>');
  lines.push('</AnalogDevices>');
  return lines.join('\n');
}

// Build the henksdi.config XML from p.drivers.henksdi. Element order per
// <Device> matches HenkSDIHardwareSupportModuleConfig.cs declaration order
// (Address, COMPort, ConnectionType, DiagnosticLEDMode,
//  InitialIndicatorPosition, MovementLimitsConfig, OutputChannelsConfig,
//  PowerDownConfig, StatorBaseAnglesConfig, UpdateRateControlConfig). XmlSerializer
// is order-tolerant on read, so the order is for human readability.
//
// Only the active <ModeSettings> element is emitted (Limit or Smooth) — the
// other mode's settings live in state but stay off-disk until the user toggles.
// Always emits canonical <StatorBaseAnglesConfig> and canonical
// xsi:type="SmoothingModeSettings" (samples have typos for both; we
// normalise on save).
function renderHenkSDIConfig(decl) {
  const devices = (decl?.devices && decl.devices.length) ? decl.devices : [henkSdiDefaultDevice()];
  const lines = [
    '<?xml version="1.0"?>',
    '<HenkSDI xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '  <Devices>',
  ];
  for (let d = 0; d < devices.length; d++) {
    const dev = devices[d];
    lines.push('    <Device>');
    lines.push(`      <!-- Card ${d} (authored by SimLinkup Profile Editor — edit via Hardware Config tab) -->`);
    lines.push(`      <Address>${escXml(dev.address ?? '')}</Address>`);
    lines.push(`      <COMPort>${escXml(dev.comPort ?? '')}</COMPort>`);
    lines.push(`      <ConnectionType>${dev.connectionType ?? HENKSDI_DEVICE_DEFAULTS.connectionType}</ConnectionType>`);
    lines.push(`      <DiagnosticLEDMode>${dev.diagnosticLEDMode ?? HENKSDI_DEVICE_DEFAULTS.diagnosticLEDMode}</DiagnosticLEDMode>`);
    lines.push(`      <InitialIndicatorPosition>${dev.initialIndicatorPosition ?? HENKSDI_DEVICE_DEFAULTS.initialIndicatorPosition}</InitialIndicatorPosition>`);

    const ml = dev.movementLimits || HENKSDI_LIMITS_DEFAULTS;
    lines.push('      <MovementLimitsConfig>');
    lines.push(`        <Max>${ml.max ?? HENKSDI_LIMITS_DEFAULTS.max}</Max>`);
    lines.push(`        <Min>${ml.min ?? HENKSDI_LIMITS_DEFAULTS.min}</Min>`);
    lines.push('      </MovementLimitsConfig>');

    lines.push('      <OutputChannelsConfig>');
    for (const name of HENKSDI_CHANNEL_NAMES) {
      const ch = (dev.channels && dev.channels[name]) || { ...HENKSDI_CHANNEL_DEFAULTS, calibration: [] };
      lines.push(`        <${name}>`);
      // C# declaration order: CalibrationData, InitialValue, Mode.
      const cal = Array.isArray(ch.calibration) ? ch.calibration : [];
      if (cal.length > 0) {
        lines.push('          <CalibrationData>');
        for (const pt of cal) {
          lines.push('            <CalibrationPoint>');
          lines.push(`              <Input>${pt.input}</Input>`);
          lines.push(`              <Output>${pt.output}</Output>`);
          lines.push('            </CalibrationPoint>');
        }
        lines.push('          </CalibrationData>');
      }
      lines.push(`          <InitialValue>${ch.initialValue ?? HENKSDI_CHANNEL_DEFAULTS.initialValue}</InitialValue>`);
      // PWM_OUT has no Mode field in any sample; suppress for it (the user
      // chose option (b) — match sample behaviour, hide the dropdown, omit
      // the element on save).
      if (name !== 'PWM_OUT') {
        lines.push(`          <Mode>${ch.mode ?? HENKSDI_CHANNEL_DEFAULTS.mode}</Mode>`);
      }
      lines.push(`        </${name}>`);
    }
    lines.push('      </OutputChannelsConfig>');

    const pd = dev.powerDown || HENKSDI_POWERDOWN_DEFAULTS;
    lines.push('      <PowerDownConfig>');
    lines.push(`        <DelayTimeMilliseconds>${pd.delayMs ?? HENKSDI_POWERDOWN_DEFAULTS.delayMs}</DelayTimeMilliseconds>`);
    lines.push(`        <Enabled>${pd.enabled ? 'true' : 'false'}</Enabled>`);
    lines.push(`        <Level>${pd.level ?? HENKSDI_POWERDOWN_DEFAULTS.level}</Level>`);
    lines.push('      </PowerDownConfig>');

    const sb = dev.statorBaseAngles || HENKSDI_STATOR_DEFAULTS;
    lines.push('      <StatorBaseAnglesConfig>');
    lines.push(`        <S1BaseAngleDegrees>${sb.s1 ?? HENKSDI_STATOR_DEFAULTS.s1}</S1BaseAngleDegrees>`);
    lines.push(`        <S2BaseAngleDegrees>${sb.s2 ?? HENKSDI_STATOR_DEFAULTS.s2}</S2BaseAngleDegrees>`);
    lines.push(`        <S3BaseAngleDegrees>${sb.s3 ?? HENKSDI_STATOR_DEFAULTS.s3}</S3BaseAngleDegrees>`);
    lines.push('      </StatorBaseAnglesConfig>');

    const urc = dev.updateRateControl || HENKSDI_URC_DEFAULTS;
    lines.push('      <UpdateRateControlConfig>');
    lines.push(`        <Mode>${urc.mode ?? HENKSDI_URC_DEFAULTS.mode}</Mode>`);
    if (urc.mode === 'Smooth') {
      lines.push('        <ModeSettings xsi:type="SmoothingModeSettings">');
      lines.push(`          <SmoothingMinimumThreshold>${urc.smoothing?.minThreshold ?? HENKSDI_URC_DEFAULTS.smoothing.minThreshold}</SmoothingMinimumThreshold>`);
      lines.push(`          <SmoothingMode>${urc.smoothing?.mode ?? HENKSDI_URC_DEFAULTS.smoothing.mode}</SmoothingMode>`);
      lines.push('        </ModeSettings>');
    } else {
      // Default to LimitModeSettings for Limit / Speed / Miscellaneous. The
      // C# class only has LimitModeSettings and SmoothingModeSettings as
      // [XmlInclude]'d types, so non-Smooth modes use Limit settings.
      lines.push('        <ModeSettings xsi:type="LimitModeSettings">');
      lines.push(`          <LimitThreshold>${urc.limitThreshold ?? HENKSDI_URC_DEFAULTS.limitThreshold}</LimitThreshold>`);
      lines.push('        </ModeSettings>');
    }
    lines.push(`        <StepUpdateDelayMillis>${urc.stepUpdateDelayMillis ?? HENKSDI_URC_DEFAULTS.stepUpdateDelayMillis}</StepUpdateDelayMillis>`);
    lines.push(`        <UseShortestPath>${urc.useShortestPath ? 'true' : 'false'}</UseShortestPath>`);
    lines.push('      </UpdateRateControlConfig>');

    lines.push('    </Device>');
  }
  lines.push('  </Devices>');
  lines.push('</HenkSDI>');
  return lines.join('\n');
}

// Build the HenkieQuadSinCosHardwareSupportModule.config XML from
// p.drivers.henkquadsincos. Per-device element order matches the C# class
// (HenkieQuadSinCosBoardHardwareSupportModuleConfig.cs) declaration order:
// Address, COMPort, ConnectionType, DiagnosticLEDMode. Root is
// <HenkieQuadSinCos>.
function renderHenkQuadSinCosConfig(decl) {
  const devices = (decl?.devices && decl.devices.length) ? decl.devices : [henkQuadSinCosDefaultDevice()];
  const lines = [
    '<?xml version="1.0"?>',
    '<HenkieQuadSinCos xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '  <Devices>',
  ];
  for (let d = 0; d < devices.length; d++) {
    const dev = devices[d];
    lines.push('    <Device>');
    lines.push(`      <!-- Card ${d} (authored by SimLinkup Profile Editor — edit via Hardware Config tab) -->`);
    lines.push(`      <Address>${escXml(dev.address ?? '')}</Address>`);
    lines.push(`      <COMPort>${escXml(dev.comPort ?? '')}</COMPort>`);
    lines.push(`      <ConnectionType>${dev.connectionType ?? HENKQSC_DEVICE_DEFAULTS.connectionType}</ConnectionType>`);
    lines.push(`      <DiagnosticLEDMode>${dev.diagnosticLEDMode ?? HENKQSC_DEVICE_DEFAULTS.diagnosticLEDMode}</DiagnosticLEDMode>`);
    lines.push('    </Device>');
  }
  lines.push('  </Devices>');
  lines.push('</HenkieQuadSinCos>');
  return lines.join('\n');
}

// Build the PhccHardwareSupportModule.config XML from p.drivers.phcc. Single-
// instance driver — exactly one device. The C# class has no [XmlRoot] override
// so the root element name is the class name itself.
function renderPhccConfig(decl) {
  const dev = decl?.devices?.[0] || phccDefaultDevice();
  const path = dev.deviceManagerConfigFilePath || PHCC_DEVICE_DEFAULTS.deviceManagerConfigFilePath;
  return [
    '<?xml version="1.0"?>',
    '<PhccHardwareSupportModuleConfig xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `  <PhccDeviceManagerConfigFilePath>${escXml(path)}</PhccDeviceManagerConfigFilePath>`,
    '</PhccHardwareSupportModuleConfig>',
  ].join('\n');
}

// Build the ArduinoSeatHardwareSupportModule.config XML. Element order per
// device matches the C# class's [XmlElement] declaration order:
//   COMPort, MotorByte1..4, ForceSlight, ForceRumble, ForceMedium, ForceHard,
//   SeatOutputs (containing zero or more <Output> entries).
// Per-output element order matches SeatOutput.cs declaration order:
//   ID, FORCE, TYPE, MOTOR_1..4, MOTOR_1_SPEED..4_SPEED, MIN, MAX.
//
// MIN/MAX are doubles. JS's String(n) handles ints, decimals, and negatives
// without decoration (e.g. "0", "0.5", "1", "-90"), matching the sample
// config's mixed int/decimal style.
function renderArduinoSeatConfig(decl) {
  const dev = decl?.devices?.[0] || arduinoSeatDefaultDevice();
  const lines = [
    '<?xml version="1.0"?>',
    '<ArduinoSeatHardwareSupportModuleConfig xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `  <COMPort>${escXml(dev.comPort ?? '')}</COMPort>`,
    `  <MotorByte1>${dev.motorByte1 ?? ARDSEAT_DEVICE_DEFAULTS.motorByte1}</MotorByte1>`,
    `  <MotorByte2>${dev.motorByte2 ?? ARDSEAT_DEVICE_DEFAULTS.motorByte2}</MotorByte2>`,
    `  <MotorByte3>${dev.motorByte3 ?? ARDSEAT_DEVICE_DEFAULTS.motorByte3}</MotorByte3>`,
    `  <MotorByte4>${dev.motorByte4 ?? ARDSEAT_DEVICE_DEFAULTS.motorByte4}</MotorByte4>`,
    `  <ForceSlight>${dev.forceSlight ?? ARDSEAT_DEVICE_DEFAULTS.forceSlight}</ForceSlight>`,
    `  <ForceRumble>${dev.forceRumble ?? ARDSEAT_DEVICE_DEFAULTS.forceRumble}</ForceRumble>`,
    `  <ForceMedium>${dev.forceMedium ?? ARDSEAT_DEVICE_DEFAULTS.forceMedium}</ForceMedium>`,
    `  <ForceHard>${dev.forceHard ?? ARDSEAT_DEVICE_DEFAULTS.forceHard}</ForceHard>`,
  ];
  const outputs = Array.isArray(dev.seatOutputs) ? dev.seatOutputs : [];
  if (outputs.length === 0) {
    lines.push('  <SeatOutputs />');
  } else {
    lines.push('  <SeatOutputs>');
    for (const o of outputs) {
      lines.push('    <Output>');
      lines.push(`      <ID>${escXml(o.id ?? '')}</ID>`);
      lines.push(`      <FORCE>${o.force ?? ARDSEAT_OUTPUT_DEFAULTS.force}</FORCE>`);
      lines.push(`      <TYPE>${o.type ?? ARDSEAT_OUTPUT_DEFAULTS.type}</TYPE>`);
      lines.push(`      <MOTOR_1>${o.motor1 ? 'true' : 'false'}</MOTOR_1>`);
      lines.push(`      <MOTOR_2>${o.motor2 ? 'true' : 'false'}</MOTOR_2>`);
      lines.push(`      <MOTOR_3>${o.motor3 ? 'true' : 'false'}</MOTOR_3>`);
      lines.push(`      <MOTOR_4>${o.motor4 ? 'true' : 'false'}</MOTOR_4>`);
      lines.push(`      <MOTOR_1_SPEED>${o.motor1Speed ?? 0}</MOTOR_1_SPEED>`);
      lines.push(`      <MOTOR_2_SPEED>${o.motor2Speed ?? 0}</MOTOR_2_SPEED>`);
      lines.push(`      <MOTOR_3_SPEED>${o.motor3Speed ?? 0}</MOTOR_3_SPEED>`);
      lines.push(`      <MOTOR_4_SPEED>${o.motor4Speed ?? 0}</MOTOR_4_SPEED>`);
      lines.push(`      <MIN>${String(o.min ?? 0)}</MIN>`);
      lines.push(`      <MAX>${String(o.max ?? 0)}</MAX>`);
      lines.push('    </Output>');
    }
    lines.push('  </SeatOutputs>');
  }
  lines.push('</ArduinoSeatHardwareSupportModuleConfig>');
  return lines.join('\n');
}

// Build the TeensyEWMUHardwareSupportModule.config XML. Single-instance driver.
// Element order matches the C# class:
//   COMPort, then DXOutputs containing zero or more <Output> entries.
// Per-output element order matches DXOutput.cs declaration: ID, Invert.
//
// Always emits canonical element form (matches the C# [XmlArrayItem("Output")]
// declaration). The bundled samples use attribute-form <DXOutput.../>, which
// SimLinkup runtime silently drops — saving in the editor migrates the file
// to the working form.
function renderTeensyEWMUConfig(decl) {
  const dev = decl?.devices?.[0] || teensyEwmuDefaultDevice();
  const lines = [
    '<?xml version="1.0"?>',
    '<TeensyEWMUHardwareSupportModuleConfig xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `  <COMPort>${escXml(dev.comPort ?? '')}</COMPort>`,
  ];
  const outputs = Array.isArray(dev.dxOutputs) ? dev.dxOutputs : [];
  if (outputs.length === 0) {
    lines.push('  <DXOutputs />');
  } else {
    lines.push('  <DXOutputs>');
    for (const o of outputs) {
      lines.push('    <Output>');
      lines.push(`      <ID>${escXml(o.id ?? '')}</ID>`);
      lines.push(`      <Invert>${o.invert ? 'true' : 'false'}</Invert>`);
      lines.push('    </Output>');
    }
    lines.push('  </DXOutputs>');
  }
  lines.push('</TeensyEWMUHardwareSupportModuleConfig>');
  return lines.join('\n');
}

// Build the TeensyRWRHardwareSupportModule.config XML. Single-instance driver.
// Element order matches the C# class declaration:
//   COMPort, RotationDegrees, TestPattern, XAxisCalibrationData,
//   YAxisCalibrationData, Centering, Scaling.
// Per-CalibrationPoint order: Input, Output (matches CalibrationPoint.cs).
//
// Numeric fields use String(n) so 0/-45/.82 round-trip without trailing zero
// padding — matches the bundled samples' style.
function renderTeensyRWRConfig(decl) {
  const dev = decl?.devices?.[0] || teensyRwrDefaultDevice();
  const lines = [
    '<?xml version="1.0"?>',
    '<TeensyRWRHardwareSupportModuleConfig xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `  <COMPort>${escXml(dev.comPort ?? '')}</COMPort>`,
    `  <RotationDegrees>${String(dev.rotationDegrees ?? TRWR_DEVICE_DEFAULTS.rotationDegrees)}</RotationDegrees>`,
    `  <TestPattern>${String(dev.testPattern ?? TRWR_DEVICE_DEFAULTS.testPattern)}</TestPattern>`,
  ];

  const writeCal = (label, points) => {
    const pts = Array.isArray(points) ? points : [];
    if (pts.length === 0) {
      lines.push(`  <${label} />`);
      return;
    }
    lines.push(`  <${label}>`);
    for (const pt of pts) {
      lines.push('    <CalibrationPoint>');
      lines.push(`      <Input>${String(pt.input ?? 0)}</Input>`);
      lines.push(`      <Output>${String(pt.output ?? 0)}</Output>`);
      lines.push('    </CalibrationPoint>');
    }
    lines.push(`  </${label}>`);
  };
  writeCal('XAxisCalibrationData', dev.xAxisCalibration);
  writeCal('YAxisCalibrationData', dev.yAxisCalibration);

  const centering = dev.centering || TRWR_CENTERING_DEFAULTS;
  lines.push('  <Centering>');
  lines.push(`    <OffsetX>${String(centering.offsetX ?? 0)}</OffsetX>`);
  lines.push(`    <OffsetY>${String(centering.offsetY ?? 0)}</OffsetY>`);
  lines.push('  </Centering>');

  const scaling = dev.scaling || TRWR_SCALING_DEFAULTS;
  lines.push('  <Scaling>');
  lines.push(`    <ScaleX>${String(scaling.scaleX ?? 1)}</ScaleX>`);
  lines.push(`    <ScaleY>${String(scaling.scaleY ?? 1)}</ScaleY>`);
  lines.push('  </Scaling>');

  lines.push('</TeensyRWRHardwareSupportModuleConfig>');
  return lines.join('\n');
}

// Build the TeensyVectorDrawingHardwareSupportModule.config XML. Single-
// instance driver. Element order matches the C# class declaration:
//   COMPort, DeviceType, RotationDegrees, TestPattern, XAxisCalibrationData,
//   YAxisCalibrationData, Centering, Scaling.
// DeviceType is an enum (RWR/HUD/HMS); the C# property has a default of
// RWR, so unknown values get coerced to RWR on read and the writer always
// emits a valid name.
function renderTeensyVectorDrawingConfig(decl) {
  const dev = decl?.devices?.[0] || teensyVectorDrawingDefaultDevice();
  const dt = TVD_DEVICE_TYPE_VALUES.includes(dev.deviceType) ? dev.deviceType : TVD_DEVICE_DEFAULTS.deviceType;
  const lines = [
    '<?xml version="1.0"?>',
    '<TeensyVectorDrawingHardwareSupportModuleConfig xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `  <COMPort>${escXml(dev.comPort ?? '')}</COMPort>`,
    `  <DeviceType>${dt}</DeviceType>`,
    `  <RotationDegrees>${String(dev.rotationDegrees ?? TVD_DEVICE_DEFAULTS.rotationDegrees)}</RotationDegrees>`,
    `  <TestPattern>${String(dev.testPattern ?? TVD_DEVICE_DEFAULTS.testPattern)}</TestPattern>`,
  ];

  const writeCal = (label, points) => {
    const pts = Array.isArray(points) ? points : [];
    if (pts.length === 0) {
      lines.push(`  <${label} />`);
      return;
    }
    lines.push(`  <${label}>`);
    for (const pt of pts) {
      lines.push('    <CalibrationPoint>');
      lines.push(`      <Input>${String(pt.input ?? 0)}</Input>`);
      lines.push(`      <Output>${String(pt.output ?? 0)}</Output>`);
      lines.push('    </CalibrationPoint>');
    }
    lines.push(`  </${label}>`);
  };
  writeCal('XAxisCalibrationData', dev.xAxisCalibration);
  writeCal('YAxisCalibrationData', dev.yAxisCalibration);

  const centering = dev.centering || TRWR_CENTERING_DEFAULTS;
  lines.push('  <Centering>');
  lines.push(`    <OffsetX>${String(centering.offsetX ?? 0)}</OffsetX>`);
  lines.push(`    <OffsetY>${String(centering.offsetY ?? 0)}</OffsetY>`);
  lines.push('  </Centering>');

  const scaling = dev.scaling || TRWR_SCALING_DEFAULTS;
  lines.push('  <Scaling>');
  lines.push(`    <ScaleX>${String(scaling.scaleX ?? 1)}</ScaleX>`);
  lines.push(`    <ScaleY>${String(scaling.scaleY ?? 1)}</ScaleY>`);
  lines.push('  </Scaling>');

  lines.push('</TeensyVectorDrawingHardwareSupportModuleConfig>');
  return lines.join('\n');
}

// Build the DTSCardHardwareSupportModule.config XML from p.drivers.niclasmorindts.
// Multi-device driver. XML root is <DTSCard> per the C# class's [XmlRoot].
// Element order per device matches the C# class declaration: Serial, DeadZone,
// CalibrationData. We emit <DeadZone> only when from/to are non-zero — the
// bundled sample's first device omits it entirely, so that pattern is the
// canonical "no dead zone needed" form.
function renderNiclasMorinDTSConfig(decl) {
  const devices = (decl?.devices && decl.devices.length) ? decl.devices : [niclasMorinDtsDefaultDevice()];
  const lines = [
    '<?xml version="1.0"?>',
    '<DTSCard xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '  <Devices>',
  ];
  for (let d = 0; d < devices.length; d++) {
    const dev = devices[d];
    lines.push('    <Device>');
    lines.push(`      <Serial>${escXml(dev.address ?? '')}</Serial>`);

    const dz = dev.deadZone || NMDTS_DEADZONE_DEFAULTS;
    const fromDeg = dz.fromDegrees ?? 0;
    const toDeg = dz.toDegrees ?? 0;
    if (fromDeg !== 0 || toDeg !== 0) {
      lines.push('      <DeadZone>');
      lines.push(`        <FromDegrees>${String(fromDeg)}</FromDegrees>`);
      lines.push(`        <ToDegrees>${String(toDeg)}</ToDegrees>`);
      lines.push('      </DeadZone>');
    }

    const cal = Array.isArray(dev.calibrationData) ? dev.calibrationData : [];
    if (cal.length === 0) {
      lines.push('      <CalibrationData />');
    } else {
      lines.push('      <CalibrationData>');
      for (const pt of cal) {
        lines.push('        <CalibrationPoint>');
        lines.push(`          <Input>${String(pt.input ?? 0)}</Input>`);
        lines.push(`          <Output>${String(pt.output ?? 0)}</Output>`);
        lines.push('        </CalibrationPoint>');
      }
      lines.push('      </CalibrationData>');
    }

    lines.push('    </Device>');
  }
  lines.push('  </Devices>');
  lines.push('</DTSCard>');
  return lines.join('\n');
}

// ── Mapping file generation ──────────────────────────────────────────────────

// Build one .mapping file per gauge that has at least one edge. The filename
// follows the convention used by sample profiles in the SimLinkup repo:
//   - Simtek gauges:  Simtek<digits><FriendlyName>.mapping
//   - Other gauges:   <gaugePn>.mapping
// SimLinkup picks up *.mapping files from the profile dir regardless of name,
// but matching the convention keeps the on-disk layout familiar.
function generateMappingFiles(p) {
  // Group edges by which gauge they belong to.
  // Stage-1 edges belong to dstGaugePn. Stage-2 edges belong to srcGaugePn.
  // Edges that don't reference any gauge land in a misc bucket.
  const byGauge = new Map();
  const misc = [];
  for (const e of p.chain.edges) {
    let pn = null;
    if (e.stage === 1 && e.dstGaugePn) pn = e.dstGaugePn;
    else if ((e.stage === 2 || e.stage === '1.5') && e.srcGaugePn) pn = e.srcGaugePn;
    if (pn) {
      if (!byGauge.has(pn)) byGauge.set(pn, []);
      byGauge.get(pn).push(e);
    } else {
      misc.push(e);
    }
  }

  const files = [];
  // Captured at load time so legacy / custom filenames survive a save.
  // Each entry: { filename, ports: [portName, ...] } — multiple per PN
  // for the case where a gauge's mappings are split across files (e.g.
  // Nigel's Malwin 19581 hydraulic pressure A + B).
  const captured = p.mappingFilesByPn || {};

  // One or more files per gauge that has edges.
  for (const [pn, edges] of byGauge) {
    const inst = INSTRUMENTS.find(i => i.pn === pn);
    const legacyFiles = captured[pn] && captured[pn].length ? captured[pn] : null;
    if (legacyFiles) {
      // Distribute the gauge's edges across the legacy files based on
      // port-name matching. New ports (not in any legacy file) go into
      // the first file as a safe default.
      const buckets = legacyFiles.map(f => ({
        filename: f.filename,
        ports: new Set(f.ports || []),
        edges: [],
      }));
      for (const e of edges) {
        const port = e.stage === 1 ? e.dstGaugePort
                   : ((e.stage === 2 || e.stage === '1.5') ? e.srcGaugePort : null);
        let bucket = port ? buckets.find(b => b.ports.has(port)) : null;
        if (!bucket) bucket = buckets[0];
        bucket.edges.push(e);
      }
      // Emit every legacy file even if a bucket is empty — empty
      // <SignalMappings/> is valid and keeps SimLinkup happy with the
      // registered HSM. main.js's sweep-on-save only deletes files
      // whose name isn't in the wantedNames set, so emitting the
      // legacy filename here protects it.
      for (const b of buckets) {
        files.push({ filename: b.filename, content: renderMappingXml(b.edges) });
      }
    } else {
      // No legacy filenames captured for this PN — use the default name.
      const filename = mappingFilenameForGauge(pn, inst);
      files.push({ filename, content: renderMappingXml(edges) });
    }
  }

  // Also emit one file per active-but-unwired gauge so SimLinkup's HSM
  // initialisation still has the registered modules visible to operators
  // browsing the profile folder. (Empty mapping files are harmless.)
  for (const pn of p.instruments) {
    if (byGauge.has(pn)) continue;
    const inst = INSTRUMENTS.find(i => i.pn === pn);
    if (!inst) continue;
    const legacyFiles = captured[pn] && captured[pn].length ? captured[pn] : null;
    if (legacyFiles) {
      // Preserve every legacy file as empty so the sweep doesn't delete it.
      for (const f of legacyFiles) {
        files.push({ filename: f.filename, content: renderMappingXml([]) });
      }
    } else {
      const filename = mappingFilenameForGauge(pn, inst);
      files.push({ filename, content: renderMappingXml([]) });
    }
  }

  // Misc edges (rare — e.g. unknown destinations) go into a fallback file.
  if (misc.length) {
    files.push({ filename: 'OtherMappings.mapping', content: renderMappingXml(misc) });
  }

  return files;
}

// Default filename for a gauge that has no legacy filename captured
// (i.e. a gauge added to the profile after load). Simtek<digits><descriptor>
// for Simtek gauges, or "<pn>.mapping" for everything else.
function mappingFilenameForGauge(pn, inst) {
  if (inst && inst.cls && inst.cls.includes('.Simtek.Simtek')) {
    // Match the Simtek<digits><descriptor>.mapping convention used by sample
    // profiles (e.g. "Simtek100194machmeter.mapping",
    // "Simtek10058102verticalvelocity.mapping"). Build the descriptor from
    // the instrument name by lower-casing and stripping non-alphanumerics.
    const shortName = inst.cls.split('.').pop().replace(/HardwareSupportModule$/, '');
    const descriptor = (inst.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return descriptor ? `${shortName}${descriptor}.mapping` : `${shortName}.mapping`;
  }
  // Non-Simtek or unknown: just use the PN directly (sanitised).
  const safe = pn.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${safe}.mapping`;
}

function renderMappingXml(edges) {
  const lines = [
    '<?xml version="1.0"?>',
    '<MappingProfile xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '  <SignalMappings>',
  ];
  for (const e of edges) {
    if (!e.src || !e.dst) continue;
    const type = e.kind === 'digital' ? 'DigitalSignal' : 'AnalogSignal';
    lines.push('    <SignalMapping>');
    lines.push(`      <Source xsi:type="${type}">`);
    lines.push(`        <Id>${e.src}</Id>`);
    lines.push('      </Source>');
    lines.push(`      <Destination xsi:type="${type}">`);
    lines.push(`        <Id>${e.dst}</Id>`);
    lines.push('      </Destination>');
    lines.push('    </SignalMapping>');
  }
  lines.push('  </SignalMappings>');
  lines.push('</MappingProfile>');
  return lines.join('\n');
}
