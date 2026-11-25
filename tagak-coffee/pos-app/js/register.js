/**
 * File: register.js
 * Path: pos-app/js/register.js
 * Description: Register / New Sale view — a product grid (sourced from the
 *              existing POS_MENU catalog) plus a persistent Order Summary /
 *              Cart pane, optional size pricing, payment tender, and a printed
 *              sales receipt. Completed sales are written into the existing
 *              POS.orders array.
 *
 *              ADDITIVE ONLY. This module never modifies or replaces an existing
 *              POS function, element ID, data structure, or localStorage key.
 *              It reuses existing globals: $, $$, POS_MENU, POS, showToast,
 *              openModal, closeModal, renderOrders, formatMoney, escapeAttr.
 */

/* ═══════════════════════════════════════════
   SIZE PRICING CONFIG
   ═══════════════════════════════════════════ */

const SIZE_CONFIG = {
  appliesTo: ['Drinks'],
  options: [
    { label: 'Regular', short: 'Reg', delta: 0 },
    { label: 'Large',   short: 'Lg',  delta: 0 }, // replaced by the large_upcharge setting
  ],
};

/* ═══════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════ */

const POS_REGISTER = {
  lines: [],            // [{ id, key, qty, size, temperature, customizations }]
  category: 'all',      // 'all' | 'Drinks' | 'Pastries'
  search: '',
  customerName: '',
  orderMode: 'dine-in', // 'dine-in' | 'takeout'
  payment: 'cash',      // 'cash' | 'qr'
  pwdDiscount: false,
  cashReceived: 0,
  lastReceived: 0,
  lastChange: 0,
  lastOrderMode: 'dine-in',
  paperWidth: '80mm',
  ticket: null,         // assigned by the server when the sale is saved
  lastOrder: null,      // last completed order (for receipt printing)
  customizationItem: null,
  nextLineId: 1,
  submitting: false,
};

/* ═══════════════════════════════════════════
   SERVER SETTINGS + BRANCHES
   ═══════════════════════════════════════════ */

function applyPosSettings() {
  const large = SIZE_CONFIG.options.find(option => option.label === 'Large');
  if (large) large.delta = POS_SETTINGS.largeUpcharge;
}

function renderBranchOptions() {
  const badge = $('#header-branch');
  if (!badge) return;
  const preferredId = POS.user?.branchId;
  const activeBranch = (preferredId && POS_BRANCHES.find(branch => branch.id === preferredId)) || POS_BRANCHES[0] || null;
  if (activeBranch) {
    badge.textContent = activeBranch.name;
    badge.dataset.branchId = activeBranch.id;
    badge.classList.remove('hidden');
  } else {
    badge.textContent = '';
    delete badge.dataset.branchId;
    badge.classList.add('hidden');
  }
}

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

function regItem(id) {
  return POS_MENU.find(m => m.id === id);
}

function regCatSlug(cat) {
  return 'cat-' + String(cat).toLowerCase().replace(/\s+/g, '-');
}

function regOrderModeLabel(mode) {
  if (mode === 'takeout') return 'Takeout';
  return 'Dine-in';
}

function regSizesFor(item) {
  if (!item) return [];
  if (Array.isArray(item.sizes) && item.sizes.length) return item.sizes;
  return SIZE_CONFIG.appliesTo.includes(item.category) ? SIZE_CONFIG.options : [];
}

function regEmptyCustomizations() {
  return { addOns: [], specialInstructions: [], note: '' };
}

function regCustomizationTotal(customizations = regEmptyCustomizations()) {
  return (customizations.addOns || []).reduce((sum, addOn) => sum + Number(addOn.price || 0), 0);
}

function regCustomizationKey(customizations = regEmptyCustomizations()) {
  const addOns = (customizations.addOns || []).map(a => a.id).sort();
  const instructions = (customizations.specialInstructions || []).slice().sort();
  const note = String(customizations.note || '').trim().replace(/\s+/g, ' ');
  return JSON.stringify({ addOns, instructions, note });
}

function regLineKey(id, size, customizations, temperature = null) {
  return `${id}|${size || ''}|${temperature || ''}|${regCustomizationKey(customizations)}`;
}

function regLineUnitPrice(line) {
  const it = regItem(line.id);
  if (!it) return 0;
  const opt = regSizesFor(it).find(s => s.label === line.size);
  return it.price + (opt ? opt.delta : 0) + regCustomizationTotal(line.customizations);
}

function regSubtotal() {
  return POS_REGISTER.lines.reduce((sum, line) => TagakQuote.round2(sum + regLineUnitPrice(line) * line.qty), 0);
}

function regDiscount(subtotal = regSubtotal()) {
  return POS_REGISTER.pwdDiscount ? TagakQuote.round2(subtotal * 0.20) : 0;
}

function regVat(subtotal = regSubtotal()) {
  return TagakQuote.round2((subtotal - regDiscount(subtotal)) * POS_SETTINGS.vatRate);
}

function regFinalTotal(subtotal = regSubtotal()) {
  return TagakQuote.round2(subtotal - regDiscount(subtotal) + regVat(subtotal));
}

function regItemCount() {
  return POS_REGISTER.lines.reduce((n, l) => n + l.qty, 0);
}

function regCategoryCounts() {
  const live = POS_MENU.filter(m => m.active !== false && !m.archived);
  const counts = { all: live.length, Drinks: 0, Pastries: 0 };
  live.forEach(m => { if (counts[m.category] != null) counts[m.category] += 1; });
  return counts;
}

/* ═══════════════════════════════════════════
   RENDER — PRODUCT GRID (Photo-first cards, Video 00:08–00:12)
   ═══════════════════════════════════════════ */

function regTileVisual(m) {
  const src = offlinePOS.offline ? null : m?.imgUrl;
  if (src) {
    return `<span class="reg-thumb"><img class="pos-img-loading" data-menu-name="${escapeAttr(m.name)}" data-category="${escapeAttr(m.category)}" src="${escapeAttr(src)}" alt="" loading="lazy"></span>`;
  }
  return MenuInitials.element(m.name, `reg-mono ${regCatSlug(m.category)}`).outerHTML;
}

function renderRegisterGrid() {
  const grid = $('#reg-grid');
  if (!grid) return;

  const q = POS_REGISTER.search.trim().toLowerCase();
  const cat = POS_REGISTER.category;

  const items = POS_MENU.filter(m =>
    m.active !== false && !m.archived &&
    (cat === 'all' || m.category === cat) &&
    (!q || m.name.toLowerCase().includes(q))
  );

  if (items.length === 0) {
    grid.innerHTML = `<div class="reg-no-results">No items match your search.</div>`;
  } else {
    grid.innerHTML = items.map(m => {
      const qty = POS_REGISTER.lines
        .filter(l => l.id === m.id)
        .reduce((sum, l) => sum + l.qty, 0);
      return `
        <button type="button" class="reg-tile ${qty ? 'in-cart' : ''}" data-id="${m.id}"
                aria-label="Add ${escapeAttr(m.name)} to ticket">
          <span class="reg-tile-media">
            ${regTileVisual(m)}
            <span class="reg-tile-top">
              <span class="reg-tile-cat">${escapeAttr(m.category)}</span>
              ${qty ? `<span class="reg-qty-badge">${qty}</span>` : ''}
            </span>
          </span>
          <span class="reg-tile-body">
            <span class="reg-tile-name">${escapeAttr(m.name)}</span>
            <span class="reg-tile-bottom">
              <span class="reg-tile-price">${formatMoney(m.price)}</span>
              <span class="reg-add" aria-hidden="true">+</span>
            </span>
          </span>
        </button>`;
    }).join('');
  }

  // Category chip counts + active state
  const counts = regCategoryCounts();
  $$('#reg-chips .reg-chip').forEach(chip => {
    const c = chip.dataset.cat;
    const n = chip.querySelector('.reg-chip-n');
    if (n) n.textContent = counts[c] != null ? counts[c] : '';
    chip.classList.toggle('active', c === cat);
  });
}

/* ═══════════════════════════════════════════
   RENDER — ORDER SUMMARY / CART (Video 00:20–00:23)
   ═══════════════════════════════════════════ */

function renderRegisterCart() {
  const linesEl = $('#reg-cart-lines');
  if (!linesEl) return;

  const ticketEl = $('#reg-ticket-id');
  if (ticketEl) ticketEl.textContent = POS_REGISTER.ticket ? '#' + POS_REGISTER.ticket : '#—';

  const modeTag = $('#reg-order-mode-tag');
  if (modeTag) modeTag.textContent = regOrderModeLabel(POS_REGISTER.orderMode).toUpperCase();

  $$('#reg-order-modes .reg-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.orderMode === POS_REGISTER.orderMode);
  });

  if (POS_REGISTER.lines.length === 0) {
    linesEl.innerHTML = `
      <div class="reg-empty">
        <div class="reg-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
        </div>
        <p class="reg-empty-title">No items in current order</p>
        <p class="reg-empty-sub">Tap any drink or pastry on the left to build the ticket.</p>
      </div>`;
  } else {
    linesEl.innerHTML = POS_REGISTER.lines.map(l => {
      const it = regItem(l.id);
      if (!it) return '';
      const sizes = regSizesFor(it);
      const unit = regLineUnitPrice(l);
      const customizations = l.customizations || regEmptyCustomizations();
      const addOnNames = customizations.addOns.map(a => a.name);
      const customSummary = addOnNames.concat(customizations.note ? [customizations.note] : []);
      const meta = [orderTemperatureLabel(l.temperature), l.size].filter(Boolean).join(' · ');
      const sizePills = sizes.length ? `
        <span class="reg-line-sizes" role="group" aria-label="Size">
          ${sizes.map(s => `<button type="button" class="reg-size ${l.size === s.label ? 'active' : ''}"
              data-key="${escapeAttr(l.key)}" data-size="${escapeAttr(s.label)}">${escapeAttr(s.short || s.label)}</button>`).join('')}
        </span>` : '';
      return `
        <div class="reg-line" data-key="${escapeAttr(l.key)}" data-id="${it.id}">
          <div class="reg-line-row">
            <div class="reg-line-thumb" aria-hidden="true">${regTileVisual(it)}</div>
            <div class="reg-line-main">
              <div class="reg-line-head">
                <span class="reg-line-name">${escapeAttr(it.name)}
                  <span class="reg-line-unit">${formatMoney(unit)}${meta ? ' · ' + escapeAttr(meta) : ''}</span>
                </span>
                <span class="reg-line-total">${formatMoney(unit * l.qty)}</span>
              </div>
              ${customSummary.length ? `<div class="reg-line-customizations">${customSummary.map(value => `<span>${escapeAttr(value)}</span>`).join('')}</div>` : ''}
              <div class="reg-line-foot">
                ${sizePills}
                <span class="reg-stepper">
                  <button type="button" class="reg-dec" data-key="${escapeAttr(l.key)}" aria-label="Decrease ${escapeAttr(it.name)} quantity">&minus;</button>
                  <span class="reg-q">${l.qty}</span>
                  <button type="button" class="reg-inc" data-key="${escapeAttr(l.key)}" aria-label="Increase ${escapeAttr(it.name)} quantity">+</button>
                </span>
                <button type="button" class="reg-edit-customization" data-key="${escapeAttr(l.key)}" aria-label="Edit ${escapeAttr(it.name)} customizations">Edit</button>
                <button type="button" class="reg-remove" data-key="${escapeAttr(l.key)}" aria-label="Remove ${escapeAttr(it.name)}">&times;</button>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  const sub = regSubtotal();
  const count = regItemCount();
  $('#reg-subtotal').textContent = formatMoney(sub);
  $('#reg-vat').textContent = formatMoney(regVat(sub));
  $('#reg-total').textContent = formatMoney(regFinalTotal(sub));
  $('#reg-pay-amount').textContent = formatMoney(regFinalTotal(sub));
  $('#reg-cart-count').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  $('#reg-pay').disabled = POS_REGISTER.lines.length === 0;
  const holdBtn = $('#btn-hold-order');
  if (holdBtn) holdBtn.disabled = POS_REGISTER.lines.length === 0;
}

/* ═══════════════════════════════════════════
   CART ACTIONS
   ═══════════════════════════════════════════ */

function registerAdd(id) {
  const it = regItem(id);
  if (!it) return;
  if (it.category === 'Drinks') {
    openRegisterCustomization(id);
    return;
  }
  const sizes = regSizesFor(it);
  const line = POS_REGISTER.lines.find(l => l.id === id);
  if (line) line.qty += 1;
  else {
    const customizations = regEmptyCustomizations();
    const matchKey = regLineKey(id, sizes.length ? sizes[0].label : null, customizations, null);
    POS_REGISTER.lines.push({
      id,
      key: `line-${POS_REGISTER.nextLineId++}`,
      matchKey,
      qty: 1,
      size: sizes.length ? sizes[0].label : null,
      temperature: null,
      customizations,
    });
  }
  renderRegisterGrid();
  renderRegisterCart();
}

function registerAddCustomized(id, customizations) {
  const it = regItem(id);
  if (!it) return;
  const sizes = regSizesFor(it);
  const size = customizations.size || (sizes.length ? sizes[0].label : null);
  const temperature = it.hasTemperature ? (customizations.temperature || 'hot') : null;
  const snapshot = {
    addOns: (customizations.addOns || []).map(addOn => ({ ...addOn })),
    specialInstructions: String(customizations.note || '').trim() ? [String(customizations.note || '').trim()] : [],
    note: String(customizations.note || '').trim(),
  };
  const key = regLineKey(id, size, snapshot, temperature);
  const line = POS_REGISTER.lines.find(l => l.matchKey === key);
  if (line) line.qty += 1;
  else POS_REGISTER.lines.push({
    id,
    key: `line-${POS_REGISTER.nextLineId++}`,
    matchKey: key,
    qty: 1,
    size,
    temperature,
    customizations: snapshot,
  });
  renderRegisterGrid();
  renderRegisterCart();
}

function registerUpdateCustomized(lineKey, customizations) {
  const line = POS_REGISTER.lines.find(candidate => candidate.key === lineKey);
  if (!line) return;
  const it = regItem(line.id);
  const note = String(customizations.note || '').trim();
  const snapshot = {
    addOns: (customizations.addOns || []).map(addOn => ({ ...addOn })),
    specialInstructions: note ? [note] : [],
    note,
  };
  const size = customizations.size || line.size;
  const temperature = it?.hasTemperature ? (customizations.temperature || line.temperature || 'hot') : null;
  const matchKey = regLineKey(line.id, size, snapshot, temperature);
  const existing = POS_REGISTER.lines.find(candidate => candidate.key !== lineKey && candidate.matchKey === matchKey);
  if (existing) {
    existing.qty += line.qty;
    POS_REGISTER.lines = POS_REGISTER.lines.filter(candidate => candidate.key !== lineKey);
  } else {
    line.size = size;
    line.temperature = temperature;
    line.matchKey = matchKey;
    line.customizations = snapshot;
  }
  renderRegisterGrid();
  renderRegisterCart();
}

function registerResetCustomization() {
  const item = POS_REGISTER.customizationItem;
  if (!item) return;
  const it = regItem(item.id);
  const sizes = regSizesFor(it);
  POS_REGISTER.customizationItem = {
    id: item.id,
    size: sizes.length ? sizes[0].label : null,
    temperature: it?.hasTemperature ? 'hot' : null,
    addOns: [],
    specialInstructions: [],
    note: '',
  };
}

function renderRegisterCustomization() {
  const state = POS_REGISTER.customizationItem;
  if (!state) return;
  const it = regItem(state.id);
  if (!it) return;

  // Populate left visual preview & category badge (Video 00:13–00:16)
  const visualEl = $('#customization-item-visual');
  if (visualEl) visualEl.innerHTML = regTileVisual(it);
  const catEl = $('#customization-item-cat');
  if (catEl) catEl.textContent = it.category || 'Drinks';

  const sizeOptions = $('#customization-size-options');
  const sizeSection = $('#customization-size-section');
  const sizes = regSizesFor(it);
  if (sizeSection) sizeSection.hidden = sizes.length === 0;
  if (sizeOptions) {
    sizeOptions.innerHTML = sizes.map(size => `
      <label class="reg-choice-card ${state.size === size.label ? 'active' : ''}">
        <input type="radio" name="customization-size" value="${escapeAttr(size.label)}" ${state.size === size.label ? 'checked' : ''}>
        <span>${escapeAttr(size.label)}</span>
        ${size.delta ? `<small>+${formatMoney(size.delta)}</small>` : ''}
      </label>`).join('');
  }

  const addonGroups = $('#customization-addon-groups');
  if (addonGroups) {
    const scope = it.category === 'Pastries' ? 'pastry' : 'drink';
    const addOns = getActiveAddOns(scope);
    const groups = [...new Set(addOns.map(addOn => addOn.group))];
    if (groups.length === 0) {
      addonGroups.innerHTML = `<p class="text-xs text-slate-600 italic py-2">No optional add-ons configured for this category.</p>`;
    } else {
      addonGroups.innerHTML = groups.map(group => `
        <div class="reg-addon-group">
          <div class="reg-addon-group-title">${escapeAttr(group)}</div>
          <div class="reg-customization-options reg-addon-list">
            ${addOns.filter(addOn => addOn.group === group).map(addOn => {
              const isSelected = state.addOns.some(selected => selected.id === addOn.id);
              return `
              <label class="reg-choice-card reg-addon-choice ${isSelected ? 'active' : ''}">
                <input id="custom-addon-${escapeAttr(addOn.id)}" type="checkbox" data-addon="${escapeAttr(addOn.id)}" ${isSelected ? 'checked' : ''}>
                <span>${escapeAttr(addOn.name)}</span>
                <small>+${formatMoney(addOn.price)}</small>
              </label>`;
            }).join('')}
          </div>
        </div>`).join('');
    }
  }

  const temperatureSection = $('#customization-temperature-section');
  const temperatureOptions = $('#customization-temperature-options');
  if (temperatureSection) temperatureSection.hidden = !it.hasTemperature;
  if (temperatureOptions) {
    if (it.hasTemperature && !state.temperature) state.temperature = 'hot';
    temperatureOptions.innerHTML = it.hasTemperature
      ? ['hot', 'iced'].map(value => `
        <label class="reg-choice-card ${state.temperature === value ? 'active' : ''}">
          <input type="radio" name="customization-temperature" value="${value}" ${state.temperature === value ? 'checked' : ''}>
          <span>${value === 'hot' ? 'Hot' : 'Iced'}</span>
        </label>`).join('')
      : '';
  }

  const note = $('#customization-note');
  if (note && note.value !== state.note) note.value = state.note;
  $('#customization-item-name').textContent = it.name;
  const sizeDelta = sizes.find(size => size.label === state.size)?.delta || 0;
  const addOnTotal = state.addOns.reduce((sum, addOn) => sum + addOn.price, 0);
  $('#reg-customization-total').textContent = formatMoney(it.price + sizeDelta + addOnTotal);
}

function openRegisterCustomization(id, lineKey = null) {
  const line = lineKey ? POS_REGISTER.lines.find(candidate => candidate.key === lineKey) : null;
  POS_REGISTER.customizationItem = line ? {
    id: line.id,
    lineKey,
    size: line.size,
    temperature: line.temperature || (regItem(line.id)?.hasTemperature ? 'hot' : null),
    addOns: (line.customizations?.addOns || []).map(addOn => ({ ...addOn })),
    specialInstructions: (line.customizations?.specialInstructions || []).slice(),
    note: line.customizations?.note || '',
  } : { id };
  if (!line) registerResetCustomization();
  renderRegisterCustomization();
  openModal('item-customization-modal');
}

function closeRegisterCustomization() {
  closeModal('item-customization-modal');
  POS_REGISTER.customizationItem = null;
}

function confirmRegisterCustomization() {
  const state = POS_REGISTER.customizationItem;
  if (!state) return;
  if (state.lineKey) registerUpdateCustomized(state.lineKey, state);
  else registerAddCustomized(state.id, state);
  closeRegisterCustomization();
}

function registerSetQty(key, delta) {
  const line = POS_REGISTER.lines.find(l => l.key === key);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) {
    POS_REGISTER.lines = POS_REGISTER.lines.filter(l => l.key !== key);
  }
  renderRegisterGrid();
  renderRegisterCart();
}

function registerSetSize(key, sizeLabel) {
  const line = POS_REGISTER.lines.find(l => l.key === key);
  if (!line) return;
  const matchKey = regLineKey(line.id, sizeLabel, line.customizations, line.temperature);
  const existing = POS_REGISTER.lines.find(l => l.key !== key && l.matchKey === matchKey);
  if (existing) {
    existing.qty += line.qty;
    POS_REGISTER.lines = POS_REGISTER.lines.filter(l => l.key !== key);
    renderRegisterCart();
    return;
  }
  line.size = sizeLabel;
  line.matchKey = matchKey;
  renderRegisterCart();
}

function registerRemove(key) {
  POS_REGISTER.lines = POS_REGISTER.lines.filter(l => l.key !== key);
  renderRegisterGrid();
  renderRegisterCart();
}

function registerClear() {
  POS_REGISTER.lines = [];
  POS_REGISTER.customerName = '';
  POS_REGISTER.pwdDiscount = false;
  POS_REGISTER.ticket = null;
  const nameInput = $('#reg-customer-name');
  if (nameInput) nameInput.value = '';
  renderRegisterGrid();
  renderRegisterCart();
}

/* ═══════════════════════════════════════════
   PAYMENT TENDER (Split 2-Column Checkout, Video 00:24–00:28)
   ═══════════════════════════════════════════ */

function renderTenderOrderItems() {
  const listEl = $('#reg-tender-items');
  if (!listEl) return;
  listEl.innerHTML = POS_REGISTER.lines.map(l => {
    const it = regItem(l.id);
    if (!it) return '';
    const unit = regLineUnitPrice(l);
    const customizations = l.customizations || regEmptyCustomizations();
    const meta = [
      orderTemperatureLabel(l.temperature),
      l.size,
      ...customizations.addOns.map(a => a.name),
      customizations.note,
    ].filter(Boolean).join(' · ');
    return `
      <div class="reg-tender-item-row">
        <div class="reg-tender-item-thumb">${regTileVisual(it)}</div>
        <div class="reg-tender-item-info">
          <p class="reg-tender-item-name">${l.qty}&times; ${escapeAttr(it.name)}</p>
          ${meta ? `<p class="reg-tender-item-meta">${escapeAttr(meta)}</p>` : ''}
        </div>
        <span class="reg-tender-item-price tabular-nums">${formatMoney(unit * l.qty)}</span>
      </div>`;
  }).join('');
}

function updateTenderChangeDisplay() {
  const finalTotal = regFinalTotal(regSubtotal());
  const receivedInput = $('#reg-tender-received');
  const changeEl = $('#reg-tender-change');
  const locked = POS_REGISTER.payment === 'qr';
  receivedInput.disabled = locked;
  $('#reg-quick-bills').hidden = locked;
  $('#reg-amount-locked').hidden = !locked;
  if (locked) receivedInput.value = finalTotal.toFixed(2);
  const received = POS_REGISTER.payment === 'cash'
    ? (parseFloat(receivedInput?.value) || finalTotal)
    : finalTotal;
  POS_REGISTER.cashReceived = received;
  const change = Math.max(0, Math.round((received - finalTotal) * 100) / 100);
  if (changeEl) changeEl.textContent = formatMoney(change);
}

function validRegisterNickname() {
  const field = $('#reg-customer-name');
  field.value = field.value.trim();
  POS_REGISTER.customerName = field.value;
  if (field.value) return true;
  closeRegisterTender();
  field.setAttribute('aria-invalid', 'true');
  showToast(TagakFields.nicknameError, 'error');
  field.focus();
  return false;
}

function openRegisterTender() {
  if (POS_REGISTER.lines.length === 0) return;
  if (!validRegisterNickname()) return;
  POS_REGISTER.payment = 'cash';
  POS_REGISTER.pwdDiscount = false;
  $('#pwd-discount-toggle').checked = false;
  $$('#tender-modal .reg-tender-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.method === 'cash'));
  renderTenderOrderItems();
  renderRegisterTenderTotals();
  const finalTotal = regFinalTotal(regSubtotal());
  POS_REGISTER.cashReceived = finalTotal;
  const receivedInput = $('#reg-tender-received');
  if (receivedInput) receivedInput.value = finalTotal.toFixed(2);
  updateTenderChangeDisplay();
  const count = regItemCount();
  $('#reg-tender-count').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  openModal('tender-modal');
}

function renderRegisterTenderTotals() {
  const subtotal = regSubtotal();
  const discount = regDiscount(subtotal);
  const finalTotal = regFinalTotal(subtotal);
  $('#reg-tender-amount').textContent = formatMoney(finalTotal);
  $('#reg-tender-subtotal').textContent = formatMoney(subtotal);
  $('#reg-tender-discount').textContent = formatMoney(discount);
  $('#reg-tender-vat').textContent = formatMoney(regVat(subtotal));
  $('#reg-tender-final').textContent = formatMoney(finalTotal);
  const receivedInput = $('#reg-tender-received');
  if (!offlinePOS.enrolled && receivedInput?.value && (parseFloat(receivedInput.value) || 0) < finalTotal) {
    receivedInput.value = finalTotal.toFixed(2);
  }
  updateTenderChangeDisplay();
}

function closeRegisterTender() {
  closeModal('tender-modal');
}

/** Save the completed sale to the server, then show the receipt. */
async function confirmRegisterTender() {
  if (!permitted('access_terminal') || POS_REGISTER.lines.length === 0 || POS_REGISTER.submitting) return;
  if (!validRegisterNickname()) return;

  const branchId = POS.user?.branchId || $('#header-branch')?.dataset?.branchId || POS_BRANCHES[0]?.id || '';
  if (!branchId) {
    showToast('Choose a branch before taking payment', 'error');
    return;
  }

  const finalTotal = regFinalTotal(regSubtotal());
  const cashInput = $('#reg-tender-received')?.value || '';
  const receivedVal = parseFloat(cashInput);
  const effectiveReceived = POS_REGISTER.payment === 'cash' && Number.isFinite(receivedVal) && receivedVal >= finalTotal
    ? receivedVal
    : finalTotal;
  POS_REGISTER.lastReceived = effectiveReceived;
  POS_REGISTER.lastChange = Math.max(0, Math.round((effectiveReceived - finalTotal) * 100) / 100);
  POS_REGISTER.lastOrderMode = POS_REGISTER.orderMode;

  const customerName = ($('#reg-customer-name')?.value ?? POS_REGISTER.customerName ?? '').trim();

  const body = {
    branchId,
    customerName,
    orderMode: POS_REGISTER.orderMode,
    payment: POS_REGISTER.payment,
    ...(POS_REGISTER.payment === 'qr' && { amountReceived: effectiveReceived }),
    pwdDiscount: POS_REGISTER.pwdDiscount,
    lines: POS_REGISTER.lines.map(l => {
      const it = regItem(l.id);
      const customizations = l.customizations || regEmptyCustomizations();
      const instructions = customizations.note || (customizations.specialInstructions || []).join(', ');
      return {
        menuItemId: l.id,
        ...(it?.hasTemperature ? { temperature: l.temperature || 'hot' } : {}),
        ...(l.size ? { size: l.size } : {}),
        addOnIds: (customizations.addOns || []).map(addOn => addOn.id),
        qty: l.qty,
        instructions,
      };
    }),
  };

  const button = $('#btn-tender-confirm');
  POS_REGISTER.submitting = true;
  if (button) button.disabled = true;


  try {
    let order;
    if (body.payment==='cash') {
      await offlinePOS.prepared;
      if (!offlinePOS.enrollmentKnown) throw Error('Register preparation incomplete. Check the connection and retry synchronization.');
    }
    if (body.payment === 'cash' && (offlinePOS.enrolled || offlinePOS.offline)) {
      if(!/^\d+(?:\.\d{1,2})?$/.test(cashInput) || receivedVal<finalTotal || receivedVal>9999999999.99)
        throw Error('Enter valid cash received covering the total');
      if (!POS.user?.permissions?.access_terminal) throw Error('Terminal permission required');
      const subtotal = regSubtotal();
      const receipt = {
        subtotal, discount:regDiscount(subtotal), vat:regVat(subtotal), total:finalTotal,
      };
      order=mapPosOrder(await offlinePOS.checkout(body,receipt,Math.round(effectiveReceived*100)));
    } else {
      if(offlinePOS.offline) throw Error('Only prepared cash checkout is available offline');
      const res = await fetch('/api/orders', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...await qrRetryHeaders(body) },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(data?.error || 'Order could not be saved', 'error');
        return;
      }

      order = mapPosOrder(res.status === 202 ? await waitForQrCheckout(data) : data);
    }
    order.cashReceived = POS_REGISTER.lastReceived || order.total;
    order.changeDue = POS_REGISTER.lastChange || 0;
    order.orderMode = POS_REGISTER.lastOrderMode || 'dine-in';

    if (permitted('view_orders')) {
      const existing = POS.orders.findIndex(candidate => candidate.id === order.id);
      if (existing >= 0) POS.orders[existing] = order;
      else POS.orders.unshift(order);
    }

    POS_REGISTER.lastOrder = order;
    closeRegisterTender();
    registerClear();
    showReceipt(order);
    if (offlinePOS.enrolled) void offlinePOS.refresh().catch(error=>showToast(error.message,'error'));
    showToast(`${order.id} paid — ${order.payment === 'qr' ? 'QR (GCash/Maya)' : 'Cash'} ${formatMoney(order.total)}`, 'success');
    renderOrders();
  } catch (error) {
    showToast(error.message || 'Order could not be saved', 'error');
  } finally {
    POS_REGISTER.submitting = false;
    if (button) button.disabled = false;
  }
}

/** QMODSIM Module 5 (DTMC State S0: Cart/Held): Hold current order on the board before queueing. */
async function holdRegisterOrder() {
  if (POS_REGISTER.lines.length === 0 || POS_REGISTER.submitting) return;
  const branchId = POS.user?.branchId || $('#header-branch')?.dataset?.branchId || POS_BRANCHES[0]?.id || '';
  if (!branchId) {
    showToast('Choose a branch before holding an order', 'error');
    return;
  }
  const customerName = ($('#reg-customer-name')?.value ?? POS_REGISTER.customerName ?? '').trim();
  const body = {
    branchId,
    customerName,
    orderMode: POS_REGISTER.orderMode,
    payment: 'cash',
    status: 'held',
    pwdDiscount: false,
    lines: POS_REGISTER.lines.map(l => {
      const it = regItem(l.id);
      const customizations = l.customizations || regEmptyCustomizations();
      const instructions = customizations.note || (customizations.specialInstructions || []).join(', ');
      return {
        menuItemId: l.id,
        ...(it?.hasTemperature ? { temperature: l.temperature || 'hot' } : {}),
        ...(l.size ? { size: l.size } : {}),
        addOnIds: (customizations.addOns || []).map(addOn => addOn.id),
        qty: l.qty,
        instructions,
      };
    }),
  };

  POS_REGISTER.submitting = true;
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      showToast(data?.error || 'Could not hold order', 'error');
      return;
    }
    const order = mapPosOrder(data);
    POS.orders.unshift(order);
    registerClear();
    renderOrders();
    showToast(`${order.id} parked in Held state (DTMC S0)`, 'info');
    if (typeof refreshQmodsimTelemetry === 'function') refreshQmodsimTelemetry();
  } catch (_) {
    showToast('Could not hold order while offline', 'error');
  } finally {
    POS_REGISTER.submitting = false;
  }
}

/* ═══════════════════════════════════════════
   RECEIPT & PAYMENT SUCCESSFUL (Video 00:00–00:03 & 00:29–00:32)
   ═══════════════════════════════════════════ */

function regMethodLabel(method) {
  return method === 'qr' ? 'QR — GCash / Maya' : 'Cash';
}

function regReceiptCustomization(item) {
  const customizations = item.customizations || regEmptyCustomizations();
  const addOnNames = (item.addOns || customizations.addOns || []).map(addOn => addOn.name);
  const details = [
    ...addOnNames,
    item.instructions || customizations.note || (customizations.specialInstructions || []).join(', '),
  ].filter(Boolean);
  return details.length ? `<small class="receipt-customizations"> · ${escapeAttr(details.join(', '))}</small>` : '';
}

function regReceiptItemLabel(item) {
  const meta = [orderTemperatureLabel(item.temperature), item.size && item.size !== '-' ? item.size : '']
    .filter(Boolean)
    .join(', ');
  return `${item.qty}&times; ${escapeAttr(item.name)}${meta ? ' <em>(' + escapeAttr(meta) + ')</em>' : ''}${regReceiptCustomization(item)}`;
}

function regReceiptLineAmount(item) {
  return (Number(item.unitPrice) + Number(item.addOnPrice || 0)) * item.qty;
}

function showReceipt(order) {
  const body = $('#receipt-body');
  if (!body) return;
  const when = new Date(order.timeOut || order.timeIn)
    .toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const received = order.cashReceived != null ? order.cashReceived : order.total;
  const change = order.changeDue != null ? order.changeDue : 0;
  const modeLabel = regOrderModeLabel(order.orderMode || POS_REGISTER.lastOrderMode);

  // Populate left "Payment Successful!" card (Video 00:00 & 00:29)
  const invEl = $('#receipt-success-invoice');
  if (invEl) invEl.textContent = `INVOICE: #${order.id}`;
  const totEl = $('#receipt-success-total');
  if (totEl) totEl.textContent = formatMoney(order.total);
  const recEl = $('#receipt-success-received');
  if (recEl) recEl.textContent = formatMoney(received);
  const chgEl = $('#receipt-success-change');
  if (chgEl) chgEl.textContent = formatMoney(change);
  const mthEl = $('#receipt-success-method');
  if (mthEl) mthEl.textContent = `${regMethodLabel(order.payment)} (${modeLabel})`;

  // Populate right Thermal Receipt Paper (#receipt-body)
  body.classList.toggle('receipt--58mm', POS_REGISTER.paperWidth === '58mm');
  body.innerHTML = `
    <div class="receipt-head">
      <div class="receipt-brand-lockup">
        <img src="../admin-app/assets/tagak-logo-admin-v2.png" class="receipt-logo" alt="Tagak Café">
        <span class="receipt-brand">Tagak <em>Café</em></span>
      </div>
      <p class="receipt-sub">OFFICIAL SALES RECEIPT &middot; ${escapeAttr(modeLabel.toUpperCase())}</p>
    </div>
    <div class="receipt-meta">
      <span>${escapeAttr(order.id)}</span>
      <span>${escapeAttr(when)}</span>
    </div>
    ${order.trackingToken ? `<p><a class="receipt-tracking" href="/customer-app/index.html#track=${encodeURIComponent(order.trackingToken)}">Track this order</a></p>` : ''}
    ${order.customerName ? `<div class="receipt-meta"><span>Customer</span><span>${escapeAttr(order.customerName)}</span></div>` : ''}
    <div class="receipt-lines">
      ${order.items.map(i => `
        <div class="receipt-line">
          <span class="rl-name">${regReceiptItemLabel(i)}</span>
          <span class="rl-amt">${formatMoney(regReceiptLineAmount(i))}</span>
        </div>`).join('')}
    </div>
    <div class="receipt-total"><span>Subtotal</span><span>${formatMoney(order.subtotal ?? order.total)}</span></div>
    ${order.discount ? `<div class="receipt-total receipt-discount"><span>PWD / Senior Citizen discount (20%)</span><span>−${formatMoney(order.discount)}</span></div>` : ''}
    ${order.vat ? `<div class="receipt-total"><span>VAT (12%)</span><span>${formatMoney(order.vat)}</span></div>` : ''}
    <div class="receipt-total receipt-grand-total"><span>TOTAL PAID</span><span>${formatMoney(order.total)}</span></div>
    <div class="receipt-total"><span>Amount Received</span><span>${formatMoney(received)}</span></div>
    <div class="receipt-total"><span>Change Due</span><span>${formatMoney(change)}</span></div>
    <div class="receipt-pay">Paid by ${escapeAttr(regMethodLabel(order.payment))}</div>
    <p class="receipt-thanks">Thank you for visiting Tagak Coffee!</p>
  `;
  openModal('receipt-modal');
}

function printReceipt(order) {
  if (!order) return;
  const when = new Date(order.timeOut || order.timeIn)
    .toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const logo = new URL('../admin-app/assets/tagak-logo-admin-v2.png', location.href).href;
  const received = order.cashReceived != null ? order.cashReceived : order.total;
  const change = order.changeDue != null ? order.changeDue : 0;
  const widthMm = POS_REGISTER.paperWidth === '58mm' ? '58mm' : '76mm';

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Receipt ${escapeAttr(order.id)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Courier New', Courier, monospace; color:#141E18; width: ${widthMm}; margin: 0 auto; padding: 6mm 4mm; }
  .center { text-align:center; }
  .brand-lockup { display:inline-flex; align-items:center; justify-content:center; gap: 2.5mm; margin: 0 auto 1.5mm; }
  .logo { width: 10mm; height: 10mm; object-fit: contain; filter: invert(.84) brightness(1.1) sepia(.18) hue-rotate(65deg) saturate(.55); }
  .brand { font-family: Georgia, serif; font-weight: 600; font-size: 13pt; letter-spacing: 0.02em; color:#2b3a30; }
  .brand em { font-size: .72em; font-style: normal; font-weight: 400; letter-spacing: .12em; text-transform: uppercase; }
  .sub { font-size: 7.5pt; color:#4B5950; letter-spacing: .1em; text-transform: uppercase; margin-top:1mm; }
  .rule { border-top: 1px dashed #8A9A8C; margin: 3mm 0; }
  .meta { display:flex; justify-content:space-between; font-size: 8pt; color:#2F3D34; }
  .line { display:flex; justify-content:space-between; gap: 4mm; font-size: 8.5pt; margin: 1.4mm 0; }
  .line .n { flex:1; }
  .line em { color:#4B5950; font-style: normal; }
  .total { display:flex; justify-content:space-between; font-size: 9pt; margin-top: 1.2mm; }
  .grand { font-size: 11pt; font-weight: 700; margin-top: 2mm; padding-top: 2mm; border-top: 1.5px solid #141E18; }
  .pay { text-align:center; font-size: 8pt; color:#4B5950; margin-top: 3mm; }
  .thanks { text-align:center; font-size: 8.5pt; margin-top: 3mm; }
  @media print { @page { margin: 0; } }
</style></head><body>
  <div class="center">
    <div class="brand-lockup">
      <img class="logo" src="${logo}" alt="Tagak Café">
      <span class="brand">Tagak <em>Café</em></span>
    </div>
    <div class="sub">Official Sales Receipt</div>
  </div>
  <div class="rule"></div>
  <div class="meta"><span>${escapeAttr(order.id)}</span><span>${escapeAttr(when)}</span></div>
  ${order.customerName ? `<div class="meta"><span>Customer</span><span>${escapeAttr(order.customerName)}</span></div>` : ''}
  <div class="rule"></div>
  ${order.items.map(i => `<div class="line"><span class="n">${regReceiptItemLabel(i)}</span><span>${formatMoney(regReceiptLineAmount(i))}</span></div>`).join('')}
  <div class="rule"></div>
  <div class="total"><span>Subtotal</span><span>${formatMoney(order.subtotal ?? order.total)}</span></div>
  ${order.discount ? `<div class="total"><span>PWD / Senior (20%)</span><span>−${formatMoney(order.discount)}</span></div>` : ''}
  ${order.vat ? `<div class="total"><span>VAT (12%)</span><span>${formatMoney(order.vat)}</span></div>` : ''}
  <div class="total grand"><span>TOTAL PAID</span><span>${formatMoney(order.total)}</span></div>
  <div class="total"><span>Amount Received</span><span>${formatMoney(received)}</span></div>
  <div class="total"><span>Change Due</span><span>${formatMoney(change)}</span></div>
  <div class="pay">Paid by ${escapeAttr(regMethodLabel(order.payment))}</div>
  ${order.trackingToken ? `<p class="thanks" style="overflow-wrap:anywhere">Track your order: ${escapeAttr(location.origin)}/customer-app/index.html#track=${encodeURIComponent(order.trackingToken)}</p>` : ''}
  <p class="thanks">Thank you for visiting Tagak Coffee!</p>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast('Popup blocked — please allow popups to print', 'error'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.print(); }, 350);
}

function closeReceipt() {
  closeModal('receipt-modal');
}

/* ═══════════════════════════════════════════
   EVENTS + INIT
   ═══════════════════════════════════════════ */

function bindRegisterEvents() {
  // Product grid — delegated so it survives re-renders
  const grid = $('#reg-grid');
  grid?.addEventListener('click', (e) => {
    const tile = e.target.closest('.reg-tile');
    if (tile) registerAdd(tile.dataset.id);
  });

  // Broken product images fall back to the typographic monogram (capture phase)
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.matches('.reg-thumb img[data-menu-name]')) return;
    img.parentElement.replaceWith(MenuInitials.element(img.dataset.menuName, 'reg-mono ' + regCatSlug(img.dataset.category)));
  }, true);

  // Order service mode tabs (Dine-in / Takeout)
  $('#reg-order-modes')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.reg-mode-btn');
    if (!btn) return;
    POS_REGISTER.orderMode = btn.dataset.orderMode === 'takeout' ? 'takeout' : 'dine-in';
    renderRegisterCart();
  });

  // Cart lines — delegated
  $('#reg-cart-lines')?.addEventListener('click', (e) => {
    const inc = e.target.closest('.reg-inc');
    const dec = e.target.closest('.reg-dec');
    const rm  = e.target.closest('.reg-remove');
    const sz  = e.target.closest('.reg-size');
    const edit = e.target.closest('.reg-edit-customization');
    if (edit) {
      const line = POS_REGISTER.lines.find(candidate => candidate.key === edit.dataset.key);
      if (line) openRegisterCustomization(line.id, line.key);
    } else if (inc) registerSetQty(inc.dataset.key, 1);
    else if (dec) registerSetQty(dec.dataset.key, -1);
    else if (rm) registerRemove(rm.dataset.key);
    else if (sz) registerSetSize(sz.dataset.key, sz.dataset.size);
  });

  // Category chips
  $('#reg-chips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.reg-chip');
    if (!chip) return;
    POS_REGISTER.category = chip.dataset.cat;
    renderRegisterGrid();
  });

  // Search
  $('#reg-search')?.addEventListener('input', (e) => {
    POS_REGISTER.search = e.target.value;
    renderRegisterGrid();
  });

  // Customer nickname
  $('#reg-customer-name')?.addEventListener('input', (e) => {
    POS_REGISTER.customerName = e.target.value;
    if (e.target.value.trim()) e.target.removeAttribute('aria-invalid');
  });

  // Clear + Hold (S0) + Pay
  $('#reg-clear')?.addEventListener('click', registerClear);
  $('#btn-hold-order')?.addEventListener('click', holdRegisterOrder);
  $('#reg-pay')?.addEventListener('click', openRegisterTender);

  // Drink customization modal
  const customizationModal = $('#item-customization-modal');
  customizationModal?.addEventListener('change', (e) => {
    const state = POS_REGISTER.customizationItem;
    if (!state) return;
    if (e.target.matches('input[name="customization-size"]')) {
      state.size = e.target.value;
    } else if (e.target.matches('input[name="customization-temperature"]')) {
      state.temperature = e.target.value;
    } else if (e.target.matches('[data-addon]')) {
      const addOn = getActiveAddOns().find(option => option.id === e.target.dataset.addon);
      if (!addOn) return;
      if (e.target.checked) state.addOns.push({ id: addOn.id, name: addOn.name, price: addOn.price });
      else state.addOns = state.addOns.filter(selected => selected.id !== addOn.id);
    }
    renderRegisterCustomization();
  });
  $('#customization-note')?.addEventListener('input', (e) => {
    if (POS_REGISTER.customizationItem) POS_REGISTER.customizationItem.note = e.target.value;
  });
  $('#btn-customization-cancel')?.addEventListener('click', closeRegisterCustomization);
  $('#btn-customization-close')?.addEventListener('click', closeRegisterCustomization);
  $('#btn-customization-confirm')?.addEventListener('click', confirmRegisterCustomization);
  customizationModal?.addEventListener('click', (e) => {
    if (e.target === customizationModal) closeRegisterCustomization();
  });

  // Tender modal
  $('#btn-tender-cancel')?.addEventListener('click', closeRegisterTender);
  $('#btn-tender-close')?.addEventListener('click', closeRegisterTender);
  $('#btn-tender-confirm')?.addEventListener('click', confirmRegisterTender);
  $('#pwd-discount-toggle')?.addEventListener('change', (e) => {
    POS_REGISTER.pwdDiscount = e.target.checked;
    renderRegisterTenderTotals();
  });
  $('#reg-tender-received')?.addEventListener('input', updateTenderChangeDisplay);
  $('#reg-quick-bills')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.reg-bill-chip');
    if (!chip || POS_REGISTER.payment !== 'cash') return;
    const finalTotal = regFinalTotal(regSubtotal());
    const val = chip.dataset.bill === 'exact' ? finalTotal : Number(chip.dataset.bill);
    const input = $('#reg-tender-received');
    if (input && Number.isFinite(val)) {
      input.value = val.toFixed(2);
      updateTenderChangeDisplay();
    }
  });
  $('#tender-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'tender-modal') { closeRegisterTender(); return; }
    const opt = e.target.closest('.reg-tender-opt');
    if (!opt || opt.disabled || POS_REGISTER.payment === opt.dataset.method) return;
    if (opt.dataset.method === 'cash') $('#reg-tender-received').value = '';
    POS_REGISTER.payment = opt.dataset.method;
    $$('#tender-modal .reg-tender-opt').forEach(b => b.classList.toggle('active', b === opt));
    updateTenderChangeDisplay();
  });

  // Receipt modal + 58mm/80mm paper width switcher
  $('#btn-receipt-close')?.addEventListener('click', closeReceipt);
  $('#btn-receipt-print')?.addEventListener('click', () => printReceipt(POS_REGISTER.lastOrder));
  $('#receipt-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'receipt-modal') { closeReceipt(); return; }
    const paperBtn = e.target.closest('.reg-paper-btn');
    if (paperBtn) {
      POS_REGISTER.paperWidth = paperBtn.dataset.paper || '80mm';
      $$('#receipt-modal .reg-paper-btn').forEach(b => b.classList.toggle('active', b === paperBtn));
      $('#receipt-body')?.classList.toggle('receipt--58mm', POS_REGISTER.paperWidth === '58mm');
    }
  });

  // Entering the register re-syncs the grid so menu/recipe edits show up.
  document.querySelector('.sidebar-item[data-view="register"]')
    ?.addEventListener('click', () => {
      renderRegisterGrid();
      renderRegisterCart();
    });
}

function initRegister() {
  if (!$('#reg-grid')) return;
  POS_REGISTER.ticket = null;
  renderRegisterGrid();
  renderRegisterCart();
  bindRegisterEvents();
}

document.addEventListener('DOMContentLoaded', initRegister);
