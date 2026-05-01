// ── Mappings tab ─────────────────────────────────────────────────────────────
//
// The Signal Mappings tab renders one card per active instrument, broken into:
//   - Inputs (from sim)        — one row per inputPort, F4 source dropdown
//   - Outputs (to hardware)    — one row per outputGroup; resolver pairs render
//                                with two paired channel rows under a single
//                                heading; analog/digital singles render as one.
//
// Each row writes to or from a stage-1 / stage-2 edge in p.chain.edges. Edges
// are addressed by edgeIdx (their position in the array). When an edge doesn't
// exist for a given port (the user hasn't wired it yet), the row's selectors
// show "— not wired —" placeholder values.
//
// Driver-channel pickers know about AnalogDevices and HenkSDI. Other drivers
// fall through to a free-text destination input for now (the underlying chain
// model handles them; just no curated picker yet).

// Effective DRIVER_HINTS for the active profile. The profile's declared
// devices for each driver (managed in the Hardware tab) override the static
// fallback list. The translation from device records to dropdown values
// depends on the driver's deviceShape:
//   'count'   — use index (0, 1, 2, …) since AD devices are addressed by position.
//   'address' — use the address field.
//   'single'  — single device, no device dropdown needed (return [] or [null]).
// If the driver isn't declared in the profile at all, the dropdown won't be
// rendered for that driver — but we still return the static fallback so the
// raw destination ID can be parsed at load time.
function effectiveDriverHint(driver) {
  const base = DRIVER_HINTS[driver];
  if (!base) return null;
  const profile = activeIdx !== null ? profiles[activeIdx] : null;
  const decl = profile?.drivers?.[driver];
  if (!decl?.devices?.length) return base;
  const meta = DRIVER_META[driver];
  const shape = meta?.deviceShape || 'count';
  let values;
  if (shape === 'address') {
    values = decl.devices.map(d => d.address).filter(a => a != null && a !== '');
  } else if (shape === 'count') {
    values = decl.devices.map((_, i) => i);
  } else {
    // 'single' — no device picker needed; return whatever's in the base hint.
    return base;
  }
  if (!values.length) return base;
  return { ...base, devices: values };
}

// Build the source <option> markup for the active profile's Mappings tab.
// Sources come from the union of all SimSupports declared on the profile.
// Each <optgroup> label is prefixed with the sim's display name (e.g.
// "Falcon BMS → Map") so signals stay distinguishable when multiple sims are
// declared, and the layout doesn't shift when a sim is added/removed.
//
// Cache key is the sorted list of declared sim IDs; the cache invalidates
// whenever the user adds/removes a SimSupport (renderEditor → renderMappings).
let _simOptionsHtmlCache = { key: null, html: null };
function simSourceOptionsHtml(declaredSimIds) {
  const ids = (declaredSimIds || []).slice().sort();
  const key = ids.join('|');
  if (_simOptionsHtmlCache.key === key) return _simOptionsHtmlCache.html;

  let html = '<option value="">— not wired —</option>';
  for (const simId of ids) {
    const sim = SIM_SUPPORTS.find(s => s.id === simId);
    const simLabel = sim ? sim.label : simId;
    const signals = SIM_SIGNALS[simId]?.scalar || [];
    if (signals.length === 0) continue;

    // Group within this sim by `coll`, alphabetised.
    const groups = new Map();
    for (const s of signals) {
      if (!groups.has(s.coll)) groups.set(s.coll, []);
      groups.get(s.coll).push(s);
    }
    for (const [coll, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      html += `<optgroup label="${escHtml(`${simLabel} → ${coll}`)}">`;
      for (const s of list) {
        const display = s.sub ? `${s.sub} → ${s.label.split(' → ').pop()}` : s.label.split(' → ').pop();
        html += `<option value="${escHtml(s.id)}" data-kind="${s.kind}" title="${escHtml(s.id)}">${escHtml(display)}</option>`;
      }
      html += '</optgroup>';
    }
  }

  _simOptionsHtmlCache = { key, html };
  return html;
}

// ── Edge-level setters wired from the UI ─────────────────────────────────────

function onSetSourceForInputPort(pn, port, kind, value) {
  const p = profiles[activeIdx];
  const edge = ensureStageOneEdge(p, pn, port, kind);
  edge.src = value;
  if (!edge.src && !edge.dst) p.chain.edges = p.chain.edges.filter(e => e !== edge);
  pruneEmptyEdges(p);
  rebuildInstrumentView(p);
  renderMappings();
  // The Calibration tab's live-cal section reads chain.edges to find each
  // gauge's wired sim source. After a stage-1 wiring change, the live-cal
  // sliders for this gauge need to refresh so the user sees the new source
  // without flipping back to the Calibration tab and reopening the card.
  renderCalibration();
}

function onSetDriverForOutputPort(pn, port, kind, driver) {
  const p = profiles[activeIdx];
  const edge = ensureStageTwoEdge(p, pn, port, kind);
  edge.dstDriver = driver || null;
  edge.dstDriverDevice = null;
  edge.dstDriverChannel = null;
  edge.dst = '';
  edge.dstKind = driver ? 'driver' : 'unknown';
  if (!edge.src && !edge.dst && !edge.dstDriver) p.chain.edges = p.chain.edges.filter(e => e !== edge);
  pruneEmptyEdges(p);
  rebuildInstrumentView(p);
  renderMappings();
  renderCalibration();
}

function onSetChannelForOutputPort(pn, port, field, value) {
  const p = profiles[activeIdx];
  const edge = p.chain.edges.find(e =>
    e.stage === 2 && e.srcGaugePn === pn && e.srcGaugePort === port
  );
  if (!edge || !edge.dstDriver) return;
  if (field === 'device') edge.dstDriverDevice = value;
  if (field === 'channel') edge.dstDriverChannel = value;
  const hint = DRIVER_HINTS[edge.dstDriver];
  if (hint && edge.dstDriverDevice != null && edge.dstDriverChannel != null && edge.dstDriverChannel !== '') {
    edge.dst = hint.formatDestination(edge.dstDriverDevice, edge.dstDriverChannel);
  } else {
    edge.dst = '';
  }
  rebuildInstrumentView(p);
  renderMappings();
  renderCalibration();
}

// ── Conflict detection ───────────────────────────────────────────────────────
// Module-level conflict map: (driver|device|channel) → [edges sharing that
// destination]. Built once per renderMappings call; consulted by the channel
// row renderer to flag duplicates. Wiring two outputs to the same DAC channel
// almost always means a bug — last-writer-wins, one gauge sits dead.
let _channelConflicts = new Map();

// Set true when the active profile has no SimSupports declared. In that
// state every stage-1 edge is "invalid" by definition — printing a hint
// under each row is just noise, so renderInputRow keeps the row's amber
// background but skips the per-row text. The banner above the cards
// explains the root cause once.
let _suppressInvalidRowHint = false;

function buildChannelConflictMap(edges) {
  const map = new Map();
  for (const e of edges) {
    if (e.stage !== 2 || !e.dstDriver) continue;
    if (e.dstDriverChannel == null || e.dstDriverChannel === '') continue;
    // device may be null for 'single'-shape drivers — that's still a valid
    // address for conflict detection (those drivers really do have just one).
    const key = `${e.dstDriver}|${e.dstDriverDevice ?? ''}|${e.dstDriverChannel}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  // Drop singletons; only keep keys with >= 2 edges (the actual conflicts).
  for (const [k, v] of [...map]) if (v.length < 2) map.delete(k);
  return map;
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderMappings() {
  const pane = document.getElementById('pane-mappings');
  if (!pane) return;
  const p = profiles[activeIdx];

  if (p.instruments.length === 0) {
    pane.innerHTML = '<div class="empty">Add an instrument from the Instruments tab first, then wire its inputs and outputs here.</div>';
    return;
  }

  // Without any declared SimSupport, the source dropdown is empty AND every
  // existing edge with a non-empty src will be flagged invalid (because
  // there are no known signals to validate against). Rather than letting the
  // user see 55 amber rows screaming "source not found," we collapse that
  // to a single banner explaining the root cause.
  const noSimSupport = !(p.simSupports && p.simSupports.length > 0);
  const brokenCount = p.chain.edges.filter(e => e.invalid).length;

  // Suppress the per-row "invalid source" hint when the cause is "no
  // SimSupport declared" — the banner above already covers that case.
  // (The row stays amber for visual continuity, just without the redundant
  // text underneath.) Read by renderInputRow via this module-level flag.
  _suppressInvalidRowHint = noSimSupport;

  _channelConflicts = buildChannelConflictMap(p.chain.edges);

  // One card per active instrument.
  let html = '<div class="mappings-toolbar">' +
             '<div class="mappings-toolbar-text">Wire each gauge HSM\'s inputs from BMS and its outputs to your hardware. Resolver pairs are routed as a unit — the sin and cos channels must use the same driver but can land on any two channels.</div>' +
             '<div class="mappings-toolbar-actions">' +
               '<button class="btn-sm" onclick="setAllGaugeCardsOpen(true)">Expand all</button>' +
               '<button class="btn-sm" onclick="setAllGaugeCardsOpen(false)">Collapse all</button>' +
             '</div>' +
             '</div>';
  if (noSimSupport) {
    const brokenSuffix = brokenCount > 0
      ? ` This will fix <strong>${brokenCount}</strong> mapping${brokenCount === 1 ? '' : 's'} that currently reference unknown signals.`
      : '';
    html += '<div class="dir-banner danger" style="margin-bottom:14px;border-radius:var(--radius)"><div><div class="dir-banner-text">' +
            '<strong>No SimSupport declared.</strong> Add one in the SimSupport tab so source signals appear in the dropdowns below.' +
            brokenSuffix +
            '</div></div></div>';
  }
  html += '<div id="mappingCards"></div>';
  pane.innerHTML = html;
  const container = document.getElementById('mappingCards');

  for (const pn of p.instruments) {
    const inst = INSTRUMENTS.find(i => i.pn === pn);
    if (!inst) continue;  // unknown PN — skip for now (could render a raw section)
    const view = p.chain.instruments.find(v => v.pn === pn) || { inputs: [], outputGroups: [] };
    container.appendChild(renderInstrumentCard(inst, view));
  }
}

// Bulk-toggle every gauge card on the Mappings tab. Wired to the
// Expand all / Collapse all buttons in the toolbar. State doesn't persist
// across re-renders — that's intentional, simpler model than tracking it.
function setAllGaugeCardsOpen(open) {
  const cards = document.querySelectorAll('#mappingCards details.instrument-card');
  const p = profiles[activeIdx];
  for (const c of cards) {
    c.open = !!open;
    // Mirror the open state into the persistence Set so the next re-render
    // (triggered by any field edit) doesn't immediately collapse cards
    // back. Mirrors setAllCalibrationCardsOpen.
    if (!p) continue;
    const pn = c.dataset.pn;
    if (!pn) continue;
    const key = `${p.name}|${pn}`;
    if (open) _mappingsOpen.add(key); else _mappingsOpen.delete(key);
  }
}

// Compute wiring completeness for one gauge card. Returns
//   { inputs: { wired, total }, outputs: { wired, total }, broken, complete }
// where:
//   - inputs.wired   = inputPorts that have a stage-1 edge with non-empty src
//   - outputs.wired  = outputGroups where every port has dstDriver+device+channel,
//                      AND (for resolver_pair) all ports share the same dstDriver
//   - broken         = stage-1 edges flagged invalid (source not in catalog)
//   - complete       = inputs all wired AND outputs all wired AND zero broken
function computeGaugeCompletion(inst, p) {
  const inputs = { wired: 0, total: (inst.inputPorts || []).length };
  for (const port of (inst.inputPorts || [])) {
    const edge = p.chain.edges.find(e =>
      e.stage === 1 && e.dstGaugePn === inst.pn && e.dstGaugePort === port.port
    );
    if (edge?.src) inputs.wired++;
  }

  const outputs = { wired: 0, total: (inst.outputGroups || []).length };
  for (const group of (inst.outputGroups || [])) {
    let allWired = true;
    let groupDriver = null;
    let driverConflict = false;
    for (const portTpl of group.ports) {
      const edge = p.chain.edges.find(e =>
        e.stage === 2 && e.srcGaugePn === inst.pn && e.srcGaugePort === portTpl.port
      );
      const wired = edge && edge.dstDriver
        && edge.dstDriverChannel != null && edge.dstDriverChannel !== '';
      if (!wired) { allWired = false; break; }
      if (groupDriver == null) groupDriver = edge.dstDriver;
      else if (groupDriver !== edge.dstDriver) driverConflict = true;
    }
    if (allWired && !driverConflict) outputs.wired++;
  }

  const broken = p.chain.edges.filter(e =>
    e.invalid && (e.dstGaugePn === inst.pn || e.srcGaugePn === inst.pn)
  ).length;

  const complete = inputs.wired === inputs.total
                && outputs.wired === outputs.total
                && broken === 0
                && (inputs.total + outputs.total) > 0;
  return { inputs, outputs, broken, complete };
}

// Persist which Mappings cards are open across re-renders. Without this,
// editing any field calls renderMappings() and every card snaps shut —
// extremely annoying when you're stepping through inputs and outputs on a
// gauge. Mirror of _calibrationOpen / _hwconfigOpen.
const _mappingsOpen = new Set();

function renderInstrumentCard(inst, view) {
  // <details> is the wrapper so the card collapses natively on summary click.
  // Default-closed on first render of a profile; user opens the gauges they
  // want to edit. The Expand-all / Collapse-all toolbar buttons toggle every
  // card at once. _mappingsOpen restores open state across the re-renders
  // triggered by every field edit.
  const card = document.createElement('details');
  card.className = 'instrument-card';
  card.dataset.pn = inst.pn;
  const p = profiles[activeIdx];
  if (_mappingsOpen.has(`${p.name}|${inst.pn}`)) card.open = true;
  card.addEventListener('toggle', () => {
    const key = `${p.name}|${inst.pn}`;
    if (card.open) _mappingsOpen.add(key); else _mappingsOpen.delete(key);
  });
  const stats = computeGaugeCompletion(inst, p);

  // Decide the gauge's overall status. Drives both the header background
  // color and the pill text:
  //   broken    — any edge with src not in the catalog (red)
  //   empty     — gauge has no ports at all (neutral); rare
  //   none      — has ports, none wired (red — caught the user's eye)
  //   partial   — some wired, not all (orange)
  //   complete  — every port wired (green)
  const totalPorts = stats.inputs.total + stats.outputs.total;
  const wiredPorts = stats.inputs.wired + stats.outputs.wired;
  let status, pillText;
  if (stats.broken > 0) {
    status = 'broken';
    pillText = `${stats.broken} broken`;
  } else if (totalPorts === 0) {
    status = 'empty';
    pillText = '—';
  } else if (wiredPorts === 0) {
    status = 'none';
    pillText = `0/${totalPorts}`;
  } else if (stats.complete) {
    status = 'complete';
    pillText = `${wiredPorts}/${totalPorts} ✓`;
  } else {
    status = 'partial';
    pillText = `${wiredPorts}/${totalPorts}`;
  }
  const pillTitle = `Inputs ${stats.inputs.wired}/${stats.inputs.total} wired · Outputs ${stats.outputs.wired}/${stats.outputs.total} wired${stats.broken ? ` · ${stats.broken} broken` : ''}`;

  const inputsHtml = (inst.inputPorts || []).map(po => renderInputRow(inst, po, view)).join('');
  const outputsHtml = (inst.outputGroups || []).map(g => renderOutputGroup(inst, g, view)).join('');

  card.innerHTML = `
    <summary class="instrument-card-head instrument-card-head-${status}">
      <span class="instrument-card-chevron" aria-hidden="true">▸</span>
      <div class="instrument-card-headline">
        <div class="instrument-card-title">${escHtml(inst.name)}</div>
        <div class="instrument-card-pn">P/N ${escHtml(inst.pn)}</div>
      </div>
      <span class="completion-pill completion-pill-${status}" title="${escHtml(pillTitle)}">${escHtml(pillText)}</span>
    </summary>
    ${inst.inputPorts && inst.inputPorts.length ? `
      <div class="map-section-head">Inputs (from BMS)</div>
      ${inputsHtml}` : ''}
    ${inst.outputGroups && inst.outputGroups.length ? `
      <div class="map-section-head">Outputs (to hardware)</div>
      ${outputsHtml}` : ''}
  `;

  // Wire up <select> values that we couldn't safely set in the template.
  for (const port of (inst.inputPorts || [])) {
    const sel = card.querySelector(`select[data-input-port="${port.port}"]`);
    if (sel) {
      const edge = p.chain.edges.find(e => e.stage === 1 && e.dstGaugePn === inst.pn && e.dstGaugePort === port.port);
      setSelectValue(sel, edge?.src || '');
    }
  }
  for (const group of (inst.outputGroups || [])) {
    for (const portTpl of group.ports) {
      const driverSel = card.querySelector(`select[data-output-driver="${portTpl.port}"]`);
      const deviceSel = card.querySelector(`select[data-output-device="${portTpl.port}"]`);
      const channelSel = card.querySelector(`select[data-output-channel="${portTpl.port}"]`);
      const edge = p.chain.edges.find(e => e.stage === 2 && e.srcGaugePn === inst.pn && e.srcGaugePort === portTpl.port);
      if (driverSel)  setSelectValue(driverSel,  edge?.dstDriver || '');
      if (deviceSel)  setSelectValue(deviceSel,  edge?.dstDriverDevice == null ? '' : String(edge.dstDriverDevice));
      if (channelSel) setSelectValue(channelSel, edge?.dstDriverChannel == null ? '' : String(edge.dstDriverChannel));
    }
  }

  return card;
}

function renderInputRow(inst, port, view) {
  const filterAttr = `data-kind-filter="${port.kind}"`;
  const p = profiles[activeIdx];
  const optionsHtml = simSourceOptionsHtml(p.simSupports || []);
  // Look up this input port's edge to detect "invalid source" — the user
  // (or an import) left a src that doesn't match any declared-sim signal.
  const edge = p.chain.edges.find(e =>
    e.stage === 1 && e.dstGaugePn === inst.pn && e.dstGaugePort === port.port
  );
  const invalid = edge?.invalid;
  const rowClass = 'map-row' + (invalid ? ' map-row-invalid' : '');
  // Only show the per-row hint when the cause is "this specific signal
  // isn't in the catalog." When the whole profile has no SimSupport, the
  // banner above already explains it — repeating the message on every row
  // is noise.
  const invalidHint = invalid && !_suppressInvalidRowHint
    ? `<div class="map-row-invalid-hint" title="${escHtml(`Source signal '${edge.src}' is not in any declared SimSupport's catalog. Either pick a different source, or restore the signal in the SimSupport tab.`)}">⚠ source not found in catalog</div>`
    : '';
  return `
    <div class="${rowClass}">
      <div class="map-row-label">
        <div class="map-row-name">${escHtml(port.label)}</div>
        <div class="map-row-port">${inst.pn.replace(/-/g, '')}_${escHtml(port.port)}</div>
      </div>
      <div class="map-row-arrow">←</div>
      <div class="map-row-control">
        <select data-input-port="${escHtml(port.port)}" ${filterAttr}
                onchange="onSetSourceForInputPort('${inst.pn}','${port.port}','${port.kind}',this.value)">
          ${optionsHtml}
        </select>
      </div>
    </div>
    ${invalidHint}`;
}

function renderOutputGroup(inst, group, view) {
  // For resolver pairs and digital singles, the channels in the template are
  // the routable units. For analog_single there's only one.
  const channelsHtml = group.ports.map(p => renderOutputChannelRow(inst, group, p)).join('');
  const groupKindLabel =
    group.kind === 'resolver_pair'  ? 'sin/cos pair' :
    group.kind === 'digital_single' ? 'digital flag' : 'analog channel';
  // Column headers align with the channel-row grid columns:
  // [role] [port] [→] [driver] [board] [output]
  const headerRow = `
    <div class="map-channel-header">
      <div></div>
      <div></div>
      <div></div>
      <div>Driver</div>
      <div>Board</div>
      <div>Output</div>
    </div>`;
  return `
    <div class="map-output-group">
      <div class="map-output-group-head">
        <span class="map-output-group-title">${escHtml(group.label)}</span>
        <span class="map-output-group-kind">${groupKindLabel}</span>
      </div>
      ${headerRow}
      ${channelsHtml}
    </div>`;
}

function renderOutputChannelRow(inst, group, portTpl) {
  const p = profiles[activeIdx];
  const edge = p.chain.edges.find(e => e.stage === 2 && e.srcGaugePn === inst.pn && e.srcGaugePort === portTpl.port);
  const driver = edge?.dstDriver || '';
  const hint = driver ? effectiveDriverHint(driver) : null;

  // Driver dropdown — only declared drivers are selectable. Undeclared ones
  // are shown disabled so the user understands the option exists but needs
  // to be added in the Hardware tab first. If an edge is already pointing at
  // an undeclared driver (state drift), keep that option enabled so the user
  // can see what's broken and fix it.
  const declaredDrivers = new Set(Object.keys(p.drivers || {}));
  const driverOpts = DRIVER_OPTIONS.map(o => {
    if (!o.value) return `<option value="">${escHtml(o.label)}</option>`;
    const isDeclared = declaredDrivers.has(o.value);
    const isCurrent = o.value === driver;
    if (isDeclared || isCurrent) {
      return `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`;
    }
    return `<option value="${escHtml(o.value)}" disabled>${escHtml(o.label)} — add in Hardware tab</option>`;
  }).join('');

  // Device dropdown — depends on driver
  let deviceOpts = '<option value="">—</option>';
  if (hint && hint.devices) {
    deviceOpts += hint.devices.map(d => `<option value="${escHtml(String(d))}">${escHtml(String(d))}</option>`).join('');
  }

  // Channel dropdown — depends on driver
  let channelOpts = '<option value="">—</option>';
  if (hint) {
    if (hint.channels) {
      channelOpts += hint.channels.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    } else if (hint.channelCount) {
      for (let c = 0; c < hint.channelCount; c++) {
        channelOpts += `<option value="${c}">${hint.formatChannel(c)}</option>`;
      }
    }
  }

  const roleLabel = portTpl.role === 'sin' ? 'sin' : portTpl.role === 'cos' ? 'cos' : '';

  // Conflict check: is this row's destination shared with other edges?
  let conflictHtml = '';
  let rowClass = 'map-channel-row';
  if (edge && edge.dstDriver && edge.dstDriverChannel != null && edge.dstDriverChannel !== '') {
    const key = `${edge.dstDriver}|${edge.dstDriverDevice ?? ''}|${edge.dstDriverChannel}`;
    const sharing = _channelConflicts.get(key);
    if (sharing && sharing.length > 1) {
      rowClass += ' map-channel-row-conflict';
      const others = sharing.filter(other => other !== edge).map(other => {
        const otherInst = INSTRUMENTS.find(i => i.pn === other.srcGaugePn);
        const gaugeName = otherInst ? otherInst.name : (other.srcGaugePn || 'unknown');
        return `${gaugeName} → ${other.srcGaugePort}`;
      });
      const tooltip = `This DAC output is also wired to:\n• ${others.join('\n• ')}`;
      conflictHtml = `<div class="map-channel-conflict" title="${escHtml(tooltip)}">⚠ shared with ${others.length} other</div>`;
    }
  }

  // Kind-mismatch check: gauge output port kind (analog/digital) must
  // agree with the destination driver's kind. SimLinkup's Runtime.cs
  // blindly casts mapping.Destination to DigitalSignal when Source is
  // digital — a digital gauge output (OFF flag) wired to an analog DAC
  // crashes the runtime there. Surface the mismatch in the same row
  // where conflicts show, so the user catches it before saving a
  // .mapping file that would crash SimLinkup. Drivers we haven't
  // classified (e.g. PHCC, which has both analog and digital outs)
  // are treated as 'unknown' and skipped.
  let kindMismatchHtml = '';
  if (edge && edge.dstDriver && edge.dstDriverChannel != null && edge.dstDriverChannel !== '') {
    const driverKind = DRIVER_CHANNEL_KIND[edge.dstDriver];
    if (driverKind && portTpl.kind && driverKind !== portTpl.kind) {
      rowClass += ' map-channel-row-conflict';
      const portKindLabel = portTpl.kind === 'digital' ? 'digital' : 'analog';
      const driverKindLabel = driverKind === 'digital' ? 'digital' : 'analog';
      const tooltip = `Gauge port "${portTpl.port}" is ${portKindLabel}, but ${edge.dstDriver} channels are ${driverKindLabel}. SimLinkup will crash at runtime trying to cast a ${portKindLabel} signal to a ${driverKindLabel} one. Pick a ${portKindLabel}-capable driver instead.`;
      kindMismatchHtml = `<div class="map-channel-conflict" title="${escHtml(tooltip)}">⚠ kind mismatch — ${escHtml(portKindLabel)} port wired to ${escHtml(driverKindLabel)} channel</div>`;
    }
  }

  return `
    <div class="${rowClass}">
      <div class="map-channel-role">${escHtml(roleLabel)}</div>
      <div class="map-channel-port">${inst.pn.replace(/-/g, '')}_${escHtml(portTpl.port)}</div>
      <div class="map-channel-arrow">→</div>
      <select data-output-driver="${escHtml(portTpl.port)}"
              onchange="onSetDriverForOutputPort('${inst.pn}','${portTpl.port}','${portTpl.kind}',this.value)">
        ${driverOpts}
      </select>
      <select data-output-device="${escHtml(portTpl.port)}" ${driver ? '' : 'disabled'}
              onchange="onSetChannelForOutputPort('${inst.pn}','${portTpl.port}','device',this.value)">
        ${deviceOpts}
      </select>
      <select data-output-channel="${escHtml(portTpl.port)}" ${driver ? '' : 'disabled'}
              onchange="onSetChannelForOutputPort('${inst.pn}','${portTpl.port}','channel',this.value)">
        ${channelOpts}
      </select>
    </div>
    ${conflictHtml}
    ${kindMismatchHtml}`;
}
