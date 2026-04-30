// ── XML parsing & chain model ────────────────────────────────────────────────
//
// A profile's mapping files describe a two-stage chain:
//   stage 1:   F4_*        →  Gauge HSM input port    (e.g. 100207_RPM_From_Sim)
//   stage 2:   Gauge output → Output driver port      (e.g. AnalogDevices_AD536x/537x__DAC_OUTPUT[0][11]
//                                                          or HenkSDI[0x32]__PWM_OUT)
//
// `parseMappingsFromXml` returns a chain { edges, instruments } where:
//   - `edges` is 1:1 with <SignalMapping> rows, each annotated with stage and
//     parsed src/dst details. This is the round-trip-safe representation.
//   - `instruments` is a per-gauge view grouping each instrument's input edges
//     and its output edges into logical outputGroups (matching INSTRUMENTS
//     metadata where available). Used by the Signal Mappings tab UI to render
//     pattern-aware editors (e.g. resolver pairs as a unit).

// Build a map from "digit prefix" → array of known instruments using that
// prefix. Most prefixes map to exactly one instrument; 10-0207 and 10-0207_110
// share prefix "100207" and disambiguation happens at parse time using
// registry context.
function buildInstrumentPrefixMap() {
  const m = new Map();
  for (const inst of INSTRUMENTS) {
    const prefix = inst.digitPrefix || inst.pn.replace(/-/g, '');
    if (!m.has(prefix)) m.set(prefix, []);
    m.get(prefix).push(inst);
  }
  return m;
}

// Build the set of valid port suffixes for a given instrument, derived from
// its inputPorts and outputGroups metadata.
function knownPortsForInstrument(inst) {
  const ports = new Set();
  for (const p of (inst.inputPorts || [])) ports.add(p.port);
  for (const g of (inst.outputGroups || [])) {
    for (const p of (g.ports || [])) ports.add(p.port);
  }
  return ports;
}

// Try to interpret an id as a gauge HSM port. Returns { pn, port, known } or
// null. When multiple instruments share a digit prefix and `declaredPns` is
// provided, prefer an instrument whose PN is in that set. Otherwise return
// the first match (stable order).
//
// Recognises both Simtek-style numeric prefixes (`100207_RPM_From_Sim`) and
// named gauge HSMs (`HenkF16ADISupportBoard_Pitch_From_Sim`,
// `Henk_F16_HSI_Board1__Bearing_From_Sim`). For unknown gauges we still return
// the raw prefix as `pn` so the chain doesn't drop them on the floor.
//
// Self-healing: an earlier version of the editor saved IDs like
// "100207_110_RPM_From_Sim" (PN suffix tacked into the port). When the
// extracted port doesn't match any known port on the resolved instrument, we
// try stripping a leading "<garbage>_" segment and re-checking. If that
// matches, we accept the cleaned port — the edge will round-trip back to the
// correct ID on the next save.
function parseGaugePort(id, instrumentPrefixMap, declaredPns) {
  // Numeric-prefix Simtek/AMI/Astronautics-style: "<digits>_<port>"
  const numMatch = id.match(/^(\d{4,})_(.+)$/);
  if (numMatch) {
    const prefix = numMatch[1];
    let port = numMatch[2];
    const candidates = instrumentPrefixMap.get(prefix);
    if (!candidates || candidates.length === 0) {
      return { pn: prefix, port, known: false };
    }
    // Disambiguate by registry context if available, otherwise pick the first.
    let inst = candidates[0];
    if (declaredPns && candidates.length > 1) {
      const declared = candidates.find(c => declaredPns.has(c.pn));
      if (declared) inst = declared;
    }
    // Self-heal malformed IDs: if `port` doesn't match any known port on the
    // resolved instrument, try stripping a leading "<x>_" segment.
    const known = knownPortsForInstrument(inst);
    if (!known.has(port)) {
      const stripped = port.replace(/^[^_]+_/, '');
      if (stripped !== port && known.has(stripped)) port = stripped;
    }
    return { pn: inst.pn, port, known: true };
  }
  // Named gauge HSMs we know about (matched longest-first).
  const namedPrefixes = [
    'HenkF16ADISupportBoard',
    'HenkieF16Altimeter',
    'HenkieF16FuelFlow',
    'Henk_F16_HSI_Board1',
    'Henk_F16_HSI_Board2',
    'HS070D51341',
    'JDLADI01',
  ];
  for (const prefix of namedPrefixes) {
    if (id.startsWith(prefix + '_')) {
      return { pn: prefix, port: id.slice(prefix.length + 1), known: false };
    }
    if (id.startsWith(prefix + '__')) {
      return { pn: prefix, port: id.slice(prefix.length + 2), known: false };
    }
  }
  return null;
}

// Parse a destination id into one of:
//   { kind: 'driver', driver, device, channel }
//   { kind: 'gauge',  pn, port, known }
//   { kind: 'unknown' }
function parseDestination(id, instrumentPrefixMap, declaredPns) {
  for (const dp of DRIVER_PATTERNS) {
    const m = id.match(dp.re);
    if (m) return { kind: 'driver', driver: dp.driver, ...dp.parse(m) };
  }
  const gauge = parseGaugePort(id, instrumentPrefixMap, declaredPns);
  if (gauge) return { kind: 'gauge', ...gauge };
  return { kind: 'unknown' };
}

// Classify a single mapping row. Pure function — no side effects.
function classifyMapping(src, dst, kind, instrumentPrefixMap, declaredPns) {
  const dstParsed = parseDestination(dst, instrumentPrefixMap, declaredPns);
  const srcGauge = parseGaugePort(src, instrumentPrefixMap, declaredPns);

  let stage = 'unknown';
  if (src.startsWith('F4_')) stage = 1;
  else if (srcGauge && dstParsed.kind === 'driver') stage = 2;
  else if (srcGauge && dstParsed.kind === 'gauge') stage = '1.5';

  return {
    src, dst, stage, kind,
    srcGaugePn:   srcGauge?.pn   ?? null,
    srcGaugePort: srcGauge?.port ?? null,
    dstKind:           dstParsed.kind,
    dstGaugePn:        dstParsed.kind === 'gauge'  ? dstParsed.pn      : null,
    dstGaugePort:      dstParsed.kind === 'gauge'  ? dstParsed.port    : null,
    dstDriver:         dstParsed.kind === 'driver' ? dstParsed.driver  : null,
    dstDriverDevice:   dstParsed.kind === 'driver' ? dstParsed.device  : null,
    dstDriverChannel:  dstParsed.kind === 'driver' ? dstParsed.channel : null,
  };
}

// Build the per-instrument view. Walks `edges` and:
//   - groups stage-1 inputs by destination gauge PN
//   - groups stage-2 outputs by source gauge PN, then matches each output port
//     against the gauge's `outputGroups` metadata to produce logical groups
//     (resolver pairs, linear singles, etc.).
function buildInstrumentView(edges, instrumentPrefixMap) {
  const byPn = new Map();
  const ensure = pn => {
    if (!byPn.has(pn)) {
      const meta = INSTRUMENTS.find(i => i.pn === pn) || null;
      byPn.set(pn, { pn, meta, inputs: [], outputGroups: [], raw: [] });
    }
    return byPn.get(pn);
  };

  edges.forEach((e, edgeIdx) => {
    if (e.stage === 1 && e.dstKind === 'gauge' && e.dstGaugePn) {
      const inst = ensure(e.dstGaugePn);
      inst.inputs.push({
        f4Source: e.src, hsmInput: e.dstGaugePort, kind: e.kind, edgeIdx,
      });
    } else if (e.stage === 2 && e.srcGaugePn) {
      const inst = ensure(e.srcGaugePn);
      // Match the source port against the gauge's outputGroups.
      const meta = inst.meta;
      let placed = false;
      if (meta && meta.outputGroups) {
        for (const groupTpl of meta.outputGroups) {
          const portTpl = groupTpl.ports.find(p => p.port === e.srcGaugePort);
          if (!portTpl) continue;
          // Find or create the runtime group.
          let group = inst.outputGroups.find(g => g._tpl === groupTpl);
          if (!group) {
            group = {
              _tpl: groupTpl,
              kind: groupTpl.kind, label: groupTpl.label,
              channels: groupTpl.ports.map(p => ({
                role: p.role, hsmOutput: p.port, kind: p.kind,
                edgeIdx: null, dstDriver: null, dstDriverDevice: null, dstDriverChannel: null,
              })),
            };
            inst.outputGroups.push(group);
          }
          const ch = group.channels.find(c => c.role === portTpl.role);
          ch.edgeIdx = edgeIdx;
          ch.dstDriver = e.dstDriver;
          ch.dstDriverDevice = e.dstDriverDevice;
          ch.dstDriverChannel = e.dstDriverChannel;
          placed = true;
          break;
        }
      }
      if (!placed) inst.raw.push({ edgeIdx, src: e.src, dst: e.dst, role: 'output' });
    } else if (e.stage === '1.5') {
      // Gauge-to-gauge wiring (rare). Attach to the source gauge's raw list.
      const inst = ensure(e.srcGaugePn);
      inst.raw.push({ edgeIdx, src: e.src, dst: e.dst, role: 'gauge-to-gauge' });
    }
    // Truly unknown rows aren't attributed to any instrument; they live only
    // in `edges` and surface in a profile-level "raw" view.
  });

  return Array.from(byPn.values());
}

// Parse mapping XML files into the chain model.
//
// `declaredPns` is an optional Set of gauge PNs declared by the profile
// (derived from HardwareSupportModule.registry on load). It's used to
// disambiguate digit-prefix collisions: 10-0207 and 10-0207_110 both emit
// port IDs prefixed "100207_", so when both classes are theoretically known,
// the parser uses the registry to pick the right gauge entry. Without it,
// the first-defined match wins.
//
// When a single profile registers BOTH colliding classes (legal but unusual),
// the per-file context is also used: edges in `Simtek100207_110*.mapping` are
// attributed to 10-0207_110, edges in `Simtek100207<rest>.mapping` (without
// `_110` after the digits) are attributed to 10-0207.
function parseMappingsFromXml(fileList, declaredPns) {
  const prefixMap = buildInstrumentPrefixMap();
  const edges = [];
  // Capture which on-disk file each PN's mappings came from. Used at save
  // time to preserve user/sample filenames (e.g. Nigel's
  // "Lilbern3321rpm.mapping" or his pair of
  // "Malwin19581hydraulicPressureA.mapping" + "...PressureB.mapping" for
  // the same gauge PN) instead of regenerating a fresh name, which would
  // orphan the original and trigger the sweep-on-save deletion in
  // main.js.
  //
  // Per-PN list of {filename, ports}. `ports` is the set of gauge port
  // names (input + output) referenced by edges in that file. At save
  // time we distribute current edges across the legacy files based on
  // port-name matching: each gauge port routes to whichever legacy
  // file claimed it. New ports added since load (e.g. user wired a
  // previously-unwired output) go into the first legacy file as a
  // safe default.
  const filesByPn = {};
  for (const { file, content } of fileList) {
    // Per-file PN preference: if the filename matches a known gauge's class
    // short name, restrict ambiguous resolutions to that gauge.
    const filePns = pnsForFilename(file);
    const effectivePns = filePns.size > 0 ? filePns : declaredPns;

    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/xml');
    const nodes = doc.querySelectorAll('SignalMapping');
    // Track which gauge ports appear in this file, grouped by PN.
    const portsByPn = new Map();
    nodes.forEach(node => {
      const srcEl = node.querySelector('Source');
      const dstEl = node.querySelector('Destination');
      const src = srcEl?.querySelector('Id')?.textContent?.trim() || '';
      const dst = dstEl?.querySelector('Id')?.textContent?.trim() || '';
      if (!src || !dst) return;
      // <Source xsi:type="DigitalSignal"> vs "AnalogSignal"
      const xsiType = srcEl?.getAttribute('xsi:type')
                   || dstEl?.getAttribute('xsi:type') || 'AnalogSignal';
      const kind = xsiType === 'DigitalSignal' ? 'digital' : 'analog';
      const edge = classifyMapping(src, dst, kind, prefixMap, effectivePns);
      edges.push(edge);
      // Track gauge PN + port for the file → port-set map.
      let pn = null;
      let port = null;
      if (edge.stage === 1 && edge.dstGaugePn) {
        pn = edge.dstGaugePn;
        port = edge.dstGaugePort;
      } else if ((edge.stage === 2 || edge.stage === '1.5') && edge.srcGaugePn) {
        pn = edge.srcGaugePn;
        port = edge.srcGaugePort;
      }
      if (pn && port) {
        if (!portsByPn.has(pn)) portsByPn.set(pn, new Set());
        portsByPn.get(pn).add(port);
      }
    });

    if (!file) continue;
    // Claim this file for each PN whose ports it contains.
    for (const [pn, ports] of portsByPn) {
      if (!filesByPn[pn]) filesByPn[pn] = [];
      filesByPn[pn].push({ filename: file, ports: [...ports] });
    }
    // If the filename's class short name matches a PN that didn't appear
    // in any of its edges (empty file for an active-but-unwired gauge),
    // still claim the filename so a save with no edges keeps it.
    if (filePns.size > 0) {
      for (const pn of filePns) {
        if (!portsByPn.has(pn)) {
          if (!filesByPn[pn]) filesByPn[pn] = [];
          // Avoid duplicate entries when the same file already claimed.
          if (!filesByPn[pn].some(f => f.filename === file)) {
            filesByPn[pn].push({ filename: file, ports: [] });
          }
        }
      }
    }
  }
  const instruments = buildInstrumentView(edges, prefixMap);
  return { edges, instruments, filesByPn };
}

// Given a .mapping filename, return the set of gauge PNs whose class short
// name appears in the filename. e.g. "Simtek100207_110tachometerrpmv2.mapping"
// returns { '10-0207_110' } (because Simtek100207_110 is in the name), while
// "Simtek100207tachometerrpm.mapping" returns { '10-0207' }. Filenames that
// don't match any known class return an empty set.
function pnsForFilename(filename) {
  const out = new Set();
  if (!filename) return out;
  // Strip the .mapping suffix and check each instrument's class short name.
  const stem = filename.replace(/\.mapping$/i, '');
  // Sort by short-name length descending so longer matches (Simtek100207_110)
  // win over shorter prefix matches (Simtek100207).
  const candidates = INSTRUMENTS
    .map(inst => ({ inst, shortName: (inst.cls || '').split('.').pop().replace(/HardwareSupportModule$/, '') }))
    .filter(c => c.shortName)
    .sort((a, b) => b.shortName.length - a.shortName.length);
  for (const c of candidates) {
    if (stem.startsWith(c.shortName)) {
      out.add(c.inst.pn);
      return out;  // longest-match wins; one PN per file
    }
  }
  return out;
}

// An empty chain — used when creating a new profile or loading fails.
function emptyChain() { return { edges: [], instruments: [] }; }

// Re-derive p.chain.instruments after a mutation to p.chain.edges. Cheap
// (linear in edges) so we just rebuild from scratch instead of trying to
// patch in place.
function rebuildInstrumentView(p) {
  const prefixMap = buildInstrumentPrefixMap();
  p.chain.instruments = buildInstrumentView(p.chain.edges, prefixMap);
  // Keep the legacy p.instruments PN list in sync with what's in the chain
  // PLUS any catalog-only PNs the user added without yet wiring (those won't
  // appear in chain.instruments because there are no edges for them).
  const fromChain = new Set(
    p.chain.instruments.map(i => i.pn).filter(pn => INSTRUMENTS.some(inst => inst.pn === pn))
  );
  for (const pn of p.instruments || []) fromChain.add(pn);
  p.instruments = [...fromChain];
}

// ── Edge mutation helpers ────────────────────────────────────────────────────
// Used by tab-mappings's onSet* handlers. Always followed by
// rebuildInstrumentView(p) to refresh the per-instrument view.

// Returns the digit prefix the gauge HSM uses when emitting port IDs in C#.
// For most gauges this is `pn.replace(/-/g, '')`, but a few (e.g. 10-0207_110)
// have a suffix on the PN that doesn't appear in the port IDs — see
// `digitPrefix` in instruments.json.
function digitPrefixForPn(gaugePn) {
  const inst = INSTRUMENTS.find(i => i.pn === gaugePn);
  if (inst?.digitPrefix) return inst.digitPrefix;
  return (gaugePn || '').replace(/-/g, '');
}

// Find or create a stage-1 edge for (gaugePn, gaugePort). Returns the edge.
function ensureStageOneEdge(p, gaugePn, gaugePort, kind) {
  let edge = p.chain.edges.find(e =>
    e.stage === 1 && e.dstGaugePn === gaugePn && e.dstGaugePort === gaugePort
  );
  if (!edge) {
    const digits = digitPrefixForPn(gaugePn);
    edge = {
      src: '', dst: `${digits}_${gaugePort}`, stage: 1, kind,
      srcGaugePn: null, srcGaugePort: null,
      dstKind: 'gauge', dstGaugePn: gaugePn, dstGaugePort: gaugePort,
      dstDriver: null, dstDriverDevice: null, dstDriverChannel: null,
    };
    p.chain.edges.push(edge);
  }
  return edge;
}

// Same for stage-2.
function ensureStageTwoEdge(p, gaugePn, gaugePort, kind) {
  let edge = p.chain.edges.find(e =>
    e.stage === 2 && e.srcGaugePn === gaugePn && e.srcGaugePort === gaugePort
  );
  if (!edge) {
    const digits = digitPrefixForPn(gaugePn);
    edge = {
      src: `${digits}_${gaugePort}`, dst: '', stage: 2, kind,
      srcGaugePn: gaugePn, srcGaugePort: gaugePort,
      dstKind: 'unknown', dstGaugePn: null, dstGaugePort: null,
      dstDriver: null, dstDriverDevice: null, dstDriverChannel: null,
    };
    p.chain.edges.push(edge);
  }
  return edge;
}

// Drop any edge whose src and dst are both empty — these are stubs left over
// from selectors that the user reset to "— not wired —".
function pruneEmptyEdges(p) {
  p.chain.edges = p.chain.edges.filter(e => e.src || e.dst);
}

// ── Registry parsing ─────────────────────────────────────────────────────────

// Parse the registry text (HardwareSupportModule.registry or
// SimSupportModule.registry) into a list of `<Module>` class FQNs. Trims
// whitespace and stops at the comma that separates class from assembly.
function parseRegistryClasses(registryText) {
  if (!registryText) return [];
  const out = [];
  const re = /<Module>\s*([^,<]+),/g;
  let m;
  while ((m = re.exec(registryText)) != null) out.push(m[1].trim());
  return out;
}

// Resolve a list of FQNs to the set of driver-ids declared. FQNs that don't
// match any known driver are ignored (could be a gauge HSM, that's filtered
// elsewhere).
function declaredDriversFromClasses(classes) {
  const out = new Set();
  for (const fqn of classes) {
    for (const [driverId, meta] of Object.entries(DRIVER_META)) {
      if (meta.cls === fqn) { out.add(driverId); break; }
    }
  }
  return [...out];
}

// Resolve a list of FQNs to the set of sim-support ids declared.
function declaredSimSupportsFromClasses(classes) {
  const out = new Set();
  for (const fqn of classes) {
    const ss = SIM_SUPPORTS.find(s => s.cls === fqn);
    if (ss) out.add(ss.id);
  }
  return [...out];
}

// Resolve a list of HSM-registry FQNs to the gauge PNs they reference.
// (Replaces the old parseGaugePnsFromRegistry helper, which was equivalent.)
function gaugePnsFromClasses(classes) {
  const pns = new Set();
  for (const fqn of classes) {
    const inst = INSTRUMENTS.find(i => i.cls === fqn);
    if (inst) pns.add(inst.pn);
  }
  return [...pns];
}

// Apply a freshly-loaded profile to the in-memory state.
//   mappingFileList     — [{ file, content }] from main's load-profile handler
//   hsmRegistryText     — HardwareSupportModule.registry text (or null)
//   ssmRegistryText     — SimSupportModule.registry text (or null)
//   driverConfigsRaw    — { filename: text } map of all known driver config files
//
// Parses mappings *with* registry context so digit-prefix collisions (e.g.
// 10-0207 vs 10-0207_110, both prefixed "100207_") resolve to the right gauge.
//
// Populates p.chain, p.driverConfigsRaw, p.instruments (gauge PNs from registry
// + chain), p.drivers (driver-id → { devices: [...] } map keyed by declared
// drivers only), and p.simSupports (list of declared sim-support ids).
function applyLoadedChain(p, mappingFileList, hsmRegistryText, ssmRegistryText, driverConfigsRaw = {}) {
  // Parse registry classes once, reuse for the downstream resolutions.
  const hsmClasses = parseRegistryClasses(hsmRegistryText);
  const ssmClasses = parseRegistryClasses(ssmRegistryText);
  const declaredPns = new Set(gaugePnsFromClasses(hsmClasses));

  // Now parse mappings with registry context for disambiguation.
  const chain = parseMappingsFromXml(mappingFileList, declaredPns);
  p.chain = chain;
  p.driverConfigsRaw = driverConfigsRaw || {};
  // Per-PN list of legacy mapping files captured at load time. Save uses
  // this to preserve user/sample filenames across edits (so Nigel's
  // "Lilbern3321rpm.mapping" doesn't get renamed to the editor's default
  // "Lilbern3321.mapping" and then swept by main.js as orphaned, and his
  // pair of "Malwin19581hydraulicPressureA.mapping" / "...PressureB.mapping"
  // both survive). Each entry: { filename, ports: [portName, ...] }.
  // New gauges added after load have no entry → fall back to default
  // naming. See generateMappingFiles for how edges get distributed across
  // multiple legacy files for one gauge.
  p.mappingFilesByPn = chain.filesByPn || {};

  // p.instruments — union of registry-seeded PNs and chain-derived PNs.
  const instSet = new Set(declaredPns);
  for (const inst of chain.instruments) {
    if (INSTRUMENTS.some(i => i.pn === inst.pn)) instSet.add(inst.pn);
  }
  for (const pn of p.instruments || []) instSet.add(pn);
  p.instruments = [...instSet];

  // p.drivers — declared drivers (one entry per <Module> in the HSM registry
  // that matches a known driver). Each entry's devices come from the parsed
  // config file when present; otherwise a single default device is created so
  // the Hardware tab shows a sensible starting state.
  const declaredDriverIds = declaredDriversFromClasses(hsmClasses);
  const parsedDriverDevices = parseDriverConfigs(driverConfigsRaw);
  p.drivers = {};
  for (const id of declaredDriverIds) {
    p.drivers[id] = parsedDriverDevices[id] || { devices: [DRIVER_META[id].defaultDevice()] };
  }
  // Backfill default AD fields on every loaded device so the Hardware Config
  // tab can render against a uniform schema even when the on-disk config was
  // written by an older editor (or a hand-edited file missing some fields).
  if (p.drivers.analogdevices) {
    backfillAnalogDevicesDevices(p.drivers.analogdevices);
  }
  // Same for HenkSDI — older profiles may carry only `{ address }` records;
  // this inflates them into the full structured schema (powerDown, channels,
  // URC, etc.) so the Hardware Config tab has a uniform view.
  if (p.drivers.henksdi) {
    backfillHenkSDIDevices(p.drivers.henksdi);
  }
  // And HenkQuadSinCos — same `{ address }`-only legacy shape.
  if (p.drivers.henkquadsincos) {
    backfillHenkQuadSinCosDevices(p.drivers.henkquadsincos);
  }
  // PHCC — single-instance driver; backfill the device-manager config path.
  if (p.drivers.phcc) {
    backfillPhccDevices(p.drivers.phcc);
  }
  // ArduinoSeat — single-instance driver with a substantial nested schema
  // (top-level board fields + array of seat-output entries).
  if (p.drivers.arduinoseat) {
    backfillArduinoSeatDevices(p.drivers.arduinoseat);
  }
  // TeensyEWMU — single-instance driver, COM port + array of DXOutput
  // entries (each id + invert bool).
  if (p.drivers.teensyewmu) {
    backfillTeensyEWMUDevices(p.drivers.teensyewmu);
  }
  // TeensyRWR — single-instance vector-display driver. COM port + display
  // orientation + X/Y axis calibration breakpoints + centering/scaling.
  if (p.drivers.teensyrwr) {
    backfillTeensyRWRDevices(p.drivers.teensyrwr);
  }
  // TeensyVectorDrawing — same shape as TeensyRWR plus a DeviceType enum
  // (RWR/HUD/HMS) selecting between vector rendering modes.
  if (p.drivers.teensyvectordrawing) {
    backfillTeensyVectorDrawingDevices(p.drivers.teensyvectordrawing);
  }
  // NiclasMorin DTS Card — multi-device driver. Per-device serial (used as
  // the address), optional dead zone, and a CalibrationData breakpoint
  // table mapping sim values → synchro angles.
  if (p.drivers.niclasmorindts) {
    backfillNiclasMorinDTSDevices(p.drivers.niclasmorindts);
  }

  // p.simSupports — list of declared sim-support ids.
  p.simSupports = declaredSimSupportsFromClasses(ssmClasses);

  // p.gaugeConfigs — per-gauge calibration state, parsed from the
  // Simtek<digits>HardwareSupportModule.config files in the profile dir.
  // Files for gauges we don't yet have a calibration editor for round-trip
  // as raw text in p.gaugeConfigsRaw.
  const { gaugeConfigs, gaugeConfigsRaw } = parseGaugeConfigs(driverConfigsRaw);
  p.gaugeConfigs = gaugeConfigs;
  p.gaugeConfigsRaw = gaugeConfigsRaw;

  // Annotate edges whose src isn't in the current sim catalog. The Mappings
  // tab renders these with a warning; the gauge-header pill counts them.
  refreshInvalidEdgeFlags(p);
}

// ── Source-validity helpers ──────────────────────────────────────────────────

// Build a Set of every source signal ID published by the profile's declared
// sims. Includes both scalar IDs (e.g. F4_RPM1__RPM_PERCENT) and indexed
// templates (F4_DED__LINES) — the indexed-array variant. Indexed lookups
// strip a trailing [N] before checking.
function buildKnownSourceIds(declaredSimIds) {
  const ids = new Set();
  for (const simId of (declaredSimIds || [])) {
    const sim = SIM_SIGNALS[simId];
    if (!sim) continue;
    for (const s of (sim.scalar || [])) ids.add(s.id);
    for (const s of (sim.indexed || [])) ids.add(s.id);
  }
  return ids;
}

function isSourceIdValid(srcId, knownIds) {
  if (!srcId) return true;  // empty src means "not yet wired" — that's fine
  if (knownIds.has(srcId)) return true;
  // Indexed signal: the catalog stores the template (F4_DED__LINES) but the
  // mapping uses F4_DED__LINES[3]. Strip a trailing [N] and re-check.
  const m = srcId.match(/^(.*)\[\d+\]$/);
  if (m && knownIds.has(m[1])) return true;
  return false;
}

// Return the set of edges in p.chain whose stage-1 src is not in any of the
// profile's declared sims' signal catalogs. Stage-2 edges are not checked
// (their `src` is a gauge port, not a sim signal).
function findInvalidEdges(p) {
  const known = buildKnownSourceIds(p.simSupports || []);
  const out = [];
  for (const e of p.chain.edges) {
    if (e.stage !== 1) continue;
    if (!e.src) continue;
    if (!isSourceIdValid(e.src, known)) out.push(e);
  }
  return out;
}

// Annotate every edge in p.chain with `invalid: true|false` so the renderer
// can style accordingly. Called whenever the catalog or declared sims change.
function refreshInvalidEdgeFlags(p) {
  const known = buildKnownSourceIds(p.simSupports || []);
  for (const e of p.chain.edges) {
    if (e.stage === 1 && e.src) {
      e.invalid = !isSourceIdValid(e.src, known);
    } else {
      e.invalid = false;
    }
  }
}

// Profile-level health summary used by the tab-header badges.
//   broken     — count of edges with .invalid === true
//   incomplete — count of gauges that aren't fully wired (uses computeGaugeCompletion)
//   conflicts  — count of (driver|device|channel) addresses targeted by 2+ edges
// computeGaugeCompletion + buildChannelConflictMap live in tab-mappings.js
// (their primary consumer) — JS hoisting + call-time resolution means the
// forward reference resolves fine at runtime.
function computeProfileHealth(p) {
  const broken = (p.chain?.edges || []).reduce((n, e) => n + (e.invalid ? 1 : 0), 0);

  let incomplete = 0;
  for (const pn of (p.instruments || [])) {
    const inst = INSTRUMENTS.find(i => i.pn === pn);
    if (!inst) continue;
    const stats = computeGaugeCompletion(inst, p);
    // A gauge counts as incomplete if it has any ports and isn't fully wired,
    // ignoring the "broken" case (that's already counted separately).
    const totalPorts = stats.inputs.total + stats.outputs.total;
    if (totalPorts > 0 && !stats.complete && stats.broken === 0) incomplete++;
  }

  const conflicts = buildChannelConflictMap(p.chain?.edges || []).size;

  return { broken, incomplete, conflicts };
}
