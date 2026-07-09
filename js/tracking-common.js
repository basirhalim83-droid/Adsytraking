// ── Tracking Resi -- factory dipakai 3x (Akuisisi/Marketplace/CRM) ──────────────
// UI diporting dari pola AdsyCRM/MarketDash: card grid + tab filter + stat card klik +
// stepper 5 tahap + modal detail + date-range picker.
//
// PENTING: heuristik stage TIDAK ada di sini. Tombol "Cek Ulang"/"Refresh Semua" cuma
// manggil /api/tracking-check dan render hasil {stage, step, detail} yang API balikin --
// lihat lib/stage-engine.js buat satu-satunya tempat logic itu hidup.

const TR_STEP_LABELS = ['Konfirmasi', 'Dikirim', 'Kota Tujuan', 'OTW', 'Sampai'];
const TR_STAGE_META = {
  MENUNGGU_RESI: { label: '⏳ Menunggu Resi', badge: 'badge-warning', step: 1 },
  BELUM_DICEK:   { label: '🔍 Belum Dicek',   badge: 'badge-gray',    step: 1 },
  DIKIRIM:       { label: '🚚 Dikirim',        badge: 'badge-primary', step: 2 },
  KOTA_TUJUAN:   { label: '🏙️ Kota Tujuan',   badge: 'badge-primary', step: 3 },
  OTW:           { label: '🛵 OTW',            badge: 'badge-warning', step: 4 },
  SAMPAI:        { label: '✅ Sampai',          badge: 'badge-success', step: 5 },
  BERMASALAH:    { label: '⚠️ Bermasalah',     badge: 'badge-danger',  step: 2, problem: true },
  RETUR:         { label: '↩️ Retur',          badge: 'badge-danger',  step: 2, problem: true },
};
const TR_TABS = [
  { key: 'SEMUA',         label: 'Semua' },
  { key: 'MENUNGGU_RESI', label: '⏳ Menunggu Resi' },
  { key: 'DIKIRIM',       label: '🚚 Dikirim' },
  { key: 'KOTA_TUJUAN',   label: '🏙️ Kota Tujuan' },
  { key: 'OTW',           label: '🛵 OTW' },
  { key: 'SAMPAI',        label: '✅ Sampai' },
  { key: 'BERMASALAH',    label: '⚠️ Bermasalah' },
  { key: 'RETUR',         label: '↩️ Retur' },
];
const TR_STAT_CARD_FILTER = { SEMUA: 'SEMUA', ON_PROSES: 'ON_PROSES_GROUP', UNDEL: 'BERMASALAH', RETUR: 'RETUR', DELIVERY: 'SAMPAI' };
const TR_ON_PROSES_STAGES = ['MENUNGGU_RESI', 'BELUM_DICEK', 'DIKIRIM', 'KOTA_TUJUAN', 'OTW'];
const TR_AVATAR_PALETTE = ['#4361EE', '#7B2FBE', '#06C270', '#FFB703', '#EF233C', '#0EA5E9', '#7C3AED', '#0891B2', '#65A30D', '#C026D3'];
const MP_BADGE = { shopee: ['badge-shopee', 'Shopee'], tiktok: ['badge-tiktok', 'TikTok'], lazada: ['badge-lazada', 'Lazada'] };

function trCardState(stage) {
  if (stage === 'SAMPAI')     return 'DELIVERY';
  if (stage === 'RETUR')      return 'RETUR';
  if (stage === 'BERMASALAH') return 'UNDEL';
  return 'ON_PROSES';
}
function trEffectiveStage(o) {
  if (String(o.id).startsWith('IMP-')) return 'MENUNGGU_RESI'; // resi asli gak ketemu di file upload
  if (!o.status_resi || !TR_STAGE_META[o.status_resi]) return 'BELUM_DICEK';
  return o.status_resi;
}
function trAvatarColor(name) {
  const s = name || '?';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 1000000007;
  return TR_AVATAR_PALETTE[Math.abs(hash) % TR_AVATAR_PALETTE.length];
}
function trStepperHtml(stage) {
  const meta = TR_STAGE_META[stage] || TR_STAGE_META.BELUM_DICEK;
  const step = meta.step;
  const allDone = stage === 'SAMPAI';
  return `<div class="tr-stepper">${TR_STEP_LABELS.map((label, i) => {
    const idx = i + 1;
    let cls = 'tr-step';
    if (allDone || idx < step) cls += ' tr-step-done';
    else if (idx === step) cls += meta.problem ? ' tr-step-problem' : ' tr-step-active';
    const icon = (allDone || idx < step) ? '✓' : idx;
    return `<div class="${cls}"><div class="tr-step-line"></div><div class="tr-step-circle">${icon}</div><div class="tr-step-label">${label}</div></div>`;
  }).join('')}</div>`;
}

// ── Date range picker (dropdown + kalender, default Bulan Ini) ─────────────────
const DRP_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const DRP_DAYS   = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
function trYmd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function drpFmtDate(d) { return d ? `${d.getDate()} ${DRP_MONTHS[d.getMonth()].slice(0,3)} ${d.getFullYear()}` : '—'; }

function drpMakeCalendar(calId, selStart, selEnd, clickFn, navFn, viewYear, viewMonth) {
  const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const startPad    = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevDays    = new Date(viewYear, viewMonth, 0).getDate();
  const today = new Date();

  let html = `<div class="drp-cal-hdr">
      <button class="drp-nav" onclick="${navFn}(-1)">‹</button>
      <div class="drp-cal-title">${DRP_MONTHS[viewMonth]} ${viewYear}</div>
      <button class="drp-nav" onclick="${navFn}(1)">›</button>
    </div>
    <div class="drp-days-hdr">${DRP_DAYS.map(d => `<span>${d}</span>`).join('')}</div>
    <div class="drp-days">`;
  for (let i = startPad; i > 0; i--) html += `<button class="drp-day other-month">${prevDays - i + 1}</button>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const cur = new Date(viewYear, viewMonth, d);
    const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && d === today.getDate();
    const isStart = selStart && cur.getTime() === new Date(selStart.getFullYear(), selStart.getMonth(), selStart.getDate()).getTime();
    const isEnd   = selEnd   && cur.getTime() === new Date(selEnd.getFullYear(), selEnd.getMonth(), selEnd.getDate()).getTime();
    const inRange = selStart && selEnd && cur > selStart && cur < selEnd;
    let cls = 'drp-day';
    if (isStart && isEnd) cls += ' selected';
    else if (isStart) cls += ' range-start';
    else if (isEnd)   cls += ' range-end';
    else if (inRange) cls += ' in-range';
    if (isToday) cls += ' today';
    html += `<button class="${cls}" onclick="${clickFn}(${viewYear},${viewMonth},${d})">${d}</button>`;
  }
  const total = startPad + daysInMonth;
  const rem = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let d = 1; d <= rem; d++) html += `<button class="drp-day other-month">${d}</button>`;
  html += '</div>';
  document.getElementById(calId).innerHTML = html;
}

// ── Factory ──────────────────────────────────────────────────────────────────
// cfg: { table: 'akuisisi_orders'|'marketplace_orders'|'crm_orders', domain: 'akuisisi'|'marketplace'|'crm',
//        domainLabel: 'Akuisisi'|'Marketplace'|'CRM', hasMarketplaceFilter: bool }
function initTrackingPage(cfg) {
  const st = {
    orders: [],
    filterStage: 'SEMUA',
    modalId: null,
    mpFilter: '',
    storeFilter: '',
    storeOptions: [],
  };
  const today = new Date();
  st.filterStart = new Date(today.getFullYear(), today.getMonth(), 1);
  st.filterEnd   = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  st.drpSelStart = st.filterStart; st.drpSelEnd = st.filterEnd;
  st.drpViewYear = today.getFullYear(); st.drpViewMonth = today.getMonth();
  st.drpLabelText = 'Bulan Ini';

  ensureModal();

  window.trDrpToggle = () => {
    const dd = document.getElementById('trDrp-dropdown');
    dd.classList.toggle('open');
    if (dd.classList.contains('open')) { renderDrp(); document.addEventListener('click', drpOutside); }
    else document.removeEventListener('click', drpOutside);
  };
  window.trDrpClose = () => { document.getElementById('trDrp-dropdown').classList.remove('open'); document.removeEventListener('click', drpOutside); };
  function drpOutside(e) {
    const dd = document.getElementById('trDrp-dropdown'), tr = document.getElementById('trDrp-trigger');
    if (!dd.contains(e.target) && !tr.contains(e.target)) window.trDrpClose();
  }
  function markActive(btn) { document.querySelectorAll('#trDrp-dropdown .drp-preset').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
  function updateSel() {
    document.getElementById('trDrp-sel-start').textContent = drpFmtDate(st.drpSelStart);
    document.getElementById('trDrp-sel-end').textContent   = drpFmtDate(st.drpSelEnd);
  }
  function renderDrp() { drpMakeCalendar('trDrp-cal', st.drpSelStart, st.drpSelEnd, 'trDrpClickDay', 'trDrpNav', st.drpViewYear, st.drpViewMonth); }
  window.trDrpPreset = (days, label, btn) => {
    const t = new Date();
    st.drpSelEnd = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const s = new Date(t); s.setDate(s.getDate() - (days - 1));
    st.drpSelStart = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    markActive(btn); updateSel(); renderDrp();
  };
  window.trDrpPresetYesterday = (btn) => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    st.drpSelStart = st.drpSelEnd = new Date(y.getFullYear(), y.getMonth(), y.getDate());
    markActive(btn); updateSel(); renderDrp();
  };
  window.trDrpPresetThisMonth = (btn) => {
    const t = new Date();
    st.drpSelStart = new Date(t.getFullYear(), t.getMonth(), 1);
    st.drpSelEnd   = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    markActive(btn); updateSel(); renderDrp();
  };
  window.trDrpPresetLastMonth = (btn) => {
    const t = new Date();
    st.drpSelStart = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    st.drpSelEnd   = new Date(t.getFullYear(), t.getMonth(), 0);
    markActive(btn); updateSel(); renderDrp();
  };
  window.trDrpApply = () => {
    if (!st.drpSelStart) return;
    st.filterStart = st.drpSelStart;
    st.filterEnd   = st.drpSelEnd || st.drpSelStart;
    st.drpLabelText = `${drpFmtDate(st.filterStart)} — ${drpFmtDate(st.filterEnd)}`;
    window.trDrpClose();
    load();
  };
  window.trDrpClickDay = (y, m, d) => {
    const clicked = new Date(y, m, d);
    if (!st.drpSelStart || (st.drpSelStart && st.drpSelEnd)) { st.drpSelStart = clicked; st.drpSelEnd = null; }
    else if (clicked < st.drpSelStart) { st.drpSelEnd = st.drpSelStart; st.drpSelStart = clicked; }
    else { st.drpSelEnd = clicked; }
    document.querySelectorAll('#trDrp-dropdown .drp-preset').forEach(b => b.classList.remove('active'));
    updateSel(); renderDrp();
  };
  window.trDrpNav = (dir) => {
    st.drpViewMonth += dir;
    if (st.drpViewMonth > 11) { st.drpViewMonth = 0; st.drpViewYear++; }
    if (st.drpViewMonth < 0)  { st.drpViewMonth = 11; st.drpViewYear--; }
    renderDrp();
  };

  async function load() {
    showLoading();
    try {
      const filters = { dateFrom: trYmd(st.filterStart), dateTo: trYmd(st.filterEnd) };
      if (cfg.hasMarketplaceFilter && st.mpFilter) filters.marketplace = st.mpFilter;
      st.orders = await dbGetTrackableOrders(cfg.table, filters);
      if (cfg.hasMarketplaceFilter && typeof dbGetStores === 'function') {
        st.storeOptions = await dbGetStores(st.mpFilter || undefined);
      }
      renderPage();
    } catch (e) {
      showError('Gagal memuat data tracking: ' + e.message);
    }
  }

  function renderPage() {
    document.getElementById('pageContent').innerHTML = `
      <div class="stat-grid cols-5">
        <div class="stat-card clickable" id="trStatCard-SEMUA" onclick="trSetFilter('SEMUA')">
          <div class="stat-label">Total</div><div class="stat-value" id="trStatTotal">0</div><div class="stat-icon">📦</div>
        </div>
        <div class="stat-card clickable" id="trStatCard-ON_PROSES" onclick="trSetFilter('ON_PROSES_GROUP')">
          <div class="stat-label">On Proses</div><div class="stat-value" id="trStatOnProses" style="color:var(--primary)">0</div><div class="stat-icon">🔄</div>
        </div>
        <div class="stat-card clickable" id="trStatCard-UNDEL" onclick="trSetFilter('BERMASALAH')">
          <div class="stat-label">Bermasalah</div><div class="stat-value" id="trStatUndel" style="color:var(--danger)">0</div><div class="stat-icon">⚠️</div>
        </div>
        <div class="stat-card clickable" id="trStatCard-RETUR" onclick="trSetFilter('RETUR')">
          <div class="stat-label">Retur</div><div class="stat-value" id="trStatRetur" style="color:var(--danger)">0</div><div class="stat-icon">↩️</div>
        </div>
        <div class="stat-card clickable" id="trStatCard-DELIVERY" onclick="trSetFilter('SAMPAI')">
          <div class="stat-label">Terkirim</div><div class="stat-value" id="trStatDelivery" style="color:var(--success)">0</div><div class="stat-icon">✅</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-header-left"><h3>Tracking Resi ${cfg.domainLabel}</h3><div class="card-sub">Monitor status pengiriman</div></div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            ${cfg.hasMarketplaceFilter ? `
              <select class="ctrl-select" id="trMpFilter" onchange="trSetMpFilter(this.value)">
                <option value="">Semua Marketplace</option>
                <option value="shopee" ${st.mpFilter==='shopee'?'selected':''}>Shopee</option>
                <option value="tiktok" ${st.mpFilter==='tiktok'?'selected':''}>TikTok</option>
                <option value="lazada" ${st.mpFilter==='lazada'?'selected':''}>Lazada</option>
              </select>
              <select class="ctrl-select" id="trStoreFilter" onchange="trSetStoreFilter(this.value)">
                <option value="">Semua Toko</option>
                ${st.storeOptions.map(s => `<option value="${escapeHtml(s.name)}" ${st.storeFilter===s.name?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}
              </select>` : ''}
            <div class="drp-wrap">
              <button class="drp-trigger" onclick="trDrpToggle()" id="trDrp-trigger">
                <span>📅</span><span id="trDrp-label">${st.drpLabelText}</span><span style="color:var(--text-3)">▾</span>
              </button>
              <div class="drp-dropdown" id="trDrp-dropdown">
                <div class="drp-presets">
                  <button class="drp-preset" onclick="trDrpPreset(1,'Hari Ini',this)">Hari Ini</button>
                  <button class="drp-preset" onclick="trDrpPresetYesterday(this)">Kemarin</button>
                  <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
                  <button class="drp-preset" onclick="trDrpPreset(7,'7 Hari Terakhir',this)">7 Hari Terakhir</button>
                  <button class="drp-preset" onclick="trDrpPreset(14,'14 Hari Terakhir',this)">14 Hari Terakhir</button>
                  <button class="drp-preset" onclick="trDrpPreset(30,'30 Hari Terakhir',this)">30 Hari Terakhir</button>
                  <button class="drp-preset" onclick="trDrpPreset(90,'90 Hari Terakhir',this)">90 Hari Terakhir</button>
                  <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
                  <button class="drp-preset active" onclick="trDrpPresetThisMonth(this)">Bulan Ini</button>
                  <button class="drp-preset" onclick="trDrpPresetLastMonth(this)">Bulan Lalu</button>
                </div>
                <div style="display:flex;flex-direction:column;flex:1">
                  <div class="drp-cal" id="trDrp-cal"></div>
                  <div class="drp-footer">
                    <div class="drp-selected-txt"><span id="trDrp-sel-start">—</span> → <span id="trDrp-sel-end">—</span></div>
                    <div style="display:flex;gap:6px">
                      <button class="drp-cancel" onclick="trDrpClose()">Batal</button>
                      <button class="drp-apply" onclick="trDrpApply()">Terapkan</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm" id="trRefreshBtn" onclick="trRefreshAll()">🔄 Refresh Semua</button>
            ${typeof openUploadModal === 'function' ? `<button class="btn btn-outline btn-sm" onclick="openUploadModal('${cfg.domain}')">📥 Upload</button>` : ''}
          </div>
        </div>
        <div class="tr-toolbar">
          <div class="tr-tabs" id="trTabs"></div>
          <div class="tr-search-wrap">
            <input type="text" id="trSearch" class="ctrl-input" style="width:100%" placeholder="🔍 Cari resi / nama / produk..." onkeyup="trApplyFilter()">
          </div>
          <div class="tr-count" id="trCount">0 pesanan</div>
        </div>
        <div id="trList"></div>
      </div>
    `;
    renderTabs();
    updateStats();
    applyFilter();
  }

  function renderTabs() {
    document.getElementById('trTabs').innerHTML = TR_TABS.map(t =>
      `<div class="tr-tab ${st.filterStage === t.key ? 'active' : ''}" onclick="trSetFilter('${t.key}')">${t.label}</div>`
    ).join('');
    Object.entries(TR_STAT_CARD_FILTER).forEach(([cardKey, filterKey]) => {
      document.getElementById('trStatCard-' + cardKey)?.classList.toggle('active', st.filterStage === filterKey);
    });
  }

  function updateStats() {
    const counts = { ON_PROSES: 0, UNDEL: 0, RETUR: 0, DELIVERY: 0 };
    st.orders.forEach(o => { counts[trCardState(trEffectiveStage(o))]++; });
    document.getElementById('trStatTotal').textContent    = st.orders.length;
    document.getElementById('trStatOnProses').textContent = counts.ON_PROSES;
    document.getElementById('trStatUndel').textContent    = counts.UNDEL;
    document.getElementById('trStatRetur').textContent    = counts.RETUR;
    document.getElementById('trStatDelivery').textContent = counts.DELIVERY;
  }

  window.trSetFilter = (key) => { st.filterStage = key; renderTabs(); applyFilter(); };
  window.trSetMpFilter = (val) => { st.mpFilter = val; st.storeFilter = ''; load(); };
  window.trSetStoreFilter = (val) => { st.storeFilter = val; applyFilter(); };

  function applyFilter() {
    const q = (document.getElementById('trSearch').value || '').toLowerCase();
    const list = st.orders.filter(o => {
      const stage = trEffectiveStage(o);
      if (st.filterStage === 'ON_PROSES_GROUP') { if (!TR_ON_PROSES_STAGES.includes(stage)) return false; }
      else if (st.filterStage !== 'SEMUA' && stage !== st.filterStage) return false;
      if (st.storeFilter && o.store_name !== st.storeFilter) return false;
      if (q && !(String(o.id).toLowerCase().includes(q) || (o.nama||o.buyer||'').toLowerCase().includes(q) || (o.produk||'').toLowerCase().includes(q))) return false;
      return true;
    });
    document.getElementById('trCount').textContent = `${list.length} pesanan`;
    document.getElementById('trList').innerHTML = list.length
      ? list.map(o => cardHtml(o)).join('')
      : '<div class="tr-card" style="grid-column:1/-1;text-align:center;color:var(--text-3);cursor:default">Tidak ada data.</div>';
  }
  window.trApplyFilter = applyFilter;

  function cardHtml(o) {
    const stage = trEffectiveStage(o);
    const meta  = TR_STAGE_META[stage] || TR_STAGE_META.BELUM_DICEK;
    const hasResi = !String(o.id).startsWith('IMP-');
    const name  = o.nama || o.buyer || 'Pembeli';
    const sub   = o.store_name || o.hp || '-';
    const initial = name.trim().charAt(0).toUpperCase() || '?';
    const mpBadge = cfg.hasMarketplaceFilter && o.marketplace && MP_BADGE[o.marketplace]
      ? `<span class="badge ${MP_BADGE[o.marketplace][0]}">${MP_BADGE[o.marketplace][1]}</span>` : '';

    return `<div class="tr-card" onclick="trOpenDetail('${o.id}')">
      <div class="tr-card-top">
        <div class="tr-card-left">
          <div class="tr-avatar" style="background:${trAvatarColor(name)}">${initial}</div>
          <div style="min-width:0">
            <div class="tr-name">${escapeHtml(name)}</div>
            <div class="tr-sub">${escapeHtml(sub)}</div>
            <div class="tr-meta">
              <span class="badge ${meta.badge}">${meta.label}</span>
              ${mpBadge}
              ${o.ekspedisi ? `<span class="badge badge-gray">${escapeHtml(o.ekspedisi)}</span>` : ''}
            </div>
            <div class="tr-produk" title="${escapeHtml(o.produk || '-')}">${escapeHtml(o.produk || '-')} × ${o.qty || 1}</div>
          </div>
        </div>
        <div>
          <div class="tr-price">${fmtFull(o.total || 0)}</div>
          <div class="tr-date">${o.order_date || '-'}</div>
          ${hasResi ? `<div class="tr-resi">${escapeHtml(o.id)}</div>` : ''}
        </div>
      </div>
      <div class="tr-divider">${trStepperHtml(stage)}</div>
    </div>`;
  }

  window.trOpenDetail = (id) => {
    st.modalId = id;
    const o = st.orders.find(x => String(x.id) === String(id));
    if (!o) return;
    const stage = trEffectiveStage(o);
    const meta  = TR_STAGE_META[stage] || TR_STAGE_META.BELUM_DICEK;

    document.getElementById('trkModalTitle').textContent = o.produk || 'Detail Pengiriman';
    document.getElementById('trkModalSub').textContent = o.id + (o.ekspedisi ? ' · ' + o.ekspedisi : '');

    const records = o.status_resi_detail?.records || [];
    let historyHtml = '<div style="font-size:.78rem;color:var(--text-3);margin-top:12px">Belum ada history — klik "Cek Ulang".</div>';
    if (records.length) {
      historyHtml = `<div style="margin-top:14px">${records.map((r, i) => `
        <div class="tr-history-item">
          <div class="tr-history-dot" style="background:${i === 0 ? 'var(--primary)' : 'var(--border)'}"></div>
          <div>
            <div style="font-size:.78rem;${i === 0 ? 'font-weight:700' : ''}">${escapeHtml(r.description || r.tracking_name || '-')}</div>
            <div style="font-size:.68rem;color:var(--text-3);margin-top:2px">${r.actual_time ? new Date(r.actual_time * 1000).toLocaleString('id-ID') : ''}${r.current_location?.location_name ? ' · ' + escapeHtml(r.current_location.location_name) : ''}</div>
          </div>
        </div>`).join('')}</div>`;
    }

    document.getElementById('trkModalBody').innerHTML = `
      <div style="margin-top:10px"><span class="badge ${meta.badge}">${meta.label}</span></div>
      ${trStepperHtml(stage)}
      ${historyHtml}
    `;
    document.getElementById('trkModalOverlay').classList.add('open');
  };

  window.trCloseModal = () => document.getElementById('trkModalOverlay').classList.remove('open');

  async function checkOne(o) {
    const r = await fetch(`/api/tracking-check?table=${cfg.table}&id=${encodeURIComponent(o.id)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Gagal cek resi');
    Object.assign(o, {
      status_resi: data.stage,
      status_resi_step: data.step,
      status_resi_detail: data.detail,
      status_resi_updated_at: new Date().toISOString(),
    });
    return data;
  }

  window.trManualCheckFromModal = async () => {
    const o = st.orders.find(x => String(x.id) === String(st.modalId));
    if (!o) return;
    try {
      const data = await checkOne(o);
      updateStats(); applyFilter();
      window.trOpenDetail(st.modalId);
      showToast('✅ Status diperbarui: ' + (TR_STAGE_META[data.stage]?.label || data.stage), 'success');
    } catch (e) {
      showToast('❌ ' + e.message, 'error');
    }
  };

  window.trRefreshAll = async () => {
    const btn = document.getElementById('trRefreshBtn');
    const targets = st.orders.filter(o => o.ekspedisi && !['SAMPAI', 'RETUR'].includes(o.status_resi));
    if (!targets.length) { showToast('Tidak ada resi yang bisa dicek', 'info'); return; }
    btn.disabled = true;
    let done = 0;
    btn.textContent = `Mengecek 0/${targets.length}...`;
    const BATCH = 5;
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      await Promise.all(batch.map(async o => {
        try { await checkOne(o); } catch {}
        done++;
        btn.textContent = `Mengecek ${done}/${targets.length}...`;
      }));
    }
    btn.disabled = false;
    btn.textContent = '🔄 Refresh Semua';
    updateStats(); applyFilter();
    showToast('✅ Selesai cek semua resi', 'success');
  };

  window.trReload = load; // dipanggil upload-common.js abis upload sukses, biar list ke-refresh

  load();

  // Auto-buka modal upload kalau dinavigasi dari sidebar "Upload X" (lihat handleUploadNavClick di js/app.js)
  const params = new URLSearchParams(window.location.search);
  if (params.get('upload') === '1' && typeof openUploadModal === 'function') {
    setTimeout(() => openUploadModal(cfg.domain), 0);
  }
}

function ensureModal() {
  if (document.getElementById('trkModalOverlay')) return;
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="modal-overlay" id="trkModalOverlay" onclick="if(event.target===this) trCloseModal()">
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h3 id="trkModalTitle">Detail Pengiriman</h3>
          <button class="modal-close" onclick="trCloseModal()">✕</button>
        </div>
        <div class="modal-body">
          <div style="font-size:.78rem;color:var(--text-3)" id="trkModalSub"></div>
          <div id="trkModalBody"></div>
          <div style="display:flex;gap:10px;margin-top:18px">
            <button class="btn btn-secondary" style="flex:1" onclick="trCloseModal()">Tutup</button>
            <button class="btn btn-primary" style="flex:1" onclick="trManualCheckFromModal()">🔄 Cek Ulang</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(div.firstElementChild);
}
