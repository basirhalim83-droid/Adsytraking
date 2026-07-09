// ── Icons (Lucide-style, port dari Marketplace-main/js/app.js) ─────────────────
const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

const ICON_DASHBOARD = SVG_OPEN + '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
const ICON_TRACKING  = SVG_OPEN + '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>';
const ICON_UPLOAD    = SVG_OPEN + '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
const ICON_SETTINGS  = SVG_OPEN + '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

// ── Struktur menu sidebar: dikelompokkan per domain ─────────────────────────────
// type 'page'   -> link navigasi biasa
// type 'upload' -> buka modal upload di halaman `target` (kalau lagi di halaman lain, navigasi dulu + ?upload=1)
const NAV_GROUPS = [
  {
    label: null,
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: ICON_DASHBOARD, file: 'dashboard.html', type: 'page' },
    ],
  },
  {
    label: 'AKUISISI',
    items: [
      { id: 'tracking-akuisisi', label: 'Tracking Resi', icon: ICON_TRACKING, file: 'tracking-akuisisi.html', type: 'page' },
      { id: 'upload-akuisisi', label: 'Upload Akuisisi', icon: ICON_UPLOAD, type: 'upload', domain: 'akuisisi', target: 'tracking-akuisisi.html' },
    ],
  },
  {
    label: 'MARKETPLACE',
    items: [
      { id: 'tracking-marketplace', label: 'Tracking Resi', icon: ICON_TRACKING, file: 'tracking-marketplace.html', type: 'page' },
      { id: 'upload-marketplace', label: 'Upload Marketplace', icon: ICON_UPLOAD, type: 'upload', domain: 'marketplace', target: 'tracking-marketplace.html' },
    ],
  },
  {
    label: 'CRM',
    items: [
      { id: 'tracking-crm', label: 'Tracking Resi', icon: ICON_TRACKING, file: 'tracking-crm.html', type: 'page' },
      { id: 'upload-crm', label: 'Upload CRM', icon: ICON_UPLOAD, type: 'upload', domain: 'crm', target: 'tracking-crm.html' },
    ],
  },
  {
    label: 'PENGATURAN',
    items: [
      { id: 'settings-toko', label: 'Kelola Toko', icon: ICON_SETTINGS, file: 'settings-toko.html', type: 'page' },
    ],
  },
];

const AVATAR_COLORS = ['#4361EE', '#7B2FBE', '#06C270', '#FFB703', '#EF233C', '#0EA5E9'];

// ── Theme ─────────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  return saved;
}
function toggleDarkMode() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}

// ── Layout ────────────────────────────────────────────────────────────────────
function renderLayout(activePage, user) {
  const theme = initTheme();
  const idx = Math.abs(hashStr(user.id || user.email || '')) % AVATAR_COLORS.length;
  const color = AVATAR_COLORS[idx];
  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase();

  document.getElementById('sidebar-slot').innerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <div class="logo-icon">📦</div>
        <div>
          <div class="logo-text">adsy-tracking</div>
          <div style="font-size:.66rem;color:var(--text-3);font-weight:600">Tracking Resi Terpadu</div>
        </div>
      </div>
      <nav class="sidebar-nav">
        ${NAV_GROUPS.map(group => `
          ${group.label ? `<div class="sidebar-group-label">${group.label}</div>` : ''}
          ${group.items.map(item => renderNavItem(item, activePage)).join('')}
        `).join('')}
      </nav>
      <div class="sidebar-bottom">
        <div class="user-card" style="cursor:default">
          <div class="user-avatar" style="background:${color}">${initial}</div>
          <div class="user-info">
            <div class="user-name">${escapeHtml(user.name || user.email)}</div>
            <div class="user-role">${user.role === 'admin' ? 'Admin' : 'User'}</div>
          </div>
          <button class="logout-btn" onclick="logout()" title="Logout">⏻</button>
        </div>
      </div>
    </aside>
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>
  `;

  const activeLabel = NAV_GROUPS.flatMap(g => g.items).find(p => p.id === activePage)?.label || '';
  document.getElementById('header-slot').innerHTML = `
    <header class="topbar">
      <button class="hamburger" onclick="openSidebar()">☰</button>
      <div class="topbar-title">
        <h1>${activeLabel}</h1>
        <p class="topbar-date">${formatDate(new Date())}</p>
      </div>
      <div class="topbar-right">
        <button class="theme-toggle" id="themeToggle" onclick="toggleDarkMode()">${theme === 'dark' ? '☀️' : '🌙'}</button>
        <div class="divider-v"></div>
        <div class="topbar-user">
          <div class="user-avatar sm" style="background:${color}">${initial}</div>
          <div>
            <div class="topbar-name">${escapeHtml(user.name || user.email)}</div>
            <div class="topbar-role">${user.role === 'admin' ? 'Admin' : 'User'}</div>
          </div>
        </div>
      </div>
    </header>
  `;
}

function renderNavItem(item, activePage) {
  if (item.type === 'page') {
    return `<a href="${item.file}" class="nav-item ${activePage === item.id ? 'active' : ''}">
      <span class="nav-icon">${item.icon}</span><span>${item.label}</span>
    </a>`;
  }
  // type === 'upload'
  return `<button class="nav-item nav-upload" onclick="handleUploadNavClick('${item.domain}','${item.target}')">
    <span class="nav-icon">${item.icon}</span><span>${item.label}</span>
  </button>`;
}

// Kalau udah di halaman tracking domain yang sesuai -> buka modal langsung.
// Kalau belum -> navigasi ke halaman itu dengan ?upload=1, modal auto-buka on load
// (lihat initTrackingPage() di js/tracking-common.js).
function handleUploadNavClick(domain, target) {
  const onTargetPage = window.location.pathname.endsWith(target);
  if (onTargetPage && typeof openUploadModal === 'function') {
    openUploadModal(domain);
  } else {
    window.location.href = target + '?upload=1';
  }
}

function openSidebar()  { document.getElementById('sidebar')?.classList.add('open'); document.getElementById('sidebarOverlay')?.classList.add('open'); }
function closeSidebar() { document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('sidebarOverlay')?.classList.remove('open'); }

// ── Loading/Error helpers ────────────────────────────────────────────────────
function showLoading(id = 'pageContent') {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="page-loading"><div class="spinner"></div><div>Memuat data...</div></div>`;
}
function showError(msg, id = 'pageContent') {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="page-loading"><div style="font-size:2rem">⚠️</div><div style="color:var(--danger)">${escapeHtml(msg)}</div><button class="btn btn-outline btn-sm" onclick="location.reload()">Coba Lagi</button></div>`;
}

// ── Format helpers ────────────────────────────────────────────────────────────
function formatDate(d) {
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtFull(n) { return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID'); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

// WIB-aware date helpers (port dari adsycrm-main/js/shared.js) -- dipakai date-range picker
function wibYMD(d = new Date()) {
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}
function wibDayStart(ymd) { return new Date(ymd + 'T00:00:00+07:00'); }
function wibDayEnd(ymd)   { return new Date(ymd + 'T23:59:59+07:00'); }
function wibYMDOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return wibYMD(d);
}

function showToast(msg, type = 'success') {
  const colors = { success: '#06C270', error: '#EF233C', info: '#4361EE' };
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;background:${colors[type] || colors.info};
    color:white;padding:12px 20px;border-radius:12px;font-weight:700;font-size:.875rem;
    box-shadow:0 4px 20px rgba(0,0,0,.25);transition:opacity .3s;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}
