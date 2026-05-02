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
function effectiveDriverHint(driver, currentDevice) {
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
    // PoKeys is count-shape for declaration but addressed by serial
    // at runtime — surface the serials as the dropdown values so the
    // signal ids and C# HSM lookup line up. Other count-shape drivers
    // (AnalogDevices) use position index.
    if (driver === 'pokeys') {
      values = decl.devices.map(d => d.address).filter(a => a != null && a !== '');
    } else {
      values = decl.devices.map((_, i) => i);
    }
  } else {
    // 'single' — no device picker needed; return whatever's in the base hint.
    return base;
  }
  if (!values.length) return base;

  // PoKeys-specific: surface the user-given Name in the Board
  // dropdown (e.g. "cockpit-left") instead of the raw serial. The
  // option's `value` stays the serial — that's what edges and signal
  // ids reference — but the display text uses the friendly name with
  // a serial fallback so unnamed boards still render. The shared
  // renderer (~30 lines below) calls `deviceLabel(value)` per option.
  let deviceLabel;
  if (driver === 'pokeys') {
    deviceLabel = (serial) => {
      const dev = decl.devices.find(d => String(d.address) === String(serial));
      const name = String(dev?.name || '').trim();
      return name ? `${name} (${serial})` : String(serial);
    };
  }

  // PoKeys-specific: build a per-device, per-kind channelGroups list
  // from the user's declared outputs. The board exposes 141 possible
  // outputs (55 GPIO + 6 PWM + 80 PoExtBus); showing all of them in
  // the dropdown would be unusable. Filtering to declared-only also
  // gives users a chance to add Names in Hardware Config that surface
  // here as labels. Per-device because picking Board A then seeing
  // Board B's outputs would be confusing in multi-board setups.
  if (driver === 'pokeys') {
    const targetSerial = currentDevice != null && currentDevice !== ''
      ? String(currentDevice)
      : (values[0] != null ? String(values[0]) : null);
    const dev = decl.devices.find(d => String(d.address) === targetSerial);
    if (dev) {
      const labelOf = (kind, primary, fallback) =>
        (typeof primary === 'string' && primary.trim()) ? `${primary.trim()} (${fallback})` : fallback;
      const digitals = (dev.digitalOutputs || []).map(o => ({
        value: `DIGITAL_PIN[${o.pin}]`,
        label: labelOf('digital', o.name, `DIGITAL_PIN[${o.pin}]`),
      }));
      const pwms = (dev.pwmOutputs || []).map(o => ({
        value: `PWM[${o.channel}]`,
        // Surface the physical pin too so the dropdown matches the
        // Hardware Config card's PWM channel labels exactly.
        label: labelOf('pwm', o.name, `PWM${o.channel} (pin ${16 + o.channel})`),
      }));
      const extBus = (dev.extBusOutputs || []).map(o => {
        const deviceIdx = Math.floor((o.bit - 1) / 8) + 1;
        const letter = String.fromCharCode(65 + ((o.bit - 1) % 8));
        return {
          value: `PoExtBus[${o.bit}]`,
          label: labelOf('extbus', o.name, `Device ${deviceIdx} : ${letter} (bit ${o.bit})`),
        };
      });
      const channelGroups = [];
      if (digitals.length) channelGroups.push({ label: 'Digital pins',     channels: digitals });
      if (pwms.length)     channelGroups.push({ label: 'PWM channels',     channels: pwms });
      if (extBus.length)   channelGroups.push({ label: 'PoExtBus relays',  channels: extBus });
      return { ...base, devices: values, channelGroups, deviceLabel };
    }
  }

  return { ...base, devices: values, deviceLabel };
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
  // If the user is picking a driver, they DO want this port wired —
  // clear any "intentionally skipped" flag so the row stops being
  // greyed out and the dropdowns enable. Persist in the background;
  // the handler's own renderMappings() below paints the new state.
  if (driver) {
    const key = _skipKey(p.name, pn, port);
    if (_skipPorts.has(key)) {
      _skipPorts.delete(key);
      persistSkipPorts();  // fire-and-forget
    }
  }
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

// ── Intentionally-skipped output ports ───────────────────────────────────────
// Some gauges expose outputs that not every rig drives — the standby ADI's
// digital OFF flag is the canonical example. The user can mark such an
// output "skip" so the gauge's completion pill doesn't count it as missing
// and the per-row "shared" / "kind mismatch" warnings don't fire.
//
// State shape: a flat Set keyed by "<profileName>|<pn>|<portId>". Persisted
// in settings.json under skipPorts so the choice survives across sessions.
// Per-profile-scoped (different rigs may have different idle outputs).
//
// Hydrated on selectProfile (renderer-side), persisted on toggle, pruned
// on profile delete. Mirrors the auto-save persistence pattern.
const _skipPorts = new Set();

function _skipKey(profileName, pn, portId) { return `${profileName}|${pn}|${portId}`; }

function isPortSkipped(pn, portId) {
  const p = profiles[activeIdx];
  if (!p) return false;
  return _skipPorts.has(_skipKey(p.name, pn, portId));
}

async function setPortSkipped(pn, portId, skip) {
  const p = profiles[activeIdx];
  if (!p) return;
  const key = _skipKey(p.name, pn, portId);
  if (skip) _skipPorts.add(key); else _skipPorts.delete(key);
  await persistSkipPorts();
  rebuildInstrumentView(p);
  renderMappings();
}

// Settings.json round-trip helpers, mirror of the gauge auto-save pair.
async function persistSkipPorts() {
  const p = profiles[activeIdx];
  if (!p) return;
  try {
    const settings = await window.api.loadSettings();
    const map = (settings && settings.skipPorts) || {};
    const prefix = `${p.name}|`;
    for (const k of Object.keys(map)) {
      if (k.startsWith(prefix)) delete map[k];
    }
    for (const k of _skipPorts) {
      if (k.startsWith(prefix)) map[k] = true;
    }
    await window.api.saveSettings({ skipPorts: map });
  } catch {}
}

async function hydrateSkipPorts() {
  // Wipe all entries — a fresh hydrate is authoritative for whatever
  // profile we just switched to.
  _skipPorts.clear();
  const p = profiles[activeIdx];
  if (!p) return;
  try {
    const settings = await window.api.loadSettings();
    const map = (settings && settings.skipPorts) || {};
    const prefix = `${p.name}|`;
    for (const [k, v] of Object.entries(map)) {
      if (v && k.startsWith(prefix)) _skipPorts.add(k);
    }
  } catch {}
}

async function pruneSkipPortsForProfile(profileName) {
  try {
    const settings = await window.api.loadSettings();
    const map = (settings && settings.skipPorts) || {};
    const prefix = `${profileName}|`;
    let changed = false;
    for (const k of Object.keys(map)) {
      if (k.startsWith(prefix)) { delete map[k]; changed = true; }
    }
    if (changed) await window.api.saveSettings({ skipPorts: map });
  } catch {}
}

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

  // Show the empty-state hint when there's literally nothing wirable.
  // A profile with declared direct groups but no instruments is still
  // wirable — render the direct cards.
  if (p.instruments.length === 0 && (p.directGroups || []).length === 0) {
    pane.innerHTML = '<div class="empty">Add an instrument from the Instruments tab — or a direct mapping group from the Direct tab — to start wiring.</div>';
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

  // Build the filtered card list. Each entry is { kind: 'gauge'|'direct',
  // status, title, render: () => HTMLElement }. The filter bar narrows
  // by search (substring of title) / status / kind, then we render
  // whatever survives. Cards are still rendered as full DOM (not
  // markup strings) because the gauge-card / direct-group-card
  // builders return Elements that need post-render select-value
  // wiring.
  const cards = [];
  for (const pn of p.instruments) {
    const inst = INSTRUMENTS.find(i => i.pn === pn);
    if (!inst) continue;
    const view = p.chain.instruments.find(v => v.pn === pn) || { inputs: [], outputGroups: [] };
    const stats = computeGaugeCompletion(inst, p);
    const status = stats.broken > 0 ? 'broken'
      : (stats.complete ? 'complete'
        : ((stats.inputs.wired + stats.outputs.wired) === 0 ? 'none' : 'partial'));
    cards.push({
      kind: 'gauge',
      status,
      title: `${inst.name || ''} ${inst.pn || ''}`.toLowerCase(),
      render: () => renderInstrumentCard(inst, view),
    });
  }
  for (let gi = 0; gi < (p.directGroups || []).length; gi++) {
    const group = p.directGroups[gi];
    const inputs = group.inputs || [];
    const groupEdges = (p.chain.edges || []).filter(e =>
      e.stage === 'direct' && e.directGroupId === group.id
    );
    const wiredCount = inputs.filter(inp => {
      if (!inp.sourceSignalId) return false;
      const e = groupEdges.find(x => x.directInputId === inp.id);
      return !!(e && e.dst);
    }).length;
    const total = inputs.length;
    const status = total === 0 ? 'none'
      : (wiredCount === 0 ? 'none'
        : (wiredCount === total ? 'complete' : 'partial'));
    cards.push({
      kind: 'direct',
      status,
      title: (group.name || '').toLowerCase(),
      render: () => renderDirectGroupMappingCard(group, gi),
    });
  }
  const filter = mapSearch.trim().toLowerCase();
  const filteredCards = cards.filter(c => {
    if (mapTypeFilter !== 'all' && c.kind !== mapTypeFilter) return false;
    if (mapStatusFilter !== 'all' && c.status !== mapStatusFilter) return false;
    if (filter && !c.title.includes(filter)) return false;
    return true;
  });

  // Toolbar now has a filter bar matching the Instruments tab pattern.
  // The descriptive paragraph that used to live up here moved to a
  // smaller hint below the filter bar so the filter controls have
  // priority real estate.
  let html = `
    <div class="filter-bar">
      <input type="search" placeholder="Search cards…" value="${escHtml(mapSearch)}"
             oninput="mapSearch=this.value;renderMappings()"/>
      <select onchange="mapTypeFilter=this.value;renderMappings()">
        <option value="all"    ${mapTypeFilter==='all'?'selected':''}>All types</option>
        <option value="gauge"  ${mapTypeFilter==='gauge'?'selected':''}>Gauges</option>
        <option value="direct" ${mapTypeFilter==='direct'?'selected':''}>Direct groups</option>
      </select>
      <select onchange="mapStatusFilter=this.value;renderMappings()">
        <option value="all"      ${mapStatusFilter==='all'?'selected':''}>All statuses</option>
        <option value="complete" ${mapStatusFilter==='complete'?'selected':''}>Fully wired</option>
        <option value="partial"  ${mapStatusFilter==='partial'?'selected':''}>Partially wired</option>
        <option value="none"     ${mapStatusFilter==='none'?'selected':''}>Not wired</option>
        <option value="broken"   ${mapStatusFilter==='broken'?'selected':''}>Broken</option>
      </select>
      <span style="font-size:11px;color:var(--text-secondary)">${filteredCards.length} of ${cards.length} card${cards.length!==1?'s':''}</span>
      <button class="btn-sm" onclick="setAllGaugeCardsOpen(true)">Expand all</button>
      <button class="btn-sm" onclick="setAllGaugeCardsOpen(false)">Collapse all</button>
    </div>`;
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

  if (filteredCards.length === 0) {
    container.innerHTML = cards.length === 0
      ? ''
      : '<div class="empty">No cards match the current filter.</div>';
    return;
  }
  for (const c of filteredCards) {
    container.appendChild(c.render());
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
      // Ports the user explicitly marked "skip" don't need to be wired —
      // they count as satisfied for completion purposes. Used for outputs
      // the rig deliberately doesn't drive (e.g. standby ADI's digital
      // OFF flag on rigs without a digital out for it).
      if (isPortSkipped(inst.pn, portTpl.port)) continue;
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
  // Pass the currently-selected device so PoKeys can scope its
  // channel-group list to that board's declared outputs.
  const hint = driver ? effectiveDriverHint(driver, edge?.dstDriverDevice) : null;
  const skipped = isPortSkipped(inst.pn, portTpl.port);

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
    deviceOpts += hint.devices.map(d => {
      const label = (typeof hint.deviceLabel === 'function')
        ? hint.deviceLabel(d)
        : String(d);
      return `<option value="${escHtml(String(d))}">${escHtml(label)}</option>`;
    }).join('');
  }

  // Channel dropdown — depends on driver. Three precedence levels:
  //   1. channelGroups (per-driver, kind-grouped via <optgroup>) — used
  //      by PoKeys where users declare named outputs in three kinds.
  //   2. channels (flat list of strings) — most drivers.
  //   3. channelCount + formatChannel (numeric range) — AnalogDevices.
  // If the current edge points at a channel that's NOT in the dropdown
  // (e.g. user removed the declaration in Hardware Config but never
  // un-wired the edge), append it as an extra disabled option so the
  // user sees what's broken instead of the dropdown silently snapping
  // to "—".
  let channelOpts = '<option value="">—</option>';
  let channelInList = false;
  const currentChannel = edge?.dstDriverChannel ?? '';
  if (hint) {
    if (Array.isArray(hint.channelGroups) && hint.channelGroups.length) {
      for (const grp of hint.channelGroups) {
        channelOpts += `<optgroup label="${escHtml(grp.label)}">`;
        for (const c of grp.channels) {
          const v = typeof c === 'string' ? c : c.value;
          const lbl = typeof c === 'string' ? c : (c.label || c.value);
          if (v === currentChannel) channelInList = true;
          channelOpts += `<option value="${escHtml(v)}">${escHtml(lbl)}</option>`;
        }
        channelOpts += '</optgroup>';
      }
    } else if (hint.channels) {
      for (const c of hint.channels) {
        if (c === currentChannel) channelInList = true;
        channelOpts += `<option value="${escHtml(c)}">${escHtml(c)}</option>`;
      }
    } else if (hint.channelCount) {
      for (let c = 0; c < hint.channelCount; c++) {
        if (String(c) === String(currentChannel)) channelInList = true;
        channelOpts += `<option value="${c}">${hint.formatChannel(c)}</option>`;
      }
    }
  }
  if (currentChannel && !channelInList) {
    // Edge points at a channel the dropdown doesn't surface (likely
    // because the user removed the declaration). Show it as a stale
    // option so they can see and fix the orphaned wiring.
    channelOpts += `<option value="${escHtml(currentChannel)}" selected>${escHtml(currentChannel)} — not declared</option>`;
  }

  const roleLabel = portTpl.role === 'sin' ? 'sin' : portTpl.role === 'cos' ? 'cos' : '';

  // Conflict check: is this row's destination shared with other edges?
  // Skipped ports never warn — the user explicitly opted out, so flagging
  // a "shared with N other" or "kind mismatch" for an intentionally-blank
  // row would be noise.
  let conflictHtml = '';
  let rowClass = 'map-channel-row' + (skipped ? ' map-channel-row-skipped' : '');
  if (!skipped && edge && edge.dstDriver && edge.dstDriverChannel != null && edge.dstDriverChannel !== '') {
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
  if (!skipped && edge && edge.dstDriver && edge.dstDriverChannel != null && edge.dstDriverChannel !== '') {
    const driverKind = getChannelKind(edge.dstDriver, edge.dstDriverChannel);
    if (driverKind && portTpl.kind && driverKind !== portTpl.kind) {
      rowClass += ' map-channel-row-conflict';
      const portKindLabel = portTpl.kind === 'digital' ? 'digital' : 'analog';
      const driverKindLabel = driverKind === 'digital' ? 'digital' : 'analog';
      const tooltip = `Gauge port "${portTpl.port}" is ${portKindLabel}, but the selected ${edge.dstDriver} channel is ${driverKindLabel}. SimLinkup will crash at runtime trying to cast a ${portKindLabel} signal to a ${driverKindLabel} one. Pick a ${portKindLabel}-capable channel instead.`;
      kindMismatchHtml = `<div class="map-channel-conflict" title="${escHtml(tooltip)}">⚠ kind mismatch — ${escHtml(portKindLabel)} port wired to ${escHtml(driverKindLabel)} channel</div>`;
    }
  }

  // Skip toggle — small checkbox + label to the right of the channel
  // dropdown. When checked, the row's dropdowns disable and completion
  // counts the port as satisfied. Tooltip explains the intent so a future
  // user inheriting the profile understands why a port is intentionally
  // blank.
  const skipToggleHtml = `
    <label class="map-channel-skip"
           title="Mark this output as intentionally not wired. The gauge's completion pill won't count it as missing.">
      <input type="checkbox" ${skipped ? 'checked' : ''}
             onchange="setPortSkipped('${inst.pn}','${portTpl.port}', this.checked)"/>
      <span>skip</span>
    </label>`;

  // Dropdowns are disabled when skipped — picking a driver while the row
  // is marked skip would be contradictory. To wire the port, the user
  // unchecks skip first.
  const dropdownsDisabled = skipped;

  return `
    <div class="${rowClass}">
      ${skipToggleHtml}
      <div class="map-channel-role">${escHtml(roleLabel)}</div>
      <div class="map-channel-port">${inst.pn.replace(/-/g, '')}_${escHtml(portTpl.port)}</div>
      <div class="map-channel-arrow">→</div>
      <select data-output-driver="${escHtml(portTpl.port)}"
              ${dropdownsDisabled ? 'disabled' : ''}
              onchange="onSetDriverForOutputPort('${inst.pn}','${portTpl.port}','${portTpl.kind}',this.value)">
        ${driverOpts}
      </select>
      <select data-output-device="${escHtml(portTpl.port)}" ${(driver && !dropdownsDisabled) ? '' : 'disabled'}
              onchange="onSetChannelForOutputPort('${inst.pn}','${portTpl.port}','device',this.value)">
        ${deviceOpts}
      </select>
      <select data-output-channel="${escHtml(portTpl.port)}" ${(driver && !dropdownsDisabled) ? '' : 'disabled'}
              onchange="onSetChannelForOutputPort('${inst.pn}','${portTpl.port}','channel',this.value)">
        ${channelOpts}
      </select>
    </div>
    ${conflictHtml}
    ${kindMismatchHtml}`;
}

// ── Direct group rendering ──────────────────────────────────────────────────
//
// One card per direct mapping group declared in the Direct tab. Each
// row inside the card is sim-source → driver-output, with no gauge in
// between. Reuses the channel-options/conflict/kind-mismatch logic
// from the gauge output rows where it applies, but the row layout is
// simpler (no role/port columns — every row is one input directly).

function renderDirectGroupMappingCard(group, groupIdx) {
  const card = document.createElement('details');
  card.className = 'instrument-card';
  card.dataset.directGroupId = group.id;
  const p = profiles[activeIdx];
  if (_mappingsOpen.has(`${p.name}|direct:${group.id}`)) card.open = true;
  card.addEventListener('toggle', () => {
    const key = `${p.name}|direct:${group.id}`;
    if (card.open) _mappingsOpen.add(key); else _mappingsOpen.delete(key);
  });

  const inputs = group.inputs || [];
  const groupEdges = (p.chain.edges || []).filter(e =>
    e.stage === 'direct' && e.directGroupId === group.id
  );
  // "Wired" here means the destination is set. The source is picked
  // in the Direct tab; without a source the row's src is empty and
  // nothing routes — but if the user has picked a destination on the
  // Mappings tab and forgotten to come back to the Direct tab, that's
  // a half-wired state and we count it as not yet complete. Only
  // (sourceSignalId AND dst) counts as fully wired.
  const wiredCount = inputs.filter(inp => {
    if (!inp.sourceSignalId) return false;
    const e = groupEdges.find(x => x.directInputId === inp.id);
    return !!(e && e.dst);
  }).length;
  const total = inputs.length;
  const status = total === 0
    ? 'empty'
    : (wiredCount === 0 ? 'none'
      : (wiredCount === total ? 'complete' : 'partial'));
  const pillText = total === 0 ? '—' : (wiredCount === total ? `${wiredCount}/${total} ✓` : `${wiredCount}/${total}`);
  const pillTitle = total === 0 ? 'No inputs declared in the Direct tab.' : `${wiredCount} of ${total} input${total === 1 ? '' : 's'} wired`;

  const rowsHtml = inputs.length
    ? inputs.map(inp => renderDirectMappingRow(group, inp)).join('')
    : `<div class="empty" style="padding:14px">No inputs declared yet. Add them in the <strong>Direct</strong> tab.</div>`;

  const simLabel = (() => {
    const ss = SIM_SUPPORTS.find(s => s.id === group.simId);
    return ss ? ss.label : (group.simId || '(no sim)');
  })();

  // Per-group "All" test toggle — same green-on/grey-off pattern as
  // the per-row buttons. Rendered only when at least one row in the
  // group has a PoKeys destination wired. Tracks state in
  // _pokeysTestState under a synthetic group key so the toggle
  // visibly latches across re-renders. The "all" state is computed
  // from per-output cached states: if EVERY wired output is ON, the
  // group toggle reads ON; otherwise it reads OFF (clicking it then
  // sets every output ON, regardless of mixed prior state). Mirrors
  // how a real "ALL" master switch works on a panel.
  const pokeysTaskList = _pokeysGroupTaskList(group);
  const hasPokeysDestinations = pokeysTaskList.length > 0;
  const allOn = hasPokeysDestinations && pokeysTaskList.every(t => {
    const cur = _pokeysTestState.get(_pokeysTestKey(t.serial, t.kind, t.index));
    if (t.kind === 'pwm') return typeof cur === 'number' && cur > 0;
    return cur === 1 || cur === true;
  });
  const allTestHtml = hasPokeysDestinations
    ? `<div class="map-direct-test-toolbar">
         <button class="map-test-toggle ${allOn ? 'on' : 'off'}"
                 onclick="onAllPoKeysTest('${escHtml(group.id)}', ${!allOn})"
                 title="Latch every wired PoKeys output in this group ${allOn ? 'OFF' : 'ON'}. Currently: ${allOn ? 'all ON' : 'mixed/all OFF'}.">
           ALL ${allOn ? 'ON' : 'OFF'}
         </button>
       </div>`
    : '';

  card.innerHTML = `
    <summary class="instrument-card-head instrument-card-head-${status}">
      <span class="instrument-card-chevron" aria-hidden="true">▸</span>
      <div class="instrument-card-headline">
        <div class="instrument-card-title">${escHtml(group.name || '(unnamed direct group)')}</div>
        <div class="instrument-card-pn">Direct mapping · ${escHtml(simLabel)}</div>
      </div>
      <span class="completion-pill completion-pill-${status}" title="${escHtml(pillTitle)}">${escHtml(pillText)}</span>
    </summary>
    <div class="map-section-head">Direct routes (sim → hardware)</div>
    ${allTestHtml}
    ${rowsHtml}
  `;

  // Wire up dropdown values that the template can't safely set
  // inline (innerHTML attribute injection of selected= would clash
  // with the optgroup-based options). For each row, set the
  // driver/device/channel selects from the edge's
  // dstDriver/Device/Channel. Source is pinned in the Direct tab
  // and shown as a read-only label in the row, so no source select
  // to wire here.
  for (const inp of inputs) {
    const edge = groupEdges.find(e => e.directInputId === inp.id);
    const drvSel = card.querySelector(`select[data-direct-driver="${inp.id}"]`);
    if (drvSel) setSelectValue(drvSel, edge?.dstDriver || '');
    const devSel = card.querySelector(`select[data-direct-device="${inp.id}"]`);
    if (devSel) setSelectValue(devSel, edge?.dstDriverDevice ?? '');
    const chSel = card.querySelector(`select[data-direct-channel="${inp.id}"]`);
    if (chSel) setSelectValue(chSel, edge?.dstDriverChannel ?? '');
  }

  return card;
}

function renderDirectMappingRow(group, input) {
  const p = profiles[activeIdx];
  const edge = (p.chain.edges || []).find(e =>
    e.stage === 'direct' && e.directGroupId === group.id && e.directInputId === input.id
  );
  const driver = edge?.dstDriver || '';
  const hint = driver ? effectiveDriverHint(driver, edge?.dstDriverDevice) : null;

  // Source label — derived from the input's chosen sim signal in the
  // Direct tab. Read-only here; the user picks/changes it on that tab.
  // Falls back to "(no source — pick one in the Direct tab)" so an
  // unsourced row tells the user where to fix it.
  const sourceLabel = (() => {
    if (!input.sourceSignalId) return '(no source — pick one in the Direct tab)';
    const signal = (SIM_SIGNALS[group.simId]?.scalar || []).find(s => s.id === input.sourceSignalId);
    return signal?.label || input.sourceSignalId;
  })();
  const sourceMissing = !!(input.sourceSignalId && !(SIM_SIGNALS[group.simId]?.scalar || []).find(s => s.id === input.sourceSignalId));

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

  let deviceOpts = '<option value="">—</option>';
  if (hint && hint.devices) {
    deviceOpts += hint.devices.map(d => {
      const label = (typeof hint.deviceLabel === 'function')
        ? hint.deviceLabel(d)
        : String(d);
      return `<option value="${escHtml(String(d))}">${escHtml(label)}</option>`;
    }).join('');
  }

  // Channel dropdown — same channelGroups / channels / channelCount
  // dispatch as the gauge output row, factored into a tiny helper for
  // readability.
  const currentChannel = edge?.dstDriverChannel ?? '';
  const channelOpts = (() => {
    let opts = '<option value="">—</option>';
    let inList = false;
    if (hint) {
      if (Array.isArray(hint.channelGroups) && hint.channelGroups.length) {
        for (const grp of hint.channelGroups) {
          opts += `<optgroup label="${escHtml(grp.label)}">`;
          for (const c of grp.channels) {
            const v = typeof c === 'string' ? c : c.value;
            const lbl = typeof c === 'string' ? c : (c.label || c.value);
            if (v === currentChannel) inList = true;
            opts += `<option value="${escHtml(v)}">${escHtml(lbl)}</option>`;
          }
          opts += '</optgroup>';
        }
      } else if (hint.channels) {
        for (const c of hint.channels) {
          if (c === currentChannel) inList = true;
          opts += `<option value="${escHtml(c)}">${escHtml(c)}</option>`;
        }
      } else if (hint.channelCount) {
        for (let c = 0; c < hint.channelCount; c++) {
          if (String(c) === String(currentChannel)) inList = true;
          opts += `<option value="${c}">${hint.formatChannel(c)}</option>`;
        }
      }
    }
    if (currentChannel && !inList) {
      opts += `<option value="${escHtml(currentChannel)}" selected>${escHtml(currentChannel)} — not declared</option>`;
    }
    return opts;
  })();

  // Kind mismatch — same logic as gauge output rows but the source
  // signal supplies the kind (analog/digital) instead of a port
  // template. Looked up from SIM_SIGNALS for the input's chosen
  // source.
  let kindMismatchHtml = '';
  if (edge && edge.dstDriver && edge.dstDriverChannel != null && edge.dstDriverChannel !== '' && input.sourceSignalId) {
    const signal = (SIM_SIGNALS[group.simId]?.scalar || []).find(s => s.id === input.sourceSignalId);
    const sourceKind = signal?.kind === 'digital' ? 'digital' : (signal?.kind === 'analog' ? 'analog' : null);
    const driverKind = getChannelKind(edge.dstDriver, edge.dstDriverChannel);
    if (sourceKind && driverKind && sourceKind !== driverKind) {
      const tooltip = `Source signal "${edge.src}" is ${sourceKind}, but the selected ${edge.dstDriver} channel is ${driverKind}. SimLinkup will crash at runtime trying to cast a ${sourceKind} signal to a ${driverKind} one.`;
      kindMismatchHtml = `<div class="map-channel-conflict" title="${escHtml(tooltip)}">⚠ kind mismatch — ${escHtml(sourceKind)} source wired to ${escHtml(driverKind)} channel</div>`;
    }
  }

  // Invalid-source flag (mirror gauge stage-1 rows). Two cases here:
  //   - The chosen sim signal isn't in the catalog (sim removed,
  //     catalog refreshed, etc). `sourceMissing` is the local check.
  //   - The active edge was already flagged invalid by
  //     refreshInvalidEdgeFlags (catches both cases through a single
  //     code path).
  let invalidHint = '';
  if ((sourceMissing || (edge && edge.invalid)) && !_suppressInvalidRowHint) {
    invalidHint = `<div class="map-channel-conflict" title="Source signal not in the declared sim's catalog">⚠ source signal not found in catalog</div>`;
  }

  // Per-row test control. Only meaningful when the row's destination
  // is a PoKeys output AND the dropdowns are filled in. Renders a
  // toggle for digital/extbus and a slider for PWM. Disabled when
  // unwired so the user doesn't click a no-op. Test state is latched
  // across renders via _pokeysTestState (cleared on profile switch).
  // Pass group + input ids through so the handler can resolve to
  // the sim source signal at call time — used to route through
  // SimLinkup's pipeline when SimLinkup is running.
  const testControlHtml = renderPoKeysTestControlHtml(edge, group.id, input.id);

  return `
    <div class="map-direct-row">
      <div class="map-direct-label" title="${escHtml(input.sourceSignalId || '')}">${escHtml(sourceLabel)}</div>
      <div class="map-channel-arrow">→</div>
      <select data-direct-driver="${escHtml(input.id)}"
              onchange="onSetDirectDriver('${escHtml(group.id)}','${escHtml(input.id)}',this.value)">
        ${driverOpts}
      </select>
      <select data-direct-device="${escHtml(input.id)}" ${driver ? '' : 'disabled'}
              onchange="onSetDirectChannel('${escHtml(group.id)}','${escHtml(input.id)}','device',this.value)">
        ${deviceOpts}
      </select>
      <select data-direct-channel="${escHtml(input.id)}" ${driver ? '' : 'disabled'}
              onchange="onSetDirectChannel('${escHtml(group.id)}','${escHtml(input.id)}','channel',this.value)">
        ${channelOpts}
      </select>
      ${testControlHtml}
    </div>
    ${invalidHint}
    ${kindMismatchHtml}`;
}

// ── PoKeys test controls (latched test-drive of one output) ─────────────────
//
// The Mappings tab surfaces a small per-row Test affordance for PoKeys
// destinations: a toggle button for digital/extbus, a slider for PWM.
// State is held in _pokeysTestState across re-renders so toggling a
// relay ON, navigating between tabs, and coming back leaves the
// button green (the relay is still latched ON on the device).
//
// Cleared on profile switch — switching profiles is a strong signal
// that the user is done with whatever they were testing.

const _pokeysTestState = new Map();
function _pokeysTestKey(serial, kind, index) {
  return `${serial}|${kind}|${index}`;
}
function _resetPokeysTestState() { _pokeysTestState.clear(); }

// Parse "DIGITAL_PIN[5]" / "PWM[3]" / "PoExtBus[12]" into {kind, index}.
// Returns null for anything else (no test control rendered).
function _pokeysParseChannel(channel) {
  if (!channel) return null;
  let m = channel.match(/^DIGITAL_PIN\[(\d+)\]$/);
  if (m) return { kind: 'digital', index: parseInt(m[1], 10) };
  m = channel.match(/^PWM\[(\d+)\]$/);
  if (m) return { kind: 'pwm', index: parseInt(m[1], 10) };
  m = channel.match(/^PoExtBus\[(\d+)\]$/);
  if (m) return { kind: 'extbus', index: parseInt(m[1], 10) };
  return null;
}

// Find the per-output config record (for invert/period). Returns null
// if the device or output isn't declared — test still works but
// invert defaults to false and PWM period to 20000us.
function _pokeysOutputConfig(serial, kind, index) {
  const p = profiles[activeIdx];
  const dev = (p?.drivers?.pokeys?.devices || []).find(d => String(d.address) === String(serial));
  if (!dev) return null;
  if (kind === 'digital') return (dev.digitalOutputs || []).find(o => o.pin === index) || null;
  if (kind === 'extbus')  return (dev.extBusOutputs || []).find(o => o.bit === index) || null;
  if (kind === 'pwm')     return { device: dev };  // PWM doesn't carry per-output state; we need the device's period
  return null;
}

function renderPoKeysTestControlHtml(edge, groupId, inputId) {
  // No edge or non-PoKeys destination → no control. We render a
  // placeholder span anyway so the grid stays balanced (otherwise
  // PoKeys rows would be wider than non-PoKeys rows in mixed groups).
  if (!edge || edge.dstDriver !== 'pokeys') {
    return '<span class="map-test-cell"></span>';
  }
  const serial = edge.dstDriverDevice;
  const parsed = _pokeysParseChannel(edge.dstDriverChannel);
  if (!serial || !parsed) {
    return '<span class="map-test-cell map-test-cell-disabled" title="Pick a destination first">—</span>';
  }
  const key = _pokeysTestKey(serial, parsed.kind, parsed.index);
  const current = _pokeysTestState.get(key);
  // groupId/inputId thread into the handlers so they can resolve
  // back to the sim source signal id at call time. That's needed
  // when SimLinkup is running — the handler then routes the test
  // value through setSignals (sim shared memory) instead of
  // setPoKeysOutput (direct USB), avoiding the cross-process
  // device contention that crashes SimLinkup.
  const gIdAttr = escHtml(groupId || '');
  const iIdAttr = escHtml(inputId || '');
  if (parsed.kind === 'pwm') {
    const v = typeof current === 'number' ? current : 0;
    const pct = Math.round(v * 100);
    return `
      <span class="map-test-cell">
        <input type="range" class="map-test-pwm" min="0" max="1" step="0.01" value="${v}"
               oninput="onPoKeysTestPwmInput('${escHtml(serial)}',${parsed.index},this.value,this)"
               onchange="onPoKeysTestPwmCommit('${escHtml(serial)}',${parsed.index},this.value,'${gIdAttr}','${iIdAttr}')"
               title="Test drive: 0..1 duty cycle (latched on the device)"/>
        <span class="map-test-pwm-label">${pct}%</span>
      </span>`;
  }
  // digital + extbus → toggle button. Green when ON, grey when OFF.
  const on = current === 1 || current === true;
  return `
    <span class="map-test-cell">
      <button class="map-test-toggle ${on ? 'on' : 'off'}"
              onclick="onPoKeysTestToggle('${escHtml(serial)}','${escHtml(parsed.kind)}',${parsed.index},'${gIdAttr}','${iIdAttr}')"
              title="Test drive: latched ${on ? 'ON' : 'OFF'} on the device. Click to flip.">
        ${on ? 'ON' : 'OFF'}
      </button>
    </span>`;
}

// Tracks which sim bridges have an open session. The bridge's
// setSignals refuses with "Session not open" until OpenSession runs
// once; we lazily call startSession on first write per sim and cache
// that fact so subsequent writes skip the round-trip. Invalidated
// when startSession itself fails (e.g. user started BMS between
// writes — the existing in-bridge guard refuses and we'll retry on
// next click). Also invalidated on profile switch.
const _bridgeSessionsOpen = new Set();
async function _ensureBridgeSession(simId) {
  if (!simId) return { ok: false, error: 'No sim id for this group.' };
  if (_bridgeSessionsOpen.has(simId)) return { ok: true };
  let result;
  try {
    // allowSimRunning: true — the test path doesn't care that the
    // sim might overwrite our value on its next tick. We just need
    // SimLinkup to see the bit briefly so it routes to the relay.
    result = await window.api.bridge.startSession(simId, { allowSimRunning: true });
  } catch (e) { return { ok: false, error: e?.message || 'startSession threw' }; }
  if (result?.ok) {
    _bridgeSessionsOpen.add(simId);
    return { ok: true };
  }
  return { ok: false, error: result?.error || 'startSession failed' };
}
function _resetBridgeSessions() { _bridgeSessionsOpen.clear(); }

// Cache the SimLinkup-running check briefly. The bridge call now
// uses OpenMutex on a kernel mutex SimLinkup creates at startup
// (was previously a `tasklist` shellout, which was taking ~3 s on
// machines with AV process-enumeration hooks). At sub-millisecond
// per-call the cache isn't strictly needed, but kept so a burst of
// "All On" clicks stays predictable and a real "user just stopped
// SimLinkup" transition isn't hidden for more than 2 s.
let _simLinkupRunningCache = { value: null, at: 0 };
async function _isSimLinkupRunning() {
  const now = Date.now();
  if (_simLinkupRunningCache.value !== null && now - _simLinkupRunningCache.at < 2000) {
    return _simLinkupRunningCache.value;
  }
  let running = false;
  try {
    const result = await window.api.isSimLinkupRunning();
    running = !!(result && result.running);
  } catch { /* assume not running on error */ }
  _simLinkupRunningCache = { value: running, at: now };
  return running;
}
function _invalidateSimLinkupRunningCache() {
  _simLinkupRunningCache = { value: null, at: 0 };
}

// Resolve a PoKeys test task to (path, payload) — either route via
// SimLinkup's pipeline (write to sim shared memory) when SimLinkup
// is running and the task has a sourceSignalId, OR route directly
// to the device via setPoKeysOutput.
//
// Returns { ok, path: 'simlinkup'|'direct', error? }. The caller
// performs the actual bridge call so it can manage cached-state
// optimism and per-task error handling.
//
// `task` shape: { serial, kind, index, value, invert,
//                 pwmPeriodMicroseconds, sourceSignalId, simId }
async function _routePoKeysTestTask(task) {
  if (task.sourceSignalId && task.simId && await _isSimLinkupRunning()) {
    const session = await _ensureBridgeSession(task.simId);
    if (!session.ok) return { ok: false, path: 'simlinkup', error: session.error };
    const result = await window.api.bridge.setSignals(task.simId, {
      [task.sourceSignalId]: task.value,
    });
    if (!result?.ok) {
      if (/session not open/i.test(result?.error || '')) {
        _bridgeSessionsOpen.delete(task.simId);
      }
      return { ok: false, path: 'simlinkup', error: result?.error || 'unknown error' };
    }
    return { ok: true, path: 'simlinkup' };
  }
  // SimLinkup not running — bridge has the device to itself.
  const result = await window.api.bridge.setPoKeysOutput({
    serial: Number(task.serial),
    kind: task.kind,
    index: task.index,
    value: task.value,
    invert: !!task.invert,
    pwmPeriodMicroseconds: task.pwmPeriodMicroseconds || 20000,
  });
  if (!result?.ok) return { ok: false, path: 'direct', error: result?.error || 'unknown error' };
  return { ok: true, path: 'direct' };
}

// Resolve a (serial, kind, index, groupId, inputId) tuple from a
// per-row click into the (sourceSignalId, simId) needed for the
// SimLinkup-routing path. Returns null when the group/input lookup
// fails (e.g. stale UI vs. mutated state) — callers should fall
// through to direct routing in that case.
function _pokeysTestSourceFor(groupId, inputId) {
  const p = profiles[activeIdx];
  const group = (p?.directGroups || []).find(g => g.id === groupId);
  if (!group) return null;
  const input = (group.inputs || []).find(i => i.id === inputId);
  if (!input) return null;
  return { sourceSignalId: input.sourceSignalId || '', simId: group.simId || '' };
}

// Toggle one digital pin or PoExtBus bit. Optimistically flips the
// cached state, sends the bridge call (via _routePoKeysTestTask
// which picks the right path), reverts on error.
async function onPoKeysTestToggle(serial, kind, index, groupId, inputId) {
  const key = _pokeysTestKey(serial, kind, index);
  const wasOn = _pokeysTestState.get(key) === 1 || _pokeysTestState.get(key) === true;
  const newOn = !wasOn;
  _pokeysTestState.set(key, newOn ? 1 : 0);
  renderMappings();
  const cfg = _pokeysOutputConfig(serial, kind, index) || {};
  const src = _pokeysTestSourceFor(groupId, inputId) || {};
  const result = await _routePoKeysTestTask({
    serial, kind, index,
    value: newOn ? 1 : 0,
    invert: !!cfg.invert,
    pwmPeriodMicroseconds: cfg.device?.pwmPeriodMicroseconds || 20000,
    sourceSignalId: src.sourceSignalId,
    simId: src.simId,
  });
  if (!result?.ok) {
    _pokeysTestState.set(key, wasOn ? 1 : 0);
    renderMappings();
    toast(`PoKeys test failed: ${result.error}`);
  }
}

// Live PWM slider: update the cached value + label immediately for
// responsive UI, but DON'T fire a bridge call on every input event
// — too chatty. Wait for the change event (mouse-up) to commit.
function onPoKeysTestPwmInput(serial, index, value, sliderEl) {
  const v = parseFloat(value);
  if (!Number.isFinite(v)) return;
  _pokeysTestState.set(_pokeysTestKey(serial, 'pwm', index), v);
  // Update the inline label without a full re-render so the slider
  // doesn't lose mouse-tracking.
  const label = sliderEl?.parentElement?.querySelector('.map-test-pwm-label');
  if (label) label.textContent = `${Math.round(v * 100)}%`;
}

async function onPoKeysTestPwmCommit(serial, index, value, groupId, inputId) {
  const v = parseFloat(value);
  if (!Number.isFinite(v)) return;
  _pokeysTestState.set(_pokeysTestKey(serial, 'pwm', index), v);
  const cfg = _pokeysOutputConfig(serial, 'pwm', index) || {};
  const src = _pokeysTestSourceFor(groupId, inputId) || {};
  const result = await _routePoKeysTestTask({
    serial, kind: 'pwm', index,
    value: v,
    pwmPeriodMicroseconds: cfg.device?.pwmPeriodMicroseconds || 20000,
    sourceSignalId: src.sourceSignalId,
    simId: src.simId,
  });
  if (!result?.ok) {
    toast(`PoKeys PWM test failed: ${result.error}`);
  }
}

// Walk a direct group's wired PoKeys destinations and produce a
// task list ready to feed into the bridge's setOutput command. Used
// by the renderer to compute "are all currently ON?" for the group
// toggle's visual state, and by the handler to actually fire the
// bridge calls. Empty array when the group has no PoKeys
// destinations — caller checks this to suppress the toggle.
function _pokeysGroupTaskList(group) {
  const p = profiles[activeIdx];
  if (!p || !group) return [];
  const tasks = [];
  for (const inp of (group.inputs || [])) {
    const edge = (p.chain.edges || []).find(e =>
      e.stage === 'direct' && e.directGroupId === group.id && e.directInputId === inp.id
    );
    if (!edge || edge.dstDriver !== 'pokeys' || !edge.dst) continue;
    const parsed = _pokeysParseChannel(edge.dstDriverChannel);
    if (!parsed || !edge.dstDriverDevice) continue;
    const cfg = _pokeysOutputConfig(edge.dstDriverDevice, parsed.kind, parsed.index) || {};
    tasks.push({
      serial: Number(edge.dstDriverDevice),
      kind: parsed.kind,
      index: parsed.index,
      invert: !!cfg.invert,
      pwmPeriodMicroseconds: cfg.device?.pwmPeriodMicroseconds || 20000,
      // sourceSignalId + simId let _routePoKeysTestTask pick the
      // SimLinkup-shared-memory path when SimLinkup is running.
      sourceSignalId: inp.sourceSignalId || '',
      simId: group.simId || '',
    });
  }
  return tasks;
}

// All-On / All-Off for a single direct group. Walks every wired
// PoKeys destination via _pokeysGroupTaskList and sends one bridge
// call per output. Bridge calls are sequential (await per call) so
// we don't flood the device with concurrent connections — each takes
// maybe 50-100 ms, so a group of 20 lamps takes ~1.5 s. Acceptable
// for a one-shot test gesture.
async function onAllPoKeysTest(groupId, on) {
  const p = profiles[activeIdx];
  const group = (p.directGroups || []).find(g => g.id === groupId);
  if (!group) return;
  const tasks = _pokeysGroupTaskList(group);
  if (tasks.length === 0) {
    toast('No PoKeys destinations wired in this group.');
    return;
  }
  // Optimistically flip cached state so the per-row toggles AND the
  // group "ALL" toggle visually update before the bridge calls
  // finish. Errors per task revert that task's cached state below.
  for (const task of tasks) {
    const value = on ? 1 : 0;
    _pokeysTestState.set(_pokeysTestKey(task.serial, task.kind, task.index), value);
  }
  renderMappings();
  let failures = 0;
  let firstError = '';
  for (const task of tasks) {
    const result = await _routePoKeysTestTask({ ...task, value: on ? 1 : 0 });
    if (!result?.ok) {
      failures++;
      if (!firstError) firstError = result.error;
      _pokeysTestState.set(_pokeysTestKey(task.serial, task.kind, task.index), on ? 0 : 1);
    }
  }
  if (failures > 0) {
    renderMappings();
    // If every task failed for the same reason (e.g. SimLinkup is
    // running but rows have no source), surface that root cause
    // rather than a generic count.
    const detail = failures === tasks.length && firstError ? `: ${firstError}` : '';
    toast(`${failures} of ${tasks.length} PoKeys output${tasks.length === 1 ? '' : 's'} failed to write${detail}`);
  }
}

// ── Direct edge mutators ────────────────────────────────────────────────────
//
// Mirror of ensureStageTwoEdge / onSetSourceForInputPort / etc. but for
// direct edges. Each direct edge is keyed on (groupId, inputId);
// editing creates the edge if it doesn't exist, mutates if it does,
// and prunes if both src and dst become empty.
function _ensureDirectEdge(p, groupId, inputId) {
  let edge = p.chain.edges.find(e =>
    e.stage === 'direct' && e.directGroupId === groupId && e.directInputId === inputId
  );
  if (!edge) {
    edge = {
      stage: 'direct',
      src: '', dst: '',
      kind: 'analog',  // updated when source kind is known
      srcGaugePn: null, srcGaugePort: null,
      dstKind: 'driver',
      dstGaugePn: null, dstGaugePort: null,
      dstDriver: null, dstDriverDevice: null, dstDriverChannel: null,
      directGroupId: groupId, directInputId: inputId,
    };
    p.chain.edges.push(edge);
  }
  return edge;
}

function _pruneDirectEdgeIfEmpty(p, groupId, inputId) {
  p.chain.edges = p.chain.edges.filter(e => {
    if (e.stage !== 'direct') return true;
    if (e.directGroupId !== groupId || e.directInputId !== inputId) return true;
    return e.src || e.dst;
  });
}

function onSetDirectDriver(groupId, inputId, driver) {
  const p = profiles[activeIdx];
  const edge = _ensureDirectEdge(p, groupId, inputId);
  edge.dstDriver = driver || null;
  edge.dstDriverDevice = null;
  edge.dstDriverChannel = null;
  edge.dst = '';
  edge.dstKind = driver ? 'driver' : 'unknown';
  _pruneDirectEdgeIfEmpty(p, groupId, inputId);
  renderMappings();
}

function onSetDirectChannel(groupId, inputId, field, value) {
  const p = profiles[activeIdx];
  const edge = (p.chain.edges || []).find(e =>
    e.stage === 'direct' && e.directGroupId === groupId && e.directInputId === inputId
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
  _pruneDirectEdgeIfEmpty(p, groupId, inputId);
  renderMappings();
}
