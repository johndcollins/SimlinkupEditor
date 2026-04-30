// ── Sidebar + editor chrome ──────────────────────────────────────────────────
// Page-level rendering: profile list (sidebar) and the editor's tab bar +
// per-tab pane shells. switchTab is the click handler wired into the inline
// onclick= attributes of the tab buttons.

// ── Profile list ─────────────────────────────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('profileList');
  document.getElementById('profileCount').textContent = profiles.length + ' profile' + (profiles.length !== 1 ? 's' : '');
  if (profiles.length === 0) {
    list.innerHTML = '<div class="empty">No profiles found. Create one below.</div>';
    return;
  }
  list.innerHTML = '';
  profiles.forEach((p, i) => {
    const isDefault = p.name === defaultProfile;
    const brokenCount = (p.chain?.edges || []).reduce((n, e) => n + (e.invalid ? 1 : 0), 0);
    const div = document.createElement('div');
    div.className = 'profile-item' + (activeIdx === i ? ' active' : '');
    const brokenBadge = brokenCount > 0
      ? `<span class="broken-badge" title="${brokenCount} mapping${brokenCount === 1 ? '' : 's'} reference signals not in the current catalog. Open the profile to see details.">⚠ ${brokenCount}</span>`
      : '';
    div.innerHTML = `
      <div class="profile-item-info">
        <div class="profile-item-name">${escHtml(p.name)}</div>
        <div class="profile-item-meta">${p.instruments.length} instrument${p.instruments.length !== 1 ? 's' : ''} · ${p.chain.edges.length} mapping${p.chain.edges.length !== 1 ? 's' : ''}</div>
      </div>
      ${brokenBadge}
      ${isDefault ? '<span class="default-badge">default</span>' : ''}`;
    div.onclick = () => selectProfile(i);
    list.appendChild(div);
  });
}

// Reset the editor pane back to its initial "no profile selected" state.
// Called from setDir() after the directory changes — without this, the
// editor pane keeps showing the previously-selected profile's title,
// metadata, default badge, and tab content from the old directory until
// the user clicks a profile in the new directory's sidebar list. The
// stale "default" badge in particular is misleading (it points at the
// old directory's default profile, not the new one's).
function clearEditor() {
  document.getElementById('editorTitle').textContent = 'Select a profile';
  document.getElementById('editorMeta').textContent = 'Create a new profile or select one from the list';
  document.getElementById('editorDefaultBadge').style.display = 'none';
  document.getElementById('btnSave').disabled = true;
  document.getElementById('btnDelete').disabled = true;
  const btnDefault = document.getElementById('btnDefault');
  btnDefault.textContent = 'Set as default';
  btnDefault.disabled = true;
  document.getElementById('editorBody').innerHTML =
    '<div class="empty">Select or create a profile to get started.</div>';
}

// ── Editor ───────────────────────────────────────────────────────────────────
function renderDefaultStatus() {
  const p = activeIdx !== null ? profiles[activeIdx] : null;
  const isDefault = p && p.name === defaultProfile;
  document.getElementById('editorDefaultBadge').style.display = isDefault ? '' : 'none';
  const btn = document.getElementById('btnDefault');
  btn.textContent = isDefault ? 'Default ✓' : 'Set as default';
  btn.disabled = !p || isDefault;
}

function renderEditor() {
  const p = profiles[activeIdx];
  document.getElementById('editorTitle').textContent = p.name;
  document.getElementById('editorMeta').textContent =
    `${p.instruments.length} instrument${p.instruments.length !== 1 ? 's' : ''} · ${p.chain.edges.length} mapping${p.chain.edges.length !== 1 ? 's' : ''}`;
  renderDefaultStatus();

  const driverCount = Object.keys(p.drivers || {}).length;
  const ssCount = (p.simSupports || []).length;

  // Health badges for the Signal mappings tab title — three buckets, each
  // shown only when nonzero so the header stays clean for healthy profiles.
  const health = computeProfileHealth(p);
  const mappingsBadges =
    (health.broken     ? `<span class="tab-badge tab-badge-broken"   title="${escHtml(health.broken + ' source signal' + (health.broken === 1 ? '' : 's') + ' not in catalog')}">⚠ ${health.broken}</span>` : '') +
    (health.conflicts  ? `<span class="tab-badge tab-badge-conflict" title="${escHtml(health.conflicts + ' DAC channel' + (health.conflicts === 1 ? '' : 's') + ' wired by 2 or more outputs')}">✗ ${health.conflicts}</span>` : '') +
    (health.incomplete ? `<span class="tab-badge tab-badge-warn"     title="${escHtml(health.incomplete + ' gauge' + (health.incomplete === 1 ? '' : 's') + ' partially wired')}">! ${health.incomplete}</span>` : '');

  // Calibration tab: show the count of declared gauges (matches the
  // Instruments / Active style), plus a badge when the user has edited any
  // gauge's calibration away from spec-sheet defaults.
  const calibratableCount = (p.instruments || []).filter(pn => gaugeCalibrationDefaultsFor(pn)).length;
  const editedCount = (p.instruments || []).reduce((n, pn) => {
    return n + (p.gaugeConfigs?.[pn] && gaugeCalibrationIsEdited(pn, p.gaugeConfigs[pn]) ? 1 : 0);
  }, 0);
  const calibrationBadges = editedCount
    ? `<span class="tab-badge tab-badge-edited" title="${escHtml(editedCount + ' gauge' + (editedCount === 1 ? '' : 's') + ' edited away from spec-sheet defaults')}">✎ ${editedCount}</span>`
    : '';

  document.getElementById('editorBody').innerHTML = `
    <div class="tabs-nav">
      <button class="tab-btn ${activeTab==='hardware'?'active':''}" onclick="switchTab('hardware',this)">Hardware (${driverCount})</button>
      <button class="tab-btn ${activeTab==='hardwareconfig'?'active':''}" onclick="switchTab('hardwareconfig',this)">Hardware Config (${driverCount})</button>
      <button class="tab-btn ${activeTab==='simsupport'?'active':''}" onclick="switchTab('simsupport',this)">SimSupport (${ssCount})</button>
      <button class="tab-btn ${activeTab==='instruments'?'active':''}" onclick="switchTab('instruments',this)">Instruments (${p.instruments.length})</button>
      <button class="tab-btn ${activeTab==='active'?'active':''}" onclick="switchTab('active',this)">Active (${p.instruments.length})</button>
      <button class="tab-btn ${activeTab==='mappings'?'active':''}" onclick="switchTab('mappings',this)">Signal mappings (${p.chain.edges.length})${mappingsBadges}</button>
      <button class="tab-btn ${activeTab==='calibration'?'active':''}" onclick="switchTab('calibration',this)">Calibration (${calibratableCount})${calibrationBadges}</button>
    </div>
    <div id="pane-hardware"       class="tab-pane ${activeTab==='hardware'?'active':''}"></div>
    <div id="pane-hardwareconfig" class="tab-pane ${activeTab==='hardwareconfig'?'active':''}"></div>
    <div id="pane-simsupport"     class="tab-pane ${activeTab==='simsupport'?'active':''}"></div>
    <div id="pane-instruments"    class="tab-pane ${activeTab==='instruments'?'active':''}"></div>
    <div id="pane-active"         class="tab-pane ${activeTab==='active'?'active':''}"></div>
    <div id="pane-mappings"       class="tab-pane ${activeTab==='mappings'?'active':''}"></div>
    <div id="pane-calibration"    class="tab-pane ${activeTab==='calibration'?'active':''}"></div>`;

  renderHardware();
  renderHardwareConfig();
  renderSimSupport();
  renderInstruments();
  renderActive();
  renderMappings();
  renderCalibration();
}

function switchTab(id, btn) {
  activeTab = id;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('pane-' + id).classList.add('active');
}
