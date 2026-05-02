// ── Per-gauge calibration config XML I/O ─────────────────────────────────────
//
// Round-trip read/write for Simtek<digits>HardwareSupportModule.config files.
// Schema is the four-pattern union defined in calibration-defaults.js — today
// only the 'piecewise' kind has an editor in the Calibration tab, but the
// parser/writer round-trip every kind so files survive across editor versions
// even before the matching editors land.
//
// File naming: matches the [XmlRoot(nameof(<ModuleClass>))] convention used
// by the two existing consumed configs (Simtek100285HardwareSupportModuleConfig.cs,
// Simtek100294HardwareSupportModuleConfig.cs). Filename is
// "Simtek<digits>HardwareSupportModule.config"; XML root is the bare class
// short name (e.g. "Simtek100207HardwareSupportModule").
//
// The two configs SimLinkup actually consumes today (10-0285 baro range,
// 10-0294 max fuel) use a DIFFERENT schema — bare double/uint? properties at
// the root, not the <Channels> structure here. Those PNs are deliberately
// absent from GAUGE_CALIBRATION_DEFAULTS, so this module never touches their
// files.

// Per-PN filename overrides for the few gauges where the unified-schema
// calibration file deliberately has a name distinct from the gauge's
// existing legacy config (so the two can coexist without colliding).
//
// HenkieF16FuelFlow: the legacy gauge HSM consumes
// HenkieF16FuelFlowIndicator.config (with stator angles, DIG_OUT init values,
// AND the calibration table). The unified-schema file ships separately as
// HenkieF16FuelFlowHardwareSupportModule.config (no "Indicator" suffix) so
// the patched SimLinkup HSM can read calibration from there while the
// existing file continues to own stator/DIG_OUT/identity. See the fork
// branch simlinkup-editor-support for the matching HSM patch.
const GAUGE_CONFIG_FILENAME_OVERRIDES = {
  'HenkieF16FuelFlow': 'HenkieF16FuelFlowHardwareSupportModule.config',
};

// Build the file basename for a gauge from its catalog `cls`. Returns null
// for gauges whose schema isn't authored by this editor.
function gaugeConfigFilenameForPn(pn) {
  if (GAUGE_CONFIG_FILENAME_OVERRIDES[pn]) return GAUGE_CONFIG_FILENAME_OVERRIDES[pn];
  const inst = INSTRUMENTS.find(i => i.pn === pn);
  if (!inst || !inst.cls) return null;
  // Last segment of the class FQN, e.g. "Simtek100207HardwareSupportModule".
  const shortName = inst.cls.split('.').pop();
  if (!shortName) return null;
  return `${shortName}.config`;
}

// Inverse: given a filename like "Simtek100207HardwareSupportModule.config",
// return the matching catalog PN, or null. Used by the loader to map an
// on-disk file back to a known gauge.
function gaugePnForConfigFilename(filename) {
  if (!filename) return null;
  // Override map first — covers the gauges that use a non-cls-derived name.
  for (const [pn, fname] of Object.entries(GAUGE_CONFIG_FILENAME_OVERRIDES)) {
    if (filename === fname) return pn;
  }
  const m = filename.match(/^(.*HardwareSupportModule)\.config$/);
  if (!m) return null;
  const shortName = m[1];
  for (const inst of INSTRUMENTS) {
    if (inst.cls && inst.cls.endsWith('.' + shortName)) return inst.pn;
  }
  return null;
}

// Render an XML string for one gauge's config. `entry` is
// `p.gaugeConfigs[pn]` (or a default produced by cloneGaugeCalibrationDefault).
// XML root element name = the gauge HSM class short name.
//
// We always emit every channel's full transform shape so a hand-edit that
// adds a missing field doesn't surprise the next save. Missing channels in
// `entry` are filled from the spec-sheet defaults.
function renderGaugeConfigXml(pn, entry) {
  const inst = INSTRUMENTS.find(i => i.pn === pn);
  if (!inst || !inst.cls) return null;
  // Root element name = the unified-schema filename (without ".config")
  // when an override exists, otherwise the gauge HSM's class short name.
  // For HenkieF16FuelFlow this gives <HenkieF16FuelFlowHardwareSupportModule>
  // instead of <HenkieF16FuelFlowIndicatorHardwareSupportModule>, since the
  // unified schema file lives alongside the legacy Indicator file rather
  // than replacing it.
  const overrideFilename = GAUGE_CONFIG_FILENAME_OVERRIDES[pn];
  const root = overrideFilename
    ? overrideFilename.replace(/\.config$/, '')
    : inst.cls.split('.').pop();
  const tpl = gaugeCalibrationDefaultsFor(pn);
  if (!tpl) return null;

  const lines = [
    '<?xml version="1.0"?>',
    `<${root} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">`,
    '  <Channels>',
  ];

  for (const tplCh of tpl.channels) {
    const ch = (entry?.channels || []).find(c => c && c.id === tplCh.id) || tplCh;
    // Same kind-drift defense as the parser: when the live entry's kind
    // disagrees with the template's, prefer the template. Kind is
    // structural — defined by the gauge file, not a user-edited value —
    // so a parsed entry with a stale kind from an older save shouldn't
    // dictate what we write on the next save.
    const kind = (tplCh.kind && ch.kind && ch.kind !== tplCh.kind)
      ? tplCh.kind
      : (ch.kind || tplCh.kind || 'piecewise');

    // Resolver-style transforms (kind=resolver, kind=piecewise_resolver,
    // kind=multi_resolver) carry role + partner attributes on the Transform
    // tag. The SIN channel of a pair carries the full transform body; the
    // COS channel carries an empty body with role="cos" partnerChannel="<sin-id>"
    // pointing back. The HSM reads transform parameters off the SIN channel.
    let transformOpen = `      <Transform kind="${escXml(kind)}"`;
    if (kind === 'resolver' || kind === 'piecewise_resolver' || kind === 'multi_resolver') {
      const role = ch.role || tplCh.role || 'sin';
      transformOpen += ` role="${escXml(role)}"`;
      const partner = ch.partnerChannel || tplCh.partnerChannel;
      if (partner) transformOpen += ` partnerChannel="${escXml(partner)}"`;
    }
    transformOpen += '>';

    lines.push(`    <Channel id="${escXml(tplCh.id)}">`);
    lines.push(transformOpen);
    if (kind === 'piecewise') {
      const bps = (ch.breakpoints && ch.breakpoints.length) ? ch.breakpoints : tplCh.breakpoints;
      // Emit `volts` for the standard volts-output gauges (32 today) and
      // `output` for raw-DAC-output gauges (Henkie family). Both round-trip
      // through parseGaugeConfigXml. The on-disk attribute follows what the
      // SimLinkup-side HSM expects to read.
      const meta = piecewiseOutputMeta(tplCh);
      lines.push('        <Breakpoints>');
      for (const bp of bps) {
        const v = bp[meta.attr];
        lines.push(`          <Point input="${formatNum(bp.input)}" ${meta.attr}="${formatNum(v)}"/>`);
      }
      lines.push('        </Breakpoints>');
    } else if (kind === 'linear') {
      // Linear range: emit InputMin/InputMax. Falls back to template values
      // if the live entry hasn't supplied them (e.g. a freshly defaulted
      // entry written before the user touched the editor).
      const inputMin = (typeof ch.inputMin === 'number') ? ch.inputMin : tplCh.inputMin;
      const inputMax = (typeof ch.inputMax === 'number') ? ch.inputMax : tplCh.inputMax;
      if (typeof inputMin === 'number') lines.push(`        <InputMin>${formatNum(inputMin)}</InputMin>`);
      if (typeof inputMax === 'number') lines.push(`        <InputMax>${formatNum(inputMax)}</InputMax>`);
    } else if (kind === 'resolver') {
      // Resolver: only the SIN channel carries the body. COS gets just the
      // role+partner attributes (already in transformOpen above) and an
      // empty <Transform> element.
      const role = ch.role || tplCh.role || 'sin';
      if (role === 'sin') {
        // Pull transform values from the SIN channel record. Fall back to
        // template defaults for any missing field.
        const inputMin = (typeof ch.inputMin === 'number') ? ch.inputMin : tplCh.inputMin;
        const inputMax = (typeof ch.inputMax === 'number') ? ch.inputMax : tplCh.inputMax;
        const angleMin = (typeof ch.angleMinDegrees === 'number') ? ch.angleMinDegrees : tplCh.angleMinDegrees;
        const angleMax = (typeof ch.angleMaxDegrees === 'number') ? ch.angleMaxDegrees : tplCh.angleMaxDegrees;
        const peakVolts = (typeof ch.peakVolts === 'number') ? ch.peakVolts : tplCh.peakVolts;
        const belowMin = ch.belowMinBehavior || tplCh.belowMinBehavior;
        if (typeof inputMin === 'number') lines.push(`        <InputMin>${formatNum(inputMin)}</InputMin>`);
        if (typeof inputMax === 'number') lines.push(`        <InputMax>${formatNum(inputMax)}</InputMax>`);
        if (typeof angleMin === 'number') lines.push(`        <AngleMinDegrees>${formatNum(angleMin)}</AngleMinDegrees>`);
        if (typeof angleMax === 'number') lines.push(`        <AngleMaxDegrees>${formatNum(angleMax)}</AngleMaxDegrees>`);
        if (typeof peakVolts === 'number') lines.push(`        <PeakVolts>${formatNum(peakVolts)}</PeakVolts>`);
        if (belowMin) lines.push(`        <BelowMinBehavior>${escXml(belowMin)}</BelowMinBehavior>`);
      }
    } else if (kind === 'piecewise_resolver') {
      // Piecewise resolver: SIN side carries the breakpoint table (input →
      // angle in degrees) plus PeakVolts. COS side is empty body + pointer
      // back. Used by ADI-style gauges where the synchro angle is a
      // non-linear function of input (10-1084 ADI pitch is the founding
      // case). Each <Point> uses `angle` instead of `volts`.
      const role = ch.role || tplCh.role || 'sin';
      if (role === 'sin') {
        const bps = (ch.breakpoints && ch.breakpoints.length) ? ch.breakpoints : tplCh.breakpoints;
        const peakVolts = (typeof ch.peakVolts === 'number') ? ch.peakVolts : tplCh.peakVolts;
        if (bps && bps.length) {
          lines.push('        <Breakpoints>');
          for (const bp of bps) {
            lines.push(`          <Point input="${formatNum(bp.input)}" angle="${formatNum(bp.angle)}"/>`);
          }
          lines.push('        </Breakpoints>');
        }
        if (typeof peakVolts === 'number') lines.push(`        <PeakVolts>${formatNum(peakVolts)}</PeakVolts>`);
      }
    } else if (kind === 'multi_resolver') {
      // Multi-turn resolver: SIN side carries UnitsPerRevolution + PeakVolts.
      // COS side is empty body + pointer back. The synchro wraps cleanly
      // across many revolutions; the runtime computes
      //   angle = (input / unitsPerRevolution) × 360°
      // then sin/cos × peakVolts.
      const role = ch.role || tplCh.role || 'sin';
      if (role === 'sin') {
        const unitsPerRevolution = (typeof ch.unitsPerRevolution === 'number')
          ? ch.unitsPerRevolution
          : tplCh.unitsPerRevolution;
        const peakVolts = (typeof ch.peakVolts === 'number') ? ch.peakVolts : tplCh.peakVolts;
        if (typeof unitsPerRevolution === 'number') lines.push(`        <UnitsPerRevolution>${formatNum(unitsPerRevolution)}</UnitsPerRevolution>`);
        if (typeof peakVolts === 'number') lines.push(`        <PeakVolts>${formatNum(peakVolts)}</PeakVolts>`);
      }
    }
    // Other kinds (multi_resolver, cross_coupled, digital_invert): schema
    // reserved or partially implemented. digital_invert has no Transform body
    // — the Invert element below the Transform carries its single field.
    // multi_resolver and cross_coupled are stubs awaiting their editors.
    lines.push('      </Transform>');
    // digital_invert: emit the <Invert> bool. Trim fields don't apply to
    // digital channels — emit them only for analog kinds to keep the file
    // tidy.
    if (kind === 'digital_invert') {
      const invert = (typeof ch.invert === 'boolean') ? ch.invert : !!tplCh.invert;
      lines.push(`      <Invert>${invert ? 'true' : 'false'}</Invert>`);
    } else {
      // Trim fields are volts-specific (zero offset in V, scale unitless).
      // DAC-output channels (Henkie family) don't have a trim layer — their
      // calibration table IS the final DAC output. Skip the trim block to
      // keep the on-disk file matching the SimLinkup-side schema.
      const isVoltsKind = (kind !== 'piecewise') ||
        (piecewiseOutputMeta(tplCh).unit === 'volts');
      if (isVoltsKind) {
        lines.push(`      <ZeroTrimVolts>${formatNum(ch.zeroTrim ?? CALIBRATION_TRIM_DEFAULTS.zeroTrim)}</ZeroTrimVolts>`);
        lines.push(`      <GainTrim>${formatNum(ch.gainTrim ?? CALIBRATION_TRIM_DEFAULTS.gainTrim)}</GainTrim>`);
      }
      // Cross-coupling pointer — emitted on any channel whose output
      // feeds into another's coupling math. The C# loader uses this to
      // know "this piecewise table produces a reference voltage that
      // gets cross-combined, not a direct DAC output."
      const coupledTo = ch.coupledTo || tplCh.coupledTo;
      if (coupledTo) lines.push(`      <CoupledTo>${escXml(coupledTo)}</CoupledTo>`);

      // Caged-rest behaviour for standby ADI resolver pairs. Only emit
      // when the user has opted in (CagedRestEnabled = true). The C#
      // HSM defaults the range to ±20° pitch / ±40° roll when the
      // min/max aren't explicit; we still emit them when the user
      // edited a value so the file is self-describing. See
      // GaugeChannelConfig.CagedRestEnabled in the C# schema.
      const cagedEnabled = (typeof ch.cagedRestEnabled === 'boolean')
        ? ch.cagedRestEnabled
        : tplCh.cagedRestEnabled;
      if (typeof cagedEnabled === 'boolean') {
        lines.push(`      <CagedRestEnabled>${cagedEnabled ? 'true' : 'false'}</CagedRestEnabled>`);
      }
      const cagedMin = (typeof ch.cagedRestRangeMinDegrees === 'number')
        ? ch.cagedRestRangeMinDegrees
        : tplCh.cagedRestRangeMinDegrees;
      if (typeof cagedMin === 'number') {
        lines.push(`      <CagedRestRangeMinDegrees>${formatNum(cagedMin)}</CagedRestRangeMinDegrees>`);
      }
      const cagedMax = (typeof ch.cagedRestRangeMaxDegrees === 'number')
        ? ch.cagedRestRangeMaxDegrees
        : tplCh.cagedRestRangeMaxDegrees;
      if (typeof cagedMax === 'number') {
        lines.push(`      <CagedRestRangeMaxDegrees>${formatNum(cagedMax)}</CagedRestRangeMaxDegrees>`);
      }

      // HiddenOutput: value driven when a digital visibility flag inhibits
      // this analog channel. Only meaningful for channels whose template
      // declares supportsHiddenOutput (today: Henk F-16 ADI Support Board's
      // two command bars). Emit when the user has set or accepted a value;
      // the C# HSM falls back to its hardcoded park position when absent.
      const hiddenOutput = (typeof ch.hiddenOutput === 'number')
        ? ch.hiddenOutput
        : tplCh.hiddenOutput;
      if (typeof hiddenOutput === 'number') {
        lines.push(`      <HiddenOutput>${formatNum(hiddenOutput)}</HiddenOutput>`);
      }
    }
    lines.push('    </Channel>');
  }

  lines.push('  </Channels>');

  // Legacy 10-0294 fuel quantity compatibility: bare <MaxPoundsTotalFuel>
  // at the document root is the linear-rescale denominator for the counter
  // output in older SimLinkup builds. Subsumed by the editor's piecewise
  // table (just edit the last counter breakpoint's input) when <Channels>
  // is populated; round-tripped here so installs running older builds keep
  // working with the bare field.
  const lmpt = entry?.legacyMaxPoundsTotalFuel;
  if (typeof lmpt === 'number') {
    lines.push(`  <MaxPoundsTotalFuel>${formatNum(lmpt)}</MaxPoundsTotalFuel>`);
  }

  // Legacy 10-0285 altimeter compatibility: when a config file existed on
  // disk before this editor knew about the gauge, it carried four bare baro
  // fields at the document root (MinBaroPressureInHg, MaxBaroPressureInHg,
  // IndicatedAltitudeDifferenceInFeetFromMinBaroToMaxBaro, AltitudeZeroOffsetInFeet).
  // Newer SimLinkup builds bypass them when <Channels> is populated, but we
  // preserve them on disk so users running older SimLinkup builds keep their
  // tuning. The "Remove from file" button in the editor card clears
  // entry.legacyBaro to drop them on the next save.
  const lb = entry?.legacyBaro;
  if (lb && (
        typeof lb.minBaroPressureInHg === 'number' ||
        typeof lb.maxBaroPressureInHg === 'number' ||
        typeof lb.indicatedAltitudeDifferenceInFeetFromMinBaroToMaxBaro === 'number' ||
        typeof lb.altitudeZeroOffsetInFeet === 'number'
      )) {
    if (typeof lb.minBaroPressureInHg === 'number') {
      lines.push(`  <MinBaroPressureInHg>${formatNum(lb.minBaroPressureInHg)}</MinBaroPressureInHg>`);
    }
    if (typeof lb.maxBaroPressureInHg === 'number') {
      lines.push(`  <MaxBaroPressureInHg>${formatNum(lb.maxBaroPressureInHg)}</MaxBaroPressureInHg>`);
    }
    if (typeof lb.indicatedAltitudeDifferenceInFeetFromMinBaroToMaxBaro === 'number') {
      lines.push(`  <IndicatedAltitudeDifferenceInFeetFromMinBaroToMaxBaro>${formatNum(lb.indicatedAltitudeDifferenceInFeetFromMinBaroToMaxBaro)}</IndicatedAltitudeDifferenceInFeetFromMinBaroToMaxBaro>`);
    }
    if (typeof lb.altitudeZeroOffsetInFeet === 'number') {
      lines.push(`  <AltitudeZeroOffsetInFeet>${formatNum(lb.altitudeZeroOffsetInFeet)}</AltitudeZeroOffsetInFeet>`);
    }
  }

  lines.push(`</${root}>`);
  return lines.join('\n');
}

// Number formatting: voltages and inputs as plain decimals (no exponent, no
// scientific notation). Trims trailing zeroes but keeps at least one digit
// after the decimal point if the value isn't an integer. Matches the
// hand-authored sample style ("28.09", "2800", "0").
function formatNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  if (Number.isInteger(v)) return String(v);
  // 6 decimals is plenty for voltages and inputs; trim trailing zeros.
  return v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

// Parse a Simtek<digits>HardwareSupportModule.config XML string into the
// p.gaugeConfigs[pn] shape: `{ channels: [{ id, kind, breakpoints, zeroTrim,
// gainTrim }, ...] }`. Returns null if the document is malformed; missing
// fields fall back to the spec-sheet defaults for that channel.
function parseGaugeConfigXml(xmlText, pn) {
  if (!xmlText) return null;
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  } catch {
    return null;
  }
  if (doc.querySelector('parsererror')) return null;

  const tpl = gaugeCalibrationDefaultsFor(pn);
  if (!tpl) return null;

  // Walk channels by template ID so the result mirrors the template even if
  // the on-disk file is missing some channels (older editor versions, or a
  // hand-edit that dropped a channel).
  const out = { channels: [] };
  const channelEls = doc.querySelectorAll('Channels > Channel');
  const byId = new Map();
  for (const el of channelEls) byId.set(el.getAttribute('id') || '', el);

  for (const tplCh of tpl.channels) {
    const el = byId.get(tplCh.id);
    if (!el) {
      // Channel missing on disk — fall back to defaults. Carry whichever
      // optional fields the template supplies (kind-specific) so the
      // shape stays valid downstream.
      const fallback = {
        id: tplCh.id,
        kind: tplCh.kind,
        // Carry breakpoints with whichever output attribute the kind uses
        // (volts for piecewise/volts, output for piecewise/dac, angle for
        // piecewise_resolver).
        breakpoints: (tplCh.breakpoints || []).map(bp => {
          const out = { input: bp.input };
          if (typeof bp.volts === 'number') out.volts = bp.volts;
          if (typeof bp.output === 'number') out.output = bp.output;
          if (typeof bp.angle === 'number') out.angle = bp.angle;
          return out;
        }),
        zeroTrim: tplCh.zeroTrim ?? CALIBRATION_TRIM_DEFAULTS.zeroTrim,
        gainTrim: tplCh.gainTrim ?? CALIBRATION_TRIM_DEFAULTS.gainTrim,
      };
      if (typeof tplCh.inputMin === 'number') fallback.inputMin = tplCh.inputMin;
      if (typeof tplCh.inputMax === 'number') fallback.inputMax = tplCh.inputMax;
      if (typeof tplCh.angleMinDegrees === 'number') fallback.angleMinDegrees = tplCh.angleMinDegrees;
      if (typeof tplCh.angleMaxDegrees === 'number') fallback.angleMaxDegrees = tplCh.angleMaxDegrees;
      if (typeof tplCh.peakVolts === 'number') fallback.peakVolts = tplCh.peakVolts;
      if (tplCh.belowMinBehavior) fallback.belowMinBehavior = tplCh.belowMinBehavior;
      if (tplCh.role) fallback.role = tplCh.role;
      if (tplCh.partnerChannel) fallback.partnerChannel = tplCh.partnerChannel;
      if (typeof tplCh.unitsPerRevolution === 'number') fallback.unitsPerRevolution = tplCh.unitsPerRevolution;
      if (typeof tplCh.invert === 'boolean') fallback.invert = tplCh.invert;
      if (tplCh.coupledTo) fallback.coupledTo = tplCh.coupledTo;
      out.channels.push(fallback);
      continue;
    }
    const xform = el.querySelector('Transform');
    // Kind drift defense: when the on-disk kind doesn't match what the
    // template declares for this channel id, prefer the template. This
    // handles auto-migration when a gauge ships a new kind (e.g. 10-0194
    // Mach moving from 'cross_coupled' to 'piecewise') — old saved files
    // with the stale kind get rewritten to the new one on next save
    // without losing the user's other edits. Kind is structural, not a
    // user-tuned value, so silently converting is the right call.
    const fileKind = xform?.getAttribute('kind');
    const kind = (tplCh.kind && fileKind && fileKind !== tplCh.kind)
      ? tplCh.kind
      : (fileKind || tplCh.kind || 'piecewise');
    let breakpoints;
    let inputMin, inputMax;
    let angleMinDegrees, angleMaxDegrees, peakVolts, belowMinBehavior;
    let role, partnerChannel;
    let invert;
    let unitsPerRevolution;
    if (kind === 'piecewise') {
      // Breakpoint Point attribute: `volts` for AnalogDevices-driven gauges
      // (32 today) and `output` for raw-DAC gauges (Henkie family). The
      // template tells us which the channel uses; on disk we accept either.
      const meta = piecewiseOutputMeta(tplCh);
      const points = xform?.querySelectorAll('Breakpoints > Point') || [];
      if (points.length >= 2) {
        breakpoints = [];
        for (const pt of points) {
          const i = Number(pt.getAttribute('input'));
          // Try the channel's expected attribute first, fall back to the
          // other name for forward-compatibility / typo recovery.
          let raw = pt.getAttribute(meta.attr);
          if (raw === null || raw === '') raw = pt.getAttribute(meta.attr === 'volts' ? 'output' : 'volts');
          const v = Number(raw);
          if (Number.isFinite(i) && Number.isFinite(v)) {
            const bp = { input: i };
            bp[meta.attr] = v;
            breakpoints.push(bp);
          }
        }
      }
    } else if (kind === 'piecewise_resolver') {
      // Each <Point> uses `angle` instead of `volts`. SIN side carries the
      // table; COS side has no body. Round-trip captures role+partner on
      // both sides.
      role = xform?.getAttribute('role') || tplCh.role;
      partnerChannel = xform?.getAttribute('partnerChannel') || tplCh.partnerChannel;
      const points = xform?.querySelectorAll('Breakpoints > Point') || [];
      if (points.length >= 2) {
        breakpoints = [];
        for (const pt of points) {
          const i = Number(pt.getAttribute('input'));
          const a = Number(pt.getAttribute('angle'));
          if (Number.isFinite(i) && Number.isFinite(a)) {
            breakpoints.push({ input: i, angle: a });
          }
        }
      }
      const peakEl = xform?.querySelector('PeakVolts');
      const peakRaw = peakEl ? Number((peakEl.textContent || '').trim()) : NaN;
      peakVolts = Number.isFinite(peakRaw) ? peakRaw : tplCh.peakVolts;
    } else if (kind === 'multi_resolver') {
      // SIN side carries UnitsPerRevolution + PeakVolts; COS side is empty.
      role = xform?.getAttribute('role') || tplCh.role;
      partnerChannel = xform?.getAttribute('partnerChannel') || tplCh.partnerChannel;
      const unitsEl = xform?.querySelector('UnitsPerRevolution');
      const peakEl = xform?.querySelector('PeakVolts');
      const unitsRaw = unitsEl ? Number((unitsEl.textContent || '').trim()) : NaN;
      const peakRaw = peakEl ? Number((peakEl.textContent || '').trim()) : NaN;
      unitsPerRevolution = Number.isFinite(unitsRaw) ? unitsRaw : tplCh.unitsPerRevolution;
      peakVolts = Number.isFinite(peakRaw) ? peakRaw : tplCh.peakVolts;
    } else if (kind === 'digital_invert') {
      // No transform body. The <Invert> element lives outside the Transform
      // (sibling to ZeroTrimVolts in analog channels) — read it from the
      // Channel element directly below.
    } else if (kind === 'linear') {
      const minEl = xform?.querySelector('InputMin');
      const maxEl = xform?.querySelector('InputMax');
      const minRaw = minEl ? Number((minEl.textContent || '').trim()) : NaN;
      const maxRaw = maxEl ? Number((maxEl.textContent || '').trim()) : NaN;
      inputMin = Number.isFinite(minRaw) ? minRaw : tplCh.inputMin;
      inputMax = Number.isFinite(maxRaw) ? maxRaw : tplCh.inputMax;
    } else if (kind === 'resolver') {
      // Resolver: SIN channel carries the body, COS just role + partner.
      // For round-trip we capture role+partner on both, and the transform
      // body fields only when present (will be on the SIN side).
      role = xform?.getAttribute('role') || tplCh.role;
      partnerChannel = xform?.getAttribute('partnerChannel') || tplCh.partnerChannel;
      const num = (sel, fallback) => {
        const e = xform?.querySelector(sel);
        if (!e) return fallback;
        const n = Number((e.textContent || '').trim());
        return Number.isFinite(n) ? n : fallback;
      };
      const txt = (sel, fallback) => {
        const e = xform?.querySelector(sel);
        if (!e) return fallback;
        const s = (e.textContent || '').trim();
        return s || fallback;
      };
      inputMin         = num('InputMin',         tplCh.inputMin);
      inputMax         = num('InputMax',         tplCh.inputMax);
      angleMinDegrees  = num('AngleMinDegrees',  tplCh.angleMinDegrees);
      angleMaxDegrees  = num('AngleMaxDegrees',  tplCh.angleMaxDegrees);
      peakVolts        = num('PeakVolts',        tplCh.peakVolts);
      belowMinBehavior = txt('BelowMinBehavior', tplCh.belowMinBehavior);
    }
    if (!breakpoints || breakpoints.length < 2) {
      // Fall back to template breakpoints, preserving whichever output
      // attribute the kind expects (volts for piecewise/volts, output for
      // piecewise/dac, angle for piecewise_resolver).
      breakpoints = (tplCh.breakpoints || []).map(bp => {
        const out = { input: bp.input };
        if (typeof bp.volts === 'number') out.volts = bp.volts;
        if (typeof bp.output === 'number') out.output = bp.output;
        if (typeof bp.angle === 'number') out.angle = bp.angle;
        return out;
      });
    }
    // <Invert> sits at Channel level (sibling to ZeroTrimVolts). Read it
    // for digital_invert channels; ignored for other kinds.
    if (kind === 'digital_invert') {
      const invEl = el.querySelector(':scope > Invert');
      if (invEl) {
        const t = (invEl.textContent || '').trim().toLowerCase();
        if (t === 'true' || t === 'false') invert = (t === 'true');
      }
      if (typeof invert !== 'boolean') invert = !!tplCh.invert;
    }
    const zeroEl = el.querySelector('ZeroTrimVolts');
    const gainEl = el.querySelector('GainTrim');
    const coupledEl = el.querySelector(':scope > CoupledTo');
    const zeroRaw = zeroEl ? Number((zeroEl.textContent || '').trim()) : NaN;
    const gainRaw = gainEl ? Number((gainEl.textContent || '').trim()) : NaN;
    const coupledTo = coupledEl ? (coupledEl.textContent || '').trim() : (tplCh.coupledTo || '');

    // Caged-rest fields (only emitted by standby ADI resolver pairs;
    // absent on every other gauge, in which case all three reads
    // return NaN/null and the parsed entry simply doesn't carry them).
    const cagedEnabledEl = el.querySelector(':scope > CagedRestEnabled');
    const cagedMinEl     = el.querySelector(':scope > CagedRestRangeMinDegrees');
    const cagedMaxEl     = el.querySelector(':scope > CagedRestRangeMaxDegrees');
    let cagedRestEnabled;
    if (cagedEnabledEl) {
      const t = (cagedEnabledEl.textContent || '').trim().toLowerCase();
      if (t === 'true' || t === 'false') cagedRestEnabled = (t === 'true');
    }
    const cagedMinRaw = cagedMinEl ? Number((cagedMinEl.textContent || '').trim()) : NaN;
    const cagedMaxRaw = cagedMaxEl ? Number((cagedMaxEl.textContent || '').trim()) : NaN;

    // HiddenOutput field for flag-gated analog channels. Absent on every
    // gauge except Henk F-16 ADI Support Board's two command bars.
    const hiddenOutputEl = el.querySelector(':scope > HiddenOutput');
    const hiddenOutputRaw = hiddenOutputEl
      ? Number((hiddenOutputEl.textContent || '').trim())
      : NaN;

    const parsed = {
      id: tplCh.id,
      kind,
      breakpoints,
      zeroTrim: Number.isFinite(zeroRaw) ? zeroRaw : (tplCh.zeroTrim ?? CALIBRATION_TRIM_DEFAULTS.zeroTrim),
      gainTrim: Number.isFinite(gainRaw) ? gainRaw : (tplCh.gainTrim ?? CALIBRATION_TRIM_DEFAULTS.gainTrim),
    };
    if (typeof inputMin === 'number') parsed.inputMin = inputMin;
    if (typeof inputMax === 'number') parsed.inputMax = inputMax;
    if (typeof angleMinDegrees === 'number') parsed.angleMinDegrees = angleMinDegrees;
    if (typeof angleMaxDegrees === 'number') parsed.angleMaxDegrees = angleMaxDegrees;
    if (typeof peakVolts === 'number') parsed.peakVolts = peakVolts;
    if (belowMinBehavior) parsed.belowMinBehavior = belowMinBehavior;
    if (role) parsed.role = role;
    if (partnerChannel) parsed.partnerChannel = partnerChannel;
    if (typeof unitsPerRevolution === 'number') parsed.unitsPerRevolution = unitsPerRevolution;
    if (typeof invert === 'boolean') parsed.invert = invert;
    if (coupledTo) parsed.coupledTo = coupledTo;
    if (typeof cagedRestEnabled === 'boolean') parsed.cagedRestEnabled = cagedRestEnabled;
    if (Number.isFinite(cagedMinRaw)) parsed.cagedRestRangeMinDegrees = cagedMinRaw;
    if (Number.isFinite(cagedMaxRaw)) parsed.cagedRestRangeMaxDegrees = cagedMaxRaw;
    if (Number.isFinite(hiddenOutputRaw)) parsed.hiddenOutput = hiddenOutputRaw;
    out.channels.push(parsed);
  }

  // Legacy 10-0285 baro fields at the document root. Read whichever are
  // present and stash them on entry.legacyBaro for round-trip. Other gauges
  // never have these elements, so this code is a no-op for them.
  const root = doc.documentElement;
  if (root) {
    const numChild = (name) => {
      const el = root.querySelector(`:scope > ${name}`);
      if (!el) return undefined;
      const n = Number((el.textContent || '').trim());
      return Number.isFinite(n) ? n : undefined;
    };
    const minBaro = numChild('MinBaroPressureInHg');
    const maxBaro = numChild('MaxBaroPressureInHg');
    const altDiff = numChild('IndicatedAltitudeDifferenceInFeetFromMinBaroToMaxBaro');
    const altZero = numChild('AltitudeZeroOffsetInFeet');
    if (minBaro !== undefined || maxBaro !== undefined ||
        altDiff !== undefined || altZero !== undefined) {
      out.legacyBaro = {};
      if (minBaro !== undefined) out.legacyBaro.minBaroPressureInHg = minBaro;
      if (maxBaro !== undefined) out.legacyBaro.maxBaroPressureInHg = maxBaro;
      if (altDiff !== undefined) out.legacyBaro.indicatedAltitudeDifferenceInFeetFromMinBaroToMaxBaro = altDiff;
      if (altZero !== undefined) out.legacyBaro.altitudeZeroOffsetInFeet = altZero;
    }

    // 10-0294 fuel quantity: bare <MaxPoundsTotalFuel> field. Round-trip
    // for back-compat with older SimLinkup builds; the editor's piecewise
    // counter table subsumes its function.
    const maxLbs = numChild('MaxPoundsTotalFuel');
    if (maxLbs !== undefined) {
      out.legacyMaxPoundsTotalFuel = maxLbs;
    }
  }

  return out;
}

// Walk the loaded `driverConfigs` map (filename → text from main.js's
// load-profile) and pull out every Simtek<digits>HardwareSupportModule.config
// that maps to a gauge in GAUGE_CALIBRATION_DEFAULTS. Returns
//   { gaugeConfigs:    { [pn]: { channels: [...] } },
//     gaugeConfigsRaw: { [filename]: text } }
//
// Files for gauges we don't yet have defaults for (or that fail to parse) get
// stashed in `gaugeConfigsRaw` so a save round-trip can preserve them — that's
// future-proofing for when the editor learns more gauges.
function parseGaugeConfigs(driverConfigs) {
  const gaugeConfigs = {};
  const gaugeConfigsRaw = {};
  if (!driverConfigs) return { gaugeConfigs, gaugeConfigsRaw };

  for (const [filename, text] of Object.entries(driverConfigs)) {
    if (!/HardwareSupportModule\.config$/i.test(filename)) continue;
    // Skip the AnalogDevices and other already-handled output-driver files.
    if (filename === 'AnalogDevicesHardwareSupportModule.config') continue;
    if (filename === 'HenkieQuadSinCosHardwareSupportModule.config') continue;
    if (filename === 'PhccHardwareSupportModule.config') continue;
    if (filename === 'ArduinoSeatHardwareSupportModule.config') continue;
    if (filename === 'DTSCardHardwareSupportModule.config') continue;
    if (filename === 'TeensyEWMUHardwareSupportModule.config') continue;
    if (filename === 'TeensyRWRHardwareSupportModule.config') continue;
    if (filename === 'TeensyVectorDrawingHardwareSupportModule.config') continue;
    if (filename === 'PoKeysHardwareSupportModule.config') continue;
    // Only files that match a catalog PN we know how to calibrate get parsed
    // into structured state. Everything else round-trips as raw text.
    const pn = gaugePnForConfigFilename(filename);
    if (pn && gaugeCalibrationDefaultsFor(pn)) {
      const parsed = parseGaugeConfigXml(text, pn);
      if (parsed) {
        gaugeConfigs[pn] = parsed;
        continue;
      }
    }
    gaugeConfigsRaw[filename] = text;
  }
  return { gaugeConfigs, gaugeConfigsRaw };
}
