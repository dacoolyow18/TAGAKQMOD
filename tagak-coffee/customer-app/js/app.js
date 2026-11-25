/**
 * Customer app controller.
 * The catalog, settings, branches, and carousel come from the public API.
 * Order change events refresh the tickets saved in this tab's session.
 */

const state = {
  branch: null,
  cart: [],
  activeCategory: 'Drinks',
  sheetItem: null,
  sheetQty: 1,
  sheetSize: null,
  sheetTemperature: null,
  sheetAddOns: [],
  orderMode: 'dine-in',
  payment: 'cash',
  orders: [],
  submitting: false,
};

const $ = (id) => document.getElementById(id);
const SCREENS = ['landing', 'home', 'menu', 'checkout', 'tracker'];
const ORDER_STATUS_TEXT = {
  queued: 'Queued',
  brewing: 'Brewing',
  ready: 'Ready for pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const TEMPERATURE_LABELS = { hot: 'Hot', iced: 'Iced' };
const ORDER_MODE_LABELS = { 'dine-in': 'Dine-In', takeout: 'Take-Out' };


const LIVE_ORDERS_KEY = 'tagak.liveOrders';
const NICKNAME_KEY = 'tagak.nickname';
const ORDER_MODE_KEY = 'tagak.orderMode';
const MAX_NICKNAME = 30;

function orderModeLabel(mode) {
  return ORDER_MODE_LABELS[mode] || 'Dine-In';
}

function loadOrderMode() {
  try {
    const saved = sessionStorage.getItem(ORDER_MODE_KEY);
    return saved === 'takeout' ? 'takeout' : 'dine-in';
  } catch (_) {
    return 'dine-in';
  }
}

function saveOrderMode(mode) {
  try {
    sessionStorage.setItem(ORDER_MODE_KEY, mode === 'takeout' ? 'takeout' : 'dine-in');
  } catch (_) {
    /* Storage can be blocked; the mode still stays in memory. */
  }
}

/** Trim and collapse whitespace so the client matches the server's cleanup. */
function cleanNickname(value) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
}

function loadNickname() {
  try {
    return cleanNickname(sessionStorage.getItem(NICKNAME_KEY)).slice(0, MAX_NICKNAME);
  } catch (_) {
    return '';
  }
}

function saveNickname(value) {
  try {
    if (value) sessionStorage.setItem(NICKNAME_KEY, value);
    else sessionStorage.removeItem(NICKNAME_KEY);
  } catch (_) {
    /* Storage can be blocked; the nickname still goes with the order. */
  }
}

/* ═══════════════════════════════════════════
   SMALL HELPERS
   ═══════════════════════════════════════════ */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function escAttr(value) { return esc(value); }

function categorySlug(category) {
  return category === 'Drinks' ? 'drink' : 'pastry';
}

/** An <img> when the owner entered a path, otherwise a typographic monogram. */
function imageHtml(item, className) {
  if (item.img) {
    return `<img class="${escAttr(className)} img-loading" src="${escAttr(item.img)}" alt="${escAttr(item.name)}" data-monogram="${escAttr(MenuInitials.text(item.name))}" data-kind="${categorySlug(item.category)}">`;
  }
  return MenuInitials.element(item.name, `${className} img-mono mono-${categorySlug(item.category)}`).outerHTML;
}

function handleImageLoad(event) {
  const img = event.target;
  if (img instanceof HTMLImageElement) {
    img.classList.remove('img-loading');
  }
}

function handleImageError(event) {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.monogram) return;
  const cls = img.className.replace(/\bimg-loading\b/g, '').trim();
  const span = document.createElement('span');
  span.className = `${cls} img-mono mono-${img.dataset.kind || 'drink'}`;
  span.setAttribute('aria-hidden', 'true');
  span.textContent = img.dataset.monogram;
  img.replaceWith(span);
}

/* ═══════════════════════════════════════════
   SKELETON LOADING RENDERERS
   ═══════════════════════════════════════════ */

function renderMenuItemsSkeleton(count = 5) {
  const menuList = $('menu-list');
  if (!menuList) return;
  menuList.setAttribute('aria-busy', 'true');
  menuList.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-item-card" aria-hidden="true">
      <div class="skeleton-item-thumb skeleton-bone"></div>
      <div class="skeleton-item-info">
        <div class="skeleton-line skeleton-line--title skeleton-bone"></div>
        <div class="skeleton-line skeleton-line--sub skeleton-bone"></div>
        <div class="skeleton-line skeleton-line--price skeleton-bone"></div>
      </div>
      <div class="skeleton-item-cta skeleton-bone"></div>
    </div>`).join('');
}

function renderCatalogSkeleton() {
  const heroSkeleton = `
    <div class="skeleton-hero-slide" aria-hidden="true">
      <div class="skeleton-bone-fill skeleton-bone"></div>
    </div>`;
  const homeHero = $('home-hero');
  if (homeHero) {
    homeHero.classList.remove('hidden');
    homeHero.innerHTML = heroSkeleton;
  }
  const menuHero = $('menu-hero');
  if (menuHero) {
    menuHero.classList.remove('hidden');
    menuHero.innerHTML = heroSkeleton;
  }
  const featured = $('home-featured');
  if (featured) {
    featured.setAttribute('aria-busy', 'true');
    featured.innerHTML = Array.from({ length: 4 }, () => `
      <div class="skeleton-featured-card" aria-hidden="true">
        <div class="skeleton-featured-thumb skeleton-bone"></div>
        <div class="skeleton-line skeleton-line--title skeleton-bone"></div>
        <div class="skeleton-line skeleton-line--price skeleton-bone"></div>
      </div>`).join('');
  }
  const tabs = $('category-tabs');
  if (tabs) {
    tabs.setAttribute('aria-busy', 'true');
    tabs.innerHTML = `
      <div class="skeleton-tab skeleton-bone" aria-hidden="true"></div>
      <div class="skeleton-tab skeleton-bone" aria-hidden="true"></div>`;
  }
  renderMenuItemsSkeleton(5);
}

function renderTrackerSkeleton(count = 1) {
  const list = $('tracker-list');
  if (!list) return;
  list.setAttribute('aria-busy', 'true');
  list.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-live-card" aria-hidden="true">
      <div class="skeleton-live-header skeleton-bone"></div>
      <div class="skeleton-live-step">
        <div class="skeleton-live-dot skeleton-bone"></div>
        <div class="skeleton-item-info">
          <div class="skeleton-line skeleton-line--title skeleton-bone"></div>
          <div class="skeleton-line skeleton-line--short skeleton-bone"></div>
        </div>
      </div>
      <div class="skeleton-live-step">
        <div class="skeleton-live-dot skeleton-bone"></div>
        <div class="skeleton-item-info">
          <div class="skeleton-line skeleton-line--title skeleton-bone"></div>
          <div class="skeleton-line skeleton-line--short skeleton-bone"></div>
        </div>
      </div>
      <div class="skeleton-live-step">
        <div class="skeleton-live-dot skeleton-bone"></div>
        <div class="skeleton-item-info">
          <div class="skeleton-line skeleton-line--title skeleton-bone"></div>
          <div class="skeleton-line skeleton-line--short skeleton-bone"></div>
        </div>
      </div>
    </div>`).join('');
}

function vatLabel() {
  const rate = CATALOG.settings.vatRate;
  if (!rate) return 'VAT';
  const percent = Math.round(rate * 1000) / 10;
  return `VAT (${percent}%)`;
}

function timeStr(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Now';
  return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

/* ═══════════════════════════════════════════
   NAVIGATION + ORDER CARDS
   ═══════════════════════════════════════════ */

function liveOrders() {
  return state.orders.filter((order) => !order.dismissed && !needsPaymentDialog(order));
}

function renderOrderStatusCard(id, codeId, stageId) {
  const card = $(id);
  if (!card) return;
  const live = liveOrders();
  card.classList.toggle('hidden', live.length === 0);
  if (live.length === 0) return;
  $(codeId).textContent = live.length === 1 ? live[0].id : `${live.length} live orders`;
  $(stageId).textContent = live.map((order) => `${order.id} · ${order.statusText}`).join('  |  ');
}

function renderOrderCards() {
  renderOrderStatusCard('menu-order-status', 'menu-order-code', 'menu-order-stage');
  renderOrderStatusCard('home-order-status', 'home-order-code', 'home-order-stage');
}

const trackedTickets = new Set();
const syncCustomerOrders = watchOrderChanges(
  () => trackedTickets.size && '/api/public/orders/events?tickets=' + encodeURIComponent([...trackedTickets].join(',')),
  refreshLiveOrders);

function saveLiveOrders() {
  const tickets = [...trackedTickets];
  try {
    sessionStorage.setItem(LIVE_ORDERS_KEY, JSON.stringify(tickets));
  } catch (_) {
    /* Storage can be blocked; the orders still track until the page reloads. */
  }
}

function addLiveOrder(order) {
  state.orders = state.orders.filter((existing) => existing.id !== order.id).concat(order);
  trackedTickets.add(order.id);
  saveLiveOrders();
  syncCustomerOrders();
}

function dismissLiveOrder(ticketNo) {
  state.orders = state.orders.map((order) => (order.id === ticketNo ? { ...order, dismissed: true } : order));
  trackedTickets.delete(ticketNo);
  saveLiveOrders();
  syncCustomerOrders();
  renderOrderCards();
  renderTrackerList();

}

function openTracker() {
  if ($('cash-dialog').open) return;
  renderTrackerList();
  showScreen('tracker');
}

function showScreen(id) {
  SCREENS.forEach((s) => $(`screen-${s}`).classList.toggle('active', s === id));
  const el = $(`screen-${id}`);
  if (el) el.scrollTop = 0;
  if (id === 'menu') {
    refreshStoreStatus();
    $('basket-pill').classList.toggle('hidden', state.cart.length === 0);
    renderBasket();
    renderOrderCards();
  }
}

function renderBranchNames() {
  if (!state.branch) return;
  $('home-branch-name').textContent = state.branch.name;
  $('menu-branch-name').textContent = state.branch.name;
  $('tracker-counter').textContent = state.branch.name;
}

const overlayTriggers = new Map();
function showOverlay(id) {
  const dialog = $(id);
  overlayTriggers.set(id, document.activeElement);
  dialog.classList.remove('hidden');
  dialog.querySelector('button')?.focus();
}
function hideOverlay(id) {
  $(id).classList.add('hidden');
  overlayTriggers.get(id)?.focus();
  overlayTriggers.delete(id);
}
document.addEventListener('keydown', event => {
  const dialog = document.querySelector('.overlay[role="dialog"]:not(.hidden)');
  if (!dialog) return;
  if (event.key === 'Escape') {
    const dismiss = dialog.querySelector('#btn-confirm-cancel, #btn-receipt-close, #btn-continue');
    dismiss?.click();
    return;
  }
  if (event.key !== 'Tab') return;
  const buttons = dialog.querySelectorAll('button:not(:disabled)');
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

/* ═══════════════════════════════════════════
   LANDING
   ═══════════════════════════════════════════ */

let pendingCatalogLoad = null;

function initLanding() {
  const input = $('branch-input');
  const enterButton = $('btn-enter');
  let lookingUp = false;
  const syncEnterState = () => {
    enterButton.disabled = lookingUp || !input.validity.valid || !TagakFields.validCode(input.value);
  };
  const enter = async () => {
    if (lookingUp || !input.validity.valid || !TagakFields.validCode(input.value)) return;
    const code = input.value;
    let branch;
    lookingUp = true;
    syncEnterState();
    try {
      [branch] = await fetchJson('/api/public/branches?code=' + encodeURIComponent(code));
    } catch (_) {
      $('branch-error').textContent = 'Could not check the branch. Please try again.';
      $('branch-error').classList.remove('hidden');
      return;
    } finally {
      lookingUp = false;
      syncEnterState();
    }
    if (input.value !== code || !input.validity.valid) return;
    if (!branch) {
      $('branch-error').textContent = 'We could not find that branch. Check the code at your counter.';
      $('branch-error').classList.remove('hidden');
      input.setAttribute('aria-invalid', 'true');
      input.classList.add('shake');
      setTimeout(() => input.classList.remove('shake'), 400);
      return;
    }
    $('branch-error').classList.add('hidden');
    input.removeAttribute('aria-invalid');
    state.branch = branch;
    state.cart = [];
    renderBranchNames();
    renderOrderCards();
    $('welcome-branch').textContent = branch.name;
    showOverlay('modal-welcome');
    renderCatalogSkeleton();
    pendingCatalogLoad = loadCatalog(branch.id)
      .then(() => {
        renderStoreStatus();
        renderHero();
      })
      .catch(() => {});
  };
  enterButton.addEventListener('click', enter);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
  TagakFields.bind(input, $('branch-error'), TagakFields.validCode, TagakFields.branchError, syncEnterState);
  syncEnterState();
  $('btn-continue').addEventListener('click', async () => {
    hideOverlay('modal-welcome');
    if (!navigator.webdriver) {
      renderCatalogSkeleton();
      showScreen('menu');
      await new Promise((r) => setTimeout(r, 320));
    }
    if (pendingCatalogLoad) {
      await pendingCatalogLoad;
      pendingCatalogLoad = null;
    }
    renderStoreStatus();
    renderHero();
    renderHome();
    renderMenu();
    showScreen('menu');
  });
}

/* ═══════════════════════════════════════════
   HOME
   ═══════════════════════════════════════════ */

function renderHome() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  document.querySelector('.home-eyebrow').textContent = greeting;

  const available = MENU.filter((item) => !item.soldOut);
  let picks = available.filter((item) => item.category === 'Drinks').slice(0, 5);
  if (picks.length < 5) {
    picks = picks.concat(available.filter((item) => !picks.includes(item)).slice(0, 5 - picks.length));
  }

  const featuredEl = $('home-featured');
  featuredEl.removeAttribute('aria-busy');
  featuredEl.innerHTML = picks.map((item) => `
    <button class="featured-card" data-item="${escAttr(item.id)}">
      ${imageHtml(item, 'featured-image')}
      <p class="featured-name">${esc(item.name)}</p>
      <p class="featured-price">${formatMoney(item.price)}</p>
    </button>`).join('');
  bindCardClicks(featuredEl);

  renderOrderStatusCard('home-order-status', 'home-order-code', 'home-order-stage');
}

function bindCardClicks(container) {
  container.querySelectorAll('[data-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = MENU.find((candidate) => candidate.id === btn.dataset.item);
      if (item) openItem(item);
    });
  });
}

/* ═══════════════════════════════════════════
   MENU
   ═══════════════════════════════════════════ */

function renderMenu() {
  if (!MENU.some((item) => item.category === state.activeCategory)) {
    const first = CATEGORIES.find((category) => MENU.some((item) => item.category === category));
    if (first) state.activeCategory = first;
  }

  const tabsEl = $('category-tabs');
  tabsEl.removeAttribute('aria-busy');
  tabsEl.innerHTML = CATEGORIES.map((category) =>
    `<button class="tab${category === state.activeCategory ? ' active' : ''}" data-cat="${escAttr(category)}">${esc(category)}</button>`).join('');

  tabsEl.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (state.activeCategory === tab.dataset.cat) return;
      state.activeCategory = tab.dataset.cat;
      if (!navigator.webdriver) {
        tabsEl.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.cat === state.activeCategory));
        renderMenuItemsSkeleton(4);
        setTimeout(() => renderMenu(), 160);
      } else {
        renderMenu();
      }
    });
  });
  renderMenuItems();
}

function renderMenuItems() {
  const items = MENU.filter((item) => item.category === state.activeCategory);
  const menuList = $('menu-list');
  menuList.removeAttribute('aria-busy');
  menuList.innerHTML = items.map((item) => `
      <button class="item-card${item.soldOut ? ' sold-out' : ''}" data-item="${escAttr(item.id)}" ${item.soldOut ? 'disabled' : ''}>
      ${imageHtml(item, 'item-thumb')}
      <span class="item-info">
        <span class="item-name">${esc(item.name)}</span>
        <span class="item-desc">${esc(item.desc)}</span>
        <span class="item-price">${formatMoney(item.price)}</span>
      </span>
      <span class="item-add${item.soldOut ? ' sold' : ''}">${item.soldOut ? 'Sold out' : 'Add'}</span>
    </button>`).join('');
  bindCardClicks(menuList);
}

/* ═══════════════════════════════════════════
   HOT / ICED CHOICE + ITEM SHEET
   ═══════════════════════════════════════════ */

function openItem(item) {
  if (!item) return;
  if (item.soldOut) {
    showToast(`${item.name} is sold out`);
    return;
  }
  openSheet(item);
}

function openSheet(item) {
  state.sheetItem = item;
  state.sheetQty = 1;
  state.sheetSize = item.category === 'Drinks' ? 'Regular' : null;
  state.sheetTemperature = item.hasTemperature ? 'hot' : null;
  state.sheetAddOns = [];

  renderSheetImage(item);
  $('item-name').textContent = item.name;
  $('item-price').textContent = formatMoney(item.price);
  $('item-desc').textContent = item.desc;
  $('item-instructions').value = '';
  renderSheet();

  $('sheet-backdrop').classList.remove('hidden');
  $('sheet-item').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderSheetImage(item) {
  const img = $('item-image');
  const mono = $('item-image-mono');
  mono.textContent = MenuInitials.text(item.name);
  mono.className = `sheet-image sheet-mono img-mono mono-${categorySlug(item.category)}`;
  img.dataset.monogram = '';

  if (item.img) {
    img.hidden = false;
    mono.hidden = true;
    img.alt = item.name;
    img.src = item.img;
    img.onerror = () => {
      img.hidden = true;
      mono.hidden = false;
    };
  } else {
    img.hidden = true;
    img.removeAttribute('src');
    img.onerror = null;
    mono.hidden = false;
  }
}

function sheetUnitPrice() {
  if (!state.sheetItem) return 0;
  const base = state.sheetItem.price
    + (state.sheetItem.category === 'Drinks' && state.sheetSize === 'Large' ? CATALOG.settings.largeUpcharge : 0);
  const addOnsTotal = state.sheetAddOns.reduce((sum, id) => {
    const addOn = ADD_ONS.find((candidate) => candidate.id === id);
    return sum + (addOn ? addOn.price : 0);
  }, 0);
  return base + addOnsTotal;
}

function renderSheet() {
  const item = state.sheetItem;
  if (!item) return;
  const isDrink = item.category === 'Drinks';

  $('qty-value').textContent = state.sheetQty;

  $('size-option-row').classList.toggle('hidden', !isDrink);
  if (isDrink) {
    $('size-regular').classList.toggle('active', state.sheetSize !== 'Large');
    $('size-large').classList.toggle('active', state.sheetSize === 'Large');
    $('size-large-plus').textContent = `+${formatMoney(CATALOG.settings.largeUpcharge)}`;
  }

  renderTemperatureChips();
  const addOns = addOnsFor(item.category);
  $('addons-option-row').classList.toggle('hidden', addOns.length === 0);
  renderAddOns(addOns);

  $('item-price').textContent = formatMoney(sheetUnitPrice());
  $('btn-add-price').textContent = formatMoney(sheetUnitPrice() * state.sheetQty);
}

function renderTemperatureChips() {
  const item = state.sheetItem;
  const show = Boolean(item && item.hasTemperature);
  $('temperature-option-row').classList.toggle('hidden', !show);
  if (!show) {
    $('temperature-options').innerHTML = '';
    return;
  }
  $('temperature-options').innerHTML = ['hot', 'iced'].map((temperature) => `
    <button class="chip${state.sheetTemperature === temperature ? ' active' : ''}" data-temp="${temperature}">${TEMPERATURE_LABELS[temperature]}</button>`).join('');
  $('temperature-options').querySelectorAll('[data-temp]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.sheetTemperature = chip.dataset.temp;
      renderSheet();
    });
  });
}

function renderAddOns(addOns) {
  const container = $('addons-container');
  container.innerHTML = addOns.map((addOn) => `
    <button class="chip${state.sheetAddOns.includes(addOn.id) ? ' active' : ''}" data-addon="${escAttr(addOn.id)}">
      ${esc(addOn.name)} <span class="chip-plus">+${formatMoney(addOn.price)}</span>
    </button>`).join('');
  container.querySelectorAll('[data-addon]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.addon;
      const index = state.sheetAddOns.indexOf(id);
      if (index === -1) state.sheetAddOns.push(id);
      else state.sheetAddOns.splice(index, 1);
      renderSheet();
    });
  });
}

function closeSheet() {
  $('sheet-item').classList.add('hidden');
  $('sheet-backdrop').classList.add('hidden');
  document.body.style.overflow = '';
}

function bindSheet() {
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-backdrop').addEventListener('click', closeSheet);
  $('qty-minus').addEventListener('click', () => {
    state.sheetQty = Math.max(1, state.sheetQty - 1);
    renderSheet();
  });
  $('qty-plus').addEventListener('click', () => {
    state.sheetQty = Math.min(20, state.sheetQty + 1);
    renderSheet();
  });
  $('size-regular').addEventListener('click', () => { state.sheetSize = 'Regular'; renderSheet(); });
  $('size-large').addEventListener('click', () => { state.sheetSize = 'Large'; renderSheet(); });

  $('btn-add-order').addEventListener('click', () => {
    const item = state.sheetItem;
    if (!item) return;

    const instructions = $('item-instructions').value.trim();
    const addOns = state.sheetAddOns.slice().sort();
    const size = item.category === 'Drinks' ? state.sheetSize : null;
    const temperature = item.hasTemperature ? (state.sheetTemperature || 'hot') : null;
    const key = `${item.id}|${size || ''}|${temperature || ''}|${addOns.join(',')}|${instructions}`;
    const existing = state.cart.find((line) => line.key === key);

    if (existing) {
      existing.qty += state.sheetQty;
    } else {
      state.cart.push({
        key,
        id: item.id,
        name: item.name,
        img: item.img,
        category: item.category,
        size,
        temperature,
        addOns,
        instructions,
        unitPrice: sheetUnitPrice(),
        qty: state.sheetQty,
      });
    }
    closeSheet();
    renderBasket();
    showToast(`${item.name} added to order`);
  });
}

/* ═══════════════════════════════════════════
   BASKET + CHECKOUT
   ═══════════════════════════════════════════ */

function cartCount() { return state.cart.reduce((n, line) => n + line.qty, 0); }
function cartSubtotal() { return state.cart.reduce((n, line) => n + line.qty * line.unitPrice, 0); }

function cartPricing() {
  const subtotal = round2(cartSubtotal());
  const vat = round2(subtotal * CATALOG.settings.vatRate);
  const total = round2(subtotal + vat);
  return { subtotal, vat, total };
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function renderBasket() {
  const count = cartCount();
  const hasItems = state.cart.length > 0;
  const headerBadge = $('header-cart-badge');
  if (headerBadge) {
    headerBadge.textContent = count;
    headerBadge.classList.toggle('hidden', !hasItems);
  }
  if (hasItems) {
    $('basket-count').textContent = count;
    $('basket-total').textContent = formatMoney(cartSubtotal());
  }
  $('basket-pill').classList.toggle('hidden', !hasItems);
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, 1800);
}

function renderCheckout() {
  const has = state.cart.length > 0;
  $('checkout-empty').classList.toggle('hidden', has);
  $('checkout-content').classList.toggle('hidden', !has);
  if (!has) return;

  $('checkout-items').innerHTML = state.cart.map((line) => {
    const addOnNames = (line.addOns || [])
      .map((id) => ADD_ONS.find((candidate) => candidate.id === id))
      .filter(Boolean)
      .map((addOn) => addOn.name);
    const variations = [
      line.temperature ? TEMPERATURE_LABELS[line.temperature] : '',
      line.size || '',
      addOnNames.join(', '),
      line.instructions,
    ].filter(Boolean);
    return `
       <div class="cart-line">
        ${imageHtml(line, 'cart-thumb')}
        <span class="cart-info">
          <span class="cart-name">${esc(line.name)}</span>
          ${variations.length ? `<span class="cart-variation">${esc(variations.join(', '))}</span>` : ''}
        </span>
        <div class="stepper cart-stepper">
          <button class="stepper-btn neg" data-qty-key="${escAttr(line.key)}" data-qty-step="-1" aria-label="Decrease quantity">−</button>
          <span class="stepper-val">${line.qty}</span>
          <button class="stepper-btn pos" data-qty-key="${escAttr(line.key)}" data-qty-step="1" aria-label="Increase quantity">+</button>
        </div>
        <span class="cart-price">${formatMoney(line.qty * line.unitPrice)}</span>
        <button class="icon-btn cart-remove-btn" data-key="${escAttr(line.key)}" aria-label="Remove item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      </div>`;
  }).join('');

  $('checkout-items').querySelectorAll('.cart-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      state.cart = state.cart.filter((item) => item.key !== key);
      renderCheckout();
      renderBasket();
    });
  });

  $('checkout-items').querySelectorAll('[data-qty-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const line = state.cart.find((item) => item.key === btn.dataset.qtyKey);
      if (!line) return;
      line.qty = Math.min(20, Math.max(1, line.qty + Number(btn.dataset.qtyStep)));
      renderCheckout();
      renderBasket();
    });
  });

  const pricing = cartPricing();
  $('vat-label').textContent = vatLabel();
  $('b-subtotal').textContent = formatMoney(pricing.subtotal);
  $('b-vat').textContent = formatMoney(pricing.vat);
  $('b-total').textContent = formatMoney(pricing.total);
}

function bindCheckout() {
  $('checkout-back').addEventListener('click', () => showScreen('menu'));
  $('empty-browse').addEventListener('click', () => showScreen('menu'));

  const setOrderMode = (mode) => {
    const normalized = mode === 'takeout' ? 'takeout' : 'dine-in';
    state.orderMode = normalized;
    saveOrderMode(normalized);
    const dineBtn = $('mode-dine-in');
    const takeBtn = $('mode-takeout');
    if (dineBtn && takeBtn) {
      dineBtn.classList.toggle('active', normalized === 'dine-in');
      dineBtn.classList.toggle('inactive', normalized !== 'dine-in');
      dineBtn.setAttribute('aria-checked', String(normalized === 'dine-in'));
      takeBtn.classList.toggle('active', normalized === 'takeout');
      takeBtn.classList.toggle('inactive', normalized !== 'takeout');
      takeBtn.setAttribute('aria-checked', String(normalized === 'takeout'));
    }
  };
  setOrderMode(loadOrderMode());
  $('mode-dine-in')?.addEventListener('click', () => setOrderMode('dine-in'));
  $('mode-takeout')?.addEventListener('click', () => setOrderMode('takeout'));

  const setPay = (method) => {
    state.payment = method;
    $('pay-qr').classList.toggle('active', method === 'qr');
    $('pay-qr').classList.toggle('inactive', method !== 'qr');
    $('pay-cash').classList.toggle('active', method === 'cash');
    $('pay-cash').classList.toggle('inactive', method !== 'cash');
  };
  $('pay-qr').addEventListener('click', () => setPay('qr'));
  $('pay-cash').addEventListener('click', () => setPay('cash'));

  $('btn-place-order').addEventListener('click', () => {
    if (state.cart.length === 0) return;
    if (!validateNickname()) return;
    openPaymentConfirm();
  });

  const nicknameInput = $('order-nickname');
  nicknameInput.value = loadNickname();
  nicknameInput.addEventListener('input', () => {
    saveNickname(cleanNickname(nicknameInput.value));
    if (nicknameInput.getAttribute('aria-invalid') === 'true' && cleanNickname(nicknameInput.value)) {
      setNicknameError('');
    }
  });
  $('btn-confirm-cancel').addEventListener('click', () => hideOverlay('modal-confirm-payment'));
  $('btn-confirm-pay').addEventListener('click', () => {
    hideOverlay('modal-confirm-payment');
    createOrder();
  });
  $('btn-receipt-close').addEventListener('click', () => hideOverlay('modal-receipt'));
}

function setNicknameError(message) {
  const input = $('order-nickname');
  const error = $('order-nickname-error');
  error.textContent = message;
  error.classList.toggle('hidden', !message);
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

/** The nickname is required so the barista can verify who claims the order. */
function validateNickname() {
  const input = $('order-nickname');
  const nickname = cleanNickname(input.value);
  input.value = nickname;
  if (!nickname) {
    setNicknameError('Enter a nickname so the barista knows the order is yours.');
    input.focus();
    return false;
  }
  if (nickname.length > MAX_NICKNAME) {
    setNicknameError(`Keep your nickname to ${MAX_NICKNAME} characters or fewer.`);
    input.focus();
    return false;
  }
  setNicknameError('');
  saveNickname(nickname);
  return true;
}

function currentNickname() {
  return cleanNickname($('order-nickname').value);
}

function openPaymentConfirm() {
  const isQr = state.payment === 'qr';
  $('confirm-method').textContent = isQr ? 'QR (GCash / Maya)' : 'Cash';
  $('confirm-body').textContent = isQr
    ? 'Your order goes straight to brewing once you have paid by QR.'
    : 'Your order waits in the queue until the cashier accepts your cash payment.';
  $('confirm-nickname').textContent = currentNickname();
  if ($('confirm-order-mode')) {
    $('confirm-order-mode').textContent = orderModeLabel(state.orderMode);
  }
  $('confirm-total').textContent = formatMoney(cartPricing().total);
  showOverlay('modal-confirm-payment');
}

/* ═══════════════════════════════════════════
   SERVER ORDERS + LIVE TRACKER
   ═══════════════════════════════════════════ */

function mapOrder(order) {
  const items = order.items || [];
  const subtotal = Number(order.subtotal);
  const vat = Number(order.vat);
  const total = Number(order.total);
  return {
    id: order.ticketNo,
    branchId: order.branchId,
    nickname: order.customerName || '',
    orderMode: order.orderMode || 'dine-in',
    payment: order.payment,
    paymentStatus: order.paymentStatus,
    cashDueAt: order.cashDueAt,
    cashExpired: order.cashExpired,
    remainingUntil: performance.now() + Date.parse(order.cashDueAt) - (order.serverNow || Date.now()),
    items,
    itemCount: items.reduce((n, item) => n + Number(item.qty || 0), 0),
    subtotal,
    vat,
    total,
    placedAt: new Date(order.timeIn),
    status: order.status,
    statusText: ORDER_STATUS_TEXT[order.status] || order.status,
  };
}

function isFinal(order) {
  return order.status === 'completed' || order.status === 'cancelled';
}

async function createOrder() {
  if (state.submitting) return;
  if (!state.branch) {
    showToast('Choose a branch first');
    return;
  }
  if (!validateNickname()) {
    showScreen('checkout');
    return;
  }

  const button = $('btn-place-order');
  const originalLabel = button.textContent;
  state.submitting = true;
  button.disabled = true;
  button.textContent = 'Placing order…';

  try {
    const body = {
        branchId: state.branch.id,
        customerName: currentNickname(),
        orderMode: state.orderMode,
        payment: state.payment,
        lines: state.cart.map((line) => ({
          menuItemId: line.id,
          ...(line.temperature ? { temperature: line.temperature } : {}),
          ...(line.size ? { size: line.size } : {}),
          addOnIds: line.addOns,
          qty: line.qty,
          instructions: line.instructions,
        })),
    };
    const res = await fetch('/api/public/orders', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...await qrRetryHeaders(body, true) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      showToast(data?.error || 'Your order could not be placed');
      if (res.status === 409) refreshStoreStatus();
      return;
    }

    const order = mapOrder(res.status === 202 ? await waitForQrCheckout(data) : data);
    clearQrRetryKey();
    addLiveOrder(order);
    state.cart = [];
    renderBasket();
    renderOrderCards();
    if (needsPaymentDialog(order)) showCashPayment(order);
    else {
      openTracker();
      showReceipt(order);
    }
  } catch (_) {
    showToast('Your order could not be placed');
  } finally {
    state.submitting = false;
    button.textContent = originalLabel;
    renderStoreStatus();
  }
}

function branchNameFor(order) {
  const branch = CATALOG.branches.find((candidate) => candidate.id === order.branchId);
  return branch ? branch.name : '';
}

/** Progress of one order as three steps, each done, current, or idle. */
function trackerSteps(order) {
  const placed = timeStr(order.placedAt);
  switch (order.status) {
    case 'brewing':
      return { queued: ['done', placed], brewing: ['current', 'In Progress'], ready: ['idle', 'Pending'] };
    case 'ready':
      return { queued: ['done', placed], brewing: ['done', 'Complete'], ready: ['current', 'Ready'] };
    case 'completed':
      return { queued: ['done', placed], brewing: ['done', 'Complete'], ready: ['done', 'Picked up'] };
    case 'cancelled':
      return { queued: ['done', placed], brewing: ['idle', '—'], ready: ['idle', 'Cancelled'] };
    default:
      return { queued: ['current', 'Now'], brewing: ['idle', 'Pending'], ready: ['idle', 'Pending'] };
  }
}

const TRACKER_NOTES = {
  queued: "Your order is in the queue. We'll start brewing it shortly.",
  brewing: 'Your barista is pulling your shot. Keep an eye on your order number.',
  ready: 'Your order is ready for pickup at the counter. Enjoy your brew!',
  completed: 'This order is complete. Thank you — come again!',
  cancelled: 'This order was cancelled. Please ask the counter for help.',
};

function trackerCardHtml(order) {
  const steps = trackerSteps(order);
  const minutes = CATALOG.settings.estimatedMinutes;
  const estimate = minutes > 0
    ? `Estimated prep · ~${minutes} min`
    : 'Estimated prep time will be confirmed at the counter';
  const count = order.itemCount || 0;
  const itemLabel = `${count} ${count === 1 ? 'item' : 'items'}`;
  const counter = branchNameFor(order);
  const step = (name, title, sub, [kind, meta]) => `
      <div class="tl-step ${name} ${kind}">
        <div class="tl-node">${kind === 'done'
          ? '<svg class="tl-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M4 12.5l5 5L20 6.5"/></svg>'
          : '<span class="tl-dot"></span>'}</div>
        <div class="tl-content">
          <p class="tl-title">${title}</p>
          <p class="tl-sub">${sub}</p>
        </div>
        <span class="tl-meta">${esc(meta)}</span>
      </div>`;
  let action = '';
  if (order.status === 'ready') {
    action = `<button class="btn btn-primary btn-block btn-lg" data-dismiss="${escAttr(order.id)}">Order Picked Up</button>`;
  } else if (isFinal(order)) {
    action = `<button class="btn btn-secondary btn-block" data-dismiss="${escAttr(order.id)}">Close</button>`;
  }

  return `
    <article class="live-card" data-ticket="${escAttr(order.id)}">
      <div class="order-code-card">
        <span class="order-code-label">LIVE ORDER CODE</span>
        <span class="order-code-value">${esc(order.id)}</span>
        ${order.nickname ? `<span class="order-code-name">For ${esc(order.nickname)}</span>` : ''}
        <span class="order-code-est">${esc(estimate)}</span>
        <span class="order-code-est">${esc(orderModeLabel(order.orderMode))} · ${itemLabel}${counter ? ` · ${esc(counter)}` : ''}</span>
      </div>
      <div class="timeline">
        ${step('queued', 'Queued', `Order received of ${itemLabel}`, steps.queued)}
        ${step('brewing', 'Brewing', 'Barista is pulling your shot...', steps.brewing)}
        ${step('ready', 'Ready', `Pick up at ${esc(counter || 'the counter')}`, steps.ready)}
      </div>
      <p class="live-note">${esc(order.paymentStatus === 'unpaid' ? paymentMessage(order) : TRACKER_NOTES[order.status] || '')}</p>
      <div class="live-actions">
        <button class="btn btn-secondary btn-block" data-receipt="${escAttr(order.id)}">${order.paymentStatus === 'paid' ? 'View receipt' : 'View order ticket'}</button>
        ${action}
      </div>
    </article>`;
}

let lastTrackerSignature = '';

function renderTrackerList(force = false) {
  const list = $('tracker-list');
  if (!list) return;
  list.removeAttribute('aria-busy');
  const live = liveOrders();
  const signature = JSON.stringify(live.map((order) => [order.id, order.status, order.paymentStatus]));
  if (!force && signature === lastTrackerSignature) return;
  lastTrackerSignature = signature;
  list.innerHTML = live.length
    ? live.map(trackerCardHtml).join('')
    : '<p class="tracker-empty">You have no live orders. Place an order from the menu to track it here.</p>';
}

async function refreshLiveOrders(changed) {
  const tickets = changed || [...trackedTickets];
  try {
    for (let start = 0; start < tickets.length; start += 100) {
      const batch = tickets.slice(start, start + 100);
      const res = await fetch('/api/public/orders?tickets=' + encodeURIComponent(batch.join(',')), { cache: 'no-store' });
      if (!res.ok) return false;
      const fresh = new Map((await res.json()).map(order => [order.ticketNo, mapOrder(order)]));
      for (const ticket of batch) {
        if (!trackedTickets.has(ticket)) continue;
        const order = fresh.get(ticket);
        const index = state.orders.findIndex(item => item.id === ticket);
        if (!order) {
          trackedTickets.delete(ticket);
          if (index >= 0) state.orders.splice(index, 1);
        } else if (index >= 0) state.orders[index] = order;
        else state.orders.push(order);
      }
    }
    saveLiveOrders();
    syncCustomerOrders();
    renderOrderCards();
    renderTrackerList();
    syncPaymentDialog();
    const dialog = $('modal-receipt');
    if (!dialog.classList.contains('hidden')) {
      const displayed = state.orders.find(order => order.id === dialog.dataset.ticket);
      if (displayed) showReceipt(displayed);
    }
    return true;
  } catch (_) { return false; }
}

function needsPaymentDialog(order) {
  return Boolean(order.cashDueAt && order.paymentStatus === 'unpaid');
}

let cashTimer;
let awaitingTicket;
function rememberPayment(ticket) {
  awaitingTicket = ticket;
  try {
    if (ticket) sessionStorage.setItem('tagak.pendingCash', ticket);
    else sessionStorage.removeItem('tagak.pendingCash');
  } catch (_) {}
}

function showCashPayment(order) {
  const dialog = $('cash-dialog');
  rememberPayment(order.id);
  clearInterval(cashTimer);
  const voided = order.status === 'cancelled';
  $('cash-ticket').textContent = order.id;
  $('cash-title').textContent = voided ? 'Order voided' : 'Pay at the counter';
  $('cash-message').textContent = voided
    ? (order.cashExpired ? 'Payment was not received within five minutes.' : 'The counter cancelled this order.')
    : 'Give the cashier ' + formatMoney(order.total) + ' and your order number.';
  $('cash-time-row').hidden = voided;
  $('cash-dismiss').hidden = !voided;
  if (!voided) {
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((order.remainingUntil - performance.now()) / 1000));
      $('cash-time').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    };
    tick();
    cashTimer = setInterval(tick, 250);
  }
  if (!dialog.open) {
    if ($('screen-tracker').classList.contains('active')) showScreen('landing');
    dialog.showModal();
  }
}

function syncPaymentDialog() {
  const pending = state.orders.find(order => needsPaymentDialog(order) && !order.dismissed);
  if (pending) return showCashPayment(pending);
  if (!awaitingTicket) return;
  const order = state.orders.find(item => item.id === awaitingTicket);
  if (!order && trackedTickets.has(awaitingTicket)) return;
  clearInterval(cashTimer);
  rememberPayment(null);
  $('cash-dialog').close();
  if (order?.paymentStatus === 'paid') openTracker();
}

function restoreLiveOrders() {
  try { awaitingTicket = sessionStorage.getItem('tagak.pendingCash'); } catch (_) {}
  try {
    const tickets = JSON.parse(sessionStorage.getItem(LIVE_ORDERS_KEY) || '[]');
    for (const ticket of tickets) if (typeof ticket === 'string') trackedTickets.add(ticket);
  } catch (_) { /* Session storage may be unavailable. */ }
  if (trackedTickets.size) renderTrackerSkeleton(trackedTickets.size);
}

function paymentMessage(order) {
  if (order.paymentStatus === 'paid') return order.payment === 'qr' ? 'Paid by QR (GCash / Maya)' : 'Paid by cash';
  if (order.status === 'cancelled') return 'Order cancelled';
  if (order.paymentStatus === 'unpaid') return 'Pay ' + formatMoney(order.total) + ' at the counter';
  return 'Cash collection unverified · Check with the cashier';
}

function showReceipt(order) {
  const dialog = $('modal-receipt');
  dialog.dataset.ticket = order.id;
  dialog.setAttribute('aria-label', order.paymentStatus === 'paid' ? 'Payment receipt' : 'Order ticket');
  const lines = order.items.map((item) => {
    const details = [
      item.temperature ? TEMPERATURE_LABELS[item.temperature] : '',
      item.size && item.size !== '-' ? item.size : '',
      ...(item.addOns || []).map((addOn) => addOn.name),
      item.instructions || '',
    ].filter(Boolean).join(', ');
    const amount = (Number(item.unitPrice) + Number(item.addOnPrice || 0)) * Number(item.qty);
    return `
      <div class="receipt-line">
        <span class="receipt-qty">${Number(item.qty)}x</span>
        <span class="receipt-name">${esc(item.name)}${details ? `<small>${esc(details)}</small>` : ''}</span>
        <span>${formatMoney(amount)}</span>
      </div>`;
  }).join('');
  const placed = order.placedAt.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  $('receipt-body').innerHTML = `
    <p class="receipt-brand">Tagak CAFÉ</p>
    <p class="receipt-meta">${order.paymentStatus === 'paid' ? 'Payment receipt' : 'Order ticket'}</p>
    <p class="receipt-branch">${esc(branchNameFor(order))}</p>
    <p class="receipt-meta">Ticket <strong>${esc(order.id)}</strong></p>
    ${order.nickname ? `<p class="receipt-meta">Name <b class="receipt-nickname">${esc(order.nickname)}</b></p>` : ''}
    <p class="receipt-meta">${esc(placed)} · ${esc(orderModeLabel(order.orderMode))} · ${esc(paymentMessage(order))}</p>
    <div class="receipt-lines">${lines}</div>
    <div class="receipt-total"><span>Subtotal</span><span>${formatMoney(order.subtotal)}</span></div>
    <div class="receipt-total"><span>${esc(vatLabel())}</span><span>${formatMoney(order.vat)}</span></div>
    <div class="receipt-total receipt-grand"><span>Total</span><span>${formatMoney(order.total)}</span></div>
    <p class="receipt-foot">Thank you for ordering with Tagak CAFÉ.</p>`;
  if (dialog.classList.contains('hidden')) showOverlay('modal-receipt');
}

/* ═══════════════════════════════════════════
   GLOBAL ACTIONS
   ═══════════════════════════════════════════ */

function initGlobalActions() {
  document.querySelector('.storefront-brand')?.addEventListener('click', () => {
    $('screen-menu').scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('header-cart')?.addEventListener('click', () => {
    renderCheckout();
    showScreen('checkout');
  });

  $('basket-pill').addEventListener('click', () => {
    renderCheckout();
    showScreen('checkout');
  });

  $('tracker-back').addEventListener('click', () => showScreen('menu'));

  $('home-order-status').addEventListener('click', openTracker);
  $('menu-order-status').addEventListener('click', openTracker);

  $('tracker-list').addEventListener('click', (e) => {
    const receipt = e.target.closest('[data-receipt]');
    if (receipt) {
      const order = state.orders.find((candidate) => candidate.id === receipt.dataset.receipt);
      if (order) showReceipt(order);
      return;
    }
    const dismiss = e.target.closest('[data-dismiss]');
    if (dismiss) {
      dismissLiveOrder(dismiss.dataset.dismiss);
      showToast('Enjoy your brew!');
    }
  });
}

/* ═══════════════════════════════════════════
   HERO CAROUSEL
   ═══════════════════════════════════════════ */

function renderHero() {
  const promos = CATALOG.carousel || [];
  const markup = promos.map((promo, index) => `
    <button class="hero-slide">
      <img class="img-loading" src="${escAttr(promo.publicUrl)}" alt="Tagak carousel image ${index + 1}">
      <span class="hero-copy"><small>Prepared to order at Tagak.</small></span>
    </button>`).join('');
  const wrap = $('home-hero');
  wrap.innerHTML = markup;
  wrap.classList.toggle('hidden', promos.length === 0);
  const menuHero = $('menu-hero');
  if (menuHero) {
    menuHero.innerHTML = markup;
    menuHero.classList.toggle('hidden', promos.length === 0);
  }
}

function enableDragScroll(el) {
  if (!el) return;
  let isDown = false;
  let startX = 0;
  let startScroll = 0;
  let dragged = false;

  const setCursor = (cursor) => { el.style.cursor = cursor; };
  const end = () => {
    isDown = false;
    setCursor('grab');
  };

  el.addEventListener('mousedown', (e) => {
    isDown = true;
    dragged = false;
    startX = e.pageX;
    startScroll = el.scrollLeft;
    setCursor('grabbing');
  });

  el.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    el.scrollLeft = startScroll - (e.pageX - startX);
    if (Math.abs(e.pageX - startX) > 5) dragged = true;
  });

  el.addEventListener('mouseup', end);
  el.addEventListener('mouseleave', end);

  el.addEventListener('click', (e) => {
    if (dragged) {
      e.preventDefault();
      e.stopPropagation();
      dragged = false;
    }
  }, true);

  setCursor('grab');
}

function initHeroAutoplay() {
  document.querySelectorAll('.hero-carousel').forEach((hero) => {
    let timer = null;
    const slideOffset = (slide) => slide.getBoundingClientRect().left - hero.getBoundingClientRect().left + hero.scrollLeft;
    const centeredOffset = (slide) => slideOffset(slide) + slide.offsetWidth / 2 - hero.clientWidth / 2;
    const next = () => {
      const slides = Array.from(hero.querySelectorAll('.hero-slide'));
      if (slides.length < 2 || hero.scrollWidth <= hero.clientWidth + 2) return;
      const current = slides.reduce((best, slide, index) => (
        Math.abs(centeredOffset(slide) - hero.scrollLeft) < Math.abs(centeredOffset(slides[best]) - hero.scrollLeft) ? index : best
      ), 0);
      const target = slides[(current + 1) % slides.length];
      hero.scrollTo({ left: Math.max(0, centeredOffset(target)), behavior: 'smooth' });
    };
    const restart = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (timer) clearInterval(timer);
      timer = setInterval(next, 3600);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    ['mouseenter', 'focusin', 'mousedown', 'touchstart', 'wheel'].forEach((eventName) => {
      hero.addEventListener(eventName, stop, { passive: true });
    });
    ['mouseleave', 'focusout', 'mouseup', 'touchend'].forEach((eventName) => {
      hero.addEventListener(eventName, restart, { passive: true });
    });
    restart();
  });
}

/* ═══════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════ */

/** Shows or hides the "Store Closed" state and pauses the ordering controls to match the register. */
function renderStoreStatus() {
  const open = CATALOG.settings.storeOpen !== false;
  document.querySelectorAll('.store-closed-banner').forEach((el) => el.classList.toggle('hidden', open));
  ['btn-place-order', 'btn-add-order'].forEach((id) => {
    const btn = $(id);
    if (btn) btn.disabled = !open;
  });
}

async function refreshStoreStatus() {
  try {
    const q = state.branch ? `?branchId=${encodeURIComponent(state.branch.id)}` : '';
    const res = await fetch(`/api/public/settings${q}`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const settings = await res.json();
    const wasOpen = CATALOG.settings.storeOpen !== false;
    CATALOG.settings.storeOpen = settings.storeOpen !== false;
    renderStoreStatus();
    if (wasOpen && !CATALOG.settings.storeOpen) showToast('We have just closed. Orders are paused.');
  } catch (_) {
    /* The next check will try again. */
  }
}

async function init() {
  document.addEventListener('load', handleImageLoad, true);
  document.addEventListener('error', handleImageError, true);
  bindSheet();
  bindCheckout();
  initGlobalActions();
  renderCatalogSkeleton();

  try {
    await loadCatalog();
  } catch (err) {
    showToast(err.message || 'The menu could not be loaded');
  }
  renderStoreStatus();
  window.addEventListener('focus', refreshStoreStatus);

  initLanding();
  renderHero();
  document.querySelectorAll('.hero-carousel').forEach(enableDragScroll);
  enableDragScroll($('home-featured'));
  initHeroAutoplay();
  const receiptToken = new URLSearchParams(location.hash.slice(1)).get('track');
  if (receiptToken) {
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const response = await fetch('/api/public/orders/claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: receiptToken }),
      });
      if (!response.ok) throw new Error();
      trackedTickets.add((await response.json()).ticketNo);
    } catch (_) { showToast('This tracking link could not be opened.'); }
  }
  $('cash-dialog').addEventListener('cancel', event => event.preventDefault());
  $('cash-dismiss').addEventListener('click', () => {
    dismissLiveOrder(awaitingTicket);
    rememberPayment(null);
    $('cash-dialog').close();
    showScreen(state.branch ? 'menu' : 'landing');
    syncPaymentDialog();
  });
  restoreLiveOrders();
  showScreen('landing');
  if (trackedTickets.size) {
    await refreshLiveOrders();
    syncCustomerOrders();
    if (receiptToken && liveOrders().length) openTracker();
  }
  document.body.dataset.appReady = 'true';
}

document.addEventListener('DOMContentLoaded', init);
