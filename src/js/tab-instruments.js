// ── Instruments tab + Active tab ─────────────────────────────────────────────
// Renderers for the gauge catalog (Instruments) and the per-profile selected
// list (Active). Both are pure render functions reading INSTRUMENTS and
// p.instruments; the toggle handler mutates state and re-renders the editor.

function renderInstruments() {
  const pane = document.getElementById('pane-instruments');
  if (!pane) return;
  const p = profiles[activeIdx];
  const filtered = INSTRUMENTS.filter(inst => {
    const matchSearch = !instSearch || inst.name.toLowerCase().includes(instSearch.toLowerCase()) || inst.pn.includes(instSearch);
    const matchCat = instFilter === 'all' || inst.cat === instFilter;
    const matchMfr = instMfrFilter === 'all' || inst.manufacturer === instMfrFilter;
    return matchSearch && matchCat && matchMfr;
  });

  // Distinct manufacturers across the full catalog (not just `filtered`) so the
  // dropdown stays stable as the user narrows by search/category.
  const allMfrs = [...new Set(INSTRUMENTS.map(i => i.manufacturer).filter(Boolean))].sort();
  const mfrOptions = allMfrs.map(m =>
    `<option value="${m}" ${instMfrFilter===m?'selected':''}>${m}</option>`).join('');

  pane.innerHTML = `
    <div class="filter-bar">
      <input type="search" placeholder="Search instruments…" value="${instSearch}" oninput="instSearch=this.value;renderInstruments()">
      <select onchange="instMfrFilter=this.value;renderInstruments()">
        <option value="all" ${instMfrFilter==='all'?'selected':''}>All manufacturers</option>
        ${mfrOptions}
      </select>
      <select onchange="instFilter=this.value;renderInstruments()">
        <option value="all" ${instFilter==='all'?'selected':''}>All categories</option>
        <option value="flight" ${instFilter==='flight'?'selected':''}>Flight / navigation</option>
        <option value="engine" ${instFilter==='engine'?'selected':''}>Engine</option>
        <option value="fuel" ${instFilter==='fuel'?'selected':''}>Fuel</option>
        <option value="attitude" ${instFilter==='attitude'?'selected':''}>Attitude</option>
      </select>
      <span style="font-size:11px;color:var(--text-secondary)">${filtered.length} instrument${filtered.length!==1?'s':''}</span>
      <button class="btn-sm" onclick="setAllMfrGroupsOpen(true)">Expand all</button>
      <button class="btn-sm" onclick="setAllMfrGroupsOpen(false)">Collapse all</button>
    </div>
    <div id="instGroups"></div>`;

  const groupsEl = document.getElementById('instGroups');
  if (filtered.length === 0) {
    groupsEl.innerHTML = '<div class="empty">No instruments match your search.</div>';
    return;
  }

  // Group by manufacturer (stable, alphabetical). Each group renders its own
  // grid so cards within a group fill the row before the next group starts.
  const grouped = new Map();
  for (const inst of filtered) {
    const mfr = inst.manufacturer || 'Unknown';
    if (!grouped.has(mfr)) grouped.set(mfr, []);
    grouped.get(mfr).push(inst);
  }
  const sortedMfrs = [...grouped.keys()].sort();
  const addedSet = new Set(p.instruments);

  for (const mfr of sortedMfrs) {
    const insts = grouped.get(mfr);
    // Default-open if any gauge in this group is added to the active profile.
    // User can override via Expand all / Collapse all (state is per-render —
    // a re-render reverts to the defaults; same model as the Mappings tab).
    const hasAdded = insts.some(i => addedSet.has(i.pn));
    const details = document.createElement('details');
    details.className = 'mfr-group';
    if (hasAdded) details.open = true;

    const summary = document.createElement('summary');
    const addedCount = insts.filter(i => addedSet.has(i.pn)).length;
    const pillClass = 'mfr-count-pill' + (addedCount > 0 ? ' has-added' : '');
    const pillText = addedCount > 0 ? `${addedCount} / ${insts.length} added` : `${insts.length}`;
    summary.innerHTML = `<span>${mfr}</span> <span class="${pillClass}">${pillText}</span>`;
    details.appendChild(summary);

    const grid = document.createElement('div');
    grid.className = 'inst-grid';
    details.appendChild(grid);
    groupsEl.appendChild(details);

    insts.forEach(inst => {
      const added = addedSet.has(inst.pn);
      const card = document.createElement('div');
      card.className = 'inst-card' + (added ? ' added' : '');
      const sigHtml = [
        ...inst.analog_in.map(s => `<span class="sig-pill pill-a">${s}</span>`),
        ...inst.digital_in.map(s => `<span class="sig-pill pill-d">${s}</span>`),
      ].join('');
      card.innerHTML = `
        <div class="inst-card-top">
          <div class="inst-pn">P/N ${inst.pn}</div>
          <button class="btn-sm ${added?'btn-danger':'btn-primary'}" onclick="toggleInstrument('${inst.pn}')">${added ? 'Remove' : '+ Add'}</button>
        </div>
        <div class="inst-name">${inst.name}</div>
        <div class="inst-signals">${sigHtml}</div>`;
      grid.appendChild(card);
    });
  }
}

// Bulk-toggle every manufacturer group on the Instruments tab. Wired to the
// Expand all / Collapse all buttons in the filter bar. State doesn't persist
// across re-renders — same model as setAllGaugeCardsOpen.
function setAllMfrGroupsOpen(open) {
  const groups = document.querySelectorAll('#instGroups details.mfr-group');
  for (const g of groups) g.open = !!open;
}

function toggleInstrument(pn) {
  const p = profiles[activeIdx];
  const idx = p.instruments.indexOf(pn);
  if (idx === -1) {
    p.instruments.push(pn);
  } else {
    p.instruments.splice(idx, 1);
    // Remove every edge that references this gauge — both stage-1 inputs
    // (dst = gauge) and stage-2 outputs (src = gauge).
    p.chain.edges = p.chain.edges.filter(e => e.dstGaugePn !== pn && e.srcGaugePn !== pn);
    rebuildInstrumentView(p);
  }
  renderEditor();
}

// ── Active tab ───────────────────────────────────────────────────────────────
function renderActive() {
  const pane = document.getElementById('pane-active');
  if (!pane) return;
  const p = profiles[activeIdx];
  if (p.instruments.length === 0) {
    pane.innerHTML = '<div class="empty">No instruments added. Go to the Instruments tab to add some.</div>';
    return;
  }
  pane.innerHTML = '';
  p.instruments.forEach(pn => {
    const inst = INSTRUMENTS.find(i => i.pn === pn);
    if (!inst) return;
    const row = document.createElement('div');
    row.className = 'active-inst-row';
    const outSigs = [
      ...inst.analog_out.map(s => `<span class="sig-pill pill-a">${s}</span>`),
      ...inst.digital_out.map(s => `<span class="sig-pill pill-d">${s}</span>`),
    ].join('');
    row.innerHTML = `
      <div class="active-icon">${pn.replace('10-','').substring(0,5)}</div>
      <div class="active-info">
        <div class="active-name">${inst.name}</div>
        <div class="active-pn">Simtek P/N ${pn} &nbsp;·&nbsp; ${inst.cls.split('.').pop()}</div>
        <div class="active-sigs">${outSigs}</div>
      </div>
      <button class="btn-sm btn-danger" onclick="toggleInstrument('${pn}')">Remove</button>`;
    pane.appendChild(row);
  });
}
