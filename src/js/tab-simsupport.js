// ── SimSupport tab ───────────────────────────────────────────────────────────
function renderSimSupport() {
  const pane = document.getElementById('pane-simsupport');
  if (!pane) return;
  pane.innerHTML = `
    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
      Declare which sim-source modules this profile loads. Each becomes a
      <code>&lt;Module&gt;</code> entry in <code>SimSupportModule.registry</code>.
      A profile that drives BMS gauges needs Falcon BMS declared.
    </div>
    <div id="simSupportCards" class="inst-grid"></div>`;
  const container = document.getElementById('simSupportCards');
  for (const ss of SIM_SUPPORTS) container.appendChild(renderSimSupportCard(ss));
}

function renderSimSupportCard(ss) {
  const p = profiles[activeIdx];
  const declared = (p.simSupports || []).includes(ss.id);
  const signalCount = (SIM_SIGNALS[ss.id]?.scalar || []).length;
  const card = document.createElement('div');
  card.className = 'inst-card' + (declared ? ' added' : '');
  card.innerHTML = `
    <div class="inst-card-top">
      <div class="inst-pn">${escHtml(ss.id)}</div>
      <button class="btn-sm ${declared ? 'btn-danger' : 'btn-primary'}"
              onclick="toggleSimSupport('${ss.id}')">${declared ? 'Remove' : '+ Add'}</button>
    </div>
    <div class="inst-name">${escHtml(ss.label)}</div>
    <div style="font-size:10px;color:var(--text-secondary);margin-top:2px">${signalCount} signal${signalCount === 1 ? '' : 's'}</div>
    <div style="display:flex;gap:4px;margin-top:6px">
      <button class="btn-sm" onclick="viewSimSignals('${ss.id}')" title="Open ${escHtml(ss.signalsFile)} in your default editor">View signals</button>
      <button class="btn-sm" onclick="importSimSignals('${ss.id}')" title="Replace ${escHtml(ss.signalsFile)} with a JSON file from disk">Import…</button>
    </div>`;
  return card;
}

function toggleSimSupport(id) {
  const p = profiles[activeIdx];
  markChainDirty();
  if (!p.simSupports) p.simSupports = [];
  const idx = p.simSupports.indexOf(id);
  if (idx >= 0) {
    p.simSupports.splice(idx, 1);
    if (p.simSupports.length === 0) {
      toast('No sim-support modules declared. Mapping sources will be empty until you add one.');
    }
  } else {
    p.simSupports.push(id);
  }
  // Re-validate stage-1 edges against the new declared-sim set: removing a
  // sim invalidates anything that referenced its signals; adding one may
  // re-validate previously-broken edges.
  refreshInvalidEdgeFlags(p);
  renderEditor();
}

async function viewSimSignals(simId) {
  const ss = SIM_SUPPORTS.find(s => s.id === simId);
  if (!ss?.signalsFile) return;
  const result = await window.api.openSignalsFile(ss.signalsFile);
  if (result && !result.success) toast('Could not open file: ' + result.error);
}

async function importSimSignals(simId) {
  const ss = SIM_SUPPORTS.find(s => s.id === simId);
  if (!ss?.signalsFile) return;
  const result = await window.api.importSignalsFile(ss.signalsFile);
  if (!result) return;
  if (result.cancelled) return;
  if (!result.success) {
    toast('Import failed: ' + result.error);
    return;
  }
  // Refresh in-memory signals from the freshly-imported file.
  const data = await window.api.loadStaticData();
  if (data?.simSignals?.[simId]) {
    SIM_SIGNALS[simId] = data.simSignals[simId];
    _simOptionsHtmlCache = { key: null, html: null };  // force rebuild
  }

  // Re-validate every profile against the new catalog. Edges whose source
  // signal disappeared in the import become invalid. Offer to clear them
  // across all profiles in one go (most users want a clean slate after a
  // catalog update; the alternative is staring at amber warnings forever).
  const invalidByProfile = [];
  for (const p of profiles) {
    if (!p.chain) continue;  // unloaded session
    refreshInvalidEdgeFlags(p);
    const broken = p.chain.edges.filter(e => e.invalid);
    if (broken.length) invalidByProfile.push({ profile: p, count: broken.length });
  }
  if (invalidByProfile.length > 0) {
    const total = invalidByProfile.reduce((sum, x) => sum + x.count, 0);
    const summary = invalidByProfile.map(x => `${x.profile.name}: ${x.count}`).join(', ');
    const ok = confirm(
      `Imported ${result.scalarCount} signals into ${ss.label}.\n\n` +
      `${total} mapping${total === 1 ? '' : 's'} reference signals that no longer exist in the new catalog (${summary}).\n\n` +
      `Click OK to clear those mappings, or Cancel to keep them (they'll show as broken until fixed).`
    );
    if (ok) {
      for (const { profile } of invalidByProfile) {
        profile.chain.edges = profile.chain.edges.filter(e => !e.invalid);
        rebuildInstrumentView(profile);
      }
      toast(`Cleared ${total} broken mapping${total === 1 ? '' : 's'}.`);
    }
  } else {
    toast(`Imported ${result.scalarCount} signals into ${ss.label}.`);
  }
  renderEditor();
}
