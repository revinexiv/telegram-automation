// ─── Config & State ──────────────────────────────────────────────────────────
const API = '';
let authToken = localStorage.getItem('tg_auth_token') || '';
let wsConn = null;
let wsRetryTimer = null;
let currentPage = 'dashboard';
let allAccounts = [], allGroups = [], allTemplates = [], allCampaigns = [], allLogs = [];
let logEntries = [];
const MAX_LIVE_LOGS = 200;

// ─── API Helper ───────────────────────────────────────────────────────────────
async function api(method, path, body = null, isFormData = false) {
  const opts = {
    method,
    headers: { 'X-Admin-Token': authToken }
  };
  if (body && !isFormData) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body && isFormData) {
    opts.body = body;
  }
  const res = await fetch(API + path, opts);
  if (res.status === 401) { logout(); return null; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || 'Request failed');
  return data;
}

// ─── Toast Notifications ──────────────────────────────────────────────────────
function toast(message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.innerHTML = `<span style="font-size:16px">${icons[type]}</span><span>${message}</span>`;
  const c = document.getElementById('toast-container');
  c.appendChild(div);
  setTimeout(() => { div.style.opacity = '0'; div.style.transform = 'translateX(100%)';
    div.style.transition = '0.3s'; setTimeout(() => div.remove(), 300); }, duration);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function logout() {
  authToken = '';
  localStorage.removeItem('tg_auth_token');
  if (wsConn) wsConn.close();
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

async function login() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Masuk...';
  try {
    const res = await fetch(API + '/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username, password})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Login gagal');
    authToken = data.token;
    localStorage.setItem('tg_auth_token', authToken);
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    initApp();
  } catch(e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Masuk ke Dashboard'; }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  wsConn = new WebSocket(`${protocol}//${location.host}/ws/logs`);

  wsConn.onopen = () => {
    document.querySelector('.ws-dot').classList.add('connected');
    document.querySelector('.ws-status span:last-child').textContent = 'Live Connected';
    if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
  };

  wsConn.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'ping') { wsConn.send('ping'); return; }
    handleWSMessage(msg);
  };

  wsConn.onclose = () => {
    document.querySelector('.ws-dot').classList.remove('connected');
    document.querySelector('.ws-status span:last-child').textContent = 'Reconnecting...';
    wsRetryTimer = setTimeout(connectWS, 3000);
  };

  wsConn.onerror = () => wsConn.close();
}

function handleWSMessage(msg) {
  if (msg.type === 'log') {
    addLiveLog(msg);
    // Update badge
    const badge = document.getElementById('logs-badge');
    if (badge) { badge.textContent = parseInt(badge.textContent || '0') + 1; }
  }
  if (msg.type === 'account_status') {
    // Refresh akun di background
    setTimeout(loadAccounts, 500);
  }
  if (msg.type === 'campaign_start' || msg.type === 'campaign_done') {
    setTimeout(loadCampaigns, 500);
    updateStats();
  }
  if (msg.type === 'campaign_error') {
    toast(`Campaign error: ${msg.error}`, 'error');
  }
}

function addLiveLog(msg) {
  logEntries.unshift(msg);
  if (logEntries.length > MAX_LIVE_LOGS) logEntries.pop();

  const terminal = document.getElementById('live-terminal');
  if (!terminal) return;

  const statusMap = {
    success: '✓ SUCCESS', failed: '✗ FAILED',
    rate_limited: '⏱ RATELIMIT', skipped: '- SKIPPED'
  };
  const time = new Date(msg.timestamp).toLocaleTimeString('id-ID');
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-status ${msg.status}">${statusMap[msg.status] || msg.status}</span>
    <span class="log-msg">Acc#${msg.account_id} → Grp#${msg.group_id}${msg.error ? ' | ' + msg.error : ''}</span>
  `;
  terminal.prepend(div);
  // Trim
  while (terminal.children.length > MAX_LIVE_LOGS) {
    terminal.removeChild(terminal.lastChild);
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('active', el.id === `page-${page}`);
  });
  const titles = {
    dashboard: 'Dashboard Overview', accounts: 'Akun Telegram',
    groups: 'Manajemen Grup', templates: 'Template Pesan',
    campaigns: 'Campaign Manager', logs: 'Log Aktivitas'
  };
  document.getElementById('topbar-title').textContent = titles[page] || page;

  // Load data for page
  if (page === 'dashboard') updateStats();
  if (page === 'accounts') loadAccounts();
  if (page === 'groups') loadGroups();
  if (page === 'templates') loadTemplates();
  if (page === 'campaigns') loadCampaigns();
  if (page === 'logs') loadLogs();
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
async function updateStats() {
  try {
    const [accounts, groups, campaigns, stats] = await Promise.all([
      api('GET', '/api/accounts'),
      api('GET', '/api/groups'),
      api('GET', '/api/campaigns'),
      api('GET', '/api/logs/stats'),
    ]);
    if (!accounts) return;

    allAccounts = accounts;
    allGroups = groups || [];
    allCampaigns = campaigns || [];

    const activeAccs = accounts.filter(a => a.is_online).length;
    const runningCamps = campaigns.filter(c => c.status === 'running').length;

    setEl('stat-accounts', `${activeAccs}/${accounts.length}`);
    setEl('stat-groups', allGroups.filter(g => g.is_active).length);
    setEl('stat-campaigns', allCampaigns.length);
    setEl('stat-sent', stats?.success || 0);

    renderRecentCampaigns();
    renderAccountSummary();
  } catch(e) { console.error('Stats error:', e); }
}

function renderRecentCampaigns() {
  const el = document.getElementById('recent-campaigns');
  if (!el) return;
  const recent = allCampaigns.slice(0, 5);
  if (!recent.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Belum ada campaign</div></div>';
    return;
  }
  el.innerHTML = recent.map(c => {
    const statusClass = {running:'success', paused:'warning', stopped:'error', completed:'info', draft:'muted'}[c.status] || 'muted';
    return `<tr>
      <td><strong>${c.name}</strong></td>
      <td><span class="badge badge-${statusClass}">${c.status}</span></td>
      <td>${c.target_groups.length} grup</td>
      <td>${new Date(c.created_at).toLocaleDateString('id-ID')}</td>
      <td>
        ${c.status === 'draft' ? `<button class="btn btn-success btn-sm" onclick="startCampaign(${c.id})">▶ Mulai</button>` : ''}
        ${c.status === 'running' ? `<button class="btn btn-danger btn-sm" onclick="stopCampaign(${c.id})">■ Stop</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function renderAccountSummary() {
  const el = document.getElementById('account-summary');
  if (!el) return;
  const shown = allAccounts.slice(0, 6);
  el.innerHTML = shown.map(a => {
    const pct = a.daily_limit > 0 ? Math.round((a.messages_sent_today / a.daily_limit) * 100) : 0;
    const color = a.is_online ? 'blue' : 'muted';
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(99,132,255,0.07)">
      <div class="account-avatar" style="width:36px;height:36px;font-size:14px">${a.phone.slice(-4)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${a.phone}</div>
        <div class="progress-bar" style="margin-top:5px">
          <div class="progress-fill ${a.is_online ? 'blue' : ''}" style="width:${pct}%;background:${a.is_online?'':'var(--border)'}"></div>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${a.messages_sent_today}/${a.daily_limit} pesan hari ini</div>
      </div>
      <span class="badge badge-${a.is_online ? 'success' : 'muted'}">${a.is_online ? 'Online' : 'Offline'}</span>
    </div>`;
  }).join('');
}

// ─── Accounts ─────────────────────────────────────────────────────────────────
async function loadAccounts() {
  try {
    const accounts = await api('GET', '/api/accounts');
    if (!accounts) return;
    allAccounts = accounts;
    renderAccounts();
  } catch(e) { toast(e.message, 'error'); }
}

function renderAccounts() {
  const el = document.getElementById('accounts-grid');
  if (!el) return;
  if (!allAccounts.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">📱</div>
      <div class="empty-title">Belum ada akun terdaftar</div>
      <div class="empty-desc">Klik "+ Tambah Akun" untuk mulai</div>
    </div>`;
    return;
  }
  el.innerHTML = allAccounts.map(a => {
    const statusClass = {active:'success', inactive:'muted', error:'error', rate_limited:'warning'}[a.status] || 'muted';
    const pct = a.daily_limit > 0 ? Math.round((a.messages_sent_today / a.daily_limit) * 100) : 0;
    const initials = a.phone.slice(-4);
    return `<div class="account-card" id="acc-${a.id}">
      <div class="account-card-header">
        <div class="account-avatar">${initials}</div>
        <div style="flex:1">
          <div class="account-phone">${a.phone}</div>
          <div class="account-notes">${a.notes || 'Tidak ada catatan'}</div>
        </div>
        <span class="badge badge-${statusClass}">${a.status}</span>
      </div>
      <div class="account-stats">
        <div class="account-stat">
          <div class="account-stat-val" style="color:${a.is_online ? 'var(--success)' : 'var(--text-muted)'}">${a.is_online ? '🟢' : '⚫'} ${a.is_online ? 'Online' : 'Offline'}</div>
          <div class="account-stat-lbl">Status</div>
        </div>
        <div class="account-stat">
          <div class="account-stat-val">${a.messages_sent_today}/${a.daily_limit}</div>
          <div class="account-stat-lbl">Pesan Hari Ini</div>
        </div>
      </div>
      <div class="progress-bar" style="margin-bottom:14px">
        <div class="progress-fill ${pct > 80 ? 'green' : 'blue'}" style="width:${pct}%"></div>
      </div>
      <div class="account-actions">
        ${!a.is_online
          ? `<button class="btn btn-success btn-sm" onclick="connectAccount(${a.id})" ${!a.has_session ? 'disabled title="Login dulu"' : ''}>▶ Connect</button>`
          : `<button class="btn btn-secondary btn-sm" onclick="disconnectAccount(${a.id})">⏹ Disconnect</button>`
        }
        ${a.is_online ? `<button class="btn btn-secondary btn-sm" onclick="detectGroups(${a.id})">🔍 Detect Grup</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="resetDaily(${a.id})">🔄 Reset</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteAccount(${a.id})" title="Hapus">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// Login flow state
let loginStep = 1;
let loginPhone = '';

function openAddAccount() {
  loginStep = 1;
  loginPhone = '';
  document.getElementById('login-step-1').style.display = '';
  document.getElementById('login-step-2').style.display = 'none';
  document.getElementById('login-step-3').style.display = 'none';
  document.getElementById('modal-add-account').querySelector('.modal-title').textContent = 'Tambah Akun Telegram';
  updateLoginStepIndicator();
  openModal('modal-add-account');
}

function updateLoginStepIndicator() {
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i + 1 < loginStep) dot.classList.add('done'), dot.textContent = '✓';
    else if (i + 1 === loginStep) dot.classList.add('active'), dot.textContent = i + 1;
    else dot.textContent = i + 1;
  });
}

async function reqCode() {
  loginPhone = document.getElementById('acc-phone').value.trim();
  if (!loginPhone) return toast('Masukkan nomor telepon', 'warning');
  const btn = document.getElementById('btn-req-code');
  btn.disabled = true; btn.textContent = 'Mengirim...';
  try {
    await api('POST', '/api/accounts/request-code', { phone: loginPhone });
    toast(`Kode OTP dikirim ke ${loginPhone}`, 'success');
    loginStep = 2;
    document.getElementById('login-step-1').style.display = 'none';
    document.getElementById('login-step-2').style.display = '';
    updateLoginStepIndicator();
  } catch(e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Kirim Kode OTP'; }
}

async function verifyOTP() {
  const code = document.getElementById('acc-otp').value.trim();
  const password = document.getElementById('acc-2fa').value.trim();
  if (!code) return toast('Masukkan kode OTP', 'warning');
  const btn = document.getElementById('btn-verify-otp');
  btn.disabled = true; btn.textContent = 'Memverifikasi...';
  try {
    const res = await api('POST', '/api/accounts/verify-code', { phone: loginPhone, code, password: password || null });
    if (res) {
      toast('Akun berhasil ditambahkan!', 'success');
      loginStep = 3;
      document.getElementById('login-step-2').style.display = 'none';
      document.getElementById('login-step-3').style.display = '';
      updateLoginStepIndicator();
      document.getElementById('login-success-phone').textContent = loginPhone;
      loadAccounts();
    }
  } catch(e) {
    if (e.message.includes('2FA_REQUIRED')) {
      document.getElementById('2fa-section').style.display = '';
      toast('Akun ini menggunakan verifikasi 2FA. Masukkan password.', 'warning');
    } else { toast(e.message, 'error'); }
  }
  finally { btn.disabled = false; btn.textContent = 'Verifikasi'; }
}

async function connectAccount(id) {
  try {
    await api('POST', `/api/accounts/${id}/connect`);
    toast('Akun terhubung!', 'success');
    loadAccounts();
  } catch(e) { toast(e.message, 'error'); }
}

async function disconnectAccount(id) {
  try {
    await api('POST', `/api/accounts/${id}/disconnect`);
    toast('Akun disconnected', 'info');
    loadAccounts();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteAccount(id) {
  if (!confirm('Hapus akun ini? Session akan dihapus.')) return;
  try {
    await api('DELETE', `/api/accounts/${id}`);
    toast('Akun dihapus', 'success');
    loadAccounts();
  } catch(e) { toast(e.message, 'error'); }
}

async function resetDaily(id) {
  try {
    await api('POST', `/api/accounts/${id}/reset-daily`);
    toast('Counter harian direset', 'success');
    loadAccounts();
  } catch(e) { toast(e.message, 'error'); }
}

let detectAccountId = null;
async function detectGroups(id) {
  detectAccountId = id;
  const el = document.getElementById('detect-list');
  el.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner"></span> Mendeteksi grup...</div>';
  openModal('modal-detect-groups');
  try {
    const res = await api('POST', `/api/accounts/${id}/detect-groups`);
    document.getElementById('detect-count').textContent = `${res.total} grup ditemukan`;
    el.innerHTML = res.groups.length ? res.groups.map((g, i) => `
      <div class="detect-item">
        <input type="checkbox" id="dg-${i}" value="${JSON.stringify(g).replace(/"/g, '&quot;')}" checked>
        <label for="dg-${i}" style="flex:1;cursor:pointer">
          <div style="font-weight:600;font-size:13px">${g.title}</div>
          <div style="font-size:11px;color:var(--text-muted)">${g.username ? '@' + g.username : g.group_id} • ${g.member_count} anggota</div>
        </label>
      </div>`).join('') :
      '<div class="empty-state"><div class="empty-icon">💬</div><div>Tidak ada grup ditemukan</div></div>';
  } catch(e) { el.innerHTML = `<div style="color:var(--error);padding:16px">${e.message}</div>`; }
}

async function importSelectedGroups() {
  const checked = document.querySelectorAll('#detect-list input:checked');
  if (!checked.length) return toast('Pilih minimal 1 grup', 'warning');
  const groups = Array.from(checked).map(cb => JSON.parse(cb.value.replace(/&quot;/g, '"')));
  try {
    const res = await api('POST', '/api/groups/bulk-import', { groups });
    toast(`${res.added} grup diimport, ${res.skipped} sudah ada`, 'success');
    closeModal('modal-detect-groups');
    loadGroups();
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Groups ───────────────────────────────────────────────────────────────────
async function loadGroups() {
  try {
    const groups = await api('GET', '/api/groups');
    if (!groups) return;
    allGroups = groups;
    renderGroupsTable();
  } catch(e) { toast(e.message, 'error'); }
}

function renderGroupsTable() {
  const el = document.getElementById('groups-tbody');
  if (!el) return;
  const filtered = document.getElementById('groups-search')?.value?.toLowerCase() || '';
  const shown = allGroups.filter(g => g.title.toLowerCase().includes(filtered) || g.group_id.includes(filtered));

  if (!shown.length) {
    el.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Belum ada grup</div></div></td></tr>`;
    return;
  }
  el.innerHTML = shown.map(g => `<tr>
    <td style="color:var(--text-primary);font-weight:500">${g.title}</td>
    <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${g.group_id}</td>
    <td>${g.username ? '<span style="color:var(--accent)">@' + g.username + '</span>' : '-'}</td>
    <td>${g.member_count?.toLocaleString() || '—'}</td>
    <td><span class="badge badge-${g.is_active ? 'success' : 'muted'}">${g.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
    <td>${g.last_sent ? new Date(g.last_sent).toLocaleString('id-ID') : '—'}</td>
    <td>
      <button class="btn btn-secondary btn-sm" onclick="toggleGroup(${g.id}, ${g.is_active})">${g.is_active ? '⏸' : '▶'}</button>
      <button class="btn btn-danger btn-sm btn-icon" onclick="deleteGroup(${g.id})">🗑</button>
    </td>
  </tr>`).join('');
}

function openAddGroup() {
  document.getElementById('form-add-group').reset();
  openModal('modal-add-group');
}

async function saveGroup() {
  const body = {
    group_id: document.getElementById('grp-id').value.trim(),
    title: document.getElementById('grp-title').value.trim(),
    username: document.getElementById('grp-username').value.trim() || null,
    member_count: parseInt(document.getElementById('grp-members').value) || 0,
    category: document.getElementById('grp-category').value.trim() || null,
  };
  if (!body.group_id || !body.title) return toast('Group ID dan nama wajib diisi', 'warning');
  try {
    await api('POST', '/api/groups', body);
    toast('Grup ditambahkan', 'success');
    closeModal('modal-add-group');
    loadGroups();
  } catch(e) { toast(e.message, 'error'); }
}

async function toggleGroup(id, currentStatus) {
  try {
    await api('PUT', `/api/groups/${id}`, { is_active: !currentStatus });
    loadGroups();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteGroup(id) {
  if (!confirm('Hapus grup ini?')) return;
  try {
    await api('DELETE', `/api/groups/${id}`);
    toast('Grup dihapus', 'success');
    loadGroups();
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Templates ────────────────────────────────────────────────────────────────
async function loadTemplates() {
  try {
    const templates = await api('GET', '/api/templates');
    if (!templates) return;
    allTemplates = templates;
    renderTemplatesGrid();
  } catch(e) { toast(e.message, 'error'); }
}

function renderTemplatesGrid() {
  const el = document.getElementById('templates-grid');
  if (!el) return;
  if (!allTemplates.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">📝</div>
      <div class="empty-title">Belum ada template</div>
      <div class="empty-desc">Buat template pesan pertamamu</div>
    </div>`;
    return;
  }
  el.innerHTML = allTemplates.map(t => `<div class="section-card">
    <div class="section-header">
      <div class="section-title">📝 ${t.name}</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="editTemplate(${t.id})">✏️ Edit</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteTemplate(${t.id})">🗑</button>
      </div>
    </div>
    <div class="section-body">
      <div style="background:var(--bg-secondary);border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px;line-height:1.6;white-space:pre-wrap;max-height:120px;overflow:hidden">${escHtml(t.content)}</div>
      ${t.media_path ? `<div style="margin-bottom:10px"><span class="badge badge-info">🖼 Media: ${t.media_path.split('/').pop()}</span></div>` : ''}
      ${t.variables.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${t.variables.map(v => `<span class="badge badge-purple">{${v}}</span>`).join('')}</div>` : ''}
    </div>
  </div>`).join('');
}

function openAddTemplate() {
  document.getElementById('form-template').reset();
  document.getElementById('template-id-hidden').value = '';
  document.getElementById('template-vars-preview').innerHTML = '';
  document.getElementById('modal-template-title').textContent = 'Buat Template Baru';
  openModal('modal-add-template');
}

function editTemplate(id) {
  const t = allTemplates.find(t => t.id === id);
  if (!t) return;
  document.getElementById('template-id-hidden').value = id;
  document.getElementById('tmpl-name').value = t.name;
  document.getElementById('tmpl-content').value = t.content;
  document.getElementById('tmpl-media').value = t.media_path || '';
  document.getElementById('modal-template-title').textContent = 'Edit Template';
  onTemplateContentChange();
  openModal('modal-add-template');
}

function onTemplateContentChange() {
  const content = document.getElementById('tmpl-content').value;
  const vars = [...new Set(content.match(/\{(\w+)\}/g)?.map(v => v.slice(1,-1)) || [])].filter(v => !['date','time','datetime'].includes(v));
  const el = document.getElementById('template-vars-preview');
  el.innerHTML = vars.length ? vars.map(v => `<span class="badge badge-purple">{${v}}</span>`).join(' ') : '<span style="color:var(--text-muted);font-size:12px">Tidak ada variabel kustom</span>';
}

async function saveTemplate() {
  const id = document.getElementById('template-id-hidden').value;
  const body = {
    name: document.getElementById('tmpl-name').value.trim(),
    content: document.getElementById('tmpl-content').value.trim(),
    media_path: document.getElementById('tmpl-media').value.trim() || null,
  };
  if (!body.name || !body.content) return toast('Nama dan isi template wajib diisi', 'warning');
  try {
    if (id) {
      await api('PUT', `/api/templates/${id}`, body);
      toast('Template diperbarui', 'success');
    } else {
      const res = await api('POST', '/api/templates', body);
      toast('Template dibuat. Variabel: ' + (res.variables.join(', ') || 'tidak ada'), 'success');
    }
    closeModal('modal-add-template');
    loadTemplates();
  } catch(e) { toast(e.message, 'error'); }
}

async function previewTemplate() {
  const content = document.getElementById('tmpl-content').value;
  if (!content) return;
  try {
    const res = await api('POST', '/api/templates/preview', { content, variable_data: {
      name: 'Budi', promo: 'DISC50', custom_text: 'Promo Hari Ini'
    }});
    document.getElementById('preview-result').textContent = res.rendered;
    document.getElementById('preview-box').style.display = '';
  } catch(e) { toast(e.message, 'error'); }
}

async function uploadTemplateMedia() {
  const file = document.getElementById('media-file').files[0];
  if (!file) return toast('Pilih file terlebih dahulu', 'warning');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await api('POST', '/api/templates/upload-media', fd, true);
    document.getElementById('tmpl-media').value = res.path;
    toast('Media diupload: ' + res.filename, 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteTemplate(id) {
  if (!confirm('Hapus template ini?')) return;
  try {
    await api('DELETE', `/api/templates/${id}`);
    toast('Template dihapus', 'success');
    loadTemplates();
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Campaigns ────────────────────────────────────────────────────────────────
async function loadCampaigns() {
  try {
    const [campaigns, templates, groups] = await Promise.all([
      api('GET', '/api/campaigns'),
      api('GET', '/api/templates'),
      api('GET', '/api/groups'),
    ]);
    if (!campaigns) return;
    allCampaigns = campaigns; allTemplates = templates; allGroups = groups;
    renderCampaigns();
  } catch(e) { toast(e.message, 'error'); }
}

function renderCampaigns() {
  const el = document.getElementById('campaigns-list');
  if (!el) return;
  if (!allCampaigns.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🚀</div>
      <div class="empty-title">Belum ada campaign</div>
      <div class="empty-desc">Buat campaign pertama untuk mulai distribusi pesan</div>
    </div>`;
    return;
  }
  el.innerHTML = allCampaigns.map(c => {
    const tmpl = allTemplates.find(t => t.id === c.template_id);
    const statusClass = {running:'success',paused:'warning',stopped:'error',completed:'info',draft:'muted'}[c.status]||'muted';
    const statusIcon = {running:'▶',paused:'⏸',stopped:'■',completed:'✓',draft:'📋'}[c.status]||'•';
    return `<div class="section-card" style="margin-bottom:12px">
      <div class="section-header">
        <div>
          <div class="section-title">${statusIcon} ${c.name}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px">
            Template: ${tmpl?.name || '—'} • ${c.target_groups.length} grup target • Delay: ${c.delay_min}-${c.delay_max}s
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge badge-${statusClass}">${c.status}</span>
          <div style="display:flex;gap:6px">
            ${c.status === 'draft' || c.status === 'stopped' || c.status === 'completed' ?
              `<button class="btn btn-success btn-sm" onclick="startCampaign(${c.id})">▶ Mulai</button>` : ''}
            ${c.status === 'running' ?
              `<button class="btn btn-warning btn-sm" onclick="pauseCampaign(${c.id})">⏸ Pause</button>
               <button class="btn btn-danger btn-sm" onclick="stopCampaign(${c.id})">■ Stop</button>` : ''}
            ${c.status === 'paused' ?
              `<button class="btn btn-success btn-sm" onclick="resumeCampaign(${c.id})">▶ Resume</button>
               <button class="btn btn-danger btn-sm" onclick="stopCampaign(${c.id})">■ Stop</button>` : ''}
            ${c.status !== 'running' ?
              `<button class="btn btn-secondary btn-sm" onclick="editCampaign(${c.id})">✏️</button>
               <button class="btn btn-danger btn-sm btn-icon" onclick="deleteCampaign(${c.id})">🗑</button>` : ''}
          </div>
        </div>
      </div>
      <div class="section-body" style="display:flex;gap:16px;flex-wrap:wrap">
        <div style="display:flex;gap:16px">
          <div class="account-stat"><div class="account-stat-val">${c.target_groups.length}</div><div class="account-stat-lbl">Target Grup</div></div>
          <div class="account-stat"><div class="account-stat-val">${c.delay_min}-${c.delay_max}s</div><div class="account-stat-lbl">Delay</div></div>
          <div class="account-stat"><div class="account-stat-val">${c.parallel_mode ? '⚡' : '→'}</div><div class="account-stat-lbl">${c.parallel_mode ? 'Paralel' : 'Sequential'}</div></div>
          <div class="account-stat"><div class="account-stat-val">${c.prevent_duplicate ? '🛡' : '—'}</div><div class="account-stat-lbl">No Duplicate</div></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openAddCampaign() {
  document.getElementById('camp-id-hidden').value = '';
  document.getElementById('form-campaign').reset();
  renderTemplateOptions();
  renderGroupCheckboxes();
  renderVarFields();
  document.getElementById('delay-min-val').textContent = '5';
  document.getElementById('delay-max-val').textContent = '20';
  document.getElementById('modal-camp-title').textContent = 'Buat Campaign Baru';
  openModal('modal-add-campaign');
}

function editCampaign(id) {
  const c = allCampaigns.find(c => c.id === id);
  if (!c) return;
  document.getElementById('camp-id-hidden').value = id;
  document.getElementById('camp-name').value = c.name;
  document.getElementById('camp-delay-min').value = c.delay_min;
  document.getElementById('camp-delay-max').value = c.delay_max;
  document.getElementById('delay-min-val').textContent = c.delay_min;
  document.getElementById('delay-max-val').textContent = c.delay_max;
  document.getElementById('camp-parallel').checked = c.parallel_mode;
  document.getElementById('camp-no-dup').checked = c.prevent_duplicate;
  renderTemplateOptions(c.template_id);
  renderGroupCheckboxes(c.target_groups);
  // Render var fields after template selected
  setTimeout(() => {
    renderVarFields(c.variable_data);
  }, 100);
  document.getElementById('modal-camp-title').textContent = 'Edit Campaign';
  openModal('modal-add-campaign');
}

function renderTemplateOptions(selectedId = null) {
  const el = document.getElementById('camp-template');
  el.innerHTML = '<option value="">-- Pilih Template --</option>' +
    allTemplates.filter(t => t.is_active).map(t =>
      `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${t.name}</option>`
    ).join('');
  el.onchange = () => renderVarFields();
}

function renderGroupCheckboxes(selectedIds = []) {
  const el = document.getElementById('camp-groups-list');
  if (!el) return;
  const active = allGroups.filter(g => g.is_active);
  if (!active.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px">Belum ada grup aktif. Tambah grup dulu.</div>';
    return;
  }
  el.innerHTML = active.map(g => `
    <div class="detect-item">
      <input type="checkbox" id="cg-${g.id}" value="${g.id}" ${selectedIds.includes(g.id) ? 'checked' : ''}>
      <label for="cg-${g.id}" style="flex:1;cursor:pointer;font-size:13px">
        ${g.title} <span style="color:var(--text-muted)">(${g.member_count?.toLocaleString() || 0} anggota)</span>
      </label>
    </div>`).join('');
}

function selectAllGroups() {
  document.querySelectorAll('#camp-groups-list input[type=checkbox]').forEach(cb => cb.checked = true);
}

function renderVarFields(existingData = {}) {
  const tmplId = parseInt(document.getElementById('camp-template').value);
  const tmpl = allTemplates.find(t => t.id === tmplId);
  const el = document.getElementById('camp-var-fields');
  if (!tmpl || !tmpl.variables.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Template ini tidak memiliki variabel kustom.</div>';
    return;
  }
  el.innerHTML = tmpl.variables.map(v => `
    <div class="form-group">
      <label class="form-label">{${v}}</label>
      <input class="form-input" id="var-${v}" placeholder="Nilai untuk {${v}}" value="${existingData[v] || ''}">
    </div>`).join('');
}

async function saveCampaign() {
  const id = document.getElementById('camp-id-hidden').value;
  const tmplId = parseInt(document.getElementById('camp-template').value);
  if (!tmplId) return toast('Pilih template terlebih dahulu', 'warning');

  const selectedGroups = Array.from(document.querySelectorAll('#camp-groups-list input:checked')).map(cb => parseInt(cb.value));
  if (!selectedGroups.length) return toast('Pilih minimal 1 grup target', 'warning');

  const tmpl = allTemplates.find(t => t.id === tmplId);
  const varData = {};
  if (tmpl) {
    tmpl.variables.forEach(v => {
      const val = document.getElementById(`var-${v}`)?.value?.trim();
      if (val) varData[v] = val;
    });
  }

  const body = {
    name: document.getElementById('camp-name').value.trim(),
    template_id: tmplId,
    target_groups: selectedGroups,
    variable_data: varData,
    delay_min: parseInt(document.getElementById('camp-delay-min').value),
    delay_max: parseInt(document.getElementById('camp-delay-max').value),
    parallel_mode: document.getElementById('camp-parallel').checked,
    prevent_duplicate: document.getElementById('camp-no-dup').checked,
  };
  if (!body.name) return toast('Nama campaign wajib diisi', 'warning');

  try {
    if (id) {
      await api('PUT', `/api/campaigns/${id}`, body);
      toast('Campaign diperbarui', 'success');
    } else {
      await api('POST', '/api/campaigns', body);
      toast('Campaign dibuat!', 'success');
    }
    closeModal('modal-add-campaign');
    loadCampaigns();
  } catch(e) { toast(e.message, 'error'); }
}

async function startCampaign(id) {
  try {
    await api('POST', `/api/campaigns/${id}/start`);
    toast('Campaign dimulai!', 'success');
    setTimeout(loadCampaigns, 500);
  } catch(e) { toast(e.message, 'error'); }
}

async function stopCampaign(id) {
  if (!confirm('Stop campaign ini?')) return;
  try {
    await api('POST', `/api/campaigns/${id}/stop`);
    toast('Campaign dihentikan', 'warning');
    setTimeout(loadCampaigns, 500);
  } catch(e) { toast(e.message, 'error'); }
}

async function pauseCampaign(id) {
  try {
    await api('POST', `/api/campaigns/${id}/pause`);
    toast('Campaign dipause', 'warning');
    setTimeout(loadCampaigns, 500);
  } catch(e) { toast(e.message, 'error'); }
}

async function resumeCampaign(id) {
  try {
    await api('POST', `/api/campaigns/${id}/resume`);
    toast('Campaign dilanjutkan', 'success');
    setTimeout(loadCampaigns, 500);
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteCampaign(id) {
  if (!confirm('Hapus campaign ini beserta semua log-nya?')) return;
  try {
    await api('DELETE', `/api/campaigns/${id}`);
    toast('Campaign dihapus', 'success');
    loadCampaigns();
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Logs ─────────────────────────────────────────────────────────────────────
async function loadLogs() {
  try {
    const [logs, stats] = await Promise.all([
      api('GET', '/api/logs?limit=200'),
      api('GET', '/api/logs/stats'),
    ]);
    if (!logs) return;
    allLogs = logs;
    renderLogsTable(logs);
    renderLogStats(stats);
  } catch(e) { toast(e.message, 'error'); }
}

function renderLogStats(stats) {
  setEl('log-stat-total', stats?.total || 0);
  setEl('log-stat-success', stats?.success || 0);
  setEl('log-stat-failed', stats?.failed || 0);
  setEl('log-stat-rl', stats?.rate_limited || 0);
}

function renderLogsTable(logs) {
  const el = document.getElementById('logs-tbody');
  if (!el) return;
  if (!logs.length) {
    el.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div>Belum ada log</div></div></td></tr>`;
    return;
  }
  const statusClass = { success:'success', failed:'error', rate_limited:'warning', skipped:'muted' };
  el.innerHTML = logs.map(l => `<tr>
    <td>${new Date(l.sent_at).toLocaleString('id-ID')}</td>
    <td>Akun #${l.account_id}</td>
    <td>Grup #${l.group_id}</td>
    <td><span class="badge badge-${statusClass[l.status]||'muted'}">${l.status}</span></td>
    <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-muted)">${l.error_message || '—'}</td>
    <td>${l.message_id || '—'}</td>
  </tr>`).join('');
}

// ─── Modal Helpers ────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('active');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}
// Close on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

// ─── Utility ──────────────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function initApp() {
  connectWS();
  navigate('dashboard');
  // Auto-refresh stats setiap 30 detik
  setInterval(() => {
    if (currentPage === 'dashboard') updateStats();
    if (currentPage === 'campaigns') loadCampaigns();
  }, 30000);
}

// Startup
window.addEventListener('DOMContentLoaded', () => {
  if (authToken) {
    // Coba auto-login
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    initApp();
  } else {
    document.getElementById('app').style.display = 'none';
  }

  // Enter key di login
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById('login-page').style.display !== 'none') {
      login();
    }
  });
});
