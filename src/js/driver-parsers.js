// ── Driver parsers ───────────────────────────────────────────────────────────
// XML→state parsers and backfills for each output-driver `.config` file.
// Called from chain.js's applyLoadedChain(); also from tab-hardware-config.js
// after the user pastes new XML.
//
// Parse the user's per-profile output-driver configs into device-list records
// matching the Hardware tab's data model.
//
// driverConfigs is an object keyed by filename:
//   { 'AnalogDevicesHardwareSupportModule.config': '<xml...>',
//     'henksdi.config':                             '<xml...>' }
//
// Returns a map keyed by driver-id where each entry has
//   { devices: [...] }
// Device records match the shape produced by DRIVER_META[driver].defaultDevice():
//   - AnalogDevices  → full structured config: [{ dacPrecision, offsetDAC0..2,
//                       channels: [{ offset, gain, dataValueA, dataValueB } × 40] }]
//                       Missing fields default to AD_DEVICE_DEFAULTS / AD_CHANNEL_DEFAULTS.
//   - HenkSDI        → full structured config: identity + powerDown +
//                       statorBaseAngles + movementLimits + 8 channels with
//                       per-channel mode/calibration + updateRateControl.
//                       Missing fields default to HENKSDI_*_DEFAULTS.
//   - HenkQuadSinCos → [{ address: '0x53' }, ...]
//   - everything else → no parser yet; the entry is just `{ devices: [{}] }`
//     when the file exists (treated as 'single' deviceShape).
function parseDriverConfigs(driverConfigs) {
  const out = {};
  const ad = driverConfigs?.['AnalogDevicesHardwareSupportModule.config'];
  if (ad) {
    out.analogdevices = parseAnalogDevicesConfig(ad);
  }
  const sdi = driverConfigs?.['henksdi.config'];
  if (sdi) {
    out.henksdi = parseHenkSDIConfig(sdi);
  }
  const qsc = driverConfigs?.['HenkieQuadSinCosHardwareSupportModule.config'];
  if (qsc) {
    out.henkquadsincos = parseHenkQuadSinCosConfig(qsc);
  }
  const phcc = driverConfigs?.['PhccHardwareSupportModule.config'];
  if (phcc) {
    out.phcc = parsePhccConfig(phcc);
  }
  const ardseat = driverConfigs?.['ArduinoSeatHardwareSupportModule.config'];
  if (ardseat) {
    out.arduinoseat = parseArduinoSeatConfig(ardseat);
  }
  const tewmu = driverConfigs?.['TeensyEWMUHardwareSupportModule.config'];
  if (tewmu) {
    out.teensyewmu = parseTeensyEWMUConfig(tewmu);
  }
  const trwr = driverConfigs?.['TeensyRWRHardwareSupportModule.config'];
  if (trwr) {
    out.teensyrwr = parseTeensyRWRConfig(trwr);
  }
  const tvd = driverConfigs?.['TeensyVectorDrawingHardwareSupportModule.config'];
  if (tvd) {
    out.teensyvectordrawing = parseTeensyVectorDrawingConfig(tvd);
  }
  const nmdts = driverConfigs?.['DTSCardHardwareSupportModule.config'];
  if (nmdts) {
    out.niclasmorindts = parseNiclasMorinDTSConfig(nmdts);
  }
  const pokeys = driverConfigs?.['PoKeysHardwareSupportModule.config'];
  if (pokeys) {
    // Single parsed object shared by reference between both PoKeys
    // driver ids. Editor mutations against either p.drivers.pokeys_digital
    // or p.drivers.pokeys_pwm land in the same devices array, and only
    // pokeys_digital's save path emits the file (pokeys_pwm carries
    // skipConfigFile: true in DRIVER_META).
    const parsed = parsePoKeysConfig(pokeys);
    out.pokeys_digital = parsed;
    out.pokeys_pwm = parsed;
  }
  // No remaining drivers need passthrough handling — every driver in
  // DRIVER_META either has a structured parser above, or has no per-driver
  // config file at all. Earlier versions of this function had a passthrough
  // loop that unconditionally overwrote `out[driver]` for the four Teensy/
  // DTS drivers, which clobbered the structured parse results above; the
  // loop is gone.
  return out;
}

// Walk an AnalogDevicesHardwareSupportModule.config XML string with DOMParser,
// returning { devices: [{ dacPrecision, offsetDAC0..2, channels: [...] }, ...] }.
// Missing/malformed fields fall back to defaults so older profiles round-trip
// cleanly without explicitly listing every value.
//
// Tolerates the casing inconsistency in Lightning's sample config: <DACPrecision>
// (canonical, matches the C# property name) vs <DacPrecision> (typo on Card #1
// in Lightning). We match either; the writer always emits the canonical form.
function parseAnalogDevicesConfig(xmlText) {
  const out = { devices: [] };
  if (!xmlText) return out;
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return out;
  }
  // If parsing failed, DOMParser returns a document containing a parsererror.
  if (doc.querySelector('parsererror')) return out;

  // Helper: case-insensitive direct-child element lookup.
  const childByName = (parent, name) => {
    if (!parent) return null;
    const lname = name.toLowerCase();
    for (const c of parent.children) {
      if (c.tagName.toLowerCase() === lname) return c;
    }
    return null;
  };
  const textOf = (el) => el ? (el.textContent || '').trim() : '';

  for (const deviceEl of doc.querySelectorAll('Devices > Device')) {
    const dev = adDefaultDevice();

    // <DACPrecision> — accept either casing.
    const precEl = childByName(deviceEl, 'DACPrecision') || childByName(deviceEl, 'DacPrecision');
    const precRaw = textOf(precEl);
    if (precRaw === 'FourteenBit' || precRaw === 'SixteenBit') {
      dev.dacPrecision = precRaw;
    }

    // Board-level <Calibration><OffsetDAC0/1/2>
    const calEl = childByName(deviceEl, 'Calibration');
    if (calEl) {
      dev.offsetDAC0 = adClamp(textOf(childByName(calEl, 'OffsetDAC0')), 16383, AD_DEVICE_DEFAULTS.offsetDAC0);
      dev.offsetDAC1 = adClamp(textOf(childByName(calEl, 'OffsetDAC1')), 16383, AD_DEVICE_DEFAULTS.offsetDAC1);
      dev.offsetDAC2 = adClamp(textOf(childByName(calEl, 'OffsetDAC2')), 16383, AD_DEVICE_DEFAULTS.offsetDAC2);
    }

    // <DACChannelConfig><DAC0>...<DAC39>
    const ccEl = childByName(deviceEl, 'DACChannelConfig');
    if (ccEl) {
      for (let c = 0; c < 40; c++) {
        const dacEl = childByName(ccEl, `DAC${c}`);
        if (!dacEl) continue;
        const ch = dev.channels[c];
        const chCal = childByName(dacEl, 'Calibration');
        if (chCal) {
          ch.offset = adClamp(textOf(childByName(chCal, 'Offset')), 65535, AD_CHANNEL_DEFAULTS.offset);
          ch.gain   = adClamp(textOf(childByName(chCal, 'Gain')),   65535, AD_CHANNEL_DEFAULTS.gain);
        }
        const chInit = childByName(dacEl, 'InitialState');
        if (chInit) {
          ch.dataValueA = adClamp(textOf(childByName(chInit, 'DataValueA')), 65535, AD_CHANNEL_DEFAULTS.dataValueA);
          ch.dataValueB = adClamp(textOf(childByName(chInit, 'DataValueB')), 65535, AD_CHANNEL_DEFAULTS.dataValueB);
        }
      }
    }

    out.devices.push(dev);
  }
  return out;
}

// Backfill any missing AD fields on an already-loaded p.drivers.analogdevices
// entry. Used after applyLoadedChain when an older profile has only `{}` device
// records, or when the user toggles AD on (defaultDevice produces `{}` and we
// need to inflate it). Idempotent: safe to call repeatedly.
function backfillAnalogDevicesDevices(decl) {
  if (!decl || !Array.isArray(decl.devices)) return;
  for (let i = 0; i < decl.devices.length; i++) {
    const dev = decl.devices[i] || {};
    if (dev.dacPrecision !== 'FourteenBit' && dev.dacPrecision !== 'SixteenBit') {
      dev.dacPrecision = AD_DEVICE_DEFAULTS.dacPrecision;
    }
    if (typeof dev.offsetDAC0 !== 'number') dev.offsetDAC0 = AD_DEVICE_DEFAULTS.offsetDAC0;
    if (typeof dev.offsetDAC1 !== 'number') dev.offsetDAC1 = AD_DEVICE_DEFAULTS.offsetDAC1;
    if (typeof dev.offsetDAC2 !== 'number') dev.offsetDAC2 = AD_DEVICE_DEFAULTS.offsetDAC2;
    if (!Array.isArray(dev.channels) || dev.channels.length !== 40) {
      dev.channels = Array.from({ length: 40 }, () => ({ ...AD_CHANNEL_DEFAULTS }));
    } else {
      for (let c = 0; c < 40; c++) {
        const ch = dev.channels[c] || {};
        if (typeof ch.offset !== 'number')     ch.offset     = AD_CHANNEL_DEFAULTS.offset;
        if (typeof ch.gain !== 'number')       ch.gain       = AD_CHANNEL_DEFAULTS.gain;
        if (typeof ch.dataValueA !== 'number') ch.dataValueA = AD_CHANNEL_DEFAULTS.dataValueA;
        if (typeof ch.dataValueB !== 'number') ch.dataValueB = AD_CHANNEL_DEFAULTS.dataValueB;
        dev.channels[c] = ch;
      }
    }
    decl.devices[i] = dev;
  }
}

// ── HenkSDI parser / backfill ────────────────────────────────────────────────
//
// Walk a henksdi.config XML string with DOMParser, returning
// `{ devices: [...] }` with each device fully populated.
//
// Tolerates two known typos in Lightning's hand-authored sample configs:
//   - <StatorBaseAngles> as alias for <StatorBaseAnglesConfig> (HenkADI's ROLL
//     SDI on line 177 of henksdi.config). XmlSerializer would silently drop the
//     misnamed element on read; we accept either name and always write the
//     canonical one on save.
//   - <ModeSettings xsi:type="SmoothModeSettings"> as alias for
//     "SmoothingModeSettings" (every sample has this typo). XmlSerializer
//     would actually fail to deserialize this — but every sample also has a
//     LimitModeSettings entry above it, and the C# property is single-valued,
//     so SimLinkup likely picks up the LimitModeSettings and ignores the
//     broken second one. We tolerate the typo on read and emit the canonical
//     "SmoothingModeSettings" on save.
function parseHenkSDIConfig(xmlText) {
  const out = { devices: [] };
  if (!xmlText) return out;
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return out;
  }
  if (doc.querySelector('parsererror')) return out;

  const childByName = (parent, name) => {
    if (!parent) return null;
    const lname = name.toLowerCase();
    for (const c of parent.children) {
      if (c.tagName.toLowerCase() === lname) return c;
    }
    return null;
  };
  const childByAnyName = (parent, names) => {
    if (!parent) return null;
    const lset = names.map(n => n.toLowerCase());
    for (const c of parent.children) {
      if (lset.includes(c.tagName.toLowerCase())) return c;
    }
    return null;
  };
  const textOf = (el) => el ? (el.textContent || '').trim() : '';
  const enumOrDefault = (raw, allowed, dflt) => allowed.includes(raw) ? raw : dflt;

  for (const deviceEl of doc.querySelectorAll('Devices > Device')) {
    const dev = henkSdiDefaultDevice();

    const addr = textOf(childByName(deviceEl, 'Address'));
    if (addr) dev.address = addr;
    const com = textOf(childByName(deviceEl, 'COMPort'));
    if (com) dev.comPort = com;
    dev.connectionType = enumOrDefault(
      textOf(childByName(deviceEl, 'ConnectionType')),
      HENKSDI_CONNECTION_VALUES, HENKSDI_DEVICE_DEFAULTS.connectionType,
    );
    dev.diagnosticLEDMode = enumOrDefault(
      textOf(childByName(deviceEl, 'DiagnosticLEDMode')),
      HENKSDI_DIAG_LED_VALUES, HENKSDI_DEVICE_DEFAULTS.diagnosticLEDMode,
    );
    dev.initialIndicatorPosition = intClamp(
      textOf(childByName(deviceEl, 'InitialIndicatorPosition')),
      0, 1023, HENKSDI_DEVICE_DEFAULTS.initialIndicatorPosition,
    );

    // <PowerDownConfig>
    const pd = childByName(deviceEl, 'PowerDownConfig');
    if (pd) {
      dev.powerDown.enabled = boolFromText(
        textOf(childByName(pd, 'Enabled')), HENKSDI_POWERDOWN_DEFAULTS.enabled);
      dev.powerDown.level = enumOrDefault(
        textOf(childByName(pd, 'Level')),
        HENKSDI_POWERDOWN_LEVEL_VALUES, HENKSDI_POWERDOWN_DEFAULTS.level);
      dev.powerDown.delayMs = intClamp(
        textOf(childByName(pd, 'DelayTimeMilliseconds')),
        0, 2016, HENKSDI_POWERDOWN_DEFAULTS.delayMs);
    }

    // <StatorBaseAnglesConfig> — also accept <StatorBaseAngles> for sample bug.
    const sb = childByAnyName(deviceEl, ['StatorBaseAnglesConfig', 'StatorBaseAngles']);
    if (sb) {
      dev.statorBaseAngles.s1 = intClamp(textOf(childByName(sb, 'S1BaseAngleDegrees')), 0, 359, HENKSDI_STATOR_DEFAULTS.s1);
      dev.statorBaseAngles.s2 = intClamp(textOf(childByName(sb, 'S2BaseAngleDegrees')), 0, 359, HENKSDI_STATOR_DEFAULTS.s2);
      dev.statorBaseAngles.s3 = intClamp(textOf(childByName(sb, 'S3BaseAngleDegrees')), 0, 359, HENKSDI_STATOR_DEFAULTS.s3);
    }

    // <MovementLimitsConfig>
    const ml = childByName(deviceEl, 'MovementLimitsConfig');
    if (ml) {
      dev.movementLimits.min = intClamp(textOf(childByName(ml, 'Min')), 0, 255, HENKSDI_LIMITS_DEFAULTS.min);
      dev.movementLimits.max = intClamp(textOf(childByName(ml, 'Max')), 0, 255, HENKSDI_LIMITS_DEFAULTS.max);
    }

    // <OutputChannelsConfig> — eight named child elements.
    const oc = childByName(deviceEl, 'OutputChannelsConfig');
    if (oc) {
      for (const name of HENKSDI_CHANNEL_NAMES) {
        const chEl = childByName(oc, name);
        if (!chEl) continue;
        const ch = dev.channels[name];
        if (name !== 'PWM_OUT') {
          // PWM_OUT has no Mode field in any sample; we hide the dropdown for
          // it and don't emit one on save, but we still default mode='Digital'
          // in case some future config has it.
          ch.mode = enumOrDefault(textOf(childByName(chEl, 'Mode')), HENKSDI_CHANNEL_MODE_VALUES, HENKSDI_CHANNEL_DEFAULTS.mode);
        }
        ch.initialValue = intClamp(textOf(childByName(chEl, 'InitialValue')), 0, 255, HENKSDI_CHANNEL_DEFAULTS.initialValue);
        const calEl = childByName(chEl, 'CalibrationData');
        if (calEl) {
          ch.calibration = [];
          for (const ptEl of calEl.children) {
            if (ptEl.tagName.toLowerCase() !== 'calibrationpoint') continue;
            const input  = floatClamp(textOf(childByName(ptEl, 'Input')),  0, 1,   0);
            const output = intClamp(  textOf(childByName(ptEl, 'Output')), 0, 255, 0);
            ch.calibration.push({ input, output });
          }
        }
      }
    }

    // <UpdateRateControlConfig>
    const urc = childByName(deviceEl, 'UpdateRateControlConfig');
    if (urc) {
      dev.updateRateControl.mode = enumOrDefault(
        textOf(childByName(urc, 'Mode')),
        HENKSDI_URC_MODE_VALUES, HENKSDI_URC_DEFAULTS.mode);
      dev.updateRateControl.stepUpdateDelayMillis = intClamp(
        textOf(childByName(urc, 'StepUpdateDelayMillis')), 8, 256,
        HENKSDI_URC_DEFAULTS.stepUpdateDelayMillis);
      dev.updateRateControl.useShortestPath = boolFromText(
        textOf(childByName(urc, 'UseShortestPath')),
        HENKSDI_URC_DEFAULTS.useShortestPath);

      // <ModeSettings> — possibly multiple, keyed by xsi:type. Real configs
      // sometimes carry both LimitModeSettings and (typo'd) SmoothModeSettings;
      // we read both into our state so toggling between modes preserves user
      // values, and only emit the active one on save.
      for (const ms of urc.children) {
        if (ms.tagName.toLowerCase() !== 'modesettings') continue;
        // The xsi: namespace declaration may not be on this element directly —
        // in well-formed DOM the attribute lookup needs the URI. Try the
        // namespaced form first, fall back to the bare attribute name.
        const t = ms.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type')
               || ms.getAttribute('xsi:type') || '';
        if (t === 'LimitModeSettings') {
          dev.updateRateControl.limitThreshold = intClamp(
            textOf(childByName(ms, 'LimitThreshold')), 0, 63, HENKSDI_URC_DEFAULTS.limitThreshold);
        } else if (t === 'SmoothingModeSettings' || t === 'SmoothModeSettings') {
          dev.updateRateControl.smoothing.minThreshold = intClamp(
            textOf(childByName(ms, 'SmoothingMinimumThreshold')),
            0, 15, HENKSDI_URC_DEFAULTS.smoothing.minThreshold);
          dev.updateRateControl.smoothing.mode = enumOrDefault(
            textOf(childByName(ms, 'SmoothingMode')),
            HENKSDI_URC_SMOOTHING_VALUES, HENKSDI_URC_DEFAULTS.smoothing.mode);
        }
      }
    }

    out.devices.push(dev);
  }
  return out;
}

// Backfill any missing HenkSDI fields on an already-loaded
// p.drivers.henksdi entry. Idempotent. Used after applyLoadedChain when an
// older profile has only `{ address }` device records (the pre-Phase-2 shape),
// or when the user toggles HenkSDI on freshly via the Hardware tab.
function backfillHenkSDIDevices(decl) {
  if (!decl || !Array.isArray(decl.devices)) return;
  for (let i = 0; i < decl.devices.length; i++) {
    const old = decl.devices[i] || {};
    const dev = henkSdiDefaultDevice();
    // Preserve every previously-set field. The address field is the only one
    // older profiles will have.
    if (typeof old.address === 'string' && old.address) dev.address = old.address;
    if (typeof old.comPort === 'string') dev.comPort = old.comPort;
    if (HENKSDI_CONNECTION_VALUES.includes(old.connectionType)) dev.connectionType = old.connectionType;
    if (HENKSDI_DIAG_LED_VALUES.includes(old.diagnosticLEDMode))  dev.diagnosticLEDMode = old.diagnosticLEDMode;
    if (typeof old.initialIndicatorPosition === 'number') dev.initialIndicatorPosition = old.initialIndicatorPosition;
    if (old.powerDown && typeof old.powerDown === 'object') {
      Object.assign(dev.powerDown, old.powerDown);
    }
    if (old.statorBaseAngles && typeof old.statorBaseAngles === 'object') {
      Object.assign(dev.statorBaseAngles, old.statorBaseAngles);
    }
    if (old.movementLimits && typeof old.movementLimits === 'object') {
      Object.assign(dev.movementLimits, old.movementLimits);
    }
    if (old.channels && typeof old.channels === 'object') {
      for (const name of HENKSDI_CHANNEL_NAMES) {
        if (old.channels[name]) {
          Object.assign(dev.channels[name], old.channels[name]);
          if (Array.isArray(old.channels[name].calibration)) {
            dev.channels[name].calibration = old.channels[name].calibration.slice();
          }
        }
      }
    }
    if (old.updateRateControl && typeof old.updateRateControl === 'object') {
      Object.assign(dev.updateRateControl, old.updateRateControl);
      if (old.updateRateControl.smoothing) {
        Object.assign(dev.updateRateControl.smoothing, old.updateRateControl.smoothing);
      }
    }
    decl.devices[i] = dev;
  }
}

// ── HenkQuadSinCos parser / backfill ─────────────────────────────────────────
//
// Walk a HenkieQuadSinCosHardwareSupportModule.config XML string with
// DOMParser, returning `{ devices: [{...}, ...] }`. Schema is small (4 fields
// per device) so this is a flat read.
function parseHenkQuadSinCosConfig(xmlText) {
  const out = { devices: [] };
  if (!xmlText) return out;
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return out;
  }
  if (doc.querySelector('parsererror')) return out;

  const childByName = (parent, name) => {
    if (!parent) return null;
    const lname = name.toLowerCase();
    for (const c of parent.children) {
      if (c.tagName.toLowerCase() === lname) return c;
    }
    return null;
  };
  const textOf = (el) => el ? (el.textContent || '').trim() : '';
  const enumOrDefault = (raw, allowed, dflt) => allowed.includes(raw) ? raw : dflt;

  for (const deviceEl of doc.querySelectorAll('Devices > Device')) {
    const dev = henkQuadSinCosDefaultDevice();
    const addr = textOf(childByName(deviceEl, 'Address'));
    if (addr) dev.address = addr;
    const com = textOf(childByName(deviceEl, 'COMPort'));
    if (com) dev.comPort = com;
    dev.connectionType = enumOrDefault(
      textOf(childByName(deviceEl, 'ConnectionType')),
      HENKSDI_CONNECTION_VALUES, HENKQSC_DEVICE_DEFAULTS.connectionType,
    );
    dev.diagnosticLEDMode = enumOrDefault(
      textOf(childByName(deviceEl, 'DiagnosticLEDMode')),
      HENKSDI_DIAG_LED_VALUES, HENKQSC_DEVICE_DEFAULTS.diagnosticLEDMode,
    );
    out.devices.push(dev);
  }
  return out;
}

// Backfill any missing HenkQuadSinCos fields on an already-loaded
// p.drivers.henkquadsincos entry. Idempotent. Inflates older `{ address }`-only
// records into the full 4-field schema.
function backfillHenkQuadSinCosDevices(decl) {
  if (!decl || !Array.isArray(decl.devices)) return;
  for (let i = 0; i < decl.devices.length; i++) {
    const old = decl.devices[i] || {};
    const dev = henkQuadSinCosDefaultDevice();
    if (typeof old.address === 'string' && old.address) dev.address = old.address;
    if (typeof old.comPort === 'string') dev.comPort = old.comPort;
    if (HENKSDI_CONNECTION_VALUES.includes(old.connectionType)) dev.connectionType = old.connectionType;
    if (HENKSDI_DIAG_LED_VALUES.includes(old.diagnosticLEDMode)) dev.diagnosticLEDMode = old.diagnosticLEDMode;
    decl.devices[i] = dev;
  }
}

// ── PHCC parser / backfill ───────────────────────────────────────────────────
//
// PhccHardwareSupportModule.config is a one-field pointer file that names the
// device-manager config (conventionally "phcc.config", living next to it in
// the profile dir). The C# class has no [XmlRoot] override, so the root
// element name is the class name itself: <PhccHardwareSupportModuleConfig>.
function parsePhccConfig(xmlText) {
  const out = { devices: [phccDefaultDevice()] };
  if (!xmlText) return out;
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return out;
  }
  if (doc.querySelector('parsererror')) return out;

  const childByName = (parent, name) => {
    if (!parent) return null;
    const lname = name.toLowerCase();
    for (const c of parent.children) {
      if (c.tagName.toLowerCase() === lname) return c;
    }
    return null;
  };
  const textOf = (el) => el ? (el.textContent || '').trim() : '';

  const root = doc.documentElement;
  if (!root) return out;
  const path = textOf(childByName(root, 'PhccDeviceManagerConfigFilePath'));
  if (path) out.devices[0].deviceManagerConfigFilePath = path;
  return out;
}

// Backfill any missing PHCC fields. Single-instance driver, so always exactly
// one device record. Idempotent.
function backfillPhccDevices(decl) {
  if (!decl) return;
  if (!Array.isArray(decl.devices) || decl.devices.length === 0) {
    decl.devices = [phccDefaultDevice()];
    return;
  }
  const old = decl.devices[0] || {};
  const dev = phccDefaultDevice();
  if (typeof old.deviceManagerConfigFilePath === 'string' && old.deviceManagerConfigFilePath) {
    dev.deviceManagerConfigFilePath = old.deviceManagerConfigFilePath;
  }
  decl.devices[0] = dev;
  // PHCC is single-instance; trim any stray extra entries from older state.
  if (decl.devices.length > 1) decl.devices.length = 1;
}

// ── ArduinoSeat parser / backfill ────────────────────────────────────────────
//
// Walk an ArduinoSeatHardwareSupportModule.config XML string with DOMParser,
// returning `{ devices: [{...}] }`. Single-instance driver — always exactly
// one device record. The C# class has no [XmlRoot] override so the root
// element name is the class name itself: <ArduinoSeatHardwareSupportModuleConfig>.
//
// Preserves duplicate <Output> IDs verbatim (the bundled sample profile has
// one — ArduinoSeat__GEAR_PANEL__GEAR_POSITION appears twice). The editor's
// UI flags duplicates so users can fix manually.
function parseArduinoSeatConfig(xmlText) {
  const out = { devices: [arduinoSeatDefaultDevice()] };
  if (!xmlText) return out;
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return out;
  }
  if (doc.querySelector('parsererror')) return out;

  const childByName = (parent, name) => {
    if (!parent) return null;
    const lname = name.toLowerCase();
    for (const c of parent.children) {
      if (c.tagName.toLowerCase() === lname) return c;
    }
    return null;
  };
  const textOf = (el) => el ? (el.textContent || '').trim() : '';
  const enumOrDefault = (raw, allowed, dflt) => allowed.includes(raw) ? raw : dflt;

  const root = doc.documentElement;
  if (!root) return out;
  const dev = arduinoSeatDefaultDevice();

  const com = textOf(childByName(root, 'COMPort'));
  if (com) dev.comPort = com;
  dev.motorByte1  = intClamp(textOf(childByName(root, 'MotorByte1')),  0, 255, ARDSEAT_DEVICE_DEFAULTS.motorByte1);
  dev.motorByte2  = intClamp(textOf(childByName(root, 'MotorByte2')),  0, 255, ARDSEAT_DEVICE_DEFAULTS.motorByte2);
  dev.motorByte3  = intClamp(textOf(childByName(root, 'MotorByte3')),  0, 255, ARDSEAT_DEVICE_DEFAULTS.motorByte3);
  dev.motorByte4  = intClamp(textOf(childByName(root, 'MotorByte4')),  0, 255, ARDSEAT_DEVICE_DEFAULTS.motorByte4);
  dev.forceSlight = intClamp(textOf(childByName(root, 'ForceSlight')), 0, 255, ARDSEAT_DEVICE_DEFAULTS.forceSlight);
  dev.forceRumble = intClamp(textOf(childByName(root, 'ForceRumble')), 0, 255, ARDSEAT_DEVICE_DEFAULTS.forceRumble);
  dev.forceMedium = intClamp(textOf(childByName(root, 'ForceMedium')), 0, 255, ARDSEAT_DEVICE_DEFAULTS.forceMedium);
  dev.forceHard   = intClamp(textOf(childByName(root, 'ForceHard')),   0, 255, ARDSEAT_DEVICE_DEFAULTS.forceHard);

  const seatOutputsEl = childByName(root, 'SeatOutputs');
  if (seatOutputsEl) {
    for (const outEl of seatOutputsEl.children) {
      if (outEl.tagName.toLowerCase() !== 'output') continue;
      const o = arduinoSeatDefaultOutput();
      o.id    = textOf(childByName(outEl, 'ID'));
      o.force = enumOrDefault(textOf(childByName(outEl, 'FORCE')), ARDSEAT_FORCE_VALUES, ARDSEAT_OUTPUT_DEFAULTS.force);
      o.type  = enumOrDefault(textOf(childByName(outEl, 'TYPE')),  ARDSEAT_PULSE_VALUES, ARDSEAT_OUTPUT_DEFAULTS.type);
      o.motor1 = boolFromText(textOf(childByName(outEl, 'MOTOR_1')), false);
      o.motor2 = boolFromText(textOf(childByName(outEl, 'MOTOR_2')), false);
      o.motor3 = boolFromText(textOf(childByName(outEl, 'MOTOR_3')), false);
      o.motor4 = boolFromText(textOf(childByName(outEl, 'MOTOR_4')), false);
      o.motor1Speed = intClamp(textOf(childByName(outEl, 'MOTOR_1_SPEED')), 0, 255, 0);
      o.motor2Speed = intClamp(textOf(childByName(outEl, 'MOTOR_2_SPEED')), 0, 255, 0);
      o.motor3Speed = intClamp(textOf(childByName(outEl, 'MOTOR_3_SPEED')), 0, 255, 0);
      o.motor4Speed = intClamp(textOf(childByName(outEl, 'MOTOR_4_SPEED')), 0, 255, 0);
      // MIN/MAX are doubles — Number() handles ints, decimals, and scientific.
      // We don't clamp them; the C# side treats them as arbitrary range markers.
      const minRaw = textOf(childByName(outEl, 'MIN'));
      const maxRaw = textOf(childByName(outEl, 'MAX'));
      o.min = (minRaw === '' || !Number.isFinite(Number(minRaw))) ? 0 : Number(minRaw);
      o.max = (maxRaw === '' || !Number.isFinite(Number(maxRaw))) ? 0 : Number(maxRaw);
      dev.seatOutputs.push(o);
    }
  }

  out.devices = [dev];
  return out;
}

// Backfill any missing ArduinoSeat fields. Single-instance, so always
// exactly one device record. Idempotent.
function backfillArduinoSeatDevices(decl) {
  if (!decl) return;
  if (!Array.isArray(decl.devices) || decl.devices.length === 0) {
    decl.devices = [arduinoSeatDefaultDevice()];
    return;
  }
  const old = decl.devices[0] || {};
  const dev = arduinoSeatDefaultDevice();
  if (typeof old.comPort === 'string') dev.comPort = old.comPort;
  if (typeof old.motorByte1 === 'number') dev.motorByte1 = old.motorByte1;
  if (typeof old.motorByte2 === 'number') dev.motorByte2 = old.motorByte2;
  if (typeof old.motorByte3 === 'number') dev.motorByte3 = old.motorByte3;
  if (typeof old.motorByte4 === 'number') dev.motorByte4 = old.motorByte4;
  if (typeof old.forceSlight === 'number') dev.forceSlight = old.forceSlight;
  if (typeof old.forceRumble === 'number') dev.forceRumble = old.forceRumble;
  if (typeof old.forceMedium === 'number') dev.forceMedium = old.forceMedium;
  if (typeof old.forceHard === 'number') dev.forceHard = old.forceHard;
  if (Array.isArray(old.seatOutputs)) {
    dev.seatOutputs = old.seatOutputs.map(o => {
      const n = arduinoSeatDefaultOutput();
      if (typeof o?.id === 'string') n.id = o.id;
      if (ARDSEAT_FORCE_VALUES.includes(o?.force)) n.force = o.force;
      if (ARDSEAT_PULSE_VALUES.includes(o?.type))  n.type  = o.type;
      n.motor1 = !!o?.motor1; n.motor2 = !!o?.motor2; n.motor3 = !!o?.motor3; n.motor4 = !!o?.motor4;
      if (typeof o?.motor1Speed === 'number') n.motor1Speed = o.motor1Speed;
      if (typeof o?.motor2Speed === 'number') n.motor2Speed = o.motor2Speed;
      if (typeof o?.motor3Speed === 'number') n.motor3Speed = o.motor3Speed;
      if (typeof o?.motor4Speed === 'number') n.motor4Speed = o.motor4Speed;
      if (typeof o?.min === 'number') n.min = o.min;
      if (typeof o?.max === 'number') n.max = o.max;
      return n;
    });
  }
  decl.devices[0] = dev;
  if (decl.devices.length > 1) decl.devices.length = 1;
}

// ── TeensyEWMU parser / backfill ─────────────────────────────────────────────
//
// Walk a TeensyEWMUHardwareSupportModule.config XML string with DOMParser,
// returning `{ devices: [{...}] }`. Single-instance driver — always exactly
// one device record. The C# class has no [XmlRoot] override so the root
// element name is the class name itself: <TeensyEWMUHardwareSupportModuleConfig>.
//
// Tolerates both on-disk shapes:
//   - Element form:   <Output><ID>...</ID><Invert>...</Invert></Output>
//                       (matches C# [XmlArrayItem("Output")])
//   - Attribute form: <DXOutput ID="..." Invert="..."/>
//                      (used by both bundled samples; does NOT match C# schema
//                       so SimLinkup runtime silently drops these entries)
// We accept either on read; the writer always emits canonical element form so
// the next save fixes the bundled-sample bug for that user automatically.
function parseTeensyEWMUConfig(xmlText) {
  const out = { devices: [teensyEwmuDefaultDevice()] };
  if (!xmlText) return out;
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return out;
  }
  if (doc.querySelector('parsererror')) return out;

  const childByName = (parent, name) => {
    if (!parent) return null;
    const lname = name.toLowerCase();
    for (const c of parent.children) {
      if (c.tagName.toLowerCase() === lname) return c;
    }
    return null;
  };
  const textOf = (el) => el ? (el.textContent || '').trim() : '';

  const root = doc.documentElement;
  if (!root) return out;
  const dev = teensyEwmuDefaultDevice();

  const com = textOf(childByName(root, 'COMPort'));
  if (com) dev.comPort = com;

  const dxEl = childByName(root, 'DXOutputs');
  if (dxEl) {
    for (const childEl of dxEl.children) {
      const tag = childEl.tagName.toLowerCase();
      if (tag === 'output' || tag === 'dxoutput') {
        const id = childEl.getAttribute('ID') || textOf(childByName(childEl, 'ID')) || '';
        const invertRaw = childEl.getAttribute('Invert') ?? textOf(childByName(childEl, 'Invert'));
        const invert = boolFromText(invertRaw, false);
        dev.dxOutputs.push({ id, invert });
      }
    }
  }

  out.devices = [dev];
  return out;
}

// Backfill any missing TeensyEWMU fields. Single-instance, so always exactly
// one device record. Idempotent.
function backfillTeensyEWMUDevices(decl) {
  if (!decl) return;
  if (!Array.isArray(decl.devices) || decl.devices.length === 0) {
    decl.devices = [teensyEwmuDefaultDevice()];
    return;
  }
  const old = decl.devices[0] || {};
  const dev = teensyEwmuDefaultDevice();
  if (typeof old.comPort === 'string') dev.comPort = old.comPort;
  if (Array.isArray(old.dxOutputs)) {
    dev.dxOutputs = old.dxOutputs.map(o => ({
      id: typeof o?.id === 'string' ? o.id : '',
      invert: !!o?.invert,
    }));
  }
  decl.devices[0] = dev;
  if (decl.devices.length > 1) decl.devices.length = 1;
}

// ── TeensyRWR parser / backfill ──────────────────────────────────────────────
//
// Walk a TeensyRWRHardwareSupportModule.config XML string with DOMParser.
// Single-instance driver. Root element is the class name itself
// (no [XmlRoot] override): <TeensyRWRHardwareSupportModuleConfig>.
//
// Calibration breakpoint format matches HenkSDI's <CalibrationData>:
// <CalibrationPoint><Input>...</Input><Output>...</Output></CalibrationPoint>.
// Both Input and Output are doubles (no clamp on the C# side).
function parseTeensyRWRConfig(xmlText) {
  const out = { devices: [teensyRwrDefaultDevice()] };
  if (!xmlText) return out;
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return out;
  }
  if (doc.querySelector('parsererror')) return out;

  const childByName = (parent, name) => {
    if (!parent) return null;
    const lname = name.toLowerCase();
    for (const c of parent.children) {
      if (c.tagName.toLowerCase() === lname) return c;
    }
    return null;
  };
  const textOf = (el) => el ? (el.textContent || '').trim() : '';
  const numOr = (raw, dflt) => {
    if (raw === '' || raw == null) return dflt;
    const n = Number(raw);
    return Number.isFinite(n) ? n : dflt;
  };

  const root = doc.documentElement;
  if (!root) return out;
  const dev = teensyRwrDefaultDevice();

  const com = textOf(childByName(root, 'COMPort'));
  if (com) dev.comPort = com;
  dev.rotationDegrees = numOr(textOf(childByName(root, 'RotationDegrees')), TRWR_DEVICE_DEFAULTS.rotationDegrees);
  dev.testPattern     = numOr(textOf(childByName(root, 'TestPattern')),     TRWR_DEVICE_DEFAULTS.testPattern);

  const centering = childByName(root, 'Centering');
  if (centering) {
    dev.centering.offsetX = numOr(textOf(childByName(centering, 'OffsetX')), TRWR_CENTERING_DEFAULTS.offsetX);
    dev.centering.offsetY = numOr(textOf(childByName(centering, 'OffsetY')), TRWR_CENTERING_DEFAULTS.offsetY);
  }
  const scaling = childByName(root, 'Scaling');
  if (scaling) {
    dev.scaling.scaleX = numOr(textOf(childByName(scaling, 'ScaleX')), TRWR_SCALING_DEFAULTS.scaleX);
    dev.scaling.scaleY = numOr(textOf(childByName(scaling, 'ScaleY')), TRWR_SCALING_DEFAULTS.scaleY);
  }

  // Calibration breakpoint tables. If the element exists and has children,
  // replace the default identity points entirely. If it's missing, defaults
  // (identity) stay.
  const readCalPoints = (parent) => {
    if (!parent) return null;
    const points = [];
    for (const childEl of parent.children) {
      if (childEl.tagName.toLowerCase() !== 'calibrationpoint') continue;
      points.push({
        input:  numOr(textOf(childByName(childEl, 'Input')),  0),
        output: numOr(textOf(childByName(childEl, 'Output')), 0),
      });
    }
    return points;
  };
  const xCal = readCalPoints(childByName(root, 'XAxisCalibrationData'));
  if (xCal) dev.xAxisCalibration = xCal;
  const yCal = readCalPoints(childByName(root, 'YAxisCalibrationData'));
  if (yCal) dev.yAxisCalibration = yCal;

  out.devices = [dev];
  return out;
}

// Backfill any missing TeensyRWR fields. Single-instance, so always exactly
// one device record. Idempotent.
function backfillTeensyRWRDevices(decl) {
  if (!decl) return;
  if (!Array.isArray(decl.devices) || decl.devices.length === 0) {
    decl.devices = [teensyRwrDefaultDevice()];
    return;
  }
  const old = decl.devices[0] || {};
  const dev = teensyRwrDefaultDevice();
  if (typeof old.comPort === 'string') dev.comPort = old.comPort;
  if (typeof old.rotationDegrees === 'number') dev.rotationDegrees = old.rotationDegrees;
  if (typeof old.testPattern === 'number') dev.testPattern = old.testPattern;
  if (old.centering && typeof old.centering === 'object') {
    if (typeof old.centering.offsetX === 'number') dev.centering.offsetX = old.centering.offsetX;
    if (typeof old.centering.offsetY === 'number') dev.centering.offsetY = old.centering.offsetY;
  }
  if (old.scaling && typeof old.scaling === 'object') {
    if (typeof old.scaling.scaleX === 'number') dev.scaling.scaleX = old.scaling.scaleX;
    if (typeof old.scaling.scaleY === 'number') dev.scaling.scaleY = old.scaling.scaleY;
  }
  if (Array.isArray(old.xAxisCalibration)) {
    dev.xAxisCalibration = old.xAxisCalibration.map(p => ({
      input:  typeof p?.input  === 'number' ? p.input  : 0,
      output: typeof p?.output === 'number' ? p.output : 0,
    }));
  }
  if (Array.isArray(old.yAxisCalibration)) {
    dev.yAxisCalibration = old.yAxisCalibration.map(p => ({
      input:  typeof p?.input  === 'number' ? p.input  : 0,
      output: typeof p?.output === 'number' ? p.output : 0,
    }));
  }
  decl.devices[0] = dev;
  if (decl.devices.length > 1) decl.devices.length = 1;
}

// ── TeensyVectorDrawing parser / backfill ────────────────────────────────────
//
// Almost identical to TeensyRWR's parser, with a DeviceType enum field
// (RWR/HUD/HMS) inserted after COMPort. Defaults match the C# class's field
// initialisers: DeviceType=RWR, Centering=0/0, Scaling=1/1.
function parseTeensyVectorDrawingConfig(xmlText) {
  const out = { devices: [teensyVectorDrawingDefaultDevice()] };
  if (!xmlText) return out;
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return out;
  }
  if (doc.querySelector('parsererror')) return out;

  const childByName = (parent, name) => {
    if (!parent) return null;
    const lname = name.toLowerCase();
    for (const c of parent.children) {
      if (c.tagName.toLowerCase() === lname) return c;
    }
    return null;
  };
  const textOf = (el) => el ? (el.textContent || '').trim() : '';
  const numOr = (raw, dflt) => {
    if (raw === '' || raw == null) return dflt;
    const n = Number(raw);
    return Number.isFinite(n) ? n : dflt;
  };
  const enumOrDefault = (raw, allowed, dflt) => allowed.includes(raw) ? raw : dflt;

  const root = doc.documentElement;
  if (!root) return out;
  const dev = teensyVectorDrawingDefaultDevice();

  const com = textOf(childByName(root, 'COMPort'));
  if (com) dev.comPort = com;
  dev.deviceType      = enumOrDefault(textOf(childByName(root, 'DeviceType')), TVD_DEVICE_TYPE_VALUES, TVD_DEVICE_DEFAULTS.deviceType);
  dev.rotationDegrees = numOr(textOf(childByName(root, 'RotationDegrees')), TVD_DEVICE_DEFAULTS.rotationDegrees);
  dev.testPattern     = numOr(textOf(childByName(root, 'TestPattern')),     TVD_DEVICE_DEFAULTS.testPattern);

  const centering = childByName(root, 'Centering');
  if (centering) {
    dev.centering.offsetX = numOr(textOf(childByName(centering, 'OffsetX')), TRWR_CENTERING_DEFAULTS.offsetX);
    dev.centering.offsetY = numOr(textOf(childByName(centering, 'OffsetY')), TRWR_CENTERING_DEFAULTS.offsetY);
  }
  const scaling = childByName(root, 'Scaling');
  if (scaling) {
    dev.scaling.scaleX = numOr(textOf(childByName(scaling, 'ScaleX')), TRWR_SCALING_DEFAULTS.scaleX);
    dev.scaling.scaleY = numOr(textOf(childByName(scaling, 'ScaleY')), TRWR_SCALING_DEFAULTS.scaleY);
  }

  const readCalPoints = (parent) => {
    if (!parent) return null;
    const points = [];
    for (const childEl of parent.children) {
      if (childEl.tagName.toLowerCase() !== 'calibrationpoint') continue;
      points.push({
        input:  numOr(textOf(childByName(childEl, 'Input')),  0),
        output: numOr(textOf(childByName(childEl, 'Output')), 0),
      });
    }
    return points;
  };
  const xCal = readCalPoints(childByName(root, 'XAxisCalibrationData'));
  if (xCal) dev.xAxisCalibration = xCal;
  const yCal = readCalPoints(childByName(root, 'YAxisCalibrationData'));
  if (yCal) dev.yAxisCalibration = yCal;

  out.devices = [dev];
  return out;
}

function backfillTeensyVectorDrawingDevices(decl) {
  if (!decl) return;
  if (!Array.isArray(decl.devices) || decl.devices.length === 0) {
    decl.devices = [teensyVectorDrawingDefaultDevice()];
    return;
  }
  const old = decl.devices[0] || {};
  const dev = teensyVectorDrawingDefaultDevice();
  if (typeof old.comPort === 'string') dev.comPort = old.comPort;
  if (TVD_DEVICE_TYPE_VALUES.includes(old.deviceType)) dev.deviceType = old.deviceType;
  if (typeof old.rotationDegrees === 'number') dev.rotationDegrees = old.rotationDegrees;
  if (typeof old.testPattern === 'number') dev.testPattern = old.testPattern;
  if (old.centering && typeof old.centering === 'object') {
    if (typeof old.centering.offsetX === 'number') dev.centering.offsetX = old.centering.offsetX;
    if (typeof old.centering.offsetY === 'number') dev.centering.offsetY = old.centering.offsetY;
  }
  if (old.scaling && typeof old.scaling === 'object') {
    if (typeof old.scaling.scaleX === 'number') dev.scaling.scaleX = old.scaling.scaleX;
    if (typeof old.scaling.scaleY === 'number') dev.scaling.scaleY = old.scaling.scaleY;
  }
  if (Array.isArray(old.xAxisCalibration)) {
    dev.xAxisCalibration = old.xAxisCalibration.map(p => ({
      input:  typeof p?.input  === 'number' ? p.input  : 0,
      output: typeof p?.output === 'number' ? p.output : 0,
    }));
  }
  if (Array.isArray(old.yAxisCalibration)) {
    dev.yAxisCalibration = old.yAxisCalibration.map(p => ({
      input:  typeof p?.input  === 'number' ? p.input  : 0,
      output: typeof p?.output === 'number' ? p.output : 0,
    }));
  }
  decl.devices[0] = dev;
  if (decl.devices.length > 1) decl.devices.length = 1;
}

// ── NiclasMorin DTS Card parser / backfill ───────────────────────────────────
//
// Multi-device driver. XML root is <DTSCard> ([XmlRoot] override on the C#
// class). Each <Device> carries:
//   - <Serial>...</Serial>       — string; mapped to dev.address in editor state
//   - <DeadZone><FromDegrees>...</FromDegrees><ToDegrees>...</ToDegrees></DeadZone>
//                                  optional; absent in some sample devices,
//                                  defaults to 0/0 when missing
//   - <CalibrationData>            array of <CalibrationPoint><Input>...</Input>
//                                  <Output>...</Output></CalibrationPoint> entries
//                                  Input is the sim value, Output is the
//                                  synchro angle in degrees.
function parseNiclasMorinDTSConfig(xmlText) {
  const out = { devices: [] };
  if (!xmlText) return out;
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return out;
  }
  if (doc.querySelector('parsererror')) return out;

  const childByName = (parent, name) => {
    if (!parent) return null;
    const lname = name.toLowerCase();
    for (const c of parent.children) {
      if (c.tagName.toLowerCase() === lname) return c;
    }
    return null;
  };
  const textOf = (el) => el ? (el.textContent || '').trim() : '';
  const numOr = (raw, dflt) => {
    if (raw === '' || raw == null) return dflt;
    const n = Number(raw);
    return Number.isFinite(n) ? n : dflt;
  };

  for (const deviceEl of doc.querySelectorAll('Devices > Device')) {
    const dev = niclasMorinDtsDefaultDevice();
    const serial = textOf(childByName(deviceEl, 'Serial'));
    if (serial) dev.address = serial;

    const dzEl = childByName(deviceEl, 'DeadZone');
    if (dzEl) {
      dev.deadZone.fromDegrees = numOr(textOf(childByName(dzEl, 'FromDegrees')), NMDTS_DEADZONE_DEFAULTS.fromDegrees);
      dev.deadZone.toDegrees   = numOr(textOf(childByName(dzEl, 'ToDegrees')),   NMDTS_DEADZONE_DEFAULTS.toDegrees);
    }

    const calEl = childByName(deviceEl, 'CalibrationData');
    if (calEl) {
      dev.calibrationData = [];
      for (const ptEl of calEl.children) {
        if (ptEl.tagName.toLowerCase() !== 'calibrationpoint') continue;
        dev.calibrationData.push({
          input:  numOr(textOf(childByName(ptEl, 'Input')),  0),
          output: numOr(textOf(childByName(ptEl, 'Output')), 0),
        });
      }
    }

    out.devices.push(dev);
  }
  return out;
}

// Backfill any missing NiclasMorinDTS fields. Multi-device, so iterates the
// list. Idempotent.
function backfillNiclasMorinDTSDevices(decl) {
  if (!decl || !Array.isArray(decl.devices)) return;
  for (let i = 0; i < decl.devices.length; i++) {
    const old = decl.devices[i] || {};
    const dev = niclasMorinDtsDefaultDevice();
    if (typeof old.address === 'string' && old.address) dev.address = old.address;
    if (old.deadZone && typeof old.deadZone === 'object') {
      if (typeof old.deadZone.fromDegrees === 'number') dev.deadZone.fromDegrees = old.deadZone.fromDegrees;
      if (typeof old.deadZone.toDegrees === 'number') dev.deadZone.toDegrees = old.deadZone.toDegrees;
    }
    if (Array.isArray(old.calibrationData)) {
      dev.calibrationData = old.calibrationData.map(p => ({
        input:  typeof p?.input  === 'number' ? p.input  : 0,
        output: typeof p?.output === 'number' ? p.output : 0,
      }));
    }
    decl.devices[i] = dev;
  }
}

// ── PoKeys parser / backfill ─────────────────────────────────────────────────
//
// Walk a PoKeysHardwareSupportModule.config XML string with DOMParser,
// returning `{ devices: [{ address, name, pwmPeriodMicroseconds,
// digitalOutputs: [{pin, invert}], pwmOutputs: [{channel}] }, ...] }`.
//
// The on-disk schema uses <Serial> per device; the editor's state
// stores it as `address` (matching the address-shape convention used
// by HenkSDI/NiclasMorinDTS) so the existing Mappings-tab driver-
// channel picker plumbing reads it via the same code path.
function parsePoKeysConfig(xmlText) {
  const out = { devices: [] };
  if (!xmlText) return out;
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return out;
  }
  if (doc.querySelector('parsererror')) return out;

  const childByName = (parent, name) => {
    if (!parent) return null;
    const lname = name.toLowerCase();
    for (const c of parent.children) {
      if (c.tagName.toLowerCase() === lname) return c;
    }
    return null;
  };
  const textOf = (el) => el ? (el.textContent || '').trim() : '';
  const intOr = (raw, dflt) => {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : dflt;
  };
  const boolOr = (raw, dflt) => {
    if (raw === 'true' || raw === 'True' || raw === '1') return true;
    if (raw === 'false' || raw === 'False' || raw === '0') return false;
    return dflt;
  };

  for (const deviceEl of doc.querySelectorAll('Devices > Device')) {
    const dev = poKeysDefaultDevice();
    const serial = textOf(childByName(deviceEl, 'Serial'));
    if (serial) dev.address = serial;
    const name = textOf(childByName(deviceEl, 'Name'));
    if (name) dev.name = name;
    const period = intOr(textOf(childByName(deviceEl, 'PWMPeriodMicroseconds')),
                         POKEYS_DEVICE_DEFAULTS.pwmPeriodMicroseconds);
    if (period > 0) dev.pwmPeriodMicroseconds = period;

    const digOutsEl = childByName(deviceEl, 'DigitalOutputs');
    if (digOutsEl) {
      for (const outEl of digOutsEl.children) {
        if (outEl.tagName !== 'Output') continue;
        const pin = intOr(textOf(childByName(outEl, 'Pin')), 0);
        if (pin < 1 || pin > 55) continue;
        dev.digitalOutputs.push({
          pin,
          invert: boolOr(textOf(childByName(outEl, 'Invert')),
                         POKEYS_DIGITAL_OUTPUT_DEFAULTS.invert),
        });
      }
    }
    const pwmOutsEl = childByName(deviceEl, 'PWMOutputs');
    if (pwmOutsEl) {
      for (const outEl of pwmOutsEl.children) {
        if (outEl.tagName !== 'Output') continue;
        const channel = intOr(textOf(childByName(outEl, 'Channel')), 0);
        if (channel < 1 || channel > 6) continue;
        dev.pwmOutputs.push({ channel });
      }
    }
    out.devices.push(dev);
  }
  return out;
}

// Backfill any missing PoKeys fields on an already-loaded
// p.drivers.pokeys_digital entry. Idempotent. Inflates older
// `{ address }`-only records into the full schema.
function backfillPoKeysDevices(decl) {
  if (!decl || !Array.isArray(decl.devices)) return;
  for (let i = 0; i < decl.devices.length; i++) {
    const old = decl.devices[i] || {};
    const dev = poKeysDefaultDevice();
    if (typeof old.address === 'string' && old.address) dev.address = old.address;
    if (typeof old.name === 'string') dev.name = old.name;
    if (typeof old.pwmPeriodMicroseconds === 'number' && old.pwmPeriodMicroseconds > 0) {
      dev.pwmPeriodMicroseconds = old.pwmPeriodMicroseconds;
    }
    if (Array.isArray(old.digitalOutputs)) {
      dev.digitalOutputs = old.digitalOutputs
        .filter(o => o && Number.isFinite(o.pin) && o.pin >= 1 && o.pin <= 55)
        .map(o => ({ pin: o.pin, invert: o.invert !== false }));
    }
    if (Array.isArray(old.pwmOutputs)) {
      dev.pwmOutputs = old.pwmOutputs
        .filter(o => o && Number.isFinite(o.channel) && o.channel >= 1 && o.channel <= 6)
        .map(o => ({ channel: o.channel }));
    }
    decl.devices[i] = dev;
  }
}
