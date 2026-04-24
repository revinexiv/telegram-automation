// ─── Config & State ──────────────────────────────────────────────────────────
// Perbaikan: Menggunakan window.location.origin agar otomatis menggunakan HTTPS domain kamu
const API = 'https://jastipclouds.my.id'; 
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
  
  try {
    const res = await fetch(API + path, opts);
    if (res.status === 401) { logout(); return null; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || 'Request failed');
    return data;
  } catch (err) {
    console.error(`API Error (${path}):`, err);
    throw err;
  }
}

// ─── Toast Notifications ──────────────────────────────────────────────────────
function toast(message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.innerHTML = `<span style="font-size:16px">${icons[type]}</span><span>${message}</span>`;
  const c = document.getElementById('toast-container');
  if (c) c.appendChild(div);
  setTimeout(() => { 
    div.style.opacity = '0'; 
    div.style.transform = 'translateX(100%)';
    div.style.transition = '0.3s'; 
    setTimeout(() => div.remove(), 300); 
  }, duration);
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
  } catch(e) { 
    toast(e.message, 'error'); 
  } finally { 
    btn.disabled = false; btn.textContent = 'Masuk ke Dashboard'; 
  }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  wsConn = new WebSocket(`${protocol}//${location.host}/ws/logs`);

  wsConn.onopen = () => {
    const dot = document.querySelector('.ws-dot');
    const label = document.querySelector('.ws-status span:last-child');
    if (dot) dot.classList.add('connected');
    if (label) label.textContent = 'Live Connected';
    if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
  };

  wsConn.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'ping') { wsConn.send('ping'); return; }
    handleWSMessage(msg);
  };

  wsConn.onclose = () => {
    const dot = document.querySelector('.ws-dot');
    const label = document.querySelector('.ws-status span:last-child');
    if (dot) dot.classList.remove('connected');
    if (label) label.textContent = 'Reconnecting...';
    wsRetryTimer = setTimeout(connectWS, 3000);
  };

  wsConn.onerror = () => wsConn.close();
}

function handleWSMessage(msg) {
  if (msg.type === 'log') {
    addLiveLog(msg);
    const badge = document.getElementById('logs-badge');
    if (badge) { badge.textContent = parseInt(badge.textContent || '0') + 1; }
  }
  if (msg.type === 'account_status') {
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
  const topTitle = document.getElementById('topbar-title');
  if (topTitle) topTitle.textContent = titles[page] || page;

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
    
    setEl('stat-accounts', `${activeAccs}/${accounts.length}`);
    setEl('stat-groups', allGroups.filter(g => g.is_active).length);
    setEl('stat-campaigns', allCampaigns.length);
    setEl('stat-sent', stats?.success || 0);

    renderRecentCampaigns();
    renderAccountSummary();
  } catch(e) { console.error('Stats update failed:', e); }
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

// ─── Login Flow ───────────────────────────────────────────────────────────────
let loginStep = 1;
let loginPhone = '';

function openAddAccount() {
  loginStep = 1; loginPhone = '';
  document.getElementById('login-step-1').style.display = '';
  document.getElementById('login-step-2').style.display = 'none';
  document.getElementById('login-step-3').style.display = 'none';
  updateLoginStepIndicator();
  openModal('modal-add-account');
}

function updateLoginStepIndicator() {
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i + 1 < loginStep) { dot.classList.add('done'); dot.textContent = '✓'; }
    else if (i + 1 === loginStep) { dot.classList.add('active'); dot.textContent = i + 1; }
    else { dot.textContent = i + 1; }
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
    await api('POST', '/api/accounts/verify-code', { phone: loginPhone, code, password: password || null });
    toast('Akun berhasil ditambahkan!', 'success');
    loginStep = 3;
    document.getElementById('login-step-2').style.display = 'none';
    document.getElementById('login-step-3').style.display = '';
    updateLoginStepIndicator();
    document.getElementById('login-success-phone').textContent = loginPhone;
    loadAccounts();
  } catch(e) {
    if (e.message.includes('2FA_REQUIRED')) {
      document.getElementById('2fa-section').style.display = '';
      toast('Akun ini menggunakan 2FA. Masukkan password.', 'warning');
    } else { toast(e.message, 'error'); }
  } finally { btn.disabled = false; btn.textContent = 'Verifikasi'; }
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
    toast('Akun terputus', 'info');
    loadAccounts();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteAccount(id) {
  if (!confirm('Hapus akun ini? Session akan dihapus secara permanen.')) return;
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

async function detectGroups(id) {
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
      </div>`).join('') : '<div class="empty-state">Tidak ada grup ditemukan</div>';
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
    if (groups) { allGroups = groups; renderGroupsTable(); }
  } catch(e) { toast(e.message, 'error'); }
}

function renderGroupsTable() {
  const el = document.getElementById('groups-tbody');
  if (!el) return;
  const filtered = document.getElementById('groups-search')?.value?.toLowerCase() || '';
  const shown = allGroups.filter(g => g.title.toLowerCase().includes(filtered) || g.group_id.includes(filtered));

  if (!shown.length) {
    el.innerHTML = `<tr><td colspan="7"><div class="empty-state">Belum ada grup</div></td></tr>`;
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

async function saveGroup() {
  const body = {
    group_id: document.getElementById('grp-id').value.trim(),
    title: document.getElementById('grp-title').value.trim(),
    username: document.getElementById('grp-username').value.trim() || null,
    member_count: parseInt(document.getElementById('grp-members').value) || 0,
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
    if (templates) { allTemplates = templates; renderTemplatesGrid(); }
  } catch(e) { toast(e.message, 'error'); }
}

function renderTemplatesGrid() {
  const el = document.getElementById('templates-grid');
  if (!el) return;
  if (!allTemplates.length) {
    el.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Belum ada template pesan</div>';
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
      <div style="background:var(--bg-secondary);border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px;white-space:pre-wrap">${escHtml(t.content)}</div>
      ${t.media_path ? `<div style="margin-bottom:10px"><span class="badge badge-info">🖼 Media Aktif</span></div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap">${t.variables.map(v => `<span class="badge badge-purple">{${v}}</span>`).join('')}</div>
    </div>
  </div>`).join('');
}

function onTemplateContentChange() {
  const content = document.getElementById('tmpl-content').value;
  const vars = [...new Set(content.match(/\{(\w+)\}/g)?.map(v => v.slice(1,-1)) || [])];
  const el = document.getElementById('template-vars-preview');
  if (el) el.innerHTML = vars.map(v => `<span class="badge badge-purple">{${v}}</span>`).join(' ') || '<span style="font-size:12px;color:var(--text-muted)">Tidak ada variabel</span>';
}

async function saveTemplate() {
  const id = document.getElementById('template-id-hidden').value;
  const body = {
    name: document.getElementById('tmpl-name').value.trim(),
    content: document.getElementById('tmpl-content').value.trim(),
    media_path: document.getElementById('tmpl-media').value.trim() || null,
  };
  try {
    if (id) await api('PUT', `/api/templates/${id}`, body);
    else await api('POST', '/api/templates', body);
    toast('Template disimpan', 'success');
    closeModal('modal-add-template');
    loadTemplates();
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
    allCampaigns = campaigns || [];
    allTemplates = templates || [];
    allGroups = groups || [];
    renderCampaigns();
  } catch(e) { toast(e.message, 'error'); }
}

function renderCampaigns() {
  const el = document.getElementById('campaigns-list');
  if (!el) return;
  if (!allCampaigns.length) {
    el.innerHTML = '<div class="empty-state">Belum ada campaign aktif</div>';
    return;
  }
  el.innerHTML = allCampaigns.map(c => {
    const statusClass = {running:'success', paused:'warning', stopped:'error', completed:'info'}[c.status] || 'muted';
    return `<div class="section-card" style="margin-bottom:12px">
      <div class="section-header">
        <div class="section-title">🚀 ${c.name}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge badge-${statusClass}">${c.status}</span>
          <div style="display:flex;gap:4px">
            ${c.status === 'running' ? `<button class="btn btn-warning btn-sm" onclick="pauseCampaign(${c.id})">⏸</button>` : `<button class="btn btn-success btn-sm" onclick="startCampaign(${c.id})">▶</button>`}
            <button class="btn btn-danger btn-sm" onclick="stopCampaign(${c.id})">■</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="deleteCampaign(${c.id})">🗑</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function startCampaign(id) {
  try { await api('POST', `/api/campaigns/${id}/start`); toast('Campaign dimulai!', 'success'); loadCampaigns(); } catch(e) { toast(e.message, 'error'); }
}

async function stopCampaign(id) {
  try { await api('POST', `/api/campaigns/${id}/stop`); toast('Campaign dihentikan', 'warning'); loadCampaigns(); } catch(e) { toast(e.message, 'error'); }
}

async function deleteCampaign(id) {
  if (!confirm('Hapus campaign ini?')) return;
  try { await api('DELETE', `/api/campaigns/${id}`); toast('Campaign dihapus', 'success'); loadCampaigns(); } catch(e) { toast(e.message, 'error'); }
}

// ─── Logs ─────────────────────────────────────────────────────────────────────
async function loadLogs() {
  try {
    const [logs, stats] = await Promise.all([
      api('GET', '/api/logs?limit=200'),
      api('GET', '/api/logs/stats'),
    ]);
    if (logs) renderLogsTable(logs);
    if (stats) {
      setEl('log-stat-total', stats.total);
      setEl('log-stat-success', stats.success);
      setEl('log-stat-failed', stats.failed);
      setEl('log-stat-rl', stats.rate_limited);
    }
  } catch(e) { toast(e.message, 'error'); }
}

function renderLogsTable(logs) {
  const el = document.getElementById('logs-tbody');
  if (!el) return;
  const sc = { success:'success', failed:'error', rate_limited:'warning', skipped:'muted' };
  el.innerHTML = logs.map(l => `<tr>
    <td>${new Date(l.sent_at).toLocaleString('id-ID')}</td>
    <td>Acc #${l.account_id}</td>
    <td>Grp #${l.group_id}</td>
    <td><span class="badge badge-${sc[l.status]||'muted'}">${l.status}</span></td>
    <td style="font-size:11px;color:var(--text-muted)">${l.error_message || '—'}</td>
    <td>${l.message_id || '—'}</td>
  </tr>`).join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function escHtml(str) { 
  if (!str) return '';
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

// ─── Initialization ───────────────────────────────────────────────────────────
function initApp() {
  connectWS();
  navigate('dashboard');
  setInterval(() => {
    if (currentPage === 'dashboard') updateStats();
  }, 30000);
}

window.addEventListener('DOMContentLoaded', () => {
  if (authToken) {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    initApp();
  }
  
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById('login-page').style.display !== 'none') login();
  });
});