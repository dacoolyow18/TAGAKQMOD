/**
 * File: admin.js
 * Path: admin-app/js/admin.js
 * Description: Main controller for the Tagak Coffee Admin Panel.
 *              Handles Account CRUD, Branch CRUD, Role & Permission
 *              management, and all UI interactions.
 *              Data is loaded from and saved to the server API.
 */

/* ═══════════════════════════════════════════
   GLOBAL STATE
   ═══════════════════════════════════════════ */

const ADMIN = {
  user: null,
  currentView: 'overview',
  clockInterval: null,
  expandedBranches: new Set(),
};

const STORE = {
  accounts: [],
  branches: [],
  permissions: {},
};

const EMPLOYEE_ROLES = ['Manager', 'Barista', 'Cashier'];
const ADMIN_ROLES = ['Admin', 'Super Admin'];
const EMPLOYEE_FILTER_CFG = {
  searchId: 'employee-search',
  branchSearchId: 'employee-branch-search',
  filterRoleId: 'employee-filter-role',
  filterStatusId: 'employee-filter-status',
};

/* ═══════════════════════════════════════════
   ROLE DISPLAY CONFIG
   ═══════════════════════════════════════════ */

const ROLE_CONFIG = {
  'Super Admin': {
    description: 'Highest level of access. Full control over all accounts, roles, and permissions.',
    icon: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>',
    iconClass: 'role-superadmin-icon',
    badgeClass: 'badge-superadmin',
  },
  Admin: {
    description: 'Full system access. Can manage users, roles, and all POS modules.',
    icon: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>',
    iconClass: 'role-admin-icon',
    badgeClass: 'badge-admin',
  },
  Manager: {
    description: 'Full POS access: orders, analytics, menu, supplies, tools.',
    icon: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>',
    iconClass: 'role-manager-icon',
    badgeClass: 'badge-manager',
  },
  Barista: {
    description: 'Restricted to the main POS terminal. Can only access and manage orders.',
    icon: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>',
    iconClass: 'role-barista-icon',
    badgeClass: 'badge-barista',
  },
  Cashier: {
    description: 'Restricted to the main POS terminal. Can only access and manage orders.',
    icon: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>',
    iconClass: 'role-cashier-icon',
    badgeClass: 'badge-cashier',
  },
};

/* ═══════════════════════════════════════════
   DOM SHORTCUTS
   ═══════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ═══════════════════════════════════════════
   API + DATA STORE
   ═══════════════════════════════════════════ */

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    window.TAGAK_AUTH.redirectToLogin();
    throw new ApiError('Your session has ended. Sign in again.', 401);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data;
}

async function loadStore() {
  const [branches, accounts, permissions] = await Promise.all([
    ADMIN.user.permissions.manage_users ? api('/api/branches?include=employees') : [],
    ADMIN.user.permissions.manage_users ? api('/api/accounts') : [],
    ADMIN.user.permissions.manage_roles ? api('/api/permissions') : {},
  ]);
  STORE.branches = branches;
  STORE.accounts = accounts;
  STORE.permissions = permissions;
}

function refreshAll() {
  renderEmployees();
  renderAdmins();
  renderBranches();
  renderRoles();
  renderOverview();
}

async function runAction(action, successMessage) {
  try {
    await action();
    if (successMessage) showToast(successMessage, 'success');
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    return false;
  }
}

function branchCodeOf(account) {
  return STORE.branches.find(b => b.id === account.branchId)?.code || '';
}

/* ═══════════════════════════════════════════
   TOAST NOTIFICATIONS
   ═══════════════════════════════════════════ */

function showToast(msg, type = 'info') {
  const container = $('#toast-container');
  const colors = {
    info:    'bg-crema text-white',
    success: 'bg-crema text-white',
    error:   'bg-espresso text-white',
    warning: 'bg-roast text-white',
  };
  const el = document.createElement('div');
  el.className = `${colors[type] || colors.info} px-4 py-2.5 rounded-lg text-xs font-semibold shadow-lg flex items-center gap-2 min-w-[12rem]`;
  el.innerHTML = `
    ${type === 'success' ? '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>' : ''}
    ${type === 'error' ? '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' : ''}
    <span>${esc(msg)}</span>
  `;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

/* ═══════════════════════════════════════════
   CLOCK
   ═══════════════════════════════════════════ */

function startClock() {
  function tick() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const date = now.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    $('#header-clock').textContent = `${date}  ${time}`;
  }
  tick();
  ADMIN.clockInterval = setInterval(tick, 1000);
}

/* ═══════════════════════════════════════════
   MODAL HELPERS
   ═══════════════════════════════════════════ */

function openModal(id) { $(`#${id}`).classList.add('open'); }
function closeModal(id) { $(`#${id}`).classList.remove('open'); }

function initModalClose() {
  // Close buttons (any element with .modal-close-btn inside a modal)
  $$('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-backdrop')?.classList.remove('open');
    });
  });

  // Backdrop click
  $$('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.remove('open');
    });
  });
}

function renderAdminSkeletons() {
  ['#overview-active-employees', '#overview-branches', '#overview-admins'].forEach(sel => {
    const el = $(sel);
    if (el) el.innerHTML = '<span class="skeleton-kpi-val admin-skeleton-bone" aria-hidden="true"></span>';
  });
  ['#overview-employee-caption', '#overview-admin-caption'].forEach(sel => {
    const el = $(sel);
    if (el) el.innerHTML = '<span class="skeleton-kpi-cap admin-skeleton-bone" aria-hidden="true"></span>';
  });

  const empBranches = $('#employees-branches');
  if (empBranches) {
    empBranches.setAttribute('aria-busy', 'true');
    empBranches.innerHTML = Array.from({ length: 3 }, () => `
      <section class="branch-group skeleton-branch-group" aria-hidden="true">
        <div class="branch-group-head">
          <span class="skeleton-mark admin-skeleton-bone"></span>
          <span class="branch-group-info" style="gap:0.35rem">
            <span class="skeleton-bar skeleton-bar--title admin-skeleton-bone"></span>
            <span class="skeleton-bar skeleton-bar--sub admin-skeleton-bone"></span>
          </span>
          <span class="branch-group-stats">
            <span class="skeleton-pill admin-skeleton-bone"></span>
            <span class="skeleton-pill admin-skeleton-bone"></span>
          </span>
        </div>
      </section>`).join('');
  }

  const branchesBody = $('#branches-tbody');
  if (branchesBody) {
    branchesBody.setAttribute('aria-busy', 'true');
    branchesBody.innerHTML = Array.from({ length: 4 }, () => `
      <tr class="skeleton-table-row" aria-hidden="true">
        <td><span class="skeleton-bar skeleton-bar--code admin-skeleton-bone" style="display:inline-block"></span></td>
        <td><span class="skeleton-bar skeleton-bar--title admin-skeleton-bone" style="display:inline-block"></span></td>
        <td><span class="skeleton-bar skeleton-bar--sub admin-skeleton-bone" style="display:inline-block"></span></td>
        <td><span class="skeleton-pill admin-skeleton-bone"></span></td>
        <td><span class="skeleton-bar skeleton-bar--sub admin-skeleton-bone" style="display:inline-block"></span></td>
        <td><span class="skeleton-bar skeleton-bar--code admin-skeleton-bone" style="display:inline-block"></span></td>
      </tr>`).join('');
  }

  const adminsBody = $('#admins-tbody');
  if (adminsBody) {
    adminsBody.setAttribute('aria-busy', 'true');
    adminsBody.innerHTML = Array.from({ length: 3 }, () => `
      <tr class="skeleton-table-row" aria-hidden="true">
        <td>
          <div class="acct-cell">
            <div class="skeleton-avatar admin-skeleton-bone"></div>
            <div style="display:flex;flex-direction:column;gap:0.3rem">
              <span class="skeleton-bar skeleton-bar--title admin-skeleton-bone" style="display:inline-block"></span>
              <span class="skeleton-bar skeleton-bar--sub admin-skeleton-bone" style="display:inline-block"></span>
            </div>
          </div>
        </td>
        <td><span class="skeleton-pill admin-skeleton-bone"></span></td>
        <td><span class="skeleton-pill admin-skeleton-bone"></span></td>
        <td><span class="skeleton-bar skeleton-bar--sub admin-skeleton-bone" style="display:inline-block"></span></td>
        <td><span class="skeleton-bar skeleton-bar--code admin-skeleton-bone" style="display:inline-block"></span></td>
      </tr>`).join('');
  }

  const rolesCards = $('#roles-cards');
  if (rolesCards) {
    rolesCards.setAttribute('aria-busy', 'true');
    rolesCards.innerHTML = Array.from({ length: 5 }, () => `
      <div class="role-card" aria-hidden="true">
        <div class="role-card-header">
          <div class="skeleton-mark admin-skeleton-bone--dark"></div>
          <div style="display:flex;flex-direction:column;gap:0.3rem;min-width:0">
            <span class="skeleton-bar skeleton-bar--sub admin-skeleton-bone--dark" style="display:inline-block"></span>
            <span class="skeleton-bar skeleton-bar--code admin-skeleton-bone--dark" style="display:inline-block"></span>
          </div>
        </div>
        <span class="skeleton-bar admin-skeleton-bone--dark" style="width:100%;height:1.75rem;display:block"></span>
        <div class="role-card-foot">
          <span class="skeleton-bar skeleton-bar--sub admin-skeleton-bone--dark" style="display:inline-block"></span>
          <span class="skeleton-pill admin-skeleton-bone--dark"></span>
        </div>
      </div>`).join('');
  }

  const permsBody = $('#permissions-tbody');
  if (permsBody) {
    permsBody.setAttribute('aria-busy', 'true');
    permsBody.innerHTML = Array.from({ length: 6 }, () => `
      <tr class="skeleton-table-row" aria-hidden="true">
        <td><span class="skeleton-bar skeleton-bar--title admin-skeleton-bone" style="display:inline-block"></span></td>
        <td class="text-center"><span class="skeleton-toggle admin-skeleton-bone"></span></td>
        <td class="text-center"><span class="skeleton-toggle admin-skeleton-bone"></span></td>
        <td class="text-center"><span class="skeleton-toggle admin-skeleton-bone"></span></td>
        <td class="text-center"><span class="skeleton-toggle admin-skeleton-bone"></span></td>
        <td class="text-center"><span class="skeleton-toggle admin-skeleton-bone"></span></td>
      </tr>`).join('');
  }
}

async function enterApp() {
  $('#app-layout').classList.remove('hidden');

  $('#header-admin').textContent = ADMIN.user.name;
  const rolePill = $('#header-role-pill');
  if (rolePill && ADMIN.user.role) rolePill.textContent = ADMIN.user.role;
  $('#sidebar-username').textContent = ADMIN.user.name;
  $('#sidebar-role').textContent = ADMIN.user.role;
  $('#sidebar-avatar').textContent = ADMIN.user.name.split(' ').map(n => n[0]).join('');

  const mobileUser = $('#sidebar-username-mobile');
  const mobileRole = $('#sidebar-role-mobile');
  const mobileAvatar = $('#sidebar-avatar-mobile');
  if (mobileUser) mobileUser.textContent = ADMIN.user.name;
  if (mobileRole) mobileRole.textContent = ADMIN.user.role;
  if (mobileAvatar) mobileAvatar.textContent = ADMIN.user.name.split(' ').map(n => n[0]).join('');

  startClock();
  initMobileSidebar();
  renderAdminSkeletons();
  $$('[data-view], [data-view-target], [data-action]').forEach(button => {
    const view = button.dataset.view || button.dataset.viewTarget || 'employees';
    button.toggleAttribute('hidden', !canOpenAdminView(view));
  });
  $('.overview-stats').hidden = !ADMIN.user.permissions.manage_users;
  switchView('overview');

  const minDelay = navigator.webdriver ? Promise.resolve() : new Promise(r => setTimeout(r, 340));
  try {
    await Promise.all([loadStore(), minDelay]);
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  ['#employees-branches', '#branches-tbody', '#admins-tbody', '#roles-cards', '#permissions-tbody'].forEach(sel => {
    $(sel)?.removeAttribute('aria-busy');
  });

  refreshAll();
  showToast(`Welcome, ${ADMIN.user.name}!`, 'success');
}

/* ═══════════════════════════════════════════
   SIDEBAR NAVIGATION
   ═══════════════════════════════════════════ */

function initSidebar() {
  $$('[data-view], [data-view-target], [data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.action === 'open-add-employee') {
        openAddAccountModal('Cashier', EMPLOYEE_ROLES);
        return;
      }
      const view = btn.dataset.view || btn.dataset.viewTarget;
      if (!view) return;
      switchView(view);
      closeSidebar();
    });
  });
}

function canOpenAdminView(view) {
  return view === 'overview' || (view === 'roles' ? ADMIN.user.permissions.manage_roles : ADMIN.user.permissions.manage_users);
}

function switchView(view) {
  if (!canOpenAdminView(view)) return;
  ADMIN.currentView = view;
  $$('.sidebar-item[data-view]').forEach(b => {
    const isActive = b.dataset.view === view;
    b.classList.toggle('active', isActive);
    if (isActive) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $$('.view-section').forEach(s => s.classList.add('hidden'));
  const target = $(`#view-${view}`);
  if (target) target.classList.remove('hidden');
  const titles = { overview: 'Overview', employees: 'Employees', admins: 'Admins', branches: 'Branches', roles: 'Roles & Permissions' };
  $('#view-title').textContent = titles[view] || view;
}

/* ═══════════════════════════════════════════
   MOBILE SIDEBAR
   ═══════════════════════════════════════════ */

function initMobileSidebar() {
  const hamburger = $('#btn-hamburger');
  const overlay = $('#sidebar-overlay');

  if (hamburger) hamburger.addEventListener('click', openSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });
}

function openSidebar() {
  const sidebar = $('#app-sidebar');
  const overlay = $('#sidebar-overlay');
  if (sidebar) sidebar.classList.add('open');
  if (overlay) overlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  const sidebar = $('#app-sidebar');
  const overlay = $('#sidebar-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('visible');
  document.body.style.overflow = '';
}

/* ═══════════════════════════════════════════
   ACCOUNT MANAGEMENT — CRUD
   ═══════════════════════════════════════════ */

let deleteConfirmCallback = null;
const employeeInputs = ['acct-first-name', 'acct-middle-name', 'acct-last-name', 'acct-branch-code'];
const resetEmployeeFields = [];
let resetBranchField;

function updateAccountSave() {
  const employee = EMPLOYEE_ROLES.includes($('#acct-role').value);
  const editId = $('#acct-edit-id').value;
  const phone = $('#acct-phone');
  let phoneMessage = phone.validationMessage === 'Only numbers are allowed.' ? phone.validationMessage : '';
  if (!phoneMessage && phone.value && !TagakFields.validPhone(phone.value)) phoneMessage = TagakFields.phoneError;
  if (!phoneMessage && phone.value && STORE.accounts.some(a => a.id !== editId && a.phone === phone.value)) {
    phoneMessage = TagakFields.duplicatePhoneError;
  }
  const password = $('#acct-password').value;
  const needsPassword = ADMIN_ROLES.includes($('#acct-role').value) && ADMIN.user?.provider !== 'supabase' && (!editId || password);
  const passwordMessage = needsPassword ? TagakFields.passwordError(password) : '';
  for (const [id, message] of [['acct-phone', phoneMessage], ['acct-password', passwordMessage]]) {
    const hint = $('#' + id + '-error');
    hint.textContent = message;
    hint.classList.toggle('hidden', !message);
    $('#' + id).setAttribute('aria-invalid', String(Boolean(message)));
  }
  $('#btn-account-save').disabled = !TagakFields.validPhone(phone.value) || Boolean(phoneMessage || passwordMessage) || (employee && employeeInputs.some(id => {
    const field = document.getElementById(id);
    const valid = id === 'acct-branch-code' ? TagakFields.validCode(field.value) : TagakFields.validName(field.value);
    return !valid || !field.validity.valid || (id !== 'acct-middle-name' && !field.value);
  })) || ['acct-first-name', 'acct-middle-name', 'acct-last-name', 'acct-middle-initial'].some(id => !TagakFields.validName($('#' + id).value));
}

function updateBranchSave() {
  const field = $('#branch-code');
  $('#btn-branch-save').disabled = !field.validity.valid || !TagakFields.validCode(field.value);
}

function buildRoleOptions(roles, selected) {
  return roles.map(r => `<option value="${r}" ${r === selected ? 'selected' : ''}>${r}</option>`).join('');
}

function updatePinFieldVisibility() {
  const roleInput = $('#acct-role');
  const pinField = $('#acct-pin');
  if (!roleInput || !pinField) return;
  const isPosRole = EMPLOYEE_ROLES.includes(roleInput.value);
  const isAdminRole = ADMIN_ROLES.includes(roleInput.value);
  const managed = ADMIN.user?.provider === 'supabase';
  pinField.closest('div').classList.toggle('hidden', managed || !isPosRole);
  $('#acct-password-section').style.display = isAdminRole && !managed ? '' : 'none';
  $('#managed-account-help').hidden = !managed;
  if (!isPosRole) pinField.value = '';
  pinField.placeholder = $('#acct-edit-id').value ? 'Leave blank to keep PIN' : '4 digits';
  $('#acct-branch-field')?.classList.toggle('hidden', !isPosRole);
  if (!isPosRole) $('#acct-branch-code').value = '';

  const middleNameField = $('#acct-middle-name-field');
  const middleNameInput = $('#acct-middle-name');
  const middleInitialField = $('#acct-middle-initial-field');
  const middleInitialInput = $('#acct-middle-initial');
  if (middleNameField) middleNameField.classList.toggle('hidden', !isPosRole);
  if (middleNameInput) {
    middleNameInput.removeAttribute('required');
    if (!isPosRole) middleNameInput.value = '';
  }
  if (middleInitialField) middleInitialField.classList.toggle('hidden', !isAdminRole);
  if (middleInitialInput) {
    middleInitialInput.removeAttribute('required');
    if (!isAdminRole) middleInitialInput.value = '';
  }
  resetEmployeeFields.forEach(reset => reset());
}

function canManageAccount(account) {
  if (!ADMIN.user) return false;
  if (ADMIN.user.role === 'Super Admin') return true;
  return EMPLOYEE_ROLES.includes(account.role);
}

function renderEmployees() {
  const container = $('#employees-branches');
  if (!container) return;

  const filters = readAccountFilters(EMPLOYEE_FILTER_CFG);
  const filtering = hasAccountFilters(filters);
  const groups = STORE.branches
    .map(branch => ({
      key: branch.id,
      branch,
      employees: (branch.employees || []).filter(a => matchesAccountFilters(a, filters)),
    }))
    .filter(group => !filtering || group.employees.length);

  if (filtering) groups.forEach(group => ADMIN.expandedBranches.add(group.key));

  if (groups.length === 0) {
    container.innerHTML = `<p class="branch-empty">${STORE.branches.length === 0 && !filtering ? 'No branches yet. Add a branch to group employees.' : 'No accounts found.'}</p>`;
  } else {
    container.innerHTML = groups.map((group, index) => renderBranchGroup(group, index)).join('');
  }

  const employees = STORE.branches.flatMap(branch => branch.employees || []).filter(a => matchesAccountFilters(a, filters));
  const active = employees.filter(a => a.active).length;
  const inactive = employees.length - active;
  const totalEl = $('#employees-total');
  const activeEl = $('#employees-active-count');
  const inactiveEl = $('#employees-inactive-count');
  if (totalEl) totalEl.textContent = `${employees.length} total`;
  if (activeEl) activeEl.textContent = `${active} active`;
  if (inactiveEl) inactiveEl.textContent = `${inactive} inactive`;
}

function renderBranchGroup(group, index) {
  const { branch, employees } = group;
  const isOpen = ADMIN.expandedBranches.has(group.key);
  const panelId = `branch-panel-${index}`;
  const manager = STORE.accounts.find(a => a.id === branch.managerId);
  const meta = `${branch.code}${branch.location ? ' · ' + branch.location : ''}`;
  const active = employees.filter(a => a.active).length;
  const countLabel = `${employees.length} employee${employees.length === 1 ? '' : 's'}`;
  const rows = employees.length
    ? employees.map(renderAccountRow).join('')
    : `<tr><td colspan="5" class="empty-state">No employees assigned to this branch.</td></tr>`;
  const managerLabel = manager ? esc(manager.name) : 'Not assigned';

  return `
    <section class="branch-group ${isOpen ? 'is-open' : ''}">
      <button type="button" class="branch-group-head" data-branch-toggle="${esc(group.key)}" aria-expanded="${isOpen}" aria-controls="${panelId}">
        <span class="branch-group-mark" aria-hidden="true">${esc(branchInitials(branch.name))}</span>
        <span class="branch-group-info">
          <strong>${esc(branch.name)}</strong>
          <small class="tabular-nums">${esc(meta)}</small>
        </span>
        <span class="branch-group-stats">
          <span class="tabular-nums">${countLabel}</span>
          <span class="stat-ok tabular-nums">${active} active</span>
        </span>
        <span class="branch-group-chevron" aria-hidden="true">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
        </span>
      </button>
      <div class="branch-group-panel" id="${panelId}" ${isOpen ? '' : 'hidden'}>
        <div class="branch-group-toolbar">
          <span>Manager: ${managerLabel}</span>
          <button type="button" class="btn btn-secondary btn-sm" data-add-employee-branch="${esc(branch.code)}">Add employee</button>
        </div>
        <div class="table-container">
          <table class="data-table">
            <caption class="sr-only">Employees in ${esc(branch.name)}</caption>
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function branchInitials(name) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
}

function toggleBranchGroup(button) {
  const key = button.dataset.branchToggle;
  const isOpen = !ADMIN.expandedBranches.has(key);
  if (isOpen) ADMIN.expandedBranches.add(key);
  else ADMIN.expandedBranches.delete(key);

  button.setAttribute('aria-expanded', String(isOpen));
  button.closest('.branch-group').classList.toggle('is-open', isOpen);
  document.getElementById(button.getAttribute('aria-controls')).hidden = !isOpen;
}

function renderOverview() {
  const accounts = STORE.accounts;
  const branches = STORE.branches;
  const employees = accounts.filter(account => EMPLOYEE_ROLES.includes(account.role));
  const admins = accounts.filter(account => ADMIN_ROLES.includes(account.role));
  const activeEmployees = employees.filter(account => account.active !== false).length;
  const activeAdmins = admins.filter(account => account.active !== false).length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const greetingEl = $('#title-overview');
  if (greetingEl && ADMIN.user?.name) {
    greetingEl.innerHTML = `${greeting}, <em>${esc(ADMIN.user.name)}.</em>`;
  }

  const values = {
    '#overview-active-employees': activeEmployees,
    '#overview-branches': branches.length,
    '#overview-admins': admins.length,
    '#overview-employee-caption': `${employees.length} total employee${employees.length === 1 ? '' : 's'}`,
    '#overview-admin-caption': `${activeAdmins} active admin${activeAdmins === 1 ? '' : 's'}`,
  };

  Object.entries(values).forEach(([selector, value]) => {
    const element = $(selector);
    if (element) element.textContent = value;
  });
}

function renderAdmins() {
  renderAccountsTable(ADMIN_ROLES, {
    searchId: 'admin-search',
    filterRoleId: 'admin-filter-role',
    filterStatusId: 'admin-filter-status',
    tbodyId: 'admins-tbody',
    totalEl: 'admins-total',
    activeEl: 'admins-active-count',
    inactiveEl: 'admins-inactive-count',
  });
}

function readAccountFilters(cfg) {
  return {
    search: ($(`#${cfg.searchId}`)?.value || '').toLowerCase(),
    branchSearch: cfg.branchSearchId ? ($(`#${cfg.branchSearchId}`)?.value || '').trim() : '',
    role: $(`#${cfg.filterRoleId}`)?.value || '',
    status: $(`#${cfg.filterStatusId}`)?.value || '',
  };
}

function hasAccountFilters(filters) {
  return Boolean(filters.search || filters.branchSearch || filters.role || filters.status);
}

function matchesAccountFilters(a, filters) {
  if (filters.search) {
    const firstLast = `${a.firstName || ''} ${a.lastName || ''}`.trim().toLowerCase();
    const haystack = `${a.name || ''} ${firstLast} ${a.email || ''} ${a.phone || ''}`.toLowerCase();
    if (!haystack.includes(filters.search)) return false;
  }
  if (filters.branchSearch && branchCodeOf(a) !== filters.branchSearch) return false;
  if (filters.role && a.role !== filters.role) return false;
  if (filters.status === 'active' && !a.active) return false;
  if (filters.status === 'inactive' && a.active) return false;
  return true;
}

function renderAccountsTable(allowedRoles, cfg) {
  const filters = readAccountFilters(cfg);
  const colCount = 5;

  const filtered = STORE.accounts.filter(a => allowedRoles.includes(a.role) && matchesAccountFilters(a, filters));

  const tbody = $(`#${cfg.tbodyId}`);
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-state">No accounts found.</td></tr>`;
  } else {
    tbody.innerHTML = filtered.map(renderAccountRow).join('');
  }

  const active = filtered.filter(a => a.active).length;
  const inactive = filtered.length - active;
  const totalEl = $(`#${cfg.totalEl}`);
  const activeEl = $(`#${cfg.activeEl}`);
  const inactiveEl = $(`#${cfg.inactiveEl}`);
  if (totalEl) totalEl.textContent = `${filtered.length} total`;
  if (activeEl) activeEl.textContent = `${active} active`;
  if (inactiveEl) inactiveEl.textContent = `${inactive} inactive`;
}

function renderAccountRow(a) {
  const contactParts = [
    a.email,
    a.phone,
    a.birthdate ? `DOB: ${formatDate(a.birthdate)}` : '',
  ].filter(Boolean);
  return `
      <tr>
        <td data-label="Employee">
          <div class="acct-cell">
            <div class="acct-avatar">${esc(a.name.split(' ').filter(Boolean).map(n => n[0]).join(''))}</div>
            <div>
              <p class="acct-name">${esc(a.name)}</p>
              ${contactParts.length ? `<p class="acct-email tabular-nums">${esc(contactParts.join(' · '))}</p>` : ''}
            </div>
          </div>
        </td>
        <td data-label="Role"><span class="badge ${ROLE_CONFIG[a.role]?.badgeClass || ''}">${esc(a.role)}</span></td>
        <td data-label="Status">
          <span class="badge ${a.active ? 'badge-active' : 'badge-inactive'}">${a.active ? 'Active' : 'Inactive'}</span>
          ${a.locked ? '<span class="badge badge-inactive" style="margin-left:0.25rem">Locked</span>' : ''}
        </td>
        <td data-label="Created"><span class="cell-meta tabular-nums">${formatDate(a.createdAt)}</span></td>
        <td data-label="Actions" class="td-actions">
          <div class="action-btns">
            ${canManageAccount(a) ? `
              ${a.locked ? `
              <button class="btn btn-ghost btn-icon text-espresso" data-row-action="unlockAccount" data-row-id="${esc(a.id)}" title="Unlock account" aria-label="Unlock">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg>
              </button>` : ''}
              <button class="btn btn-ghost btn-icon" data-row-action="editAccount" data-row-id="${esc(a.id)}" title="Edit" aria-label="Edit">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button class="btn btn-ghost btn-icon" data-row-action="toggleAccountActive" data-row-id="${esc(a.id)}" title="${a.active ? 'Deactivate' : 'Activate'}" aria-label="${a.active ? 'Deactivate' : 'Activate'}">
                ${a.active
                  ? '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>'
                  : '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9"/></svg>'}
              </button>
              <button class="btn btn-ghost btn-icon text-espresso" data-row-action="deleteAccount" data-row-id="${esc(a.id)}" title="Delete" aria-label="Delete">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            ` : `
              <span class="cell-restricted">Restricted</span>
            `}
          </div>
        </td>
      </tr>
    `;
}

function setPasswordVisible(visible) {
  const input = $('#acct-password');
  const toggle = $('#toggle-acct-password');
  input.type = visible ? 'text' : 'password';
  toggle.classList.toggle('is-visible', visible);
  toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  toggle.setAttribute('aria-pressed', String(visible));
}

function initAccountActions() {
  const rowActions = new Map([
    ['unlockAccount', unlockAccount], ['editAccount', editAccount],
    ['toggleAccountActive', toggleAccountActive], ['deleteAccount', deleteAccount],
    ['editBranch', editBranch], ['deleteBranch', deleteBranch],
  ]);
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-row-action]');
    if (button) rowActions.get(button.dataset.rowAction)?.(button.dataset.rowId);
  });
  for (const id of employeeInputs) {
    const code = id === 'acct-branch-code';
    resetEmployeeFields.push(TagakFields.bind(document.getElementById(id), document.getElementById(id + '-error'),
      code ? TagakFields.validCode : TagakFields.validName, code ? TagakFields.branchError : TagakFields.nameError,
      updateAccountSave, code ? () => EMPLOYEE_ROLES.includes($('#acct-role').value) : undefined));
  }
  resetEmployeeFields.push(TagakFields.bind($('#acct-middle-initial'), $('#acct-middle-initial-error'),
    TagakFields.validName, TagakFields.nameError, updateAccountSave));
  $('#btn-add-employee')?.addEventListener('click', () => openAddAccountModal('Cashier', EMPLOYEE_ROLES));
  $('#employees-branches')?.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-branch-toggle]');
    if (toggle) {
      toggleBranchGroup(toggle);
      return;
    }
    const addButton = event.target.closest('[data-add-employee-branch]');
    if (addButton) openAddAccountModal('Cashier', EMPLOYEE_ROLES, addButton.dataset.addEmployeeBranch);
  });
  $('#btn-add-admin')?.addEventListener('click', openAddAdminModal);
  $('#btn-account-save')?.addEventListener('click', saveAccount);
  $('#toggle-acct-password')?.addEventListener('click', () => {
    setPasswordVisible($('#acct-password').type === 'password');
  });
  $('#acct-password').addEventListener('input', updateAccountSave);
  $('#acct-role')?.addEventListener('change', updatePinFieldVisibility);
  const digitsOnly = value => /^\d*$/.test(value);
  resetEmployeeFields.push(TagakFields.bind($('#acct-phone'), $('#acct-phone-error'),
    digitsOnly, 'Only numbers are allowed.', updateAccountSave));
  resetEmployeeFields.push(TagakFields.bind($('#acct-pin'), $('#acct-pin-error'),
    digitsOnly, 'Only numbers are allowed.', updateAccountSave, () => EMPLOYEE_ROLES.includes($('#acct-role').value)));
  $('#employee-search')?.addEventListener('input', renderEmployees);
  $('#employee-branch-search')?.addEventListener('input', renderEmployees);
  $('#employee-filter-role')?.addEventListener('change', renderEmployees);
  $('#employee-filter-status')?.addEventListener('change', renderEmployees);
  $('#admin-search')?.addEventListener('input', renderAdmins);
  $('#admin-filter-role')?.addEventListener('change', renderAdmins);
  $('#admin-filter-status')?.addEventListener('change', renderAdmins);
}

function openAddAccountModal(defaultRole = 'Cashier', allowedRoles = EMPLOYEE_ROLES, branchCode = '') {
  $('#account-form-title').textContent = 'Add Employee';
  $('#acct-edit-id').value = '';
  $('#acct-first-name').value = '';
  $('#acct-middle-name').value = '';
  $('#acct-middle-initial').value = '';
  $('#acct-last-name').value = '';
  $('#acct-pin').value = '';
  $('#acct-role').innerHTML = buildRoleOptions(allowedRoles, defaultRole);
  $('#acct-branch-code').value = branchCode;
  $('#acct-branch-field').classList.remove('hidden');
  $('#acct-email').value = '';
  $('#acct-phone').value = '';
  $('#acct-birthdate').value = '';
  $('#acct-password').value = '';
  setPasswordVisible(false);
  $('#acct-password-section').style.display = 'none';
  openModal('account-modal');
  updatePinFieldVisibility();
}

function openAddAdminModal() {
  if (ADMIN.user.role !== 'Super Admin') {
    showToast('Only Super Admins can create Admin accounts', 'error');
    return;
  }
  $('#account-form-title').textContent = 'Add Admin';
  $('#acct-edit-id').value = '';
  $('#acct-first-name').value = '';
  $('#acct-middle-name').value = '';
  $('#acct-middle-initial').value = '';
  $('#acct-last-name').value = '';
  $('#acct-pin').value = '';
  $('#acct-role').innerHTML = buildRoleOptions(ADMIN_ROLES, 'Admin');
  $('#acct-branch-code').value = '';
  $('#acct-branch-field').classList.add('hidden');
  $('#acct-email').value = '';
  $('#acct-phone').value = '';
  $('#acct-birthdate').value = '';
  $('#acct-password').value = '';
  setPasswordVisible(false);
  $('#acct-password-section').style.display = '';
  openModal('account-modal');
  updatePinFieldVisibility();
}

function editAccount(id) {
  const a = STORE.accounts.find(x => x.id === id);
  if (!a) return;

  if (!canManageAccount(a)) {
    showToast('You can only manage employee accounts (Manager, Barista, Cashier)', 'error');
    return;
  }

  $('#account-form-title').textContent = a.role === 'Super Admin' ? 'Edit Super Admin' : 'Edit Account';
  $('#acct-edit-id').value = a.id;
  $('#acct-first-name').value = a.firstName || '';
  $('#acct-middle-name').value = a.middleName || '';
  $('#acct-middle-initial').value = a.middleInitial || '';
  $('#acct-last-name').value = a.lastName || '';
  $('#acct-pin').value = '';
  const allowedRoles = ADMIN_ROLES.includes(a.role) ? ADMIN_ROLES : EMPLOYEE_ROLES;
  $('#acct-role').innerHTML = buildRoleOptions(allowedRoles, a.role);
  $('#acct-branch-code').value = branchCodeOf(a);
  $('#acct-branch-field').classList.toggle('hidden', !EMPLOYEE_ROLES.includes(a.role));
  $('#acct-email').value = a.email || '';
  $('#acct-phone').value = a.phone || '';
  $('#acct-birthdate').value = a.birthdate || '';
  $('#acct-password').value = '';
  setPasswordVisible(false);
  $('#acct-password-section').style.display = ADMIN_ROLES.includes(a.role) ? '' : 'none';
  openModal('account-modal');
  updatePinFieldVisibility();
}

async function saveAccount() {
  updateAccountSave();
  if ($('#btn-account-save').disabled) return;
  const editId = $('#acct-edit-id').value;
  const firstName = $('#acct-first-name').value.trim();
  const middleName = $('#acct-middle-name').value.trim();
  const middleInitial = $('#acct-middle-initial').value.trim().replace(/\.+$/, '');
  const lastName = $('#acct-last-name').value.trim();
  const pin = $('#acct-pin').value.trim();
  const role = $('#acct-role').value;
  const branchCode = $('#acct-branch-code').value.trim();
  const email = $('#acct-email').value.trim();
  const phone = $('#acct-phone').value;
  const birthdate = $('#acct-birthdate').value.trim();
  const password = $('#acct-password').value;
  const isAdminRole = ADMIN_ROLES.includes(role);
  const isPosRole = EMPLOYEE_ROLES.includes(role);

  if (!firstName) { showToast('Please enter a first name', 'error'); return; }
  if (isAdminRole && middleInitial.length > 2) { showToast('Middle initial must be 1 or 2 characters', 'error'); return; }
  if (!lastName) { showToast('Please enter a last name', 'error'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('Please enter a valid email address', 'error');
    return;
  }
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
    showToast('Please enter a valid birthdate', 'error');
    return;
  }
  if (ADMIN.user?.provider !== 'supabase' && isPosRole && (!editId || pin) && !/^\d{4}$/.test(pin)) { showToast('PIN must be exactly 4 digits', 'error'); return; }

  let branchId = null;
  if (isPosRole) {
    const branch = STORE.branches.find(b => b.code === branchCode);
    if (!branch) { showToast('No branch has that code', 'error'); return; }
    branchId = branch.id;
  }

  const existing = editId ? STORE.accounts.find(a => a.id === editId) : null;
  const body = {
    firstName,
    middleName: isPosRole ? middleName : '',
    middleInitial: isAdminRole ? middleInitial : '',
    lastName,
    role,
    email,
    phone,
    birthdate,
    ...(isPosRole && pin ? { pin } : {}),
    branchId,
    ...(isPosRole && { branchCode }),
    active: existing ? existing.active : true,
    password: password || undefined,
  };

  const saved = await runAction(async () => {
    if (editId) await api(`/api/accounts/${editId}`, { method: 'PUT', body });
    else await api('/api/accounts', { method: 'POST', body });
    await loadStore();
  }, editId ? 'Account updated successfully' : 'Account created successfully');
  if (!saved) return;

  closeModal('account-modal');
  refreshAll();
}

async function unlockAccount(id) {
  const a = STORE.accounts.find(x => x.id === id);
  if (!a) return;

  if (!canManageAccount(a)) {
    showToast('You can only manage employee accounts (Manager, Barista, Cashier)', 'error');
    return;
  }

  const saved = await runAction(async () => {
    await api(`/api/accounts/${id}/unlock`, { method: 'POST' });
    await loadStore();
  }, `Unlocked ${a.name}`);
  if (saved) refreshAll();
}

async function toggleAccountActive(id) {
  const a = STORE.accounts.find(x => x.id === id);
  if (!a) return;

  // Super Admins may deactivate their own account; others cannot.
  if (a.id === ADMIN.user.id && ADMIN.user.role !== 'Super Admin') {
    showToast('You cannot deactivate your own account', 'error');
    return;
  }

  if (!canManageAccount(a)) {
    showToast('You can only manage employee accounts (Manager, Barista, Cashier)', 'error');
    return;
  }

  const nextActive = !a.active;
  const saved = await runAction(async () => {
    await api(`/api/accounts/${id}`, {
      method: 'PUT',
      body: {
        firstName: a.firstName,
        middleName: a.middleName,
        middleInitial: a.middleInitial,
        lastName: a.lastName,
        role: a.role,
        email: a.email,
        phone: a.phone,
        birthdate: a.birthdate,
        branchId: a.branchId,
        active: nextActive,
      },
    });
    await loadStore();
  }, null);
  if (!saved) return;

  refreshAll();
  showToast(`Account ${nextActive ? 'activated' : 'deactivated'}`, nextActive ? 'success' : 'warning');
}

function deleteAccount(id) {
  const a = STORE.accounts.find(x => x.id === id);
  if (!a) return;

  // Super Admins may delete their own account; others cannot.
  if (a.id === ADMIN.user.id && ADMIN.user.role !== 'Super Admin') {
    showToast('You cannot delete your own account', 'error');
    return;
  }

  if (!canManageAccount(a)) {
    showToast('You can only manage employee accounts (Manager, Barista, Cashier)', 'error');
    return;
  }

  $('#confirm-modal-title').textContent = 'Delete Account';
  $('#confirm-modal-msg').textContent = `Are you sure you want to permanently delete ${a.name}'s account? This cannot be undone.`;
  openModal('confirm-modal');

  deleteConfirmCallback = async () => {
    closeModal('confirm-modal');
    const removed = await runAction(async () => {
      await api(`/api/accounts/${id}`, { method: 'DELETE' });
      await loadStore();
    }, 'Account deleted');
    if (removed) refreshAll();
  };
}

/* ═══════════════════════════════════════════
   BRANCH MANAGEMENT — CRUD
   ═══════════════════════════════════════════ */

function buildManagerOptions(selectedId) {
  // Include the currently assigned manager even if the account was deactivated,
  // so editing an existing branch never loses its selection.
  const managers = STORE.accounts.filter(a => a.role === 'Manager' && (a.active || a.id === selectedId));

  if (managers.length === 0) {
    return '<option value="">No managers available</option>';
  }

  return managers.map(m =>
    `<option value="${esc(m.id)}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.name)}${m.email ? ' — ' + esc(m.email) : ''}</option>`
  ).join('');
}

function renderBranches() {
  const query = ($('#branch-search')?.value || '').trim().toLowerCase();
  const branches = STORE.branches.filter(branch => {
    if (!query) return true;
    return `${branch.code} ${branch.name}`.toLowerCase().includes(query);
  });
  const tbody = $('#branches-tbody');
  if (!tbody) return;

  if (branches.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No branches found.</td></tr>`;
  } else {
    tbody.innerHTML = branches.map(b => {
      const manager = STORE.accounts.find(a => a.id === b.managerId);
      return `
        <tr>
          <td data-label="Branch Code"><span class="pin-code tabular-nums">${esc(b.code)}</span></td>
          <td data-label="Branch Name"><span class="acct-name">${esc(b.name)}</span></td>
          <td data-label="Location"><span class="cell-body">${esc(b.location)}</span></td>
          <td data-label="Manager">
            ${manager
              ? `<span class="badge ${ROLE_CONFIG[manager.role]?.badgeClass || 'badge-manager'}">${esc(manager.name)}</span>`
              : '<span class="cell-meta">No manager assigned</span>'}
          </td>
          <td data-label="Created"><span class="cell-meta tabular-nums">${formatDate(b.createdAt)}</span></td>
          <td data-label="Actions" class="td-actions">
            <div class="action-btns">
              <button class="btn btn-ghost btn-icon" data-row-action="editBranch" data-row-id="${esc(b.id)}" title="Edit" aria-label="Edit">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button class="btn btn-ghost btn-icon text-espresso" data-row-action="deleteBranch" data-row-id="${esc(b.id)}" title="Delete" aria-label="Delete">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  const totalEl = $('#branches-total');
  if (totalEl) totalEl.textContent = `${branches.length} total`;
}

function openAddBranchModal() {
  $('#branch-form-title').textContent = 'Add Branch';
  $('#branch-edit-id').value = '';
  $('#branch-code').value = '';
  $('#branch-name').value = '';
  $('#branch-location').value = '';
  $('#branch-manager').innerHTML = buildManagerOptions('');
  openModal('branch-modal');
  resetBranchField();
  $('#branch-code').focus();
}

function editBranch(id) {
  const b = STORE.branches.find(x => x.id === id);
  if (!b) return;

  $('#branch-form-title').textContent = 'Edit Branch';
  $('#branch-edit-id').value = b.id;
  $('#branch-code').value = b.code;
  $('#branch-name').value = b.name;
  $('#branch-location').value = b.location;
  $('#branch-manager').innerHTML = buildManagerOptions(b.managerId);
  openModal('branch-modal');
  resetBranchField();
}

async function saveBranch() {
  updateBranchSave();
  if ($('#btn-branch-save').disabled) return;
  const editId = $('#branch-edit-id').value;
  const code = $('#branch-code').value.trim();
  const name = $('#branch-name').value.trim();
  const location = $('#branch-location').value.trim();
  const managerId = $('#branch-manager').value;

  if (!code) { showToast('Please enter a branch code', 'error'); return; }
  if (!name) { showToast('Please enter the exact branch name', 'error'); return; }
  if (!location) { showToast('Please enter the branch location', 'error'); return; }
  const body = { code, name, location, managerId: managerId || null };
  const saved = await runAction(async () => {
    if (editId) await api(`/api/branches/${editId}`, { method: 'PUT', body });
    else await api('/api/branches', { method: 'POST', body });
    await loadStore();
  }, editId ? 'Branch updated successfully' : 'Branch created successfully');
  if (!saved) return;

  closeModal('branch-modal');
  refreshAll();
}

function deleteBranch(id) {
  const b = STORE.branches.find(x => x.id === id);
  if (!b) return;

  $('#confirm-modal-title').textContent = 'Delete Branch';
  $('#confirm-modal-msg').textContent = `Are you sure you want to permanently delete ${b.name} (${b.code})? This cannot be undone.`;
  openModal('confirm-modal');

  deleteConfirmCallback = async () => {
    closeModal('confirm-modal');
    const removed = await runAction(async () => {
      await api(`/api/branches/${id}`, { method: 'DELETE' });
      await loadStore();
    }, 'Branch deleted');
    if (removed) refreshAll();
  };
}

function initBranchActions() {
  resetBranchField = TagakFields.bind($('#branch-code'), $('#branch-code-error'),
    TagakFields.validCode, TagakFields.branchError, updateBranchSave);
  $('#btn-add-branch')?.addEventListener('click', openAddBranchModal);
  $('#btn-branch-save')?.addEventListener('click', saveBranch);
  $('#branch-search')?.addEventListener('input', renderBranches);
  $('#branch-search-clear')?.addEventListener('click', () => {
    const search = $('#branch-search');
    if (!search) return;
    search.value = '';
    renderBranches();
    search.focus();
  });
}

/* ═══════════════════════════════════════════
   ROLES & PERMISSIONS
   ═══════════════════════════════════════════ */

function renderRoles() {
  const permissions = STORE.permissions;
  const accounts = STORE.accounts;

  // Role cards
  const cardsEl = $('#roles-cards');
  if (cardsEl) {
    cardsEl.innerHTML = Object.keys(ROLE_CONFIG).map(role => {
      const config = ROLE_CONFIG[role];
      const count = accounts.filter(a => a.role === role && a.active).length;
      const permCount = permissions[role] ? Object.values(permissions[role]).filter(Boolean).length : 0;

      return `
        <div class="role-card">
          <div class="role-card-header">
            <div class="role-icon ${config.iconClass}">${config.icon}</div>
            <div class="min-w-0">
              <p class="role-card-title">${role}</p>
              <p class="role-card-count tabular-nums">${count} active account${count !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <p class="role-card-desc">${config.description}</p>
          <div class="role-card-foot">
            <span class="role-card-perm tabular-nums">${permCount} of ${PERMISSION_DEFS.length} permissions</span>
            <span class="badge ${config.badgeClass}">${role}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Permission matrix table
  const tbody = $('#permissions-tbody');
  if (tbody) {
    const roles = ['Super Admin', 'Admin', 'Manager', 'Barista', 'Cashier'];
    let currentModule = '';

    tbody.innerHTML = PERMISSION_DEFS.map(perm => {
      let moduleHeader = '';
      if (perm.module !== currentModule) {
        currentModule = perm.module;
        moduleHeader = `<tr class="addon-section-head"><td colspan="6">${esc(perm.module)}</td></tr>`;
      }

      const cells = roles.map(role => {
        const locked = role === 'Super Admin' || (role === 'Admin' && ADMIN.user.role !== 'Super Admin') ||
          (perm.module === 'Admin' && !ADMIN_ROLES.includes(role));
        const checked = permissions[role]?.[perm.key] || false;
        return `<td class="text-center">
          <button ${locked ? 'disabled' : ''} class="perm-toggle ${checked ? 'on' : 'off'}" data-role="${role}" data-perm="${perm.key}" title="${checked ? 'Enabled' : 'Disabled'}">
            <div class="toggle-sm"></div>
          </button>
        </td>`;
      }).join('');

      return `${moduleHeader}<tr>
        <td class="acct-name">${esc(perm.label)}</td>
        ${cells}
      </tr>`;
    }).join('');

    // Bind toggle clicks
    tbody.querySelectorAll('.perm-toggle').forEach(btn => {
      btn.addEventListener('click', () => togglePermission(btn));
    });
  }
}

async function togglePermission(btn) {
  const role = btn.dataset.role;
  const perm = btn.dataset.perm;

  if (role === 'Super Admin' || (ADMIN.user.role !== 'Super Admin' && (role === 'Admin' || !EMPLOYEE_ROLES.includes(role)))) {
    showToast(role === 'Super Admin' ? 'Super Admin permissions are locked' : 'Only Super Admins can modify this role\'s permissions', 'error');
    return;
  }

  const saved = await runAction(async () => {
    await api('/api/permissions', { method: 'PATCH', body: { role, key: perm, enabled: !STORE.permissions[role]?.[perm] } });
    await loadStore();
  }, null);
  if (!saved) return;

  const enabled = STORE.permissions[role]?.[perm];
  renderRoles();
  showToast(`${perm.replace(/_/g, ' ')} ${enabled ? 'enabled' : 'disabled'} for ${role}`, 'success');
}

/* ═══════════════════════════════════════════
   CONFIRM MODAL
   ═══════════════════════════════════════════ */

function initConfirmModal() {
  $('#btn-confirm-action')?.addEventListener('click', () => {
    if (typeof deleteConfirmCallback === 'function') {
      const callback = deleteConfirmCallback;
      deleteConfirmCallback = null;
      callback();
    }
  });
}

/* ═══════════════════════════════════════════
   FORMATTING HELPERS
   ═══════════════════════════════════════════ */

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ═══════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  window.TAGAK_AUTH.ready.then(session => {
    if (!session) return;

    ADMIN.user = session.user;
    window.TAGAK_AUTH.bindLogout('#btn-logout');
    window.TAGAK_AUTH.authorizeFetch();
    enterApp();
    initSidebar();
    initModalClose();
    initAccountActions();
    initConfirmModal();
    initBranchActions();
  });
});
