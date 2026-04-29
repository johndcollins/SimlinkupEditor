// ── Calibration tab ──────────────────────────────────────────────────────────
//
// Per-gauge transform editors. One collapsible <details> card per declared
// instrument. Pattern-aware: today only the 'piecewise' transform pattern has
// an editor (10-0207 RPM is the proof-of-concept). Gauges without a known
// pattern get a stub card so the user sees what's still missing.
//
// Renders into #pane-calibration. Re-runs on every renderEditor() call so it
// stays in sync with the Instruments tab.
//
// Save flow: per-gauge configs are emitted by save.js's generateDriverConfigs
// using the same `driverConfigs` IPC channel as the AD config. createOnly:true
// so a hand-edited file is never clobbered without explicit user action ("Reset
// to spec-sheet defaults" wipes the in-memory state and re-emits the defaults
// on next save — but the user gets a confirm() before that runs).

function renderCalibration() {
  const pane = document.getElementById('pane-calibration');
  if (!pane) return;
  const p = profiles[activeIdx];

  if ((p.instruments || []).length === 0) {
    pane.innerHTML = `
      <div class="empty">
        Add an instrument from the
        <a href="#" onclick="switchTab('instruments', document.querySelector('.tab-btn:nth-child(4)')); return false;">Instruments</a>
        tab first. Each declared gauge gets a calibration card here.
      </div>`;
    return;
  }

  pane.innerHTML = `
    <div class="mappings-toolbar">
      <div class="mappings-toolbar-text">
        Per-gauge transform calibration. Each gauge HSM converts a sim signal
        (RPM%, altitude, °C, …) into a voltage or angle. Edits here are saved
        as <code>Simtek&lt;digits&gt;HardwareSupportModule.config</code> next to
        the profile's <code>.mapping</code> files. SimLinkup ignores these
        files for most gauges today — they become useful once SimLinkup is
        patched to read them.
      </div>
      <div class="mappings-toolbar-actions">
        <button class="btn-sm" onclick="setAllCalibrationCardsOpen(true)">Expand all</button>
        <button class="btn-sm" onclick="setAllCalibrationCardsOpen(false)">Collapse all</button>
      </div>
    </div>
    <div id="calibrationCards"></div>`;

  const container = document.getElementById('calibrationCards');
  for (const pn of p.instruments) {
    container.appendChild(renderGaugeCalibrationCard(pn));
  }
}

// Bulk-toggle every calibration card. Mirrors setAllGaugeCardsOpen from the
// Mappings tab — by querySelector, not by mutating an open-state Set, since
// the user expects the bulk toggle to take effect immediately on what's
// currently rendered.
function setAllCalibrationCardsOpen(open) {
  const cards = document.querySelectorAll('#calibrationCards details.calibration-card');
  for (const c of cards) {
    c.open = !!open;
    // Mirror the open state into the persistence Set so the next re-render
    // (e.g. after a value change) doesn't immediately collapse cards back.
    const p = profiles[activeIdx];
    const pn = c.dataset.pn;
    if (!p || !pn) continue;
    const key = `${p.name}|${pn}`;
    if (open) _calibrationOpen.add(key); else _calibrationOpen.delete(key);
  }
}

// Persist which calibration cards are open across re-renders (a re-render
// triggers when any field changes — without this the card the user is
// editing would snap shut every keystroke). Mirror of _hwconfigOpen.
const _calibrationOpen = new Set();

// Render one card for one gauge PN. Pattern dispatch lives here: today only
// piecewise has an editor; everything else (named-prefix Henk gauges,
// gauges not yet in GAUGE_CALIBRATION_DEFAULTS) gets a stub.
function renderGaugeCalibrationCard(pn) {
  const p = profiles[activeIdx];
  const inst = INSTRUMENTS.find(i => i.pn === pn);
  const card = document.createElement('details');
  card.className = 'calibration-card';
  card.dataset.pn = pn;
  if (_calibrationOpen.has(`${p.name}|${pn}`)) card.open = true;
  card.addEventListener('toggle', () => {
    const key = `${p.name}|${pn}`;
    if (card.open) _calibrationOpen.add(key); else _calibrationOpen.delete(key);
  });

  // Status drives the header tint:
  //   no-defaults — gauge isn't in GAUGE_CALIBRATION_DEFAULTS yet (neutral).
  //   default     — defaults in place, no user edits (neutral-blue).
  //   edited      — at least one field differs from spec-sheet (info blue).
  //   warn        — a piecewise channel has a non-monotonic / out-of-range
  //                 issue (amber).
  const tpl = gaugeCalibrationDefaultsFor(pn);
  const entry = (p.gaugeConfigs || {})[pn];
  let status, pillText, pillTitle;

  if (!tpl) {
    status = 'no-defaults';
    pillText = 'no editor yet';
    pillTitle = 'This gauge does not yet have a calibration editor in this app. Coming in a future release.';
    card.innerHTML = `
      <summary class="calibration-card-head calibration-card-head-${status}">
        <span class="calibration-card-chevron" aria-hidden="true">▸</span>
        <div class="calibration-card-headline">
          <div class="calibration-card-title">${escHtml(inst?.name || pn)}</div>
          <div class="calibration-card-pn">P/N ${escHtml(pn)}</div>
        </div>
        <span class="calibration-pill calibration-pill-${status}" title="${escHtml(pillTitle)}">${escHtml(pillText)}</span>
      </summary>
      <div class="calibration-card-body">
        <div class="calibration-stub">
          A calibration editor for this gauge hasn't been built yet. The four
          transform patterns (linear, piecewise, resolver, multi-turn resolver)
          are documented in <code>js/calibration-defaults.js</code>; the
          editor currently ships only the <strong>piecewise</strong> pattern
          and only for gauges with an entry in <code>GAUGE_CALIBRATION_DEFAULTS</code>.
        </div>
      </div>`;
    return card;
  }

  // Compute warnings across all channels — used to flip status to 'warn'.
  const warnings = [];
  for (const ch of tpl.channels) {
    if (ch.kind === 'piecewise') {
      const liveCh = (entry?.channels || []).find(c => c.id === ch.id) || ch;
      const v = validatePiecewiseChannel(liveCh);
      for (const w of v.warnings) warnings.push(`${ch.id}: ${w}`);
    }
  }
  const edited = !!entry && gaugeCalibrationIsEdited(pn, entry);
  if (warnings.length) {
    status = 'warn';
    pillText = `⚠ ${warnings.length}`;
    pillTitle = warnings.join('\n');
  } else if (edited) {
    status = 'edited';
    pillText = 'edited';
    pillTitle = 'At least one field differs from spec-sheet defaults. Save to write the .config file.';
  } else {
    status = 'default';
    pillText = 'defaults';
    pillTitle = 'Spec-sheet defaults from the SimLinkup C# source. Save still emits a .config file (createOnly).';
  }

  // Render each channel's editor. Today every channel in the table is
  // 'piecewise' (10-0207 has one channel), but the dispatch is structured so
  // adding linear/resolver/multi_resolver editors later is a single switch.
  const channelHtml = tpl.channels.map((tplCh, channelIdx) => {
    const liveCh = (entry?.channels || []).find(c => c.id === tplCh.id) || tplCh;
    if (tplCh.kind === 'piecewise') {
      return renderPiecewiseChannelEditor(pn, channelIdx, tplCh, liveCh);
    }
    if (tplCh.kind === 'linear') {
      return renderLinearChannelEditor(pn, channelIdx, tplCh, liveCh);
    }
    if (tplCh.kind === 'resolver') {
      // Sin/cos pair: render ONE editor card per pair, anchored on the SIN
      // channel. The COS channel is folded into the SIN card (shared
      // transform body, per-channel trim for both). Skip the COS channel
      // here so it doesn't draw a duplicate card.
      const role = tplCh.role || 'sin';
      if (role === 'cos') return '';
      // Find the partner channel template + live record so the editor can
      // surface per-channel trim for both.
      const partnerId = tplCh.partnerChannel;
      const partnerTplIdx = tpl.channels.findIndex(c => c.id === partnerId);
      const partnerTpl = partnerTplIdx >= 0 ? tpl.channels[partnerTplIdx] : null;
      const partnerLive = partnerTpl
        ? ((entry?.channels || []).find(c => c.id === partnerId) || partnerTpl)
        : null;
      return renderResolverPairEditor(pn, channelIdx, tplCh, liveCh, partnerTpl, partnerLive);
    }
    if (tplCh.kind === 'piecewise_resolver') {
      // Same pair model as resolver — SIN carries the breakpoint table,
      // COS is folded into the SIN card.
      const role = tplCh.role || 'sin';
      if (role === 'cos') return '';
      const partnerId = tplCh.partnerChannel;
      const partnerTplIdx = tpl.channels.findIndex(c => c.id === partnerId);
      const partnerTpl = partnerTplIdx >= 0 ? tpl.channels[partnerTplIdx] : null;
      const partnerLive = partnerTpl
        ? ((entry?.channels || []).find(c => c.id === partnerId) || partnerTpl)
        : null;
      return renderPiecewiseResolverPairEditor(pn, channelIdx, tplCh, liveCh, partnerTpl, partnerLive);
    }
    if (tplCh.kind === 'multi_resolver') {
      // Same pair model again — SIN carries unitsPerRevolution + peakVolts,
      // COS is folded into the SIN card.
      const role = tplCh.role || 'sin';
      if (role === 'cos') return '';
      const partnerId = tplCh.partnerChannel;
      const partnerTplIdx = tpl.channels.findIndex(c => c.id === partnerId);
      const partnerTpl = partnerTplIdx >= 0 ? tpl.channels[partnerTplIdx] : null;
      const partnerLive = partnerTpl
        ? ((entry?.channels || []).find(c => c.id === partnerId) || partnerTpl)
        : null;
      return renderMultiResolverPairEditor(pn, channelIdx, tplCh, liveCh, partnerTpl, partnerLive);
    }
    if (tplCh.kind === 'digital_invert') {
      return renderDigitalInvertEditor(pn, channelIdx, tplCh, liveCh);
    }
    // Cross-coupled channels (e.g. 10-0194 Mach which depends on the current
    // airspeed output voltage) get a tailored stub that names the dependency
    // so the user understands why this channel isn't directly editable.
    if (tplCh.kind === 'cross_coupled') {
      return `
        <div class="calibration-channel-section">
          <div class="calibration-channel-head">
            <div class="calibration-channel-id">${escHtml(tplCh.id)}</div>
            <span class="cal-tag cal-tag-cross_coupled">cross-coupled</span>
          </div>
          <div class="calibration-stub">
            This channel's output is computed by SimLinkup at runtime from the
            current value of <code>${escHtml(tplCh.coupledTo || 'another channel')}</code>
            — there is no standalone <code>f(input) → volts</code> curve to edit.
            A future editor will surface the underlying reference table and the
            coupling math; for now SimLinkup's hardcoded behaviour applies.
            The trim fields below still apply once a SimLinkup-side patch
            consumes them.
          </div>
          <div class="calibration-trim-grid">
            ${renderTrimFieldsBlock(pn, tplCh.id, liveCh, /*compact*/ false)}
          </div>
        </div>`;
    }
    return `
      <div class="calibration-channel-section">
        <div class="calibration-channel-head">
          <div class="calibration-channel-id">${escHtml(tplCh.id)}</div>
          <span class="cal-tag cal-tag-${escHtml(tplCh.kind)}">${escHtml(tplCh.kind)}</span>
        </div>
        <div class="calibration-stub">
          The <strong>${escHtml(tplCh.kind)}</strong> transform editor isn't built yet.
          The on-disk <code>.config</code> file still round-trips this channel.
        </div>
      </div>`;
  }).join('');

  // Optional gauge-specific extra section. Today only 10-0285 has one — the
  // legacy bare baro fields preserved for back-compat with older SimLinkup
  // builds. Shown only when the on-disk file actually carried those fields.
  const extraHtml = renderGaugeExtras(pn, entry) || '';

  card.innerHTML = `
    <summary class="calibration-card-head calibration-card-head-${status}">
      <span class="calibration-card-chevron" aria-hidden="true">▸</span>
      <div class="calibration-card-headline">
        <div class="calibration-card-title">${escHtml(inst?.name || pn)}</div>
        <div class="calibration-card-pn">P/N ${escHtml(pn)}</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); resetGaugeCalibration('${escHtml(pn)}')">Reset to defaults</button>
      <span class="calibration-pill calibration-pill-${status}" title="${escHtml(pillTitle)}">${escHtml(pillText)}</span>
    </summary>
    <div class="calibration-card-body">${channelHtml}${extraHtml}</div>`;
  return card;
}

// Per-gauge extra UI sections that don't fit the per-channel grid. Today
// two gauges have one: 10-0285 altimeter (legacy baro compensation fields)
// and 10-0294 fuel quantity (legacy MaxPoundsTotalFuel scaling). Both are
// preserved-on-disk legacy fields that newer SimLinkup builds bypass when
// <Channels> is populated; the section is purely round-trip preservation
// plus a "Remove from file" affordance.
function renderGaugeExtras(pn, entry) {
  if (pn === '10-0294') return renderLegacyMaxPoundsTotalFuel(pn, entry);
  if (pn !== '10-0285') return '';
  const lb = entry?.legacyBaro;
  if (!lb) return '';
  const fmt = (v) => (typeof v === 'number') ? formatNum(v) : '—';
  return `
    <details class="calibration-channel-section calibration-legacy-baro">
      <summary>
        <strong>Legacy baro compensation</strong>
        <span class="cal-tag cal-tag-legacy">legacy</span>
      </summary>
      <div class="cal-help-text">
        These four fields are read by older SimLinkup builds to bias the
        altitude pointer based on the Kollsman knob setting. Newer SimLinkup
        builds use the already-baro-compensated altitude that BMS publishes
        and bypass these fields whenever the resolver channels above are
        present, so editing them has no effect on the gauge in current
        builds. Kept on disk for compatibility with older installs.
      </div>
      <div class="calibration-legacy-baro-grid">
        <div class="calibration-legacy-baro-row">
          <div class="calibration-legacy-baro-label">Min baro pressure (inHg)</div>
          <div class="calibration-legacy-baro-value">${escHtml(fmt(lb.minBaroPressureInHg))}</div>
        </div>
        <div class="calibration-legacy-baro-row">
          <div class="calibration-legacy-baro-label">Max baro pressure (inHg)</div>
          <div class="calibration-legacy-baro-value">${escHtml(fmt(lb.maxBaroPressureInHg))}</div>
        </div>
        <div class="calibration-legacy-baro-row">
          <div class="calibration-legacy-baro-label">Indicated altitude difference (ft, min→max baro)</div>
          <div class="calibration-legacy-baro-value">${escHtml(fmt(lb.indicatedAltitudeDifferenceInFeetFromMinBaroToMaxBaro))}</div>
        </div>
        <div class="calibration-legacy-baro-row">
          <div class="calibration-legacy-baro-label">Altitude zero offset (ft)</div>
          <div class="calibration-legacy-baro-value">${escHtml(fmt(lb.altitudeZeroOffsetInFeet))}</div>
        </div>
      </div>
      <div class="calibration-legacy-baro-actions">
        <button class="btn-sm" onclick="removeLegacyBaroFromGauge('${escHtml(pn)}')">Remove from file</button>
      </div>
    </details>`;
}

// 10-0294 fuel quantity: legacy <MaxPoundsTotalFuel> bare field. Same shape
// as the baro panel above — read-only display + "Remove from file" button.
// Reuses the .calibration-legacy-baro CSS rules so the visual treatment
// matches.
function renderLegacyMaxPoundsTotalFuel(pn, entry) {
  const lmpt = entry?.legacyMaxPoundsTotalFuel;
  if (typeof lmpt !== 'number') return '';
  return `
    <details class="calibration-channel-section calibration-legacy-baro">
      <summary>
        <strong>Legacy max-fuel scaling</strong>
        <span class="cal-tag cal-tag-legacy">legacy</span>
      </summary>
      <div class="cal-help-text">
        Older SimLinkup builds use this single field to rescale the counter
        output (linear: input ÷ MaxPoundsTotalFuel × 20 − 10 V). Newer
        builds use the editor's piecewise counter table instead — to change
        the input that maps to +10 V, edit the last counter breakpoint's
        input value above. Kept on disk for compatibility with older
        installs.
      </div>
      <div class="calibration-legacy-baro-grid">
        <div class="calibration-legacy-baro-row">
          <div class="calibration-legacy-baro-label">Max pounds total fuel (lbs)</div>
          <div class="calibration-legacy-baro-value">${escHtml(formatNum(lmpt))}</div>
        </div>
      </div>
      <div class="calibration-legacy-baro-actions">
        <button class="btn-sm" onclick="removeLegacyMaxPoundsTotalFuelFromGauge('${escHtml(pn)}')">Remove from file</button>
      </div>
    </details>`;
}

// Render a piecewise breakpoint table for one channel. Layout per row:
//   #  |  input (number)  |  volts (slider)  |  volts (number)  |  remove
//
// Above the table sits a read-only SVG transfer-curve preview (input X-axis
// vs volts Y-axis, breakpoints as dots, line connecting them). The curve is
// redrawn live on every slider movement via updateCalibrationCurve(), but
// the table HTML is NOT re-rendered mid-edit so focus stays put.
//
// Three event surfaces touch the model:
//   - input number's onchange  → setCalibrationBreakpoint(field='input')
//                                 → curve redraw, no re-render
//   - volts slider's oninput   → setCalibrationVoltsLive
//                                 → updates the sibling number input + curve
//   - volts number's onchange  → setCalibrationBreakpoint(field='volts')
//                                 → updates the sibling slider + curve
//
// ── Shared block renderers ──────────────────────────────────────────────────
// Helper-emitted blocks of UI that recur across multiple editor cards. Kept
// here (above the editors that call them) so each editor stays focused on
// its kind-specific layout instead of re-stating these field labels and
// help texts in N places.

// Per-channel zero/gain trim block. Plain-language labels with explanatory
// text — these are the LAST-RESORT compensation knobs. Users should reach
// for the breakpoint table FIRST when a specific input value reads wrong;
// trim is for when the whole channel is uniformly off (one sin winding
// reads 0.3 V too low across the entire range).
//
// Each field gets a SLIDER bounded to the useful range plus a NUMBER input
// for precise entry. Slider drag updates the model + number input live;
// number-input edit updates the slider position back. Same dual-control
// pattern as the piecewise breakpoint editor's volts column.
//
// `compact: true` skips the introductory help-text block (used inside the
// resolver pair trim sub-table where the row label sits to the left and
// the help text already lives on the parent section header).
function renderTrimFieldsBlock(pn, channelId, ch, compact) {
  const zero = formatTrimNum(ch?.zeroTrim ?? 0);
  const gain = formatTrimNum(ch?.gainTrim ?? 1);
  // Slider thumb position clamps into the useful range; values outside
  // (typed into the number input) pin the thumb at the closest end.
  const zeroSlider = Math.max(-2, Math.min(2, Number(ch?.zeroTrim ?? 0)));
  const gainSlider = Math.max(0.5, Math.min(2.0, Number(ch?.gainTrim ?? 1)));
  const rowKey = `cal-trim-${pn}-${channelId}`;
  const helpText = compact ? '' : `
    <div class="cal-help-text">
      Last-resort hardware compensation. Use the breakpoint table above to
      fix specific input values; use these to nudge the whole channel
      uniformly when one winding is consistently off.
    </div>`;
  return `
    ${helpText}
    <label class="cal-trim-field">
      <span>Zero offset (V) <span class="cal-help-inline">— shifts the whole channel up or down. 0.0 = no shift. Useful range: ±2 V.</span></span>
      <div class="cal-trim-controls">
        <input type="range" min="-2" max="2" step="0.05" value="${zeroSlider}"
               id="${rowKey}-zero-slider"
               oninput="setCalibrationTrimLive('${escHtml(pn)}','${escHtml(channelId)}','zeroTrim',this.value)"
               title="Drag to nudge the zero offset. Hold Shift while using arrow keys for finer steps."/>
        <input type="number" step="0.05" min="-10" max="10" value="${zero}"
               id="${rowKey}-zero-num"
               onchange="setCalibrationTrim('${escHtml(pn)}','${escHtml(channelId)}','zeroTrim',this.value)"
               title="Voltage added to the transform output. The hardware clamps the final output to ±10 V regardless of what you enter."/>
      </div>
    </label>
    <label class="cal-trim-field">
      <span>Scale (×) <span class="cal-help-inline">— stretches or shrinks the whole response. 1.0 = no change. Useful range: 0.5 to 2.0.</span></span>
      <div class="cal-trim-controls">
        <input type="range" min="0.5" max="2" step="0.01" value="${gainSlider}"
               id="${rowKey}-gain-slider"
               oninput="setCalibrationTrimLive('${escHtml(pn)}','${escHtml(channelId)}','gainTrim',this.value)"
               title="Drag to scale the response. 1.0 = no scaling."/>
        <input type="number" step="0.01" min="0" max="5" value="${gain}"
               id="${rowKey}-gain-num"
               onchange="setCalibrationTrim('${escHtml(pn)}','${escHtml(channelId)}','gainTrim',this.value)"
               title="Multiplier applied to the transform output. Values above ~2 saturate at the rails for most of the input range; 0 or negative invert / kill the output."/>
      </div>
    </label>`;
}

// Trim-specific number formatter. Always shows one decimal place (1 → "1.0",
// 0 → "0.0", 1.05 → "1.05") so the displayed value matches the help text's
// references to "0.0 = no shift" / "1.0 = no change". The general-purpose
// formatNum strips trailing zeros — right for breakpoint tables, wrong here.
function formatTrimNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.0';
  if (Number.isInteger(v)) return v.toFixed(1);
  // Up to 6 decimals; trim trailing zeros but keep at least one ('.10' → '.1').
  return v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
}

// Synchro drive amplitude block — the "peak volts" knob on resolver-style
// channels. Buried in Advanced because almost no user should touch it.
// Slider 0..10 V + number input mirror, same dual-control pattern as the
// trim fields.
function renderPeakVoltsField(pn, channelIdx, sinChannelId, peakVolts) {
  const v = formatTrimNum(peakVolts);
  const sliderV = Math.max(0, Math.min(10, Number(peakVolts)));
  const rowKey = `cal-peakvolts-${pn}-${sinChannelId}`;
  return `
    <div class="cal-help-text">
      The synchro decodes the needle angle from the RATIO of sin to cos —
      not from their absolute amplitude. Lowering this just gives the
      hardware a weaker signal to work with. Leave at 10 V unless your
      synchro spec calls for something different.
    </div>
    <label class="cal-trim-field">
      <span>Peak drive voltage <span class="cal-help-inline">— V. Range: 0 to 10. Default: 10 (full DAC scale).</span></span>
      <div class="cal-trim-controls">
        <input type="range" min="0" max="10" step="0.1" value="${sliderV}"
               id="${rowKey}-slider"
               oninput="setPeakVoltsLive('${escHtml(pn)}',${channelIdx},'${escHtml(sinChannelId)}',this.value)"
               title="Drag to set peak drive voltage."/>
        <input type="number" step="0.1" min="0" max="10" value="${v}"
               id="${rowKey}-num"
               onchange="setCalibrationResolverField('${escHtml(pn)}',${channelIdx},'${escHtml(sinChannelId)}','peakVolts',this.value)"
               title="Amplitude of the sin/cos waves driving the synchro windings. Almost always 10 V (full DAC scale)."/>
      </div>
    </label>`;
}

// `channelIdx` is the position of this channel within the gauge's channels
// array; combined with `pn` it gives every DOM node a unique id so the live
// updaters can find the right row + curve without a tab-wide re-render.
function renderPiecewiseChannelEditor(pn, channelIdx, tplCh, liveCh) {
  const bps = liveCh.breakpoints || tplCh.breakpoints || [];
  const channelKey = `${pn}-${channelIdx}`;

  // Per-channel validation banner (non-blocking — values still save).
  const validation = validatePiecewiseChannel(liveCh);
  const warningBanner = validation.warnings.length
    ? `<div class="cal-warnings">
         <strong>Validation:</strong>
         <ul>${validation.warnings.map(w => `<li>${escHtml(w)}</li>`).join('')}</ul>
       </div>`
    : '';

  // Cross-coupling banner — when this channel feeds into another's
  // coupling math (e.g. 10-0194 Mach feeding the airspeed cross-coupling),
  // the volts in this table aren't the final DAC output. Make that
  // visible so users don't think they're editing the literal DAC voltage.
  const coupledTo = liveCh.coupledTo || tplCh.coupledTo;
  const coupledBanner = coupledTo
    ? `<div class="cal-info-banner">
         <strong>Cross-coupled:</strong> The volts in this table are a
         <em>reference voltage</em>, not the final DAC output. SimLinkup
         combines them with the current
         <code>${escHtml(coupledTo)}</code> output to position this gauge's
         needle relative to the other channel.
       </div>`
    : '';

  const headerRow = `
    <div class="calibration-bp-row calibration-bp-header">
      <div>#</div><div>Input</div><div>Volts</div><div>V (num)</div><div></div>
    </div>`;

  const rows = bps.map((bp, idx) => {
    const rowKey = `cal-row-${channelKey}-${idx}`;
    const voltClamped = Math.max(-10, Math.min(10, Number(bp.volts) || 0));
    return `
    <div class="calibration-bp-row" id="${rowKey}">
      <div class="calibration-bp-idx">${idx + 1}</div>
      <input type="number" step="any" value="${formatNum(bp.input)}"
             onchange="setCalibrationBreakpoint('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}',${idx},'input',this.value)"
             title="Input value (units depend on the gauge — % RPM, feet, knots, …)"/>
      <div class="cal-slider-wrap">
        <input type="range" min="-10" max="10" step="0.001" value="${voltClamped}"
               id="${rowKey}-slider"
               oninput="setCalibrationVoltsLive('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}',${idx},this.value)"
               title="Drag to set output volts (clamped to ±10 V by the gauge HSM)"/>
      </div>
      <input type="number" step="any" min="-10" max="10" value="${formatNum(bp.volts)}"
             id="${rowKey}-num"
             onchange="setCalibrationBreakpoint('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}',${idx},'volts',this.value)"
             title="Output volts (clamped to ±10 V by the gauge HSM)"/>
      <button class="calibration-bp-remove"
              ${bps.length <= 2 ? 'disabled title="At least 2 rows required"' : `onclick="removeCalibrationBreakpoint('${escHtml(pn)}','${escHtml(tplCh.id)}',${idx})"`}>−</button>
    </div>`;
  }).join('');

  return `
    <div class="calibration-channel-section">
      <div class="calibration-channel-head">
        <div class="calibration-channel-id">${escHtml(tplCh.id)}</div>
        <span class="cal-tag cal-tag-piecewise">piecewise</span>
        <span class="cal-count">${bps.length} pts</span>
      </div>
      ${warningBanner}
      ${coupledBanner}
      <div class="cal-curve-wrap">
        <svg class="cal-curve-svg" id="cal-curve-${channelKey}"
             viewBox="0 0 400 140"
             xmlns="http://www.w3.org/2000/svg">
          ${renderCalibrationCurveSvg(bps)}
        </svg>
      </div>
      <div class="calibration-bp-table">
        ${headerRow}
        ${rows}
      </div>
      <div class="calibration-bp-actions">
        <button class="cal-btn cal-btn-accent" onclick="addCalibrationBreakpoint('${escHtml(pn)}','${escHtml(tplCh.id)}')">+ Add breakpoint</button>
      </div>
      <div class="calibration-trim-grid">
        ${renderTrimFieldsBlock(pn, tplCh.id, liveCh, /*compact*/ false)}
      </div>
    </div>`;
}

// Render the inner contents of the transfer-curve SVG (everything between
// <svg>…</svg>). Called on initial render AND on every live slider movement
// via updateCalibrationCurve. The viewBox is fixed at 400×140 in JS and the
// SVG element preserves the 400:140 aspect ratio (default xMidYMid meet)
// so the curve doesn't get squashed flat on wide tables. CSS uses
// `aspect-ratio` to size the rendered element proportionally with a max
// height cap.
//
// Coordinate system: x = input range mapped to [pad, 400-pad];
//                    y = volts (-10..+10) mapped to [pad, 140-pad] (inverted
//                    so +10 V is at the top).
function renderCalibrationCurveSvg(bps) {
  if (!bps || bps.length < 2) {
    return `<text x="200" y="70" text-anchor="middle" class="cal-curve-label">need ≥2 breakpoints</text>`;
  }
  const W = 400, H = 140;
  const padL = 28, padR = 8, padT = 8, padB = 16;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const inputs = bps.map(b => Number(b.input));
  const minIn = Math.min(...inputs);
  const maxIn = Math.max(...inputs);
  const inSpan = (maxIn - minIn) || 1;

  const xOf = i => padL + ((Number(i) - minIn) / inSpan) * innerW;
  const yOf = v => padT + ((10 - Math.max(-10, Math.min(10, Number(v)))) / 20) * innerH;

  // Detect monotonicity issues — flag dots in amber where input <= prev.
  const flagged = new Array(bps.length).fill(false);
  for (let i = 1; i < bps.length; i++) {
    if (!(Number(bps[i].input) > Number(bps[i-1].input))) flagged[i] = true;
  }

  // Frame: zero-volt baseline (dashed blue), bottom axis, left axis.
  const zeroY = yOf(0);
  const parts = [];
  parts.push(`<line class="cal-curve-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}"/>`);
  parts.push(`<line class="cal-curve-axis" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"/>`);
  parts.push(`<line class="cal-curve-zero" x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}"/>`);
  // Y-axis tick labels at +10, 0, -10.
  parts.push(`<text x="${padL - 4}" y="${padT + 7}"  text-anchor="end" class="cal-curve-label">+10</text>`);
  parts.push(`<text x="${padL - 4}" y="${zeroY + 3}" text-anchor="end" class="cal-curve-label">0</text>`);
  parts.push(`<text x="${padL - 4}" y="${H - padB + 1}" text-anchor="end" class="cal-curve-label">-10</text>`);
  // X-axis labels at min/max input.
  parts.push(`<text x="${xOf(minIn)}" y="${H - 2}" text-anchor="middle" class="cal-curve-label">${formatNum(minIn)}</text>`);
  parts.push(`<text x="${xOf(maxIn)}" y="${H - 2}" text-anchor="middle" class="cal-curve-label">${formatNum(maxIn)}</text>`);

  // Polyline through the breakpoints.
  const pts = bps.map(b => `${xOf(b.input).toFixed(2)},${yOf(b.volts).toFixed(2)}`).join(' ');
  parts.push(`<polyline class="cal-curve-line" points="${pts}"/>`);
  // Breakpoint dots.
  for (let i = 0; i < bps.length; i++) {
    const cx = xOf(bps[i].input).toFixed(2);
    const cy = yOf(bps[i].volts).toFixed(2);
    const cls = flagged[i] ? 'cal-curve-dot warn' : 'cal-curve-dot';
    parts.push(`<circle class="${cls}" cx="${cx}" cy="${cy}" r="3.5"><title>(${formatNum(bps[i].input)}, ${formatNum(bps[i].volts)} V)</title></circle>`);
  }
  return parts.join('');
}

// Redraw the SVG curve for one channel without rebuilding the table. Reads
// the current breakpoints (or the synthesized 2-point table for linear) out
// of p.gaugeConfigs[pn] (which the live mutators keep up to date). Cheap:
// ~16 polyline points + 16 dots, swapped in via innerHTML on the <svg>.
function updateCalibrationCurve(pn, channelIdx) {
  const p = profiles[activeIdx];
  const entry = p?.gaugeConfigs?.[pn];
  const tpl = gaugeCalibrationDefaultsFor(pn);
  if (!tpl) return;
  const tplCh = tpl.channels[channelIdx];
  if (!tplCh) return;
  const liveCh = (entry?.channels || []).find(c => c.id === tplCh.id) || tplCh;
  const svg = document.getElementById(`cal-curve-${pn}-${channelIdx}`);
  if (!svg) return;
  if (tplCh.kind === 'resolver') {
    // Resolver pair re-render — read shared transform fields off the SIN
    // channel record (cos channel just points back via partnerChannel).
    const inputMin = (typeof liveCh.inputMin === 'number') ? liveCh.inputMin : (tplCh.inputMin ?? 0);
    const inputMax = (typeof liveCh.inputMax === 'number') ? liveCh.inputMax : (tplCh.inputMax ?? 100);
    const angleMin = (typeof liveCh.angleMinDegrees === 'number') ? liveCh.angleMinDegrees : (tplCh.angleMinDegrees ?? 0);
    const angleMax = (typeof liveCh.angleMaxDegrees === 'number') ? liveCh.angleMaxDegrees : (tplCh.angleMaxDegrees ?? 360);
    const peakVolts = (typeof liveCh.peakVolts === 'number') ? liveCh.peakVolts : (tplCh.peakVolts ?? 10);
    const belowMin = liveCh.belowMinBehavior || tplCh.belowMinBehavior || 'clamp';
    const scrubKey = `${pn}|${tplCh.id}`;
    let scrubValue = _resolverScrubState.get(scrubKey);
    if (typeof scrubValue !== 'number') scrubValue = (inputMin + inputMax) / 2;
    if (scrubValue < inputMin) scrubValue = inputMin;
    if (scrubValue > inputMax) scrubValue = inputMax;
    svg.innerHTML = renderResolverDialSvg({ inputMin, inputMax, angleMin, angleMax, peakVolts, belowMin, scrubValue });
    // Also refresh the readout if the dial is being live-redrawn (scrub
    // slider drag uses this path, not a full re-render).
    const readout = document.getElementById(`cal-scrub-readout-${pn}-${channelIdx}`);
    if (readout) {
      const ang = scrubAngle({ inputMin, inputMax, angleMin, angleMax, belowMin, scrubValue });
      const angText = ang === null ? 'rest' : `${formatNum(ang)}°`;
      readout.innerHTML = `input <strong>${formatNum(scrubValue)}</strong> → angle <strong>${escHtml(angText)}</strong>`;
    }
    return;
  }
  if (tplCh.kind === 'piecewise_resolver') {
    // Piecewise resolver re-render — same scrub-driven dial as resolver,
    // but the angle comes from a piecewise interpolation over breakpoints.
    const bps = (liveCh.breakpoints && liveCh.breakpoints.length)
      ? liveCh.breakpoints
      : (tplCh.breakpoints || []);
    const inputMin = bps.length ? bps[0].input : 0;
    const inputMax = bps.length ? bps[bps.length - 1].input : 100;
    const scrubKey = `${pn}|${tplCh.id}`;
    let scrubValue = _resolverScrubState.get(scrubKey);
    if (typeof scrubValue !== 'number') scrubValue = (inputMin + inputMax) / 2;
    if (scrubValue < inputMin) scrubValue = inputMin;
    if (scrubValue > inputMax) scrubValue = inputMax;
    const needleAngle = piecewiseResolverScrubAngle(bps, scrubValue);
    svg.innerHTML = renderPiecewiseResolverDialSvg({ bps, scrubValue, needleAngle });
    const readout = document.getElementById(`cal-scrub-readout-${pn}-${channelIdx}`);
    if (readout) {
      const angText = needleAngle === null ? 'rest' : formatNum(needleAngle % 360) + '°';
      readout.innerHTML = `input <strong>${formatNum(scrubValue)}</strong> → angle <strong>${escHtml(angText)}</strong>`;
    }
    return;
  }
  if (tplCh.kind === 'multi_resolver') {
    // Multi-turn resolver re-render — same scrub-driven dial. The dial
    // shows the synchro angle (mod 360); the readout adds the "we're on
    // revolution N" detail since the dial alone can't communicate it.
    const unitsPerRevolution = (typeof liveCh.unitsPerRevolution === 'number')
      ? liveCh.unitsPerRevolution
      : (tplCh.unitsPerRevolution ?? 1000);
    const scrubMin = (typeof tplCh.inputMin === 'number') ? tplCh.inputMin : -unitsPerRevolution * 5;
    const scrubMax = (typeof tplCh.inputMax === 'number') ? tplCh.inputMax : unitsPerRevolution * 80;
    const scrubKey = `${pn}|${tplCh.id}`;
    let scrubValue = _resolverScrubState.get(scrubKey);
    if (typeof scrubValue !== 'number') scrubValue = (scrubMin + scrubMax) / 2;
    if (scrubValue < scrubMin) scrubValue = scrubMin;
    if (scrubValue > scrubMax) scrubValue = scrubMax;
    const revolutions = unitsPerRevolution !== 0 ? scrubValue / unitsPerRevolution : 0;
    const angleDeg = revolutions * 360;
    const angleMod = ((angleDeg % 360) + 360) % 360;
    svg.innerHTML = renderMultiResolverDialSvg({ scrubValue, angleMod });
    const readout = document.getElementById(`cal-scrub-readout-${pn}-${channelIdx}`);
    if (readout) {
      readout.innerHTML = `input <strong>${formatNum(scrubValue)}</strong> → revolution <strong>${formatNum(revolutions)}</strong> → angle <strong>${formatNum(angleMod)}°</strong>`;
    }
    return;
  }
  let bps;
  if (tplCh.kind === 'linear') {
    const min = (typeof liveCh.inputMin === 'number') ? liveCh.inputMin : tplCh.inputMin;
    const max = (typeof liveCh.inputMax === 'number') ? liveCh.inputMax : tplCh.inputMax;
    bps = linearAsBreakpoints(min, max);
  } else {
    bps = liveCh.breakpoints || tplCh.breakpoints || [];
  }
  svg.innerHTML = renderCalibrationCurveSvg(bps);
}

// ── Linear channel editor ────────────────────────────────────────────────────
//
// Single-pattern editor for the 'linear' transform kind: two number fields
// (InputMin, InputMax) defining a straight line from (inputMin, −10 V) to
// (inputMax, +10 V). Below the inline trim grid sits a small live SVG
// preview (same vocabulary as the piecewise curve — line, axis labels) so
// edits read visually identically across patterns.
//
// `channelIdx` is here for symmetry with the piecewise editor and to give
// the SVG a stable DOM id (`cal-curve-<pn>-<channelIdx>`); the live update
// path is updateCalibrationCurve which dispatches per-kind.
function renderLinearChannelEditor(pn, channelIdx, tplCh, liveCh) {
  const channelKey = `${pn}-${channelIdx}`;
  const inputMin = (typeof liveCh.inputMin === 'number') ? liveCh.inputMin : (tplCh.inputMin ?? 0);
  const inputMax = (typeof liveCh.inputMax === 'number') ? liveCh.inputMax : (tplCh.inputMax ?? 100);
  const validation = validateLinearChannel({ inputMin, inputMax });
  const warningBanner = validation.warnings.length
    ? `<div class="cal-warnings">
         <strong>Validation:</strong>
         <ul>${validation.warnings.map(w => `<li>${escHtml(w)}</li>`).join('')}</ul>
       </div>`
    : '';

  return `
    <div class="calibration-channel-section">
      <div class="calibration-channel-head">
        <div class="calibration-channel-id">${escHtml(tplCh.id)}</div>
        <span class="cal-tag cal-tag-linear">linear</span>
        <span class="cal-count">${formatNum(inputMin)} → ${formatNum(inputMax)}</span>
      </div>
      ${warningBanner}
      <div class="cal-curve-wrap">
        <svg class="cal-curve-svg" id="cal-curve-${channelKey}"
             viewBox="0 0 400 140"
             xmlns="http://www.w3.org/2000/svg">
          ${renderCalibrationCurveSvg(linearAsBreakpoints(inputMin, inputMax))}
        </svg>
      </div>
      <div class="calibration-trim-grid">
        <label>Input min (−10 V)
          <input type="number" step="any" value="${formatNum(inputMin)}"
                 onchange="setCalibrationLinearField('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}','inputMin',this.value)"
                 title="Input value that maps to −10 V output."/>
        </label>
        <label>Input max (+10 V)
          <input type="number" step="any" value="${formatNum(inputMax)}"
                 onchange="setCalibrationLinearField('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}','inputMax',this.value)"
                 title="Input value that maps to +10 V output."/>
        </label>
        ${renderTrimFieldsBlock(pn, tplCh.id, liveCh, /*compact*/ false)}
      </div>
    </div>`;
}

// Synthesize a 2-point breakpoint table from a linear (inputMin, inputMax)
// pair so we can reuse renderCalibrationCurveSvg for the preview without
// teaching it about the linear pattern. Defensive against degenerate ranges
// (returns a single-point table; the curve renderer's "need ≥2" stub fires).
function linearAsBreakpoints(inputMin, inputMax) {
  if (typeof inputMin !== 'number' || typeof inputMax !== 'number' || inputMax <= inputMin) {
    return [];
  }
  return [
    { input: inputMin, volts: -10 },
    { input: inputMax, volts:  10 },
  ];
}

// Lightweight validator for the linear pattern. Flags degenerate ranges.
// Symmetric with validatePiecewiseChannel.
function validateLinearChannel(ch) {
  const warnings = [];
  const min = Number(ch?.inputMin);
  const max = Number(ch?.inputMax);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    warnings.push('Input min and max must both be set.');
  } else if (max <= min) {
    warnings.push('Input max must be greater than input min.');
  }
  return { ok: warnings.length === 0, warnings };
}

// ── Resolver pair editor ─────────────────────────────────────────────────────
//
// Sin and cos are physically driven by the same input via shared transform
// math, so we render ONE card per pair — even though the on-disk schema
// keeps a flat <Channel> per output port (sin's record carries the
// transform body, cos's just points back via partnerChannel).
//
// Layout: shared transform fields at the top (input range + angle range +
// peak volts + below-min behaviour), then a 2-row trim sub-table (sin row,
// cos row) so the user can independently calibrate the two windings, then
// a small SVG dial preview that sweeps from angleMin to angleMax with the
// peak-volts envelope.
//
// `tplCh` / `liveCh` are the SIN-side template + live record (which carry
// the transform body). `partnerTpl` / `partnerLive` are the COS side
// (used for cos trim only). May be null if the partner is missing — we
// still render the SIN-side editor in that case but skip the cos trim row.
function renderResolverPairEditor(pn, channelIdx, tplCh, liveCh, partnerTpl, partnerLive) {
  const channelKey = `${pn}-${channelIdx}`;
  const inputMin   = (typeof liveCh.inputMin   === 'number') ? liveCh.inputMin   : (tplCh.inputMin   ?? 0);
  const inputMax   = (typeof liveCh.inputMax   === 'number') ? liveCh.inputMax   : (tplCh.inputMax   ?? 100);
  const angleMin   = (typeof liveCh.angleMinDegrees === 'number') ? liveCh.angleMinDegrees : (tplCh.angleMinDegrees ?? 0);
  const angleMax   = (typeof liveCh.angleMaxDegrees === 'number') ? liveCh.angleMaxDegrees : (tplCh.angleMaxDegrees ?? 360);
  const peakVolts  = (typeof liveCh.peakVolts  === 'number') ? liveCh.peakVolts  : (tplCh.peakVolts  ?? 10);
  const belowMin   = liveCh.belowMinBehavior || tplCh.belowMinBehavior || 'clamp';

  const validation = validateResolverChannel({ inputMin, inputMax, angleMin, angleMax, peakVolts });
  const warningBanner = validation.warnings.length
    ? `<div class="cal-warnings">
         <strong>Validation:</strong>
         <ul>${validation.warnings.map(w => `<li>${escHtml(w)}</li>`).join('')}</ul>
       </div>`
    : '';

  // Trim sub-table: one row per channel (sin always; cos only if partner
  // exists). Uses the shared renderTrimFieldsBlock helper in compact mode
  // (the SIN/COS row label sits to the left, so the helper just emits
  // the two field labels without the explanatory hint).
  const trimRow = (label, channelId, ch) => {
    if (!ch) return '';
    return `
      <div class="calibration-trim-row">
        <div class="calibration-trim-label">${escHtml(label)}</div>
        <div class="calibration-trim-fields">
          ${renderTrimFieldsBlock(pn, channelId, ch, /*compact*/ true)}
        </div>
      </div>`;
  };

  const belowMinOptions = ['clamp', 'zero'].map(opt =>
    `<option value="${opt}" ${belowMin === opt ? 'selected' : ''}>${opt}</option>`
  ).join('');

  // Scrub-slider state: where the user has parked the simulated input value.
  // Per-channel so each card remembers its position across re-renders. Default
  // to the midpoint of the input range.
  const scrubKey = `${pn}|${tplCh.id}`;
  let scrubValue = _resolverScrubState.get(scrubKey);
  if (typeof scrubValue !== 'number') {
    scrubValue = (inputMin + inputMax) / 2;
    _resolverScrubState.set(scrubKey, scrubValue);
  }
  // Clamp scrub value into the current range (range may have changed since
  // the last save).
  if (scrubValue < inputMin) scrubValue = inputMin;
  if (scrubValue > inputMax) scrubValue = inputMax;

  // Whether the Advanced disclosure is open. Persisted across re-renders.
  const advKey = `${pn}|${tplCh.id}|adv`;
  const advOpen = _resolverAdvOpen.has(advKey);

  return `
    <div class="calibration-channel-section">
      <div class="calibration-channel-head">
        <div class="calibration-channel-id">Resolver pair · ${escHtml(roleSummaryFromIds(tplCh.id, partnerTpl?.id))}</div>
        <span class="cal-tag cal-tag-resolver">resolver pair</span>
        <span class="cal-count">${formatNum(inputMin)}–${formatNum(inputMax)} → ${formatNum(angleMin)}°–${formatNum(angleMax)}°</span>
      </div>
      ${warningBanner}
      <div class="cal-dial-wrap">
        <svg class="cal-dial-svg" id="cal-curve-${channelKey}"
             viewBox="0 0 240 200"
             xmlns="http://www.w3.org/2000/svg">
          ${renderResolverDialSvg({ inputMin, inputMax, angleMin, angleMax, peakVolts, belowMin, scrubValue })}
        </svg>
        <div class="cal-dial-scrub">
          <label>Test input value
            <input type="range"
                   min="${formatNum(inputMin)}" max="${formatNum(inputMax)}"
                   step="${formatNum((inputMax - inputMin) / 200)}"
                   value="${formatNum(scrubValue)}"
                   id="cal-scrub-${channelKey}"
                   oninput="setResolverScrubLive('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}',this.value)"/>
          </label>
          <div class="cal-dial-scrub-readout" id="cal-scrub-readout-${channelKey}">
            input <strong>${formatNum(scrubValue)}</strong>
            → angle <strong>${formatNum(scrubAngle({ inputMin, inputMax, angleMin, angleMax, belowMin, scrubValue }))}°</strong>
          </div>
        </div>
      </div>
      <div class="calibration-trim-grid">
        <label>Sim value at lower stop
          <input type="number" step="any" value="${formatNum(inputMin)}"
                 onchange="setCalibrationResolverField('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}','inputMin',this.value)"
                 title="Lowest sim input value the gauge will see (e.g. 0% nozzle, 0° heading, -90° roll)."/>
        </label>
        <label>Sim value at upper stop
          <input type="number" step="any" value="${formatNum(inputMax)}"
                 onchange="setCalibrationResolverField('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}','inputMax',this.value)"
                 title="Highest sim input value the gauge will see."/>
        </label>
      </div>
      <details class="calibration-resolver-advanced" ${advOpen ? 'open' : ''}
               onclick="event.stopPropagation()"
               ontoggle="setResolverAdvancedOpen('${escHtml(pn)}','${escHtml(tplCh.id)}',this.open)">
        <summary>Advanced</summary>
        <div class="calibration-trim-grid">
          ${renderPeakVoltsField(pn, channelIdx, tplCh.id, peakVolts)}
          <label>When sim is below lower stop
            <select onchange="setCalibrationResolverField('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}','belowMinBehavior',this.value)"
                    title="What to do when the sim sends a value below the lower stop. 'rest needle' parks both outputs at 0 V (typical for engine-off gauges like nozzle). 'clamp' pins the needle at the lower stop angle (typical for continuous gauges like compass)."/>
              <option value="zero"  ${belowMin === 'zero'  ? 'selected' : ''}>rest needle (0 V to both)</option>
              <option value="clamp" ${belowMin === 'clamp' ? 'selected' : ''}>clamp at lower stop angle</option>
            </select>
          </label>
        </div>
      </details>
      <div class="calibration-resolver-trims">
        <div class="calibration-resolver-trims-head">Per-winding trim — calibrate the two synchro windings independently</div>
        <div class="cal-help-text">
          Each winding (sin and cos) has its own zero offset and scale.
          The hardware decodes the needle angle from the RATIO of the two,
          so adjusting them independently fixes asymmetric drift (e.g.
          sin reading correctly while cos drifts low).
        </div>
        ${trimRow('SIN', tplCh.id, liveCh)}
        ${partnerTpl ? trimRow('COS', partnerTpl.id, partnerLive) : ''}
      </div>
    </div>`;
}

// Per-channel state maps (survive re-renders, scoped to the page session).
const _resolverScrubState = new Map();
const _resolverAdvOpen    = new Set();

// Build a friendly summary of which sim signal feeds the pair, e.g. for
// nozzle: "Nozzle Position SIN ↔ COS". Strips the gauge digits and the
// _To_Instrument suffix so the header stays readable.
function roleSummaryFromIds(sinId, cosId) {
  if (!sinId) return '';
  // e.g. "101088_Nozzle_Position_SIN_To_Instrument" → "Nozzle Position"
  const friendly = String(sinId)
    .replace(/^\d+_/, '')
    .replace(/_(SIN|COS)_To_Instrument$/i, '')
    .replace(/_/g, ' ');
  return friendly || sinId;
}

// Compute the angle the needle points to for a given scrub input. Mirrors
// the C# EvaluateResolver math (just the angle half — we don't need the
// sin/cos voltages for the dial preview).
function scrubAngle(p) {
  const span = p.inputMax - p.inputMin;
  if (!Number.isFinite(span) || span <= 0) return 0;
  let v = Number(p.scrubValue);
  if (v < p.inputMin) {
    if (p.belowMin === 'zero') return null;  // rest position
    return p.angleMin;
  }
  if (v > p.inputMax) return p.angleMax;
  const t = (v - p.inputMin) / span;
  return p.angleMin + t * (p.angleMax - p.angleMin);
}

// ── Piecewise resolver pair editor ───────────────────────────────────────────
//
// ADI-style pitch channels: input → reference angle (degrees) via piecewise
// table, then sin/cos × peakVolts. Renders ONE card per pair (anchored on
// the SIN channel template), like the resolver editor — but the breakpoint
// table replaces the linear input/angle range fields.
//
// The angle column is read-only just like resolver angle ranges (they're
// spec-sheet hardware properties documented in the gauge file). The user
// CAN edit input values and per-channel trim, but not the underlying angle
// curve. The dial preview renders the sweep at the scrub-input position.
function renderPiecewiseResolverPairEditor(pn, channelIdx, tplCh, liveCh, partnerTpl, partnerLive) {
  const channelKey = `${pn}-${channelIdx}`;
  const bps = (liveCh.breakpoints && liveCh.breakpoints.length)
    ? liveCh.breakpoints
    : (tplCh.breakpoints || []);
  const peakVolts = (typeof liveCh.peakVolts === 'number')
    ? liveCh.peakVolts
    : (tplCh.peakVolts ?? 10);

  // Scrub state (per-card, persisted across re-renders). Defaults to the
  // midpoint of the input range.
  const inputMin = bps.length ? bps[0].input : 0;
  const inputMax = bps.length ? bps[bps.length - 1].input : 100;
  const scrubKey = `${pn}|${tplCh.id}`;
  let scrubValue = _resolverScrubState.get(scrubKey);
  if (typeof scrubValue !== 'number') {
    scrubValue = (inputMin + inputMax) / 2;
    _resolverScrubState.set(scrubKey, scrubValue);
  }
  if (scrubValue < inputMin) scrubValue = inputMin;
  if (scrubValue > inputMax) scrubValue = inputMax;

  const advKey = `${pn}|${tplCh.id}|adv`;
  const advOpen = _resolverAdvOpen.has(advKey);

  // Compute the angle the needle points to for the current scrub value
  // (linear interp across the breakpoint table; same shape as the C#
  // EvaluatePiecewiseResolver, just JS).
  const needleAngle = piecewiseResolverScrubAngle(bps, scrubValue);

  // Trim sub-table (sin always; cos only if partner exists). Uses the
  // shared renderTrimFieldsBlock helper.
  const trimRow = (label, channelId, ch) => {
    if (!ch) return '';
    return `
      <div class="calibration-trim-row">
        <div class="calibration-trim-label">${escHtml(label)}</div>
        <div class="calibration-trim-fields">
          ${renderTrimFieldsBlock(pn, channelId, ch, /*compact*/ true)}
        </div>
      </div>`;
  };

  // Editable breakpoint table — input value and reference angle per row.
  // Edits push into p.gaugeConfigs[pn] in place; the dial preview redraws
  // live without re-rendering the table (so focus stays on the field
  // being edited). The angle is stored MONOTONICALLY in the table — the
  // displayed value is `% 360` so users see canonical 0..360°, but the
  // underlying number can exceed 360 to keep linear interp working
  // across the wrap (relevant for ADI pitch; identity for compass).
  // We display the canonical value but write back whatever the user
  // types — they can enter values >360 if they need to thread a
  // wrap-crossing segment.
  // Each row: idx | input number | angle slider | angle number | remove.
  // The slider lets the user nudge an angle visually; the number is for
  // precise entry. Mirrors the piecewise (volts) editor layout. The
  // slider is bounded 0..360 — values outside that range can still be
  // typed into the number input directly (needed for piecewise_resolver
  // gauges like ADI pitch where angles exceed 360° to keep interpolation
  // monotonic across the wrap).
  const tableRows = bps.map((bp, i) => {
    const rowKey = `cal-piecewise-resolver-${channelKey}-${i}`;
    const angleVal = Number(bp.angle ?? 0);
    const sliderVal = Math.max(0, Math.min(360, angleVal));
    return `
    <div class="calibration-piecewise-row calibration-piecewise-row-edit" id="${rowKey}">
      <div class="calibration-piecewise-idx">${i + 1}</div>
      <input type="number" step="any" value="${formatNum(bp.input)}"
             onchange="setPiecewiseResolverField('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}',${i},'input',this.value)"
             title="Sim input value at this breakpoint."/>
      <div class="cal-slider-wrap">
        <input type="range" min="0" max="360" step="0.1" value="${sliderVal}"
               id="${rowKey}-slider"
               oninput="setPiecewiseResolverAngleLive('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}',${i},this.value)"
               title="Drag to nudge the reference angle for this breakpoint."/>
      </div>
      <input type="number" step="any" value="${formatNum(bp.angle ?? 0)}"
             id="${rowKey}-num"
             onchange="setPiecewiseResolverField('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}',${i},'angle',this.value)"
             title="Reference angle (degrees) the synchro will sweep to at this input. Values may exceed 360° to keep interpolation monotonic across the 360°→0° wrap; the runtime applies % 360 before sin/cos."/>
      <button class="calibration-bp-remove"
              ${bps.length <= 2 ? 'disabled title="At least 2 rows required"' : `onclick="removePiecewiseResolverBreakpoint('${escHtml(pn)}','${escHtml(tplCh.id)}',${i})"`}>−</button>
    </div>`;
  }).join('');

  return `
    <div class="calibration-channel-section">
      <div class="calibration-channel-head">
        <div class="calibration-channel-id">Resolver pair · ${escHtml(roleSummaryFromIds(tplCh.id, partnerTpl?.id))}</div>
        <span class="cal-tag cal-tag-piecewise_resolver">piecewise resolver</span>
        <span class="cal-count">${bps.length} pts · ${formatNum(inputMin)}..${formatNum(inputMax)}</span>
      </div>
      <div class="cal-dial-wrap">
        <svg class="cal-dial-svg" id="cal-curve-${channelKey}"
             viewBox="0 0 240 200"
             xmlns="http://www.w3.org/2000/svg">
          ${renderPiecewiseResolverDialSvg({ bps, scrubValue, needleAngle })}
        </svg>
        <div class="cal-dial-scrub">
          <label>Test input value
            <input type="range"
                   min="${formatNum(inputMin)}" max="${formatNum(inputMax)}"
                   step="${formatNum((inputMax - inputMin) / 200)}"
                   value="${formatNum(scrubValue)}"
                   id="cal-scrub-${channelKey}"
                   oninput="setResolverScrubLive('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}',this.value)"/>
          </label>
          <div class="cal-dial-scrub-readout" id="cal-scrub-readout-${channelKey}">
            input <strong>${formatNum(scrubValue)}</strong>
            → angle <strong>${needleAngle === null ? 'rest' : formatNum(needleAngle % 360) + '°'}</strong>
          </div>
        </div>
      </div>
      <details class="calibration-piecewise-table-disclosure" open>
        <summary>Reference angle table (${bps.length} breakpoints)</summary>
        <div class="calibration-bp-actions" style="margin-bottom:8px">
          <button class="cal-btn cal-btn-accent"
                  onclick="addPiecewiseResolverBreakpoint('${escHtml(pn)}','${escHtml(tplCh.id)}')">+ Add breakpoint</button>
        </div>
        <div class="calibration-piecewise-table">
          <div class="calibration-piecewise-row calibration-piecewise-header">
            <div>#</div><div>Input</div><div>Angle</div><div>° (num)</div><div></div>
          </div>
          ${tableRows}
        </div>
      </details>
      <details class="calibration-resolver-advanced" ${advOpen ? 'open' : ''}
               onclick="event.stopPropagation()"
               ontoggle="setResolverAdvancedOpen('${escHtml(pn)}','${escHtml(tplCh.id)}',this.open)">
        <summary>Advanced</summary>
        <div class="calibration-trim-grid">
          ${renderPeakVoltsField(pn, channelIdx, tplCh.id, peakVolts)}
        </div>
      </details>
      <div class="calibration-resolver-trims">
        <div class="calibration-resolver-trims-head">Per-winding trim — calibrate the two synchro windings independently</div>
        <div class="cal-help-text">
          Each winding (sin and cos) has its own zero offset and scale.
          The hardware decodes the needle angle from the RATIO of the two,
          so adjusting them independently fixes asymmetric drift (e.g.
          sin reading correctly while cos drifts low).
        </div>
        ${trimRow('SIN', tplCh.id, liveCh)}
        ${partnerTpl ? trimRow('COS', partnerTpl.id, partnerLive) : ''}
      </div>
    </div>`;
}

// Compute the reference angle at a given scrub input — linear interp
// across the breakpoint table. Mirrors the C# EvaluatePiecewiseResolver
// (just the angle half — the dial preview doesn't need sin/cos voltages).
function piecewiseResolverScrubAngle(bps, scrubValue) {
  if (!bps || bps.length < 2) return null;
  const v = Number(scrubValue);
  if (!Number.isFinite(v)) return null;
  if (v <= bps[0].input) return bps[0].angle;
  const last = bps[bps.length - 1];
  if (v >= last.input) return last.angle;
  for (let i = 1; i < bps.length; i++) {
    const hi = bps[i];
    if (v < hi.input) {
      const lo = bps[i - 1];
      const span = hi.input - lo.input;
      if (span <= 0) return lo.angle;
      const t = (v - lo.input) / span;
      return lo.angle + t * (hi.angle - lo.angle);
    }
  }
  return last.angle;
}

// Dial SVG for piecewise_resolver — full circle + needle at the current
// scrub angle. Unlike the resolver dial, there's no fixed sweep arc to
// draw (the sweep is implicit in the breakpoint table and may wrap past
// 360°), so we draw a full reference circle + tick marks at each
// breakpoint's angle (mod 360) instead.
function renderPiecewiseResolverDialSvg(p) {
  const W = 240, H = 200;
  const cx = 120, cy = 110;
  const r = 80;
  const polar = (angleDeg, radius) => {
    const rad = (angleDeg - 90) * Math.PI / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };
  const parts = [];
  // Full reference circle.
  parts.push(`<circle class="cal-dial-arc" cx="${cx}" cy="${cy}" r="${r}" fill="none"/>`);
  // Tick at each breakpoint's angle, slightly outside the circle.
  for (const bp of (p.bps || [])) {
    const a = (bp.angle || 0) % 360;
    const [x1, y1] = polar(a, r - 4);
    const [x2, y2] = polar(a, r + 4);
    parts.push(`<line class="cal-dial-tick" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`);
  }
  // Needle at the scrub angle.
  if (p.needleAngle !== null && Number.isFinite(p.needleAngle)) {
    const [nx, ny] = polar(p.needleAngle % 360, r - 6);
    parts.push(`<line class="cal-dial-needle" x1="${cx}" y1="${cy}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}"/>`);
  }
  parts.push(`<circle class="cal-dial-needle-hub" cx="${cx}" cy="${cy}" r="4"/>`);
  // Scrub-input readout label centered below the dial.
  const inputText = formatNum(p.scrubValue);
  parts.push(`<text x="${cx}" y="${H - 6}" text-anchor="middle" class="cal-dial-label">${escHtml(inputText)}</text>`);
  return parts.join('');
}

// ── Multi-turn resolver pair editor ──────────────────────────────────────────
//
// Altimeter-style pairs: input drives a synchro that wraps many revolutions
// across the input range. The angle math is just
//   angle = (input / unitsPerRevolution) × 360°
// then sin/cos × peakVolts. The synchro doesn't care that the angle has
// passed 360° many times — the hardware reads atan2(sin, cos) which wraps
// naturally.
//
// Editor card layout: same single-dial preview as the resolver editor, with
// a scrub slider sweeping the input range. The needle shows the current
// angle modulo 360°. A revolutions readout under the dial communicates the
// "this is turn N of M" idea — the dial alone can't show that.
//
// Sim-value range fields (inputMin/inputMax) are exposed only as the scrub
// range — they're not part of the on-disk schema for multi_resolver (the
// sweep is unbounded). The editor uses them purely to bound the test
// slider; gauges should set sensible defaults like ±the gauge's max input.
function renderMultiResolverPairEditor(pn, channelIdx, tplCh, liveCh, partnerTpl, partnerLive) {
  const channelKey = `${pn}-${channelIdx}`;
  const unitsPerRevolution = (typeof liveCh.unitsPerRevolution === 'number')
    ? liveCh.unitsPerRevolution
    : (tplCh.unitsPerRevolution ?? 1000);
  const peakVolts = (typeof liveCh.peakVolts === 'number')
    ? liveCh.peakVolts
    : (tplCh.peakVolts ?? 10);

  // Scrub bounds — read from inputMin/inputMax if the template supplies
  // them, else default to a sensible 10× revolution range so the user can
  // see the wrapping behaviour.
  const scrubMin = (typeof tplCh.inputMin === 'number')
    ? tplCh.inputMin
    : -unitsPerRevolution * 5;
  const scrubMax = (typeof tplCh.inputMax === 'number')
    ? tplCh.inputMax
    : unitsPerRevolution * 80;

  const scrubKey = `${pn}|${tplCh.id}`;
  let scrubValue = _resolverScrubState.get(scrubKey);
  if (typeof scrubValue !== 'number') {
    scrubValue = (scrubMin + scrubMax) / 2;
    _resolverScrubState.set(scrubKey, scrubValue);
  }
  if (scrubValue < scrubMin) scrubValue = scrubMin;
  if (scrubValue > scrubMax) scrubValue = scrubMax;

  const advKey = `${pn}|${tplCh.id}|adv`;
  const advOpen = _resolverAdvOpen.has(advKey);

  const revolutions = unitsPerRevolution !== 0 ? scrubValue / unitsPerRevolution : 0;
  const angleDeg = revolutions * 360;
  const angleMod = ((angleDeg % 360) + 360) % 360;

  const trimRow = (label, channelId, ch) => {
    if (!ch) return '';
    return `
      <div class="calibration-trim-row">
        <div class="calibration-trim-label">${escHtml(label)}</div>
        <div class="calibration-trim-fields">
          ${renderTrimFieldsBlock(pn, channelId, ch, /*compact*/ true)}
        </div>
      </div>`;
  };

  return `
    <div class="calibration-channel-section">
      <div class="calibration-channel-head">
        <div class="calibration-channel-id">Multi-turn resolver · ${escHtml(roleSummaryFromIds(tplCh.id, partnerTpl?.id))}</div>
        <span class="cal-tag cal-tag-multi_resolver">multi-turn resolver</span>
        <span class="cal-count">${formatNum(unitsPerRevolution)} per rev</span>
      </div>
      <div class="cal-dial-wrap">
        <svg class="cal-dial-svg" id="cal-curve-${channelKey}"
             viewBox="0 0 240 200"
             xmlns="http://www.w3.org/2000/svg">
          ${renderMultiResolverDialSvg({ scrubValue, angleMod })}
        </svg>
        <div class="cal-dial-scrub">
          <label>Test input value
            <input type="range"
                   min="${formatNum(scrubMin)}" max="${formatNum(scrubMax)}"
                   step="${formatNum((scrubMax - scrubMin) / 400)}"
                   value="${formatNum(scrubValue)}"
                   id="cal-scrub-${channelKey}"
                   oninput="setResolverScrubLive('${escHtml(pn)}',${channelIdx},'${escHtml(tplCh.id)}',this.value)"/>
          </label>
          <div class="cal-dial-scrub-readout" id="cal-scrub-readout-${channelKey}">
            input <strong>${formatNum(scrubValue)}</strong>
            → revolution <strong>${formatNum(revolutions)}</strong>
            → angle <strong>${formatNum(angleMod)}°</strong>
          </div>
        </div>
      </div>
      <details class="calibration-resolver-advanced" ${advOpen ? 'open' : ''}
               onclick="event.stopPropagation()"
               ontoggle="setResolverAdvancedOpen('${escHtml(pn)}','${escHtml(tplCh.id)}',this.open)">
        <summary>Advanced</summary>
        <div class="calibration-trim-grid">
          ${renderPeakVoltsField(pn, channelIdx, tplCh.id, peakVolts)}
        </div>
      </details>
      <div class="calibration-resolver-trims">
        <div class="calibration-resolver-trims-head">Per-winding trim — calibrate the two synchro windings independently</div>
        <div class="cal-help-text">
          Each winding (sin and cos) has its own zero offset and scale.
          The hardware decodes the needle angle from the RATIO of the two,
          so adjusting them independently fixes asymmetric drift (e.g.
          sin reading correctly while cos drifts low).
        </div>
        ${trimRow('SIN', tplCh.id, liveCh)}
        ${partnerTpl ? trimRow('COS', partnerTpl.id, partnerLive) : ''}
      </div>
    </div>`;
}

// Dial SVG for multi_resolver — full reference circle + needle at the
// current angle (mod 360). The "we're on revolution N" information is in
// the textual readout below; the dial just shows the synchro position.
function renderMultiResolverDialSvg(p) {
  const W = 240, H = 200;
  const cx = 120, cy = 110;
  const r = 80;
  const polar = (angleDeg, radius) => {
    const rad = (angleDeg - 90) * Math.PI / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };
  const parts = [];
  // Full reference circle.
  parts.push(`<circle class="cal-dial-arc" cx="${cx}" cy="${cy}" r="${r}" fill="none"/>`);
  // Tick marks at 0/90/180/270 to give the eye a reference.
  for (const t of [0, 90, 180, 270]) {
    const [x1, y1] = polar(t, r - 4);
    const [x2, y2] = polar(t, r + 4);
    parts.push(`<line class="cal-dial-tick" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`);
  }
  // Needle.
  const [nx, ny] = polar(p.angleMod, r - 6);
  parts.push(`<line class="cal-dial-needle" x1="${cx}" y1="${cy}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}"/>`);
  parts.push(`<circle class="cal-dial-needle-hub" cx="${cx}" cy="${cy}" r="4"/>`);
  // Scrub-input label centered below the dial.
  parts.push(`<text x="${cx}" y="${H - 6}" text-anchor="middle" class="cal-dial-label">${escHtml(formatNum(p.scrubValue))}</text>`);
  return parts.join('');
}

// ── Digital invert editor ────────────────────────────────────────────────────
//
// Single-field editor: a checkbox labelled "Invert output". Used by gauges
// like the 10-1084 ADI OFF flag, where the synchro driver expects active-
// low logic but the sim publishes active-high (or vice versa).
function renderDigitalInvertEditor(pn, channelIdx, tplCh, liveCh) {
  const invert = (typeof liveCh.invert === 'boolean') ? liveCh.invert : !!tplCh.invert;
  return `
    <div class="calibration-channel-section">
      <div class="calibration-channel-head">
        <div class="calibration-channel-id">${escHtml(tplCh.id)}</div>
        <span class="cal-tag cal-tag-digital_invert">digital invert</span>
      </div>
      <div class="calibration-digital-invert">
        <label>
          <input type="checkbox" ${invert ? 'checked' : ''}
                 onchange="setCalibrationInvert('${escHtml(pn)}','${escHtml(tplCh.id)}',this.checked)"/>
          Invert output (output bool = NOT input bool)
        </label>
        <div class="calibration-stub">
          When checked, the synchro driver receives the logical inverse of
          the sim's signal. Used when the hardware expects active-low logic
          and the sim publishes active-high (e.g. the ADI OFF flag where
          input "visible" maps to output "hidden=false").
        </div>
      </div>
    </div>`;
}

// Lightweight validator for the resolver pattern. Symmetric with the
// linear/piecewise validators.
function validateResolverChannel(ch) {
  const warnings = [];
  const inMin = Number(ch?.inputMin);
  const inMax = Number(ch?.inputMax);
  const angMin = Number(ch?.angleMin);
  const angMax = Number(ch?.angleMax);
  const peak = Number(ch?.peakVolts);
  if (!Number.isFinite(inMin) || !Number.isFinite(inMax)) {
    warnings.push('Input min and max must both be set.');
  } else if (inMax <= inMin) {
    warnings.push('Input max must be greater than input min.');
  }
  if (!Number.isFinite(angMin) || !Number.isFinite(angMax)) {
    warnings.push('Angle min and max must both be set.');
  } else if (angMax === angMin) {
    warnings.push('Angle min and max must differ.');
  }
  if (!Number.isFinite(peak) || peak <= 0 || peak > 10) {
    warnings.push('Peak volts must be between 0 and 10.');
  }
  return { ok: warnings.length === 0, warnings };
}

// Render a dial-style preview of the resolver: an arc from angleMin to
// angleMax with tick marks at each end, plus a needle pointing at the
// scrub input value's mapped angle. The arc shows the gauge's mechanical
// sweep; the needle shows where the sim would push it given the current
// scrub-slider position.
//
// Convention: 0° = straight up (12 o'clock), angles increase CLOCKWISE.
// Matches how a user thinks about a dial (compass north = 0°, clock 3
// o'clock = 90°, etc.) and the C# EvaluateResolver math (which uses
// standard sin/cos with that convention via the synchro hardware).
//
// SVG viewBox is 240×200, dial centered at (120, 110), radius 80. Above
// the dial is room for the title labels at the angle endpoints.
function renderResolverDialSvg(p) {
  const W = 240, H = 200;
  const cx = 120, cy = 110;
  const r = 80;
  const span = p.inputMax - p.inputMin;
  if (!Number.isFinite(span) || span <= 0) {
    return `<text x="${cx}" y="${cy}" text-anchor="middle" class="cal-curve-label">degenerate range</text>`;
  }

  // Helper: convert an angle (degrees, clockwise from 12 o'clock) to SVG
  // (x, y) on the unit circle around the dial center.
  const polar = (angleDeg, radius) => {
    // Rotate so that 0° points up (12 o'clock). SVG default is 0° = +x axis
    // (3 o'clock), increasing counterclockwise; we want 0° = -y axis,
    // increasing clockwise. So angleSvg = angleDeg - 90.
    const rad = (angleDeg - 90) * Math.PI / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };

  // Build the arc path from angleMin to angleMax.
  const startAngle = p.angleMin;
  const endAngle   = p.angleMax;
  const sweepDeg = endAngle - startAngle;
  const [sx, sy] = polar(startAngle, r);
  const [ex, ey] = polar(endAngle,   r);
  const largeArc = Math.abs(sweepDeg) > 180 ? 1 : 0;
  const sweepFlag = sweepDeg >= 0 ? 1 : 0;
  const arcPath = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${ex.toFixed(2)} ${ey.toFixed(2)}`;

  // Tick marks at the two endpoints, slightly outside the arc.
  const tick = (angleDeg) => {
    const [x1, y1] = polar(angleDeg, r - 5);
    const [x2, y2] = polar(angleDeg, r + 5);
    return `<line class="cal-dial-tick" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  };

  // Endpoint label — read-only. Angles are spec-sheet hardware properties
  // documented in each gauge file (sim-<digits>-<short>.js); the user
  // shouldn't edit them. The label sits just outside the tick mark so the
  // dial reads as a confidence-check visualization.
  const endpointLabel = (angleDeg, simValue) => {
    const [lx, ly] = polar(angleDeg, r + 18);
    return `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" text-anchor="middle" class="cal-dial-label">${escHtml(formatNum(simValue))}</text>`;
  };

  // Needle: from center to the angle the scrub input maps to. If the
  // belowMin behaviour is "zero" and the scrub is below the input range,
  // the needle is parked at center (no needle drawn).
  const needleAngle = scrubAngle(p);
  let needleSvg = '';
  if (needleAngle !== null) {
    const [nx, ny] = polar(needleAngle, r - 6);
    needleSvg = `
      <line class="cal-dial-needle" x1="${cx}" y1="${cy}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}"/>
      <circle class="cal-dial-needle-hub" cx="${cx}" cy="${cy}" r="4"/>`;
  } else {
    needleSvg = `<circle class="cal-dial-needle-hub" cx="${cx}" cy="${cy}" r="4"/>`;
  }

  return `
    <path class="cal-dial-arc" d="${arcPath}"/>
    ${tick(startAngle)}
    ${tick(endAngle)}
    ${endpointLabel(startAngle, p.inputMin)}
    ${endpointLabel(endAngle,   p.inputMax)}
    ${needleSvg}
  `;
}

// ── Mutators ─────────────────────────────────────────────────────────────────
// Each mutator ensures p.gaugeConfigs[pn] exists (cloning the spec-sheet
// default the first time the user touches a field), updates the requested
// field, and triggers a re-render. Re-rendering on every change for add/
// remove/reset/trim is fine — the Calibration tab is small (one card per
// declared gauge). Per-row input/volts edits skip the re-render to preserve
// focus, but rebuild the in-memory state.

function ensureGaugeEntry(p, pn) {
  if (!p.gaugeConfigs) p.gaugeConfigs = {};
  if (!p.gaugeConfigs[pn]) {
    const cloned = cloneGaugeCalibrationDefault(pn);
    if (!cloned) return null;
    p.gaugeConfigs[pn] = cloned;
  }
  return p.gaugeConfigs[pn];
}

// `channelIdx` is added so we can reach the matching SVG curve and slider
// without re-rendering. Older callers passed (pn, channelId, idx, field, value);
// new callers pass (pn, channelIdx, channelId, idx, field, value).
function setCalibrationBreakpoint(pn, channelIdx, channelId, idx, field, value) {
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === channelId);
  if (!ch || !ch.breakpoints) return;
  const bp = ch.breakpoints[idx];
  if (!bp) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  bp[field] = n;
  // Live sync: if the user typed a new volts value, push it into the matching
  // slider so the two stay aligned. Same for input → slider isn't applicable
  // (the slider is fixed -10..+10 V and only tracks volts).
  if (field === 'volts') {
    const slider = document.getElementById(`cal-row-${pn}-${channelIdx}-${idx}-slider`);
    if (slider) {
      slider.value = String(Math.max(-10, Math.min(10, n)));
    }
  }
  updateCalibrationCurve(pn, channelIdx);
  // No table re-render — the input already shows the typed value and a
  // re-render would lose focus mid-edit. Validation banner / header pill
  // staleness is acceptable until the next event that does re-render
  // (add/remove row, trim, switch tab).
}

// Slider drag handler: updates the model AND the sibling number input AND
// the curve, all without re-rendering the table.
function setCalibrationVoltsLive(pn, channelIdx, channelId, idx, value) {
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === channelId);
  if (!ch || !ch.breakpoints) return;
  const bp = ch.breakpoints[idx];
  if (!bp) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  bp.volts = n;
  // Mirror the slider's value into the sibling number input so the user can
  // see the precise value while dragging.
  const num = document.getElementById(`cal-row-${pn}-${channelIdx}-${idx}-num`);
  if (num && document.activeElement !== num) {
    num.value = formatNum(n);
  }
  updateCalibrationCurve(pn, channelIdx);
}

function addCalibrationBreakpoint(pn, channelId) {
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === channelId);
  if (!ch || !ch.breakpoints) return;
  // New breakpoint defaults: place it at the end, midway between the last
  // input and the last input + 10. Volts copies the previous row's volts.
  const last = ch.breakpoints[ch.breakpoints.length - 1] || { input: 0, volts: 0 };
  ch.breakpoints.push({ input: last.input + 10, volts: last.volts });
  renderCalibration();
}

// 10-0285 altimeter only: drop the four legacy bare baro fields from the
// per-gauge config. Newer SimLinkup builds use BMS's already-baro-compensated
// altitude directly and ignore these fields when <Channels> is populated, so
// this is a clean-up for users who want to retire the workaround.
function removeLegacyBaroFromGauge(pn) {
  if (!confirm(
    'Remove the four legacy baro-compensation fields from this gauge’s config file?\n\n' +
    'These fields are kept for compatibility with older SimLinkup builds. Newer ' +
    'builds bypass them when the resolver channels are present.\n\n' +
    'You can put them back later by hand-editing the file.')) return;
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  delete entry.legacyBaro;
  renderCalibration();
}

// 10-0294 fuel quantity only: drop the bare <MaxPoundsTotalFuel> field.
// Newer SimLinkup builds bypass it when the piecewise counter table is
// populated; same shape as removeLegacyBaroFromGauge.
function removeLegacyMaxPoundsTotalFuelFromGauge(pn) {
  if (!confirm(
    'Remove the legacy MaxPoundsTotalFuel field from this gauge’s config file?\n\n' +
    'This field is kept for compatibility with older SimLinkup builds. Newer ' +
    'builds use the piecewise counter table instead.\n\n' +
    'You can put it back later by hand-editing the file.')) return;
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  delete entry.legacyMaxPoundsTotalFuel;
  renderCalibration();
}

function removeCalibrationBreakpoint(pn, channelId, idx) {
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === channelId);
  if (!ch || !ch.breakpoints) return;
  if (ch.breakpoints.length <= 2) return;  // safety; button is disabled too
  ch.breakpoints.splice(idx, 1);
  renderCalibration();
}

function setCalibrationTrim(pn, channelId, field, value) {
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === channelId);
  if (!ch) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  ch[field] = n;
  // Trim affects the header pill — re-render to refresh the edited/default
  // state. The full re-render also re-positions the slider thumb, so the
  // slider stays in sync with whatever the user typed.
  renderCalibration();
}

// Slider drag handler for trim fields. Updates the model AND the sibling
// number input AND nothing else (no full re-render, so focus stays on the
// slider). Mirrors setCalibrationVoltsLive for the piecewise volts slider.
function setCalibrationTrimLive(pn, channelId, field, value) {
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === channelId);
  if (!ch) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  ch[field] = n;
  // Mirror into the sibling number input. The id pattern is
  // `cal-trim-<pn>-<channelId>-<zeroOrGain>-num`.
  const which = field === 'zeroTrim' ? 'zero' : 'gain';
  const num = document.getElementById(`cal-trim-${pn}-${channelId}-${which}-num`);
  if (num && document.activeElement !== num) {
    num.value = formatTrimNum(n);
  }
}

// Slider drag handler for the peak drive voltage. Same shape as
// setCalibrationTrimLive — model + sibling number, no full re-render.
function setPeakVoltsLive(pn, channelIdx, sinChannelId, value) {
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === sinChannelId);
  if (!ch) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  ch.peakVolts = n;
  const num = document.getElementById(`cal-peakvolts-${pn}-${sinChannelId}-num`);
  if (num && document.activeElement !== num) {
    num.value = formatTrimNum(n);
  }
}

// Setter for digital_invert channels — toggles the invert bool. Same
// re-render-on-change pattern as the trim setter.
function setCalibrationInvert(pn, channelId, value) {
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === channelId);
  if (!ch) return;
  ch.invert = !!value;
  renderCalibration();
}

// Setter for piecewise_resolver breakpoint cells (input or angle) — updates
// the model in place and redraws the dial preview live without re-rendering
// the whole tab. Mirrors setCalibrationBreakpoint for piecewise volts; the
// difference is the angle cell instead of volts.
function setPiecewiseResolverField(pn, channelIdx, sinChannelId, idx, field, value) {
  if (field !== 'input' && field !== 'angle') return;
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === sinChannelId);
  if (!ch || !Array.isArray(ch.breakpoints)) return;
  const bp = ch.breakpoints[idx];
  if (!bp) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  bp[field] = n;
  // Live sync: when the user types a new angle, mirror into the row's
  // slider so the two stay aligned. Slider clamps to [0, 360]; values
  // outside that range still write to the model but the slider thumb
  // pins at the closest end.
  if (field === 'angle') {
    const slider = document.getElementById(`cal-piecewise-resolver-${pn}-${channelIdx}-${idx}-slider`);
    if (slider) slider.value = String(Math.max(0, Math.min(360, n)));
  }
  // Live SVG redraw — no full re-render so the input the user just edited
  // keeps focus. Header pill / edited badge will refresh on the next event
  // that does re-render (add row, switch tab, etc.).
  updateCalibrationCurve(pn, channelIdx);
}

// Slider drag handler for the piecewise_resolver angle column. Updates
// the model AND the sibling number input AND the dial preview without
// re-rendering the table. Mirrors setCalibrationVoltsLive for the
// piecewise volts slider.
function setPiecewiseResolverAngleLive(pn, channelIdx, sinChannelId, idx, value) {
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === sinChannelId);
  if (!ch || !Array.isArray(ch.breakpoints)) return;
  const bp = ch.breakpoints[idx];
  if (!bp) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  bp.angle = n;
  // Mirror the slider's value into the sibling number input so the user
  // can see the precise value while dragging. Skip when the number input
  // is currently focused (user is typing — don't fight them).
  const num = document.getElementById(`cal-piecewise-resolver-${pn}-${channelIdx}-${idx}-num`);
  if (num && document.activeElement !== num) {
    num.value = formatNum(n);
  }
  updateCalibrationCurve(pn, channelIdx);
}

// Insert a new breakpoint at the end of the table. Defaults: input is the
// midpoint between the last row and the next sensible boundary; angle
// continues the previous slope. Triggers a full re-render so the new row
// shows up. Mirrors addCalibrationBreakpoint for piecewise volts.
function addPiecewiseResolverBreakpoint(pn, sinChannelId) {
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === sinChannelId);
  if (!ch || !Array.isArray(ch.breakpoints)) return;
  const last = ch.breakpoints[ch.breakpoints.length - 1] || { input: 0, angle: 0 };
  const prev = ch.breakpoints[ch.breakpoints.length - 2];
  // New row defaults: nudge input forward by whatever the previous step
  // was (or +10 if there's only one row); angle copies the previous row's
  // angle (user will edit it).
  const inputStep = prev ? (last.input - prev.input) : 10;
  ch.breakpoints.push({
    input: last.input + (inputStep || 10),
    angle: last.angle,
  });
  renderCalibration();
}

// Remove a breakpoint by index. Refuses to drop below 2 rows (the dial
// needs at least 2 to interpolate). Mirrors removeCalibrationBreakpoint.
function removePiecewiseResolverBreakpoint(pn, sinChannelId, idx) {
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === sinChannelId);
  if (!ch || !Array.isArray(ch.breakpoints)) return;
  if (ch.breakpoints.length <= 2) return;  // safety; button is disabled too
  ch.breakpoints.splice(idx, 1);
  renderCalibration();
}

// Linear-pattern setter: update inputMin or inputMax. Triggers a full
// re-render so the validation banner / cal-count summary / SVG label
// reflect the new range. The cost is small (linear cards have ~4 inputs)
// and the user isn't typing fast enough to lose focus across the re-render.
function setCalibrationLinearField(pn, channelIdx, channelId, field, value) {
  if (field !== 'inputMin' && field !== 'inputMax') return;
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === channelId);
  if (!ch) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  ch[field] = n;
  renderCalibration();
}

// Live scrub-slider handler for the resolver dial preview. Updates the
// per-card scrub state (no model edit — this is purely a preview tool)
// and redraws just the SVG via updateCalibrationCurve. Doesn't trigger a
// full re-render since the underlying gauge config is unchanged.
function setResolverScrubLive(pn, channelIdx, channelId, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  _resolverScrubState.set(`${pn}|${channelId}`, n);
  updateCalibrationCurve(pn, channelIdx);
}

// Track which resolver Advanced disclosures are open across re-renders.
function setResolverAdvancedOpen(pn, channelId, open) {
  const k = `${pn}|${channelId}|adv`;
  if (open) _resolverAdvOpen.add(k); else _resolverAdvOpen.delete(k);
}

// Resolver-pattern setter: update one of the user-editable shared transform
// fields on the SIN channel (the cos channel has no transform body, just
// role + partnerChannel). The user-editable fields are inputMin, inputMax,
// peakVolts, belowMinBehavior — the angle fields are spec-sheet hardware
// properties documented in each gauge file and not editable in the UI.
// Always re-renders so the SVG preview, header summary, and validation
// banner all refresh.
function setCalibrationResolverField(pn, channelIdx, sinChannelId, field, value) {
  const numericFields = ['inputMin', 'inputMax', 'peakVolts'];
  const stringFields = ['belowMinBehavior'];
  const p = profiles[activeIdx];
  const entry = ensureGaugeEntry(p, pn);
  if (!entry) return;
  const ch = entry.channels.find(c => c.id === sinChannelId);
  if (!ch) return;
  if (numericFields.indexOf(field) >= 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    ch[field] = n;
  } else if (stringFields.indexOf(field) >= 0) {
    if (value !== 'clamp' && value !== 'zero') return;
    ch[field] = value;
  } else {
    return;
  }
  renderCalibration();
}

function resetGaugeCalibration(pn) {
  const p = profiles[activeIdx];
  if (!confirm(`Reset ${pn} to spec-sheet defaults? Any per-channel edits and trim values will be lost. The on-disk .config file will be re-written on next save.`)) return;
  if (!p.gaugeConfigs) p.gaugeConfigs = {};
  delete p.gaugeConfigs[pn];
  // Mark this PN as needing the on-disk file to be overwritten on next save —
  // without this, save.js would fall into the createOnly:true branch (no
  // entry in p.gaugeConfigs) and the existing on-disk file would survive,
  // making the reset feel like a no-op until the user manually deleted the
  // file. The flag is consumed (and cleared) by save.js's per-gauge loop.
  if (!(p._gaugeResetPending instanceof Set)) p._gaugeResetPending = new Set();
  p._gaugeResetPending.add(pn);
  renderCalibration();
}
