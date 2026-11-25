/**
 * File: orders.js
 * Path: pos-app/js/orders.js
 * Description: Order management module for the POS.
 *              Renders the Kanban board with Queued / Brewing / Ready / Completed
 *              columns, supports DTMC Held (S0) and Refunded (S6) transitions,
 *              Game Theory Manager PIN Void/Refund Authorization & Spot Audits,
 *              and merges locally queued offline orders.
 */

/* ═══════════════════════════════════════════
   SEARCH STATE & GAME THEORY AUDIT STATE
   ═══════════════════════════════════════════ */

const columnSearchTerms = {};
let voidActionMode = 'cancelled'; // 'cancelled' (S5 Void) or 'refunded' (S6 Refund)
let spotAuditRequired = false;

/* ═══════════════════════════════════════════
   SERVER ORDER SYNC
   ═══════════════════════════════════════════ */

function orderTemperatureLabel(value) {
  if (!value) return '';
  if (value === 'iced') return 'Iced';
  if (value === 'hot') return 'Hot';
  return String(value);
}

function orderModeLabel(mode) {
  return mode === 'takeout' ? 'Take-Out' : 'Dine-In';
}

/** Normalize a server order into the shape the POS board already renders. */
function mapPosOrder(order) {
  return {
    ...order,
    id: order.ticketNo,
    trackingToken: order.trackingToken,
    items: (order.items || []).map(item => ({
      ...item,
      size: item.size || '-',
      instructions: item.instructions || '',
    })),
  };
}

function canManageOrders() {
  return Boolean(POS.user?.permissions?.manage_orders);
}

let lastOrdersSignature = '';
let orderRevision = 0;
const syncPosOrders = watchOrderChanges(
  () => !offlinePOS.offline && POS.user?.permissions?.view_orders && '/api/orders/events',
  async () => {
    const ordersOk = await loadOrders();
    const suppliesOk = await refreshSupplies();
    return ordersOk && suppliesOk;
  });


const dayMs = 24 * 60 * 60 * 1000;
const philippineOffsetMs = 8 * 60 * 60 * 1000;
function posDayStart(now = Date.now()) {
  return Math.floor((now + philippineOffsetMs) / dayMs) * dayMs - philippineOffsetMs;
}

function terminalOrder(order) {
  return order.status === 'completed' || order.status === 'cancelled';
}

let boardDay = posDayStart();
let midnightTimer;
function checkBoardDay() {
  clearTimeout(midnightTimer);
  const today = posDayStart();
  midnightTimer = setTimeout(checkBoardDay, Math.max(1, today + dayMs - Date.now()));
  if (today === boardDay) return;
  boardDay = today;
  renderOrders();
  if (permitted('view_orders') && !offlinePOS.offline) void loadOrders();
}
window.addEventListener('pageshow', checkBoardDay);
window.addEventListener('focus', checkBoardDay);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBoardDay(); });

async function loadOrders() {
  const revision = ++orderRevision;
  try {
    const start = posDayStart();
    const day = new Date(start + philippineOffsetMs).toISOString().slice(0, 10);
    const [recent, daily] = await Promise.all([
      fetchJson('/api/orders'),
      fetchJson('/api/orders?from=' + day + '&to=' + day),
    ]);
    const terminal = daily.filter(terminalOrder);
    const terminalTickets = new Set(terminal.map(row => row.ticketNo));
    const orders = recent.filter(row => !terminalOrder(row) && !terminalTickets.has(row.ticketNo))
      .concat(terminal).map(mapPosOrder);
    const signature = JSON.stringify(orders.map(order => [order.ticketNo, order.status, order.paymentStatus, order.timeOut, order.customerName, order.orderMode]));
    if (revision !== orderRevision) return false;
    if (offlinePOS.offline) return false;
    if (start !== posDayStart()) return false;
    POS.orders = offlinePOS.merge(orders);
    if (signature !== lastOrdersSignature) {
      lastOrdersSignature = signature;
      renderOrders();
      const detail = $('#order-detail-modal');
      if (detail.classList.contains('open')) openOrderDetail(detail.dataset.ticket);
      if (POS.currentView === 'analytics') renderAnalytics();
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function setOrderStatus(id, newStatus, extraBody = {}) {
  if (offlinePOS.offline || POS.orders.find(o=>o.id===id)?.localId) {
    try{return await offlinePOS.advance(id,newStatus);}catch(error){showToast(error.message,'error');return null;}
  }
  const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus, ...extraBody }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    showToast(data?.error || 'Order could not be updated', 'error');
    return null;
  }
  orderRevision++;
  const order = mapPosOrder(data);
  const index = POS.orders.findIndex(candidate => candidate.id === id);
  if (index >= 0) POS.orders[index] = order;
  else POS.orders.unshift(order);
  renderOrders();
  if (POS.currentView === 'analytics') renderAnalytics();
  if (typeof refreshQmodsimTelemetry === 'function') refreshQmodsimTelemetry();
  return order;
}

function filterColumnCards(column) {
  const query = (columnSearchTerms[column.dataset.column] || '').toLowerCase();
  column.querySelectorAll('.order-card').forEach(card => {
    const id = (card.dataset.orderId || '').toLowerCase();
    const name = (card.dataset.customerName || '').toLowerCase();
    card.classList.toggle('hidden', query !== '' && !id.includes(query) && !name.includes(query));
  });
}

/* ═══════════════════════════════════════════
   RENDER ORDERS
   ═══════════════════════════════════════════ */

function renderOrders() {
  const board = $('#kanban-board');
  if (!board) return;

  const activeOrders = POS.orders.filter(o => o.status !== 'cancelled' && o.status !== 'void' && o.status !== 'refunded');
  const oldestFirst = (a, b) => new Date(a.timeIn) - new Date(b.timeIn);
  const isPending = order => order.status === 'queued' && order.paymentStatus === 'unpaid';
  const pending = activeOrders.filter(isPending).sort(oldestFirst);
  const queued = activeOrders.filter(o => o.status === 'held' || (o.status === 'queued' && !isPending(o))).sort(oldestFirst);
  const start = posDayStart();
  const todaysTerminal = POS.orders.filter(order => {
    const time = Date.parse(order.timeOut);
    return terminalOrder(order) && time >= start && time < start + dayMs;
  });
  const voided = todaysTerminal.filter(o => o.status === 'cancelled')
    .sort((a, b) => Date.parse(b.timeOut) - Date.parse(a.timeOut));
  const brewing   = activeOrders.filter(o => o.status === 'brewing').sort(oldestFirst);
  const ready     = activeOrders.filter(o => o.status === 'ready').sort(oldestFirst);
  const completed = todaysTerminal.filter(o => o.status === 'completed');

  // Update count badge
  const activeCount = pending.length + queued.length + brewing.length + ready.length;
  const badge = $('#order-count-badge');
  if (badge) {
    badge.textContent = `${activeCount} active`;
    badge.className = `badge ${activeCount > 0 ? 'badge-queued' : 'badge-completed'}`;
  }

  board.innerHTML = `
    ${renderColumn('Pending Payment', 'pending', pending, 'var(--bg-subtle)', 'var(--roast)')}
    ${renderColumn('Queued', 'queued', queued, 'var(--bg-subtle)', 'var(--crema)')}
    ${renderColumn('Brewing', 'brewing', brewing, 'var(--bg-subtle)', 'var(--roast)')}
    ${renderColumn('Ready', 'ready', ready, 'var(--bg-subtle)', 'var(--ink)')}
    ${renderColumn('Completed', 'completed', completed, 'var(--bg-subtle)', 'var(--ink-secondary)')}
    ${renderColumn('Voided', 'voided', voided, 'var(--bg-subtle)', 'var(--ink-secondary)')}
  `;

  bindOrderEvents();
}

function renderColumn(title, status, orders, bgColor, textColor) {
  return `
    <div class="kanban-column">
      <div class="kanban-header" style="background:${bgColor}; color:${textColor}">
        <span>${title}</span>
        <span class="kanban-header-count tabular-nums">${orders.length}</span>
      </div>
      <div class="kanban-search-row">
        <input type="text" class="column-search-input" placeholder="Search order ID or name..." aria-label="Search ${title} orders by ID or customer name"
               data-column="${status}" value="${escapeOrderText(columnSearchTerms[status] || '')}">
      </div>
      <div class="kanban-list">
        ${orders.length === 0 ? '<div class="empty-state text-xs py-8">No orders</div>' : ''}
        ${orders.map(o => renderOrderCard(o)).join('')}
      </div>
    </div>
  `;
}

function renderOrderCard(order) {
  const timeIn = new Date(order.timeIn);
  const elapsed = Math.round((Date.now() - timeIn.getTime()) / 60000);
  const timeStr = timeIn.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });

  const hasInstructions = order.items.some(i => i.instructions);
  const customerName = order.customerName || '';
  const modeLabel = orderModeLabel(order.orderMode);
  const channelBadge = order.channel === 'mobile'
    ? '<span class="order-mode-pill" title="Mobile Web Self-Order (Module 6)">Mobile</span>'
    : '';
  const offlineBadge = order.offlineQueued
    ? '<span class="order-mode-pill" style="background:#FEF3C7;color:#92400E" title="Signed Local Offline Queue (Module 12)">Offline Signed</span>'
    : '';

  return `
    <div class="order-card cursor-pointer" data-order-id="${escapeOrderText(order.id)}" data-customer-name="${escapeOrderText(customerName)}" data-order-mode="${escapeOrderText(order.orderMode || 'dine-in')}">
      <div class="flex items-center justify-between mb-1.5">
        <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
          <span class="font-bold text-sm text-text-dark tabular-nums">${escapeOrderText(order.id)}</span>
          <span class="order-mode-pill">${escapeOrderText(modeLabel)}</span>
          ${channelBadge}
          ${offlineBadge}
        </div>
        <span class="badge badge-${order.status === 'held' ? 'queued' : order.status}">${order.status === 'cancelled' ? 'Voided' : order.paymentStatus === 'unpaid' && order.status === 'queued' ? 'Pending Payment' : order.status}</span>
      </div>
      ${order.payment === 'cash' ? `<p class="text-xs">${escapeOrderText(cashLabel(order))}</p>` : ''}
      ${customerName ? `
      <div class="order-claim-name mb-2" title="Customer nickname — confirm before handing over">
        <span class="order-claim-label">For</span>
        <span class="order-claim-value">${escapeOrderText(customerName)}</span>
      </div>` : ''}
      <div class="space-y-0.5 mb-2">
        ${order.items.map(i => {
          const meta = [orderTemperatureLabel(i.temperature), i.size !== '-' ? i.size : ''].filter(Boolean).join(', ');
          return `
          <p class="text-xs text-slate-700 truncate">${escapeOrderText(i.qty)}x ${escapeOrderText(i.name)}${meta ? ' (' + escapeOrderText(meta) + ')' : ''}</p>
        `;
        }).join('')}
      </div>
      ${hasInstructions ? `<p class="text-[11px] text-roast mb-1.5 italic">Note: ${order.items.filter(i => i.instructions).map(i => escapeOrderText(i.instructions)).join('; ')}</p>` : ''}
      <div class="flex items-center justify-between pt-1 border-t border-slate-100">
        <span class="text-[11px] text-slate-600 tabular-nums">${order.status === 'cancelled' ? (order.timeOut ? 'Voided · ' + new Date(order.timeOut).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'Void time unavailable') : `${timeStr} · ${elapsed}m ago`}</span>
        <span class="text-xs font-bold text-text-dark tabular-nums">\u20B1${order.total.toLocaleString()}</span>
      </div>
      <div class="flex gap-1.5 mt-2.5 flex-wrap">
        ${renderOrderActions(order)}
      </div>
    </div>
  `;
}

function cashLabel(order) {
  if (order.cashExpired) return 'Voided · Cash payment timed out';
  if (order.paymentStatus === 'paid' || order.localId) {
    const time = order.cashCollectedAt && new Date(order.cashCollectedAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
    return ['Paid by cash', order.cashCollectorName, time].filter(Boolean).join(' · ');
  }
  if (order.paymentStatus === 'unpaid') return order.status === 'cancelled' ? 'Cash not collected' : 'Awaiting cash · ₱' + Number(order.total).toFixed(2) + ' due';
  return 'Cash collection unverified · Check register records';
}

function renderOrderActions(order) {
  const local=!!order.localId;
  if (offlinePOS.offline && !local) return '';
  if (!local && order.payment === 'cash' && order.paymentStatus !== 'paid' && !['held','completed','cancelled'].includes(order.status)) {
    const id = escapeOrderText(order.id);
    const collect = ['Cashier','Manager'].includes(POS.user?.role) && permitted('access_terminal')
      ? `<button class="btn btn-primary btn-xs act-collect" data-id="${id}">Confirm cash received</button>` : '';
    const cancel = canManageOrders() && permitted('void_orders')
      ? `<button class="btn btn-void btn-xs act-void" data-id="${id}">Void</button>` : '';
    return collect + cancel;
  }
  if (!canManageOrders() && !(local && POS.user?.permissions?.fulfill_own_offline_orders)) return '';
  let btns = '';
  const safeId = escapeOrderText(order.id);

  if (order.status === 'held') {
    btns += `<button class="btn btn-secondary btn-xs act-queue" data-id="${safeId}">Queue Order</button>`;
    if (permitted('void_orders')) btns += `<button class="btn btn-void btn-xs act-void" data-id="${safeId}">Void</button>`;
  }
  if (order.status === 'queued') {
    btns += `<button class="btn btn-secondary btn-xs act-brew" data-id="${safeId}">Start Brewing</button>`;
  }
  if (order.status === 'brewing') {
    btns += `<button class="btn btn-primary btn-xs act-ready" data-id="${safeId}">Mark Ready</button>`;
    if (!local && permitted('void_orders')) btns += `<button class="btn btn-void btn-xs act-void" data-id="${safeId}">Void</button>`;
  }
  if (order.status === 'ready') {
    btns += `<button class="btn btn-secondary btn-xs act-complete" data-id="${safeId}">Complete</button>`;
  }
  if (!local && permitted('void_orders') && order.status === 'queued') {
    btns += `<button class="btn btn-void btn-xs act-void" data-id="${safeId}">Void</button>`;
  }

  if (!local && permitted('void_orders') && order.payment === 'cash' && order.status === 'completed') btns += `<button class="btn btn-ghost btn-xs act-refund" data-id="${safeId}">Refund</button>`;
  return btns;
}

/* ═══════════════════════════════════════════
   ORDER ACTIONS
   ═══════════════════════════════════════════ */

let voidTarget = null;

function escapeOrderText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openVoidOrRefundModal(orderId, mode = 'cancelled') {
  voidTarget = orderId;
  voidActionMode = mode;
  const order = POS.orders.find(o => o.id === voidTarget);

  const titleEl = $('#void-modal-title');
  if (titleEl) titleEl.textContent = mode === 'refunded' ? 'Refund Completed Order (S6)' : 'Void Order (S5)';

  const confirmBtn = $('#btn-void-confirm');
  if (confirmBtn) confirmBtn.textContent = mode === 'refunded' ? 'Confirm Refund' : 'Yes, Void Order';

  $('#void-modal-order-id').textContent = order
    ? `${order.id}${order.customerName ? ` (${order.customerName})` : ''} — \u20B1${order.total.toLocaleString()}`
    : '';

  const reasonInput = $('#void-reason-input');
  if (reasonInput) reasonInput.value = '';
  const pinInput = $('#void-manager-pin');
  if (pinInput) pinInput.value = '';

  // QMODSIM Module 7: Game Theory Mixed-Strategy Nash Equilibrium Spot-Audit Check
  const sigmaM = typeof window.QMODSIM_AUDIT_THRESHOLD === 'number' ? window.QMODSIM_AUDIT_THRESHOLD : 0.1667;
  spotAuditRequired = Math.random() < sigmaM;
  const auditBanner = $('#void-spot-audit-banner');
  if (auditBanner) {
    auditBanner.classList.toggle('hidden', !spotAuditRequired);
    const pctSpan = $('#void-spot-audit-pct');
    if (pctSpan) pctSpan.textContent = `${(sigmaM * 100).toFixed(1)}%`;
  }

  openModal('void-modal');
}

function bindOrderEvents() {
  // Card click → detail modal
  $$('.order-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn')) return;
      openOrderDetail(card.dataset.orderId);
    });
  });

  // Held -> Queued (DTMC S0 -> S1)
  $$('.act-queue').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateOrderStatus(btn.dataset.id, 'queued');
    });
  });

  $$('.act-collect').forEach(button => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const response = await fetch('/api/orders/' + encodeURIComponent(button.dataset.id) + '/collect-cash', { method: 'POST' });
        if (!response.ok) throw new Error((await response.json()).error);
        await loadOrders();
        showToast('Cash collection confirmed', 'success');
      } catch (err) {
        showToast(err.message || 'Check the ticket before retrying', 'error');
      } finally { button.disabled = false; }
    });
  });

  // Brew
  $$('.act-brew').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateOrderStatus(btn.dataset.id, 'brewing');
    });
  });

  // Mark Ready
  $$('.act-ready').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateOrderStatus(btn.dataset.id, 'ready');
    });
  });

  // Complete
  $$('.act-complete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      completeOrder(btn.dataset.id);
    });
  });

  // Void (DTMC S5)
  $$('.act-void').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openVoidOrRefundModal(btn.dataset.id, 'cancelled');
    });
  });

  // Refund (DTMC S6)
  $$('.act-refund').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openVoidOrRefundModal(btn.dataset.id, 'refunded');
    });
  });
}

async function updateOrderStatus(id, newStatus) {
  const updated = await setOrderStatus(id, newStatus);
  if (!updated) return;
  const labels = { queued: 'Moved to Queue', brewing: 'Now brewing', ready: 'Ready for pickup', completed: 'Completed' };
  showToast(`${id} → ${labels[newStatus] || newStatus}`, 'success');
}

async function completeOrder(id) {
  const updated = await setOrderStatus(id, 'completed');
  if (updated) showToast(`${id} completed`, 'success');
}

async function voidOrder(id, status = 'cancelled', extra = {}) {
  const updated = await setOrderStatus(id, status, extra);
  if (updated) {
    showToast(
      status === 'refunded' ? `${id} has been refunded (stock restored)` : `${id} has been voided`,
      status === 'refunded' ? 'warning' : 'error',
    );
  }
}

/* ═══════════════════════════════════════════
   ORDER DETAIL MODAL
   ═══════════════════════════════════════════ */

function openOrderDetail(id) {
  if (!canViewModule('orders')) return;
  const order = POS.orders.find(o => o.id === id);
  if (!order) return;
  $('#order-detail-modal').dataset.ticket = id;

  $('#detail-order-id').textContent = `Order ${order.id}`;
  const customerName = order.customerName || '';
  $('#detail-customer-name').textContent = customerName;
  $('#detail-customer').classList.toggle('hidden', !customerName);
  const paymentLabel = order.payment === 'qr' ? 'QR Payment (GCash/Maya)' : cashLabel(order);
  $('#detail-payment').textContent = `${orderModeLabel(order.orderMode)} • ${paymentLabel}`;
  $('#detail-total').textContent = `\u20B1${order.total.toLocaleString()}`;

  $('#detail-items').innerHTML = order.items.map(i => {
    const details = [
      orderTemperatureLabel(i.temperature),
      i.size !== '-' ? i.size : '',
      ...(i.addOns || []).map(addOn => addOn.name),
      i.instructions,
    ].filter(Boolean).join(' • ');
    const amount = (Number(i.unitPrice) + Number(i.addOnPrice || 0)) * i.qty;
    return `
    <div class="flex justify-between items-start py-2 border-b border-slate-200/80 last:border-0">
      <div>
        <p class="text-sm font-semibold text-text-dark">${escapeOrderText(i.qty)}x ${escapeOrderText(i.name)}</p>
        <p class="text-xs text-slate-600">${details ? escapeOrderText(details) : ''}</p>
      </div>
      <span class="text-sm font-semibold text-text-dark tabular-nums">\u20B1${amount.toLocaleString()}</span>
    </div>
  `;
  }).join('');

  const timeIn = new Date(order.timeIn);
  $('#detail-actions').innerHTML = `
    <span class="text-xs text-slate-600 tabular-nums mr-auto">In: ${timeIn.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })}${order.timeOut ? ' | Out: ' + new Date(order.timeOut).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }) : ''}</span>
    ${!order.localId && permitted('void_orders') && canManageOrders() && order.status !== 'completed' && order.status !== 'cancelled' && order.status !== 'void' ? `<button class="btn btn-void btn-sm" data-void-order>Void</button>` : ''}
  `;

  $('#detail-actions [data-void-order]')?.addEventListener('click', () => {
    openVoidOrRefundModal(order.id, 'cancelled');
  });
  openModal('order-detail-modal');
}

/* ═══════════════════════════════════════════
   MODAL WIRING
   ═══════════════════════════════════════════ */

function initOrderModals() {
  // Void / Refund modal
  $('#btn-void-cancel').addEventListener('click', () => { voidTarget = null; closeModal('void-modal'); });
  $('#btn-void-confirm').addEventListener('click', () => {
    if (voidTarget) {
      const voidReason = ($('#void-reason-input')?.value || '').trim();
      const managerPin = ($('#void-manager-pin')?.value || '').trim();
      voidOrder(voidTarget, voidActionMode, {
        voidReason,
        managerPin,
        spotAuditTriggered: spotAuditRequired,
      });
    }
    voidTarget = null;
    closeModal('void-modal');
  });

  // Detail modal
  $('#btn-close-detail').addEventListener('click', () => closeModal('order-detail-modal'));

  // Close modals on backdrop click
  $$('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('open');
        voidTarget = null;
      }
    });
  });

}

/* ═══════════════════════════════════════════
   OVERRIDE renderOrders to also init modals + scroll hints
   ═══════════════════════════════════════════ */

const _originalRenderOrders = renderOrders;
renderOrders = function() {
  _originalRenderOrders();
  // Re-apply active search filters after re-render
  $$('.kanban-column').forEach(col => {
    const input = col.querySelector('.column-search-input');
    if (input) input.value = columnSearchTerms[col.dataset.column] || '';
    filterColumnCards(col);
  });
  initKanbanScrollHints();
};

// One-time delegated listener for column search inputs (survives innerHTML rebuilds)
$('#kanban-board')?.addEventListener('input', (e) => {
  if (!e.target.classList.contains('column-search-input')) return;
  const column = e.target.closest('.kanban-column');
  if (!column) return;
  columnSearchTerms[column.dataset.column] = e.target.value;
  filterColumnCards(column);
});

/* ═══════════════════════════════════════════
   KANBAN SCROLL HINTS (mobile)
   ═══════════════════════════════════════════ */

function initKanbanScrollHints() {
  const board = $('#kanban-board');
  const hints = $('#kanban-scroll-hints');
  if (!board || !hints) return;

  // Only bind on mobile
  if (window.innerWidth > 767) return;

  const dots = hints.querySelectorAll('.scroll-dot');
  const columns = board.querySelectorAll('.kanban-column');

  // Update active dot based on scroll position
  function updateDots() {
    const scrollLeft = board.scrollLeft;
    const colWidth = columns.length ? columns[0].offsetWidth + 12 : 1; // gap
    const activeIdx = Math.round(scrollLeft / colWidth);
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === activeIdx);
    });
  }

  board.addEventListener('scroll', updateDots, { passive: true });
  updateDots();
}

// Init modals once DOM is ready
document.addEventListener('DOMContentLoaded', initOrderModals);
