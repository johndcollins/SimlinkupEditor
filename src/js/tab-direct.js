// ── Direct mappings tab ──────────────────────────────────────────────────────
//
// Catalog of "direct mapping groups" — user-named buckets of sim
// signals that route straight to a hardware output without going
// through a gauge HSM. Used for cockpit lamps, panel relays, and any
// pass-through where the user wants the raw sim value at hardware
// without an intermediate transform.
//
// Each group on this tab gets a card in the Mappings tab too, where
// the actual sim source / driver destination wiring happens. This tab
// is just for declaring the group's identity (name + sim) and naming
// the input rows.
//
// State shape:
//   p.directGroups: [
//     { id: '<uuid>', name: 'Cockpit Lamps', simId: 'falcon4',
//       inputs: [{ id: '<uuid>', label: 'Gear down lamp' }, ...] }
//   ]
//
// On disk: one Direct_<sanitised name>.mapping file per group, with
// XML comments preserving group + input identity across reloads.

function renderDirect() {
  const pane = document.getElementById('pane-direct');
  if (!pane) return;
  const p = profiles[activeIdx];
  if (!p) return;

  const groups = p.directGroups || [];
  const declaredSims = (p.simSupports || []).slice();
  const noSimSupport = declaredSims.length === 0;

  const helpHtml = `
    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
      Direct mappings route a sim signal straight to a hardware output —
      no gauge in between. Useful for cockpit lamps, relays, or any
      pass-through where you want the raw sim value at the output.
      <br/>
      Each group represents a logical batch of related signals (e.g.
      <em>Cockpit Lamps</em>) and writes one
      <code>Direct_&lt;name&gt;.mapping</code> file. After declaring a
      group and its inputs here, switch to <strong>Signal mappings</strong>
      to pick the sim source and hardware destination for each row.
    </div>`;

  const noSimBanner = noSimSupport
    ? `<div class="dir-banner danger" style="margin-bottom:14px;border-radius:var(--radius)">
         <div><div class="dir-banner-text">
           <strong>No SimSupport declared.</strong> Direct mappings need a sim
           to source signals from. Add one in the SimSupport tab first.
         </div></div>
       </div>`
    : '';

  const groupCardsHtml = groups.length
    ? groups.map((g, i) => renderDirectGroupCard(g, i, declaredSims)).join('')
    : `<div class="empty">No direct mappings yet. Click <strong>+ Add direct group</strong> to declare one.</div>`;

  pane.innerHTML = `
    ${helpHtml}
    ${noSimBanner}
    <div class="direct-toolbar">
      <button class="btn-sm btn-primary" onclick="addDirectGroup()" ${noSimSupport ? 'disabled title="Declare a SimSupport first"' : ''}>
        + Add direct group
      </button>
    </div>
    <div id="directGroupCards">${groupCardsHtml}</div>`;
}

function renderDirectGroupCard(group, idx, declaredSims) {
  const inputs = group.inputs || [];
  // Sim dropdown — only declared sims are picks. If the group's
  // current simId isn't declared anymore (e.g. user removed the
  // SimSupport), keep it visible-but-warning so the user can see
  // and fix the orphan rather than the field silently snapping to
  // a different sim.
  const simOptions = (() => {
    const declared = new Set(declaredSims);
    const opts = [];
    if (!group.simId) {
      opts.push(`<option value="" selected>— pick a sim —</option>`);
    }
    for (const ss of SIM_SUPPORTS) {
      if (!declared.has(ss.id) && ss.id !== group.simId) continue;
      const selected = ss.id === group.simId ? 'selected' : '';
      const undeclared = !declared.has(ss.id);
      opts.push(`<option value="${escHtml(ss.id)}" ${selected} ${undeclared ? 'disabled' : ''}>${escHtml(ss.label)}${undeclared ? ' — not declared' : ''}</option>`);
    }
    return opts.join('');
  })();

  // Wired-edge counts for this group: total + invalid (broken source)
  // for the badge, plus per-input counts so individual rows can show
  // their wiring state.
  const p = profiles[activeIdx];
  const groupEdges = (p.chain.edges || []).filter(e => e.stage === 'direct' && e.directGroupId === group.id);
  const wiredCount = groupEdges.filter(e => e.src && e.dst).length;
  const wiredBadge = wiredCount
    ? `<span class="direct-wired-pill" title="${wiredCount} input${wiredCount === 1 ? '' : 's'} wired">${wiredCount} wired</span>`
    : '';

  const inputRowsHtml = inputs.length
    ? inputs.map((inp, ii) => renderDirectInputRow(group, idx, inp, ii, groupEdges)).join('')
    : `<div class="hwconfig-empty-row">No inputs declared. Click <strong>+ Add input</strong> to add one.</div>`;

  return `
    <details class="direct-card" ${(_directOpen.has(`${p.name}|${group.id}`)) ? 'open' : ''}
             ondblclick="event.stopPropagation()"
             ontoggle="onDirectCardToggle('${escHtml(group.id)}', this.open, this)">
      <summary class="direct-card-head">
        <span class="direct-card-chevron">▶</span>
        <div class="direct-card-headline">
          <input type="text" class="direct-card-name"
                 value="${escHtml(group.name || '')}"
                 placeholder="Group name (e.g. Cockpit Lamps)"
                 onclick="event.stopPropagation()"
                 onkeydown="_directSummaryKeyEvent(event)"
                 onkeyup="_directSummaryKeyEvent(event)"
                 onkeypress="_directSummaryKeyEvent(event)"
                 onchange="setDirectGroupName(${idx}, this.value)"/>
          ${wiredBadge}
        </div>
        <select class="direct-card-sim"
                onclick="event.stopPropagation()"
                onkeydown="_directSummaryKeyEvent(event)"
                onkeyup="_directSummaryKeyEvent(event)"
                onkeypress="_directSummaryKeyEvent(event)"
                onchange="setDirectGroupSim(${idx}, this.value)">
          ${simOptions}
        </select>
        <button class="btn-sm btn-danger"
                onclick="event.preventDefault(); event.stopPropagation(); removeDirectGroup(${idx})">
          Remove
        </button>
      </summary>
      <div class="direct-card-body">
        ${inputRowsHtml}
        <div class="direct-card-actions">
          <button class="btn-sm btn-primary" onclick="addDirectInput(${idx})">+ Add input</button>
        </div>
      </div>
    </details>`;
}

function renderDirectInputRow(group, groupIdx, input, inputIdx, groupEdges) {
  // Each input is a single sim-signal pick. The label shown in the
  // Mappings tab is the signal's catalog label, not user-typed —
  // signals already have meaningful names like "Aircraft → BUP_ADI_OFF".
  // The actual destination (driver / board / output) is wired in the
  // Mappings tab; this tab just declares "I want to drive THIS signal
  // somewhere."
  const edge = groupEdges.find(e => e.directInputId === input.id);
  const sourceWired = !!input.sourceSignalId;
  const destWired = !!(edge && edge.dst);
  const wiredHtml = (sourceWired && destWired)
    ? `<span class="direct-input-wired" title="Source picked + destination wired in Signal mappings">✓ wired</span>`
    : sourceWired
      ? `<span class="direct-input-unwired" title="Source picked; pick a destination in Signal mappings">no destination</span>`
      : `<span class="direct-input-unwired" title="Pick a sim signal to drive">no source</span>`;
  return `
    <div class="direct-input-row">
      <select onchange="setDirectInputSource(${groupIdx}, ${inputIdx}, this.value)">
        ${directInputSourceOptionsHtml(group.simId, input.sourceSignalId)}
      </select>
      ${wiredHtml}
      <button class="btn-sm btn-danger"
              onclick="removeDirectInput(${groupIdx}, ${inputIdx})">×</button>
    </div>`;
}

// Build the <option> markup for one direct group's input row. Same
// shape as the Mappings tab's `simSourceOptionsHtml` (one optgroup
// per signal collection) but scoped to a single sim and excluding
// `kind === 'text'` (PoKeys/AD/etc don't drive text outputs).
//
// Caches per (simId, currentValue) so opening N rows in a group
// doesn't rebuild the full optgroup markup N times. Cache invalidates
// when the active profile or sim catalog changes via the same
// renderEditor flow that re-renders the rest of the page.
let _directInputSourceOptionsCache = new Map();
function directInputSourceOptionsHtml(simId, currentValue) {
  const key = `${simId}|${currentValue || ''}`;
  if (_directInputSourceOptionsCache.has(key)) return _directInputSourceOptionsCache.get(key);
  let html = `<option value="" ${currentValue ? '' : 'selected'}>— pick a sim signal —</option>`;
  if (simId) {
    const sim = SIM_SUPPORTS.find(s => s.id === simId);
    const simLabel = sim ? sim.label : simId;
    const signals = (SIM_SIGNALS[simId]?.scalar || []).filter(s => s.kind !== 'text');
    const groups = new Map();
    for (const s of signals) {
      const coll = s.coll || '(uncategorised)';
      if (!groups.has(coll)) groups.set(coll, []);
      groups.get(coll).push(s);
    }
    let foundCurrent = false;
    for (const [coll, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      html += `<optgroup label="${escHtml(`${simLabel} → ${coll}`)}">`;
      for (const s of list.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id))) {
        const selected = s.id === currentValue ? 'selected' : '';
        if (selected) foundCurrent = true;
        html += `<option value="${escHtml(s.id)}" ${selected}>${escHtml(s.label || s.id)}</option>`;
      }
      html += '</optgroup>';
    }
    // If the current value isn't in the catalog (broken source —
    // signal removed from sim catalog after the row was authored),
    // append an explicit option so the user sees what's broken.
    if (currentValue && !foundCurrent) {
      html += `<option value="${escHtml(currentValue)}" selected>${escHtml(currentValue)} — not in catalog</option>`;
    }
  }
  _directInputSourceOptionsCache.set(key, html);
  return html;
}
function _resetDirectInputSourceOptionsCache() {
  _directInputSourceOptionsCache = new Map();
}

// Persist which Direct cards are open across re-renders. Mirrors the
// _mappingsOpen / _hwconfigOpen pattern in the other tabs.
const _directOpen = new Set();
// Set true on the <details> element while we're programmatically
// reverting an unintended toggle, so the synthetic toggle event
// fired by the revert doesn't loop back into the revert path.
const _DIRECT_REVERTING = '__directReverting';

function onDirectCardToggle(groupId, isOpen, detailsEl) {
  const p = profiles[activeIdx];
  if (!p) return;
  // If we're in the middle of a programmatic revert, just clear
  // the flag and return — don't update _directOpen and don't
  // re-check focus (the user's space-press has already been
  // handled).
  if (detailsEl && detailsEl[_DIRECT_REVERTING]) {
    detailsEl[_DIRECT_REVERTING] = false;
    return;
  }
  // Guard against accidental toggles caused by typing Space or
  // Enter in the name input or sim dropdown. Both inputs live
  // inside <summary>, and <details> natively activates on
  // Space/Enter when anything in the summary is focused. We can't
  // reliably suppress that at the key-event level (browsers
  // dispatch a synthetic click on the summary that happens after
  // any keydown/keyup handler runs), so instead we observe the
  // toggle event itself: if the active element is an input or
  // select within this summary, the user clearly didn't mean to
  // toggle — revert and don't update _directOpen.
  if (detailsEl && document.activeElement) {
    const ae = document.activeElement;
    const summary = detailsEl.querySelector(':scope > summary');
    if (summary && summary.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) {
      detailsEl[_DIRECT_REVERTING] = true;
      detailsEl.open = !isOpen;
      return;
    }
  }
  const key = `${p.name}|${groupId}`;
  if (isOpen) _directOpen.add(key); else _directOpen.delete(key);
}

// Inputs and selects nested inside a <summary> bubble their key
// events up to the <details>, which natively toggles on Space and
// Enter when ANYTHING in the summary is focused. The browser
// activates the summary on keyup (not keydown) per the HTML spec,
// but the spec doesn't say which exact event triggers the toggle —
// implementations differ — so we stop propagation on all three
// (keydown / keypress / keyup). preventDefault is NOT used here:
// we still want the input to receive the space character itself,
// just not have the parent <details> see the activation.
//
// Other keys (arrows, tab, alphanumerics, etc.) bubble normally so
// browser defaults like tab-traversal keep working.
function _directSummaryKeyEvent(e) {
  if (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar') {
    e.stopPropagation();
  }
}

// ── Mutators ─────────────────────────────────────────────────────────────────

function _newDirectId() {
  // Electron's renderer has crypto.randomUUID since Chromium 92 / Electron 14.
  // The editor targets recent Electron, so this is safe.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: 12 hex chars from Math.random. Not RFC4122 but unique
  // enough for in-process IDs that never leave the editor.
  return 'd' + Math.random().toString(16).slice(2, 14) + Date.now().toString(16);
}

function addDirectGroup() {
  const p = profiles[activeIdx];
  if (!p) return;
  if (!Array.isArray(p.directGroups)) p.directGroups = [];
  // Default the new group's sim to the first declared SimSupport so
  // the user doesn't have to re-pick it for the common single-sim
  // setup. Renaming and sim re-pick are both cheap on the card.
  const defaultSim = (p.simSupports && p.simSupports[0]) || '';
  const id = _newDirectId();
  p.directGroups.push({
    id,
    name: '',
    simId: defaultSim,
    inputs: [],
  });
  // Auto-open the new card so the user lands on it ready to type a
  // name. Persist via _directOpen so the next re-render keeps it open.
  _directOpen.add(`${p.name}|${id}`);
  renderEditor();
}

function removeDirectGroup(groupIdx) {
  const p = profiles[activeIdx];
  if (!p?.directGroups?.[groupIdx]) return;
  const group = p.directGroups[groupIdx];
  // Refuse if any rows in the group are wired — same orphan-protection
  // we apply to driver removal in the Hardware tab.
  const wired = (p.chain.edges || []).filter(e =>
    e.stage === 'direct' && e.directGroupId === group.id && e.src && e.dst
  ).length;
  if (wired > 0) {
    toast(`Cannot remove "${group.name || 'group'}": ${wired} input${wired === 1 ? ' is' : 's are'} wired. Unwire them in Signal mappings first.`);
    return;
  }
  if (!confirm(`Remove direct group "${group.name || '(unnamed)'}"? This deletes the group and any unwired input rows it contains.`)) return;
  // Drop any leftover edges for this group (defensively — they
  // shouldn't exist if the wired check passed, but if a row was
  // declared without ever being wired the edge might have a src or
  // dst but not both).
  p.chain.edges = (p.chain.edges || []).filter(e =>
    !(e.stage === 'direct' && e.directGroupId === group.id)
  );
  p.directGroups.splice(groupIdx, 1);
  renderEditor();
}

function setDirectGroupName(groupIdx, name) {
  const p = profiles[activeIdx];
  const group = p?.directGroups?.[groupIdx];
  if (!group) return;
  group.name = String(name || '').trim();
  renderSidebar();  // tab title's group count doesn't change but refresh anyway
}

function setDirectGroupSim(groupIdx, simId) {
  const p = profiles[activeIdx];
  const group = p?.directGroups?.[groupIdx];
  if (!group) return;
  // Switching sims invalidates every input's source pick (signals are
  // sim-scoped). Refuse if any input has a source so the user
  // explicitly clears sources before swapping rather than silently
  // breaking the catalog references.
  const sourcedInputs = (group.inputs || []).filter(i => i.sourceSignalId).length;
  if (sourcedInputs > 0 && simId !== group.simId) {
    toast(`Cannot switch sim while ${sourcedInputs} input${sourcedInputs === 1 ? ' has' : 's have'} a source. Clear them first.`);
    renderEditor();  // revert dropdown
    return;
  }
  group.simId = simId || '';
  _resetDirectInputSourceOptionsCache();
  renderEditor();
}

function addDirectInput(groupIdx) {
  const p = profiles[activeIdx];
  const group = p?.directGroups?.[groupIdx];
  if (!group) return;
  if (!Array.isArray(group.inputs)) group.inputs = [];
  // sourceSignalId starts empty; the user picks a signal from the
  // dropdown, which sets both the input's sourceSignalId AND the
  // matching chain edge's src in one step.
  group.inputs.push({ id: _newDirectId(), sourceSignalId: '' });
  renderEditor();
}

function removeDirectInput(groupIdx, inputIdx) {
  const p = profiles[activeIdx];
  const group = p?.directGroups?.[groupIdx];
  const input = group?.inputs?.[inputIdx];
  if (!input) return;
  // Refuse if a destination is wired — that's the case where removing
  // the input would silently orphan a running mapping. The source
  // (sourceSignalId) lives entirely on this tab, so dropping it
  // along with the row when the user clicks Remove is fine.
  const destWired = (p.chain.edges || []).some(e =>
    e.stage === 'direct' && e.directGroupId === group.id &&
    e.directInputId === input.id && e.dst
  );
  if (destWired) {
    const label = _directInputDisplayLabel(group, input);
    toast(`Cannot remove "${label}": destination still wired. Clear it in Signal mappings first.`);
    return;
  }
  // Drop any leftover edge for this input (source set but no dest).
  p.chain.edges = (p.chain.edges || []).filter(e =>
    !(e.stage === 'direct' && e.directGroupId === group.id && e.directInputId === input.id)
  );
  group.inputs.splice(inputIdx, 1);
  renderEditor();
}

// Friendly label for an input — the sim signal's catalog label when a
// source is picked, falling back to a plain "(unset)" placeholder.
// Used in toasts and the Mappings tab card. Matches the Direct-tab
// dropdown's display so the user sees the same string in both places.
function _directInputDisplayLabel(group, input) {
  if (!input?.sourceSignalId) return '(unset input)';
  const signal = (SIM_SIGNALS[group.simId]?.scalar || []).find(s => s.id === input.sourceSignalId);
  return signal?.label || input.sourceSignalId;
}

// Set the sim signal that this input drives. Updates both the
// input's sourceSignalId (Direct-tab state) AND the matching edge's
// src (chain state). Called when the user picks from the dropdown.
// If empty (user cleared it), drops the source from the edge but
// keeps the input declared so the row stays visible — the user
// might be mid-rethink.
function setDirectInputSource(groupIdx, inputIdx, signalId) {
  const p = profiles[activeIdx];
  const group = p?.directGroups?.[groupIdx];
  const input = group?.inputs?.[inputIdx];
  if (!group || !input) return;
  const newId = String(signalId || '').trim();
  // Refuse the change if the OLD source is wired and we'd orphan a
  // running mapping. The user can clear the destination first if
  // they really want to swap sources.
  const edge = (p.chain.edges || []).find(e =>
    e.stage === 'direct' && e.directGroupId === group.id && e.directInputId === input.id
  );
  input.sourceSignalId = newId;
  // Mirror to the chain edge. _ensureDirectEdge is defined in
  // tab-mappings.js (where the rest of the direct-edge plumbing
  // lives); JS hoisting + global scope means the forward reference
  // resolves at call time.
  if (edge || newId) {
    const e = _ensureDirectEdge(p, group.id, input.id);
    e.src = newId;
    // Pull the source signal's kind so the runtime emits the right
    // xsi:type and the kind-mismatch validator can compare against
    // the destination's kind. text-kind sources are filtered out of
    // the dropdown so we only see analog/digital here.
    const signal = (SIM_SIGNALS[group.simId]?.scalar || []).find(s => s.id === newId);
    if (signal?.kind === 'digital') e.kind = 'digital';
    else if (signal?.kind === 'analog') e.kind = 'analog';
    refreshInvalidEdgeFlags(p);
    _pruneDirectEdgeIfEmpty(p, group.id, input.id);
  }
  renderEditor();
}
