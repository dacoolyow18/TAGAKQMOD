/**
 * File: app.js
 * Path: pos-app/js/app.js
 * Description: Main controller for the Vendor POS.
 *              Handles authenticated app initialization, sidebar navigation,
 *              header clock, store open/close toggle, Cash Drawer + Blind Shift Close,
 *              and QMODSIM Lab view initialization.
 */

/* ═══════════════════════════════════════════
   GLOBAL STATE
   ═══════════════════════════════════════════ */

const POS = {
  user: null,            // { name, role }
  storeOpen: true,
  currentView: 'register',
  orders: [],
  clockInterval: null,
};

/* ═══════════════════════════════════════════
   DOM SHORTCUTS
   ═══════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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
  const safeMsg = String(msg ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  el.innerHTML = `
    ${type === 'success' ? '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>' : ''}
    ${type === 'error' ? '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' : ''}
    <span>${safeMsg}</span>
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
  POS.clockInterval = setInterval(tick, 1000);
}

function renderPosSkeletons() {
  const regGrid = $('#reg-grid');
  if (regGrid) {
    regGrid.setAttribute('aria-busy', 'true');
    regGrid.innerHTML = Array.from({ length: 8 }, () => `
      <div class="skeleton-reg-tile" aria-hidden="true">
        <div class="skeleton-reg-thumb pos-skeleton-bone"></div>
        <div class="skeleton-reg-body">
          <div class="skeleton-bar skeleton-bar--title pos-skeleton-bone"></div>
          <div class="skeleton-reg-bottom">
            <div class="skeleton-bar skeleton-bar--price pos-skeleton-bone"></div>
            <div class="skeleton-reg-add pos-skeleton-bone"></div>
          </div>
        </div>
      </div>`).join('');
  }

  const kanban = $('#kanban-board');
  if (kanban) {
    kanban.setAttribute('aria-busy', 'true');
    const cols = ['Queued', 'Brewing', 'Ready', 'Completed'];
    kanban.innerHTML = cols.map(col => `
      <div class="kanban-column" aria-hidden="true">
        <div class="kanban-header" style="background:var(--bg-subtle); color:var(--ink)">
          <span>${col}</span>
          <span class="kanban-header-count tabular-nums">—</span>
        </div>
        <div class="kanban-list">
          ${Array.from({ length: 2 }, () => `
            <div class="skeleton-kanban-card">
              <div class="skeleton-kanban-row">
                <div class="skeleton-bar skeleton-bar--sub pos-skeleton-bone"></div>
                <div class="skeleton-pill pos-skeleton-bone"></div>
              </div>
              <div class="skeleton-bar skeleton-bar--title pos-skeleton-bone"></div>
              <div class="skeleton-bar skeleton-bar--sub pos-skeleton-bone"></div>
              <div class="skeleton-kanban-row">
                <div class="skeleton-btn-bar pos-skeleton-bone"></div>
                <div class="skeleton-btn-bar pos-skeleton-bone"></div>
              </div>
            </div>`).join('')}
        </div>
      </div>`).join('');
  }

  const recipeList = $('#recipe-list');
  if (recipeList) {
    recipeList.setAttribute('aria-busy', 'true');
    recipeList.innerHTML = Array.from({ length: 6 }, () => `
      <div class="skeleton-recipe-item" aria-hidden="true">
        <div class="flex-1 min-w-0 space-y-1.5">
          <div class="skeleton-bar skeleton-bar--title pos-skeleton-bone"></div>
          <div class="skeleton-bar skeleton-bar--sub pos-skeleton-bone"></div>
        </div>
        <div class="skeleton-toggle pos-skeleton-bone"></div>
      </div>`).join('');
  }

  const suppliesBody = $('#supplies-table-body');
  if (suppliesBody) {
    suppliesBody.setAttribute('aria-busy', 'true');
    suppliesBody.innerHTML = Array.from({ length: 5 }, () => `
      <tr class="skeleton-table-row" aria-hidden="true">
        <td><div class="skeleton-bar skeleton-bar--title pos-skeleton-bone"></div></td>
        <td><div class="skeleton-bar skeleton-bar--price pos-skeleton-bone"></div></td>
        <td><div class="skeleton-bar skeleton-bar--sub pos-skeleton-bone"></div></td>
        <td><div class="skeleton-bar skeleton-bar--sub pos-skeleton-bone"></div></td>
        <td><div class="skeleton-pill pos-skeleton-bone"></div></td>
        <td><div class="skeleton-bar skeleton-bar--sub pos-skeleton-bone"></div></td>
      </tr>`).join('');
  }

  const addonsBody = $('#addons-table-body');
  if (addonsBody) {
    addonsBody.setAttribute('aria-busy', 'true');
    addonsBody.innerHTML = Array.from({ length: 4 }, () => `
      <tr class="skeleton-table-row" aria-hidden="true">
        <td><div class="skeleton-bar skeleton-bar--title pos-skeleton-bone"></div></td>
        <td><div class="skeleton-bar skeleton-bar--sub pos-skeleton-bone"></div></td>
        <td><div class="skeleton-bar skeleton-bar--price pos-skeleton-bone"></div></td>
        <td><div class="skeleton-pill pos-skeleton-bone"></div></td>
        <td><div class="skeleton-bar skeleton-bar--sub pos-skeleton-bone"></div></td>
      </tr>`).join('');
  }
}

document.addEventListener('load', (event) => {
  if (event.target instanceof HTMLImageElement) {
    event.target.classList.remove('pos-img-loading');
  }
}, true);

async function enterApp() {
  $('#app-layout').classList.remove('hidden');

  // Populate header / sidebar user info
  $('#header-cashier').textContent = POS.user.name;
  $('#sidebar-username').textContent = POS.user.name;
  $('#sidebar-role').textContent = POS.user.role;
  $('#sidebar-avatar').textContent = POS.user.name.split(' ').map(n => n[0]).join('');

  // Mobile sidebar user info
  const mobileUser = $('#sidebar-username-mobile');
  const mobileRole = $('#sidebar-role-mobile');
  const mobileAvatar = $('#sidebar-avatar-mobile');
  if (mobileUser) mobileUser.textContent = POS.user.name;
  if (mobileRole) mobileRole.textContent = POS.user.role;
  if (mobileAvatar) mobileAvatar.textContent = POS.user.name.split(' ').map(n => n[0]).join('');

  // Init sub-modules & show skeleton loading states while fetching initial store data
  startClock();
  applyModuleAccess();
  initCashDrawer();
  renderPosSkeletons();
  initTools();
  initMobileSidebar();
  const minDelay = navigator.webdriver ? Promise.resolve() : new Promise(r => setTimeout(r, 340));
  const perms = POS.user?.permissions || {};
  const tasks = [
    perms.view_menu || perms.access_terminal ? loadMenuItems() : Promise.resolve([]),
    perms.view_addons || perms.access_terminal ? loadAddOns() : Promise.resolve([]),
    loadPosSettings(),
    loadBranches(),
    perms.access_terminal && loadStoreStatus(),
    perms.view_supplies || perms.view_menu || perms.view_addons ? loadSupplies() : Promise.resolve([]),
  ];
  if (perms.access_cash_drawer || perms.view_analytics) tasks.push(loadCashLogs());
  const loaded = await Promise.allSettled(tasks);
  loaded.filter(result => result.status === 'rejected')
    .forEach(result => showToast(result.reason.message, 'error'));

  // Recipes depend on the menu item IDs returned above.
  if (POS_MENU.length && perms.view_menu) {
    try {
      await loadRecipes();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
  await minDelay;

  ['#reg-grid', '#kanban-board', '#recipe-list', '#supplies-table-body', '#addons-table-body'].forEach(sel => {
    $(sel)?.removeAttribute('aria-busy');
  });

  applyPosSettings();
  if (typeof renderSettingsForm === 'function') renderSettingsForm();
  POS.orders = [];
  renderOrders();
  initAnalytics();
  initMenuRecipes();
  renderBranchOptions();
  renderRegisterGrid();
  if (perms.view_addons || perms.access_terminal) initAddOns();
  syncPosOrders();

  if (typeof initQmodsimLab === 'function') initQmodsimLab();

  // Register view picks up the now-populated POS.orders (for its ticket number).
  if (typeof renderRegisterCart === 'function') renderRegisterCart();

  showToast(`Welcome, ${POS.user.name}!`, 'success');
}

/* ═══════════════════════════════════════════
   SIDEBAR NAVIGATION
   ═══════════════════════════════════════════ */

function initSidebar() {
  $$('.sidebar-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
      closeSidebar();
    });
  });
}

const GATED_VIEWS = {
  register: 'access_terminal', orders: 'view_orders', analytics: 'view_analytics',
  'menu-recipes': 'view_menu', 'add-ons': 'view_addons', supplies: 'view_supplies', tools: 'view_tools',
};

function permitted(key) {
  return POS.user?.permissions?.[key] === true;
}

function canViewModule(view) {
  if (view === 'offline') return permitted('access_terminal');
  if (offlinePOS.offline && !['orders', 'register'].includes(view)) return false;
  if (offlinePOS.offline && view === 'orders' && !offlinePOS.ready) return false;
  if (view === 'qmodsim') return Boolean(POS.user);
  return permitted(GATED_VIEWS[view]);
}

function applyModuleAccess() {
  document.body.dataset.permissions = Object.keys(POS.user?.permissions || {}).filter(permitted).join(' ');
  const buttons = Array.from($$('.sidebar-item[data-view]'));
  buttons.forEach(btn => btn.classList.toggle('hidden', !canViewModule(btn.dataset.view)));
  if (!canViewModule(POS.currentView)) {
    const first = buttons.find(btn => canViewModule(btn.dataset.view));
    if (first) switchView(first.dataset.view);
    else {
      POS.currentView = null;
      $$('.view-section').forEach(section => section.classList.add('hidden'));
      $('#view-title').textContent = 'No authorized POS features';
    }
  }
}

async function refreshPermissionViews(previous) {
  const lost = key => previous[key] && !permitted(key);
  const dialogs = {
    view_orders: ['order-detail-modal', 'void-modal'], manage_orders: ['void-modal'], void_orders: ['void-modal'],
    access_cash_drawer: ['cash-drawer-modal'], access_terminal: ['item-customization-modal', 'tender-modal', 'receipt-modal'],
    view_supplies: ['supply-history-modal', 'supplies-modal'], edit_supplies: ['supplies-modal'],
  };
  for (const [key, ids] of Object.entries(dialogs)) if (lost(key)) ids.forEach(closeModal);
  if (lost('view_menu') || lost('edit_menu') || lost('edit_supplies') || lost('view_supplies')) cancelDeleteConfirm();
  if (lost('edit_addons') || lost('view_addons')) hideAddOnForm();
  if (lost('view_orders') || lost('manage_orders')) $('#offline-review').replaceChildren();
  if (!permitted('view_orders')) {
    orderRevision++;
    lastOrdersSignature = '';
    POS.orders = [];
  }
  if (!permitted('view_analytics')) { analyticsOrders = []; analyticsItems = null; }
  if (!permitted('access_terminal') && previous.access_terminal) {
    POS_REGISTER.lines = [];
    renderRegisterCart();
  }
  if (!permitted('view_supplies')) SUPPLIES = [];
  if (!permitted('view_menu')) Object.keys(RECIPES).forEach(id => delete RECIPES[id]);
  if (!permitted('view_menu') && !permitted('access_terminal')) POS_MENU = [];
  if (!permitted('view_addons') && !permitted('access_terminal')) ADD_ONS = [];
  renderOrders();
  const detail = $('#order-detail-modal');
  if (detail.classList.contains('open')) openOrderDetail(detail.dataset.ticket);
  syncPosOrders();
  if (offlinePOS.offline) return;
  const gained = key => permitted(key) && !previous[key];
  if (gained('access_terminal') || gained('view_menu') || (lost('view_menu') && permitted('access_terminal'))) await loadMenuItems();
  if (gained('access_terminal') || gained('view_addons') || (lost('view_addons') && permitted('access_terminal'))) await loadAddOns();
  if (gained('view_menu')) await loadRecipes();
  if (gained('view_supplies') || gained('view_menu') || gained('view_addons') ||
      (lost('view_supplies') && (permitted('view_menu') || permitted('view_addons')))) await loadSupplies();
  if (gained('access_terminal')) await loadStoreStatus();
  if (permitted('view_menu') && (gained('view_menu') || gained('edit_menu') || lost('edit_menu') || gained('view_supplies') || lost('view_supplies'))) {
    recipeIngredientId ||= firstLiveMenuId();
    renderRecipeList();
    renderRecipeDetail();
  }
  if (gained('view_tools') || gained('edit_tools') || lost('edit_tools') || gained('edit_menu') || lost('edit_menu')) renderSettingsForm();
  renderRegisterGrid();
  renderAddOnsManagement();
  renderSuppliesTable();
  if (POS.currentView === 'analytics') await renderAnalytics();
}

function switchView(view) {
  if (!canViewModule(view)) return;
  POS.currentView = view;

  // Update sidebar active state
  $$('.sidebar-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));

  // Show/hide view sections
  $$('.view-section').forEach(s => s.classList.add('hidden'));
  const target = $(`#view-${view}`);
  if (target) target.classList.remove('hidden');

  // Update header title
  const titles = { qmodsim: 'QMODSIM Lab', offline: 'Offline Mode', register: 'Register', orders: 'Orders', analytics: 'Analytics', 'menu-recipes': 'Menu & Recipes', 'add-ons': 'Add-ons Management', supplies: 'Supplies Management', tools: 'Tools' };
  $('#view-title').textContent = titles[view] || view;

  // Refresh visualizations whenever their view is opened
  if (view === 'qmodsim') renderQmodsimLab();
  if (view === 'analytics' && typeof renderAnalytics === 'function') renderAnalytics();
  if (view === 'tools' && typeof renderSettingsForm === 'function') renderSettingsForm();
  if (view === 'supplies') refreshSupplies();
}

/* ═══════════════════════════════════════════
   MOBILE SIDEBAR TOGGLE
   ═══════════════════════════════════════════ */

function initMobileSidebar() {
  const hamburger = $('#btn-hamburger');
  const overlay = $('#sidebar-overlay');

  if (hamburger) {
    hamburger.addEventListener('click', openSidebar);
  }

  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });
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
   STORE OPEN / CLOSE TOGGLE
   ═══════════════════════════════════════════ */

function renderStoreToggle() {
  const btn = $('#btn-store-toggle');
  const label = $('#store-label');
  if (!btn || !label) return;
  btn.classList.toggle('open', POS.storeOpen);
  btn.classList.toggle('closed', !POS.storeOpen);
  label.textContent = POS.storeOpen ? 'Open' : 'Closed';
  label.classList.toggle('text-crema', POS.storeOpen);
  label.classList.toggle('text-red-700', !POS.storeOpen);
}

/** The store state lives on the server, so the customer app and every POS see the same value. */
async function loadStoreStatus() {
  const res = await fetch('/api/store', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Store status could not be loaded (${res.status})`);
  POS.storeOpen = (await res.json()).open;
  renderStoreToggle();
}

function initStoreToggle() {
  $('#btn-store-toggle').addEventListener('click', async () => {
    const res = await fetch('/api/store', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open: !POS.storeOpen }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      showToast(data?.error || 'Store status could not be changed', 'error');
      return;
    }
    POS.storeOpen = data.open;
    renderStoreToggle();
    if (POS.storeOpen) showToast('Store is now OPEN', 'success');
    else showToast('Store is now CLOSED — customer app locked', 'error');
  });
}

/* ═══════════════════════════════════════════
   MODAL HELPERS
   ═══════════════════════════════════════════ */

function openModal(id) { $(`#${id}`)?.classList.add('open'); }
function closeModal(id) { $(`#${id}`)?.classList.remove('open'); }

/* ═══════════════════════════════════════════
   CASH DRAWER (Pay In / Pay Out + Blind Shift Close)
   ═══════════════════════════════════════════ */

function initCashDrawer() {
  $('#btn-cash-drawer')?.addEventListener('click', openCashDrawer);
  $('#btn-cash-drawer-cancel')?.addEventListener('click', closeCashDrawer);
  $('#btn-cash-drawer-cancel2')?.addEventListener('click', closeCashDrawer);
  $('#btn-cash-drawer-save')?.addEventListener('click', saveCashDrawer);
  $('#btn-blind-close-save')?.addEventListener('click', submitBlindShiftClose);
  $('#cash-drawer-modal')?.addEventListener('click', (e) => { if (e.target.id === 'cash-drawer-modal') closeCashDrawer(); });
}

function openCashDrawer() {
  if (!permitted('access_cash_drawer') || offlinePOS.offline) return;
  $('#cd-type').value = 'payIn';
  $('#cd-amount').value = '';
  $('#cd-reason').value = '';
  const blindCounted = $('#cd-blind-counted');
  const blindNotes = $('#cd-blind-notes');
  const blindResult = $('#cd-blind-result');
  if (blindCounted) blindCounted.value = '';
  if (blindNotes) blindNotes.value = '';
  if (blindResult) blindResult.classList.add('hidden');
  openModal('cash-drawer-modal');
  $('#cd-amount')?.focus();
}

function closeCashDrawer() {
  closeModal('cash-drawer-modal');
}

async function saveCashDrawer() {
  const type = $('#cd-type').value;
  const amount = parseFloat($('#cd-amount').value) || 0;
  const reason = $('#cd-reason').value.trim();

  if (amount <= 0) { showToast('Please enter an amount greater than 0', 'error'); return; }
  if (!reason) { showToast('Please enter a reason', 'error'); return; }

  try {
    const log = await fetchJson('/api/cash-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, amount, reason }),
    });
    CASH_LOGS.unshift({
      id: log.id,
      type: log.type,
      amount: Number(log.amount),
      reason: log.reason,
      timestamp: log.createdAt,
    });

    closeCashDrawer();
    if (typeof renderAnalytics === 'function') renderAnalytics();
    const label = type === 'payIn' ? 'Pay In' : 'Pay Out';
    showToast(`${label} of ₱${amount.toFixed(2)} recorded — ${reason}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * QMODSIM Module 4 (FAIR Risk Control): Blind Shift Drawer Reconciliation.
 * The cashier submits their physical cash count without seeing the expected system total first.
 */
async function submitBlindShiftClose() {
  const countedVal = parseFloat($('#cd-blind-counted')?.value);
  const notes = ($('#cd-blind-notes')?.value || '').trim();
  if (!Number.isFinite(countedVal) || countedVal < 0) {
    showToast('Enter the physical counted cash amount (₱0.00 or more)', 'error');
    return;
  }

  try {
    const recon = await fetchJson('/api/cash-logs/blind-close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countedCash: countedVal, notes }),
    });
    const resBox = $('#cd-blind-result');
    if (resBox) {
      const diff = Number(recon.discrepancy) || 0;
      const statusLabel = diff === 0
        ? 'EXACT MATCH (₱0.00 variance)'
        : diff < 0
          ? `SHORTAGE (−₱${Math.abs(diff).toFixed(2)})`
          : `OVERAGE (+₱${diff.toFixed(2)})`;
      resBox.className = `mt-3 p-3 rounded-lg border text-xs ${
        diff < 0 ? 'bg-red-50 border-red-200 text-red-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'
      }`;
      resBox.innerHTML = `
        <p class="font-bold mb-1">Blind Shift Reconciliation Recorded</p>
        <div class="grid grid-cols-3 gap-2 tabular-nums">
          <div><span class="block text-[10px] opacity-75">Physical Counted</span><strong>₱${Number(recon.countedCash).toFixed(2)}</strong></div>
          <div><span class="block text-[10px] opacity-75">System Expected</span><strong>₱${Number(recon.expectedCash).toFixed(2)}</strong></div>
          <div><span class="block text-[10px] opacity-75">Discrepancy</span><strong>${statusLabel}</strong></div>
        </div>
      `;
      resBox.classList.remove('hidden');
    }
    showToast('Blind shift reconciliation logged to FAIR audit trail.', 'success');
    if (typeof refreshQmodsimTelemetry === 'function') refreshQmodsimTelemetry();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ═══════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  window.TAGAK_AUTH.ready.then(session => {
    if (!session) return;
    POS.user = session.user;
    window.TAGAK_AUTH.bindLogout('#btn-logout');
    window.TAGAK_AUTH.authorizeFetch();
    initSidebar();
    initStoreToggle();
    (async () => {
      if (offlinePOS.offline) {
        $('#app-layout').classList.remove('hidden');
        $('#header-cashier').textContent=POS.user.name;
        initMobileSidebar(); startClock();
      } else {
        await enterApp();
        enableQrCheckout();
      }
      await offlinePOS.start(POS.user);
    })().catch(error=>showToast(error.message,'error'));
  });
});
