/**
 * File: inventory.js
 * Path: pos-app/js/inventory.js
 * Description: Inventory & store management module for the POS.
 *              Handles three sub-views:
 *              1. Menu & Recipes — combined master/detail UI where each menu
 *                 item's product details (name/category/price/description/image/status) and
 *                 its ingredient recipe are edited in one pane, with an
 *                 "Add Ingredient" dropdown sourced from SUPPLIES.
 *              2. Supplies Management — CRUD for dynamic supplies with price
 *                 history (batch/historical costing).
 *              3. Item-Based Reports — date-range filtered table computing
 *                 Revenue, COGS (historical supply costs) and Net Profit.
 */

/* ═══════════════════════════════════════════
   SHARED STATE
   ═══════════════════════════════════════════ */

let editingSupplyId = null;     // id of supply being edited in the modal (null = new)
let recipeIngredientId = null;  // selected menu item in the Menu & Recipes master/detail
let pendingMenuImage = null;
let pendingMenuImageId = null;
let pendingDelete = null;       // { type: 'menu' | 'supply', id } awaiting confirmation in the delete modal
let reportStartISO = null;
let reportEndISO = null;

/* ═══════════════════════════════════════════
   INITIALIZATION
   ═══════════════════════════════════════════ */

function initMenuRecipes() {
  recipeIngredientId = firstLiveMenuId();
  renderRecipeList();
  renderRecipeDetail();
  bindRecipeEvents();
  renderSuppliesTable();
  bindSuppliesEvents();
  bindDeleteConfirmEvents();
}

function firstLiveMenuId() {
  const live = liveMenuItems();
  return live.length ? live[0].id : null;
}

function initAnalytics() {
  // Default range = last 7 days so analytics are immediately meaningful
  // even when there are no sales yet today.
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  $('#report-start').value = toDateInput(start);
  $('#report-end').value = toDateInput(end);
  reportStartISO = toDateInput(start);
  reportEndISO = toDateInput(end);
  activePreset = 'daily';
  createCharts();
  bindPresetButtons();
  bindReportEvents();
  renderAnalytics();
}

/* ═══════════════════════════════════════════
   1. MENU & RECIPES (combined master / detail)
   ═══════════════════════════════════════════ */

async function toggleSoldOut(id) {
  const item = POS_MENU.find(i => i.id === id);
  if (!item) return;
  const next = !item.soldOut;
  if (!(await saveMenuItem(item.id, { ...menuItemBody(item), soldOut: next }))) return;
  renderRecipeList();
  if (recipeIngredientId === item.id) renderRecipeDetail();
  showToast(`${item.name} is now ${next ? 'Sold Out' : 'In Stock'}`, next ? 'warning' : 'success');
}

function renderRecipeList() {
  const list = $('#recipe-list');
  if (!list) return;

  const query = ($('#recipe-search')?.value || '').trim().toLowerCase();
  const showArchived = $('#recipe-show-archived')?.checked === true;

  const visible = POS_MENU
    .filter(item => showArchived || !item.archived)
    .filter(item => !query || item.name.toLowerCase().includes(query));

  if (visible.length === 0) {
    list.innerHTML = `<p class="px-3 py-4 text-xs text-slate-600 italic">${query ? 'No menu items match your search.' : 'No menu items yet.'}</p>`;
    return;
  }

  list.innerHTML = visible
    .map(item => {
      const count = (RECIPES[item.id] || []).length;
      const tag = item.archived
        ? ' <span class="text-[10px] font-semibold text-slate-600 uppercase">Archived</span>'
        : item.active === false ? ' <span class="text-[10px] font-semibold text-slate-600 uppercase">Draft</span>' : '';
      const status = item.archived ? '' : `
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <span class="text-[11px] font-semibold ${item.soldOut ? 'text-espresso' : 'text-crema'}">${item.soldOut ? 'Sold Out' : 'In Stock'}</span>
            <button class="sold-out-toggle ${item.soldOut ? 'sold-out' : 'in-stock'}" data-id="${item.id}" title="Toggle sold out" aria-label="Toggle sold out">
              <div class="toggle-sm"></div>
            </button>
          </div>`;
      return `
        <div class="recipe-list-item ${recipeIngredientId === item.id ? 'active' : ''} ${item.archived ? 'is-archived' : ''}" data-menu-id="${item.id}">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-text-dark truncate">${escapeAttr(item.name)}${tag}</p>
            <p class="text-xs text-slate-600 tabular-nums">${count} ingredient${count === 1 ? '' : 's'} &middot; &#8369;${item.price.toFixed(2)}</p>
          </div>${status}
        </div>
      `;
    }).join('');
}

function renderRecipeDetail() {
  const detail = $('#recipe-detail');
  if (!detail) return;
  const prevSupplySelection = $('#recipe-add-supply')?.value || '';

  if (pendingMenuImageId !== recipeIngredientId) {
    pendingMenuImage = null;
    pendingMenuImageId = null;
  }

  const item = getMenuItem(recipeIngredientId);
  if (!item) {
    $('#recipe-detail-title').textContent = 'Select an item';
    detail.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-300 p-8 text-center">
        <p class="text-xs text-slate-600 font-semibold mb-1">No menu item selected</p>
        <p class="text-[11px] text-slate-600">Pick an item on the left, or click &ldquo;+ Add New Item&rdquo; to create one.</p>
      </div>
    `;
    return;
  }

  $('#recipe-detail-title').textContent = item.name;

  if (item.archived) {
    renderArchivedDetail(detail, item);
    return;
  }

  const recipe = RECIPES[item.id] || [];
  const usedIds = recipe.map(r => r.supplyId);
  const available = SUPPLIES.filter(s => !usedIds.includes(s.id));
  const catBadge = item.category === 'Drinks' ? 'badge-brewing' : 'badge-queued';
  const cogs = recipe.reduce((sum, r) => sum + getSupplyPriceAt(getSupply(r.supplyId), new Date().toISOString()) * r.qty, 0);

  const shownImage = pendingMenuImage !== null ? pendingMenuImage : (item.imagePath || '');

  // ── Section 1: Item Details ──
  const detailsCard = `
    <div class="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div class="px-4 py-2.5 bg-foam border-b border-slate-200 flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-slate-700 uppercase tracking-wider">Item Details</span>
        <span class="badge ${catBadge} flex-shrink-0">${item.category}</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
        <div class="sm:col-span-2">
          <label for="mr-name" class="field-label">Name</label>
          <input type="text" id="mr-name" maxlength="60" value="${escapeAttr(item.name)}" class="field-input w-full font-semibold">
        </div>
        <div>
          <label for="mr-category" class="field-label">Category</label>
          <select id="mr-category" class="field-input w-full">
            <option value="Drinks" ${item.category === 'Drinks' ? 'selected' : ''}>Drinks</option>
            <option value="Pastries" ${item.category === 'Pastries' ? 'selected' : ''}>Pastries</option>
          </select>
        </div>
        <div>
          <label for="mr-price" class="field-label">Price (&#8369;)</label>
          <input type="number" id="mr-price" value="${item.price}" min="0" step="5" class="field-input w-full tabular-nums">
        </div>
        <label class="sm:col-span-2 flex items-center gap-2 text-sm text-text-dark ${item.category === 'Drinks' ? '' : 'hidden'}" for="mr-temp">
          <input id="mr-temp" type="checkbox" ${item.hasTemperature ? 'checked' : ''}>
          Offer a Hot / Iced choice for this drink
        </label>
        <label class="sm:col-span-2 flex items-center gap-2 text-sm text-text-dark" for="mr-published">
          <input id="mr-published" type="checkbox" ${item.active !== false ? 'checked' : ''}>
          Published on the customer menu (needs at least one supply)
        </label>
        <div class="sm:col-span-2">
          <span class="field-label">Menu image</span>
          <div class="flex flex-wrap items-center gap-3">
            <div class="w-20 h-20 rounded-lg overflow-hidden border border-slate-200">
              ${shownImage ? `<img id="mr-image-preview" src="${escapeAttr(shownImage)}" alt="" class="w-full h-full object-contain">` : MenuInitials.element(item.name, 'reg-mono ' + regCatSlug(item.category)).outerHTML}
            </div>
            <div class="flex flex-wrap gap-2">
              <label for="mr-image-file" class="btn btn-secondary btn-lg cursor-pointer">Choose image</label>
              <input type="file" id="mr-image-file" accept="image/*" class="hidden">
              <button type="button" id="btn-mr-image-remove" class="btn btn-ghost btn-lg ${shownImage ? '' : 'hidden'}">Remove image</button>
            </div>
          </div>
          <p class="text-xs text-slate-600 mt-1">Full image is preserved. JPG, PNG, or WebP up to 5 MB.</p>
        </div>
        <div class="sm:col-span-2">
          <label for="mr-description" class="field-label">Description</label>
          <textarea id="mr-description" rows="3" class="field-input w-full resize-none">${escapeAttr(item.description || '')}</textarea>
        </div>
        <div class="sm:col-span-2 flex items-center justify-end gap-3 border-t border-slate-200/80 pt-3">
          <button id="btn-save-details" class="btn btn-primary btn-lg">Save Details</button>
        </div>
      </div>
    </div>
  `;

  // ── Section 2: Recipe (Ingredients) ──
  // Each line stacks the supply name over its measurements so the Regular and
  // Large amounts (and their units) always have room, at any pane width.
  const isDrink = item.category === 'Drinks';
  const nowISO = new Date().toISOString();
  const ingredientRows = recipe.map(r => {
    const sup = getSupply(r.supplyId);
    const unit = sup ? escapeAttr(sup.unit) : '';
    const unitPrice = getSupplyPriceAt(sup, nowISO);
    const cost = unitPrice * r.qty;
    const largeCost = unitPrice * (r.largeQty ?? r.qty);
    const supName = sup ? escapeAttr(sup.name) : 'Unknown supply';
    const largeId = `recipe-large-${escapeAttr(r.supplyId)}`;
    const regularId = `recipe-qty-${escapeAttr(r.supplyId)}`;
    return `
      <div class="recipe-line" data-supply-id="${r.supplyId}">
        <div class="recipe-line-head">
          <p class="recipe-line-name">${supName}</p>
          <p class="recipe-line-cost">&#8369;${cost.toFixed(2)} per regular${isDrink ? ` &middot; &#8369;${largeCost.toFixed(2)} per large` : ''}</p>
        </div>
        <button class="btn btn-xs btn-void remove-ingredient recipe-line-remove" data-supply-id="${r.supplyId}" data-menu-id="${item.id}" title="Remove ${supName}" aria-label="Remove ${supName}">&times;</button>
        <div class="recipe-line-measures">
          <div class="recipe-measure">
            <label for="${regularId}" class="recipe-measure-label">${isDrink ? 'Regular' : 'Per serving'}</label>
            <input id="${regularId}" type="number" inputmode="decimal" step="0.1" min="0" value="${r.qty}" class="recipe-qty" data-supply-id="${r.supplyId}" data-menu-id="${item.id}">
            <span class="recipe-measure-unit">${unit}</span>
          </div>
          ${isDrink ? `
          <div class="recipe-measure">
            <label for="${largeId}" class="recipe-measure-label">Large</label>
            <input id="${largeId}" type="number" inputmode="decimal" step="0.1" min="0" value="${r.largeQty ?? ''}" placeholder="${r.qty}" class="recipe-large-qty" data-supply-id="${r.supplyId}" data-menu-id="${item.id}" aria-describedby="recipe-large-hint">
            <span class="recipe-measure-unit">${unit}</span>
          </div>` : ''}
        </div>
      </div>
    `;
  }).join('');
  const largeHint = isDrink && recipe.length
    ? '<p id="recipe-large-hint" class="recipe-large-hint">Leave Large blank to use the Regular amount.</p>'
    : '';

  const addRow = `
    <div class="mt-3 border-t border-slate-200/80 pt-3">
      <label class="field-label" for="recipe-add-supply">Add Ingredient</label>
      <div class="flex gap-2">
        <select id="recipe-add-supply" class="field-input flex-1 min-w-0">
          <option value="">Select a supply&hellip;</option>
          ${available.map(s => `<option value="${escapeAttr(s.id)}">${escapeAttr(s.name)} (${escapeAttr(s.unit)}, &#8369;${currentSupplyPrice(s).toFixed(2)}/${escapeAttr(s.unit)})</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-lg" id="btn-add-ingredient" ${available.length === 0 ? 'disabled' : ''}>Add</button>
      </div>
      ${available.length === 0 ? '<p class="text-xs text-slate-600 mt-1 italic">All supplies are already mapped to this item.</p>' : ''}
    </div>
  `;

  const recipeCard = `
    <div class="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div class="px-4 py-2.5 bg-foam border-b border-slate-200 flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-slate-700 uppercase tracking-wider">Recipe (Ingredients)</span>
        <div class="flex items-center gap-2.5 flex-shrink-0">
          <span class="text-xs text-slate-600 font-medium tabular-nums hidden sm:inline">COGS/serv &#8369;${cogs.toFixed(2)}</span>
          <button class="btn btn-primary btn-lg" id="btn-recipe-save">Save Recipe</button>
        </div>
      </div>
      <div class="p-4">
        <div id="recipe-ingredient-list" class="mb-1">${ingredientRows || '<p class="text-xs text-slate-600 italic py-2">No ingredients mapped yet. Add one below.</p>'}</div>
        ${largeHint}
        ${addRow}
      </div>
    </div>
  `;

  const deleteRow = `
    <div class="flex justify-end">
      <button id="btn-delete-menu-item" class="btn btn-void btn-sm">Archive Menu Item</button>
    </div>
  `;

  detail.innerHTML = `${detailsCard}${recipeCard}${deleteRow}`;
  if (prevSupplySelection && $('#recipe-add-supply')) {
    $('#recipe-add-supply').value = prevSupplySelection;
  }

  const preview = detail.querySelector('#mr-image-preview');
  if (preview) preview.addEventListener('error', () => {
    preview.replaceWith(MenuInitials.element(item.name, 'reg-mono ' + regCatSlug(item.category)));
  }, { once: true });
  if (!permitted('edit_menu')) {
    detail.querySelectorAll('input, select, textarea').forEach(field => { field.disabled = true; });
    return;
  }
  bindMenuRecipesDetailEvents(item.id);
}

async function chooseMenuImage(file) {
  const res = await uploadBranchImage('/api/menu-items/image', file, file.name);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    showToast(data?.error || `Image upload failed (HTTP ${res.status})`, 'error');
    return;
  }
  pendingMenuImage = data.publicUrl;
  pendingMenuImageId = recipeIngredientId;
  renderRecipeDetail();
  showToast('Image ready — save details to publish it', 'success');
}

function bindMenuRecipesDetailEvents(menuId) {
  $('#btn-save-details')?.addEventListener('click', saveItemDetails);
  $('#mr-image-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) chooseMenuImage(file);
  });
  $('#btn-mr-image-remove')?.addEventListener('click', () => {
    pendingMenuImage = '';
    pendingMenuImageId = recipeIngredientId;
    renderRecipeDetail();
  });
  $('#mr-category')?.addEventListener('change', (e) => {
    $('#mr-temp')?.closest('label')?.classList.toggle('hidden', e.target.value !== 'Drinks');
  });
  $('#btn-recipe-save')?.addEventListener('click', saveRecipeDetail);
  $('#btn-add-ingredient')?.addEventListener('click', addIngredientToRecipe);
  $('#btn-delete-menu-item')?.addEventListener('click', deleteMenuRecipesItem);

  $$('#recipe-ingredient-list .recipe-large-qty').forEach(input => {
    input.addEventListener('change', () => {
      const entry = (RECIPES[menuId] || []).find(r => r.supplyId === input.dataset.supplyId);
      if (entry) entry.largeQty = input.value === '' ? null : parseFloat(input.value);
    });
  });

  $$('#recipe-ingredient-list .recipe-qty').forEach(input => {
    input.addEventListener('change', () => {
      const supId = input.dataset.supplyId;
      const qty = parseFloat(input.value) || 0;
      const entry = (RECIPES[menuId] || []).find(r => r.supplyId === supId);
      if (entry) entry.qty = qty;
    });
  });

  $$('#recipe-ingredient-list .remove-ingredient').forEach(btn => {
    btn.addEventListener('click', () => {
      if (RECIPES[menuId]) {
        RECIPES[menuId] = RECIPES[menuId].filter(r => r.supplyId !== btn.dataset.supplyId);
        if (RECIPES[menuId].length === 0) delete RECIPES[menuId];
      }
      renderRecipeList();
      renderRecipeDetail();
    });
  });
}

function menuItemBody(item) {
  const branchId = typeof activePosBranchId === 'function' ? activePosBranchId() : (POS.user?.branchId || null);
  return {
    name: item.name,
    category: item.category,
    price: item.price,
    description: item.description || '',
    hasTemperature: item.category === 'Drinks' && item.hasTemperature === true,
    imagePath: item.imagePath || '',
    soldOut: item.soldOut === true,
    active: item.active !== false,
    ...(branchId ? { branchId } : {}),
  };
}

async function saveMenuItem(id, body) {
  const res = await fetch(`/api/menu-items/${id}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    showToast(data?.error || 'Could not save the menu item', 'error');
    return false;
  }
  await loadMenuItems();
  renderRegisterGrid();
  return true;
}

async function addMenuItem() {
  recipeIngredientId = null;
  renderRecipeDetail();
  const branchId = typeof activePosBranchId === 'function' ? activePosBranchId() : (POS.user?.branchId || null);
  const res = await fetch('/api/menu-items', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New Drink', category: 'Drinks', price: 0, ...(branchId ? { branchId } : {}) }),
  });
  const created = await res.json().catch(() => null);
  if (!res.ok) { showToast(created?.error || 'Could not add the menu item', 'error'); return; }
  await loadMenuItems();
  recipeIngredientId = created.id;

  renderRecipeList();
  renderRecipeDetail();
  scrollRecipeDetailIntoView();

  showToast('Added a draft menu item — add supplies, then publish it', 'success');
}

async function saveItemDetails() {
  const item = getMenuItem(recipeIngredientId);
  if (!item) return;
  const name = $('#mr-name').value.trim();
  if (!name) { showToast('Please enter an item name', 'error'); return; }

  const draft = {
    ...item,
    name,
    category: $('#mr-category').value,
    price: parseFloat($('#mr-price').value) || item.price,
    description: $('#mr-description').value.trim(),
    hasTemperature: $('#mr-temp')?.checked === true,
    imagePath: pendingMenuImage !== null ? pendingMenuImage : (item.imagePath || ''),
    active: $('#mr-published')?.checked === true,
  };

  if (!(await saveMenuItem(item.id, menuItemBody(draft)))) return;
  pendingMenuImage = null;
  pendingMenuImageId = null;

  renderRecipeList();
  renderRecipeDetail();
  showToast('Item details saved successfully!', 'success');
}

function addIngredientToRecipe() {
  const select = $('#recipe-add-supply');
  const supId = select.value;
  if (!supId) return;
  if (!RECIPES[recipeIngredientId]) RECIPES[recipeIngredientId] = [];
  if (RECIPES[recipeIngredientId].some(r => r.supplyId === supId)) return;
  RECIPES[recipeIngredientId].push({ supplyId: supId, qty: 1, largeQty: null });
  renderRecipeList();
  renderRecipeDetail();
}

async function saveRecipeDetail() {
  const menuId = recipeIngredientId;
  if (!menuId) return;
  const recipe = (RECIPES[menuId] || [])
    .map(line => ({
      supplyId: line.supplyId,
      qty: Number(line.qty),
      largeQty: line.largeQty == null || line.largeQty === '' ? null : Number(line.largeQty),
    }))
    .filter(line => line.qty > 0);
  try {
    await fetchJson(`/api/menu-items/${encodeURIComponent(menuId)}/recipe`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recipe),
    });
    RECIPES[menuId] = recipe;
    renderRecipeList();
    renderRecipeDetail();
    showToast('Recipe saved successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function deleteMenuRecipesItem() {
  const item = getMenuItem(recipeIngredientId);
  if (!item) return;
  pendingDelete = { type: 'menu', id: item.id };
  $('#delete-modal-title').textContent = 'Archive Menu Item';
  $('#delete-modal-msg').textContent = `Archive "${item.name}"? It leaves the register and customer menu right away. Past orders, its recipe, and sales reports keep it, and you can restore it later from "Show archived items".`;
  $('#btn-delete-confirm').textContent = 'Archive';
  openModal('delete-confirm-modal');
}

async function doDeleteMenuItem(id) {
  const item = getMenuItem(id);
  if (!item) return;

  const res = await fetch(`/api/menu-items/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
  const data = await res.json().catch(() => null);
  if (!res.ok) { showToast(data?.error || 'Could not archive the menu item', 'error'); return; }
  await loadMenuItems();
  renderRegisterGrid();

  if (recipeIngredientId === id && $('#recipe-show-archived')?.checked !== true) {
    recipeIngredientId = firstLiveMenuId();
  }
  renderRecipeList();
  renderRecipeDetail();
  showToast(`Archived "${item.name}". Reports still include its past sales.`, 'warning');
}

async function restoreMenuItem(id) {
  const item = getMenuItem(id);
  if (!item) return;
  const res = await fetch(`/api/menu-items/${encodeURIComponent(id)}/restore`, { method: 'POST', credentials: 'same-origin' });
  const data = await res.json().catch(() => null);
  if (!res.ok) { showToast(data?.error || 'Could not restore the menu item', 'error'); return; }
  await loadMenuItems();
  renderRegisterGrid();
  recipeIngredientId = id;
  renderRecipeList();
  renderRecipeDetail();
  showToast(`Restored "${item.name}" as a draft. Publish it when it is ready to sell.`, 'success');
}

/** Read-only view of an archived item: what it was, and a way back. */
function renderArchivedDetail(detail, item) {
  const recipe = RECIPES[item.id] || [];
  const isDrink = item.category === 'Drinks';
  const archivedOn = item.archivedAt
    ? new Date(item.archivedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const lines = recipe.map(r => {
    const sup = getSupply(r.supplyId);
    const unit = sup ? escapeAttr(sup.unit) : '';
    return `
      <div class="recipe-line recipe-line-readonly">
        <div class="recipe-line-head"><p class="recipe-line-name">${sup ? escapeAttr(sup.name) : 'Unknown supply'}</p></div>
        <div class="recipe-line-measures">
          <p class="recipe-measure"><span class="recipe-measure-label">${isDrink ? 'Regular' : 'Per serving'}</span><span class="recipe-measure-value">${r.qty} ${unit}</span></p>
          ${isDrink ? `<p class="recipe-measure"><span class="recipe-measure-label">Large</span><span class="recipe-measure-value">${r.largeQty ?? r.qty} ${unit}</span></p>` : ''}
        </div>
      </div>`;
  }).join('');

  detail.innerHTML = `
    <div class="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div class="px-4 py-3 bg-foam border-b border-slate-200">
        <p class="text-sm font-semibold text-text-dark">Archived${archivedOn ? ` on ${archivedOn}` : ''}</p>
        <p class="text-xs text-slate-600 mt-0.5">Hidden from the register and customer menu. Past orders and sales reports still use it.</p>
      </div>
      <div class="p-4">
        <p class="text-xs text-slate-600 mb-2 tabular-nums">${escapeAttr(item.category)} &middot; &#8369;${item.price.toFixed(2)}</p>
        ${lines || '<p class="text-xs text-slate-600 italic py-2">No ingredients were mapped.</p>'}
        <div class="flex justify-end border-t border-slate-200/80 pt-3 mt-3">
          <button id="btn-restore-menu-item" class="btn btn-primary btn-lg">Restore as Draft</button>
        </div>
      </div>
    </div>
  `;
  $('#btn-restore-menu-item')?.addEventListener('click', () => restoreMenuItem(item.id));
}

function bindRecipeEvents() {
  // Delegated master list clicks — survive list re-renders
  $('#recipe-list')?.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.sold-out-toggle');
    if (toggleBtn) {
      e.stopPropagation();
      toggleSoldOut(toggleBtn.dataset.id);
      return;
    }
    const itemEl = e.target.closest('.recipe-list-item');
    if (!itemEl) return;
    recipeIngredientId = itemEl.dataset.menuId;
    renderRecipeList();
    renderRecipeDetail();
    scrollRecipeDetailIntoView();
  });

  $('#btn-add-menu-item')?.addEventListener('click', addMenuItem);
  $('#recipe-search')?.addEventListener('input', renderRecipeList);
  $('#recipe-show-archived')?.addEventListener('change', (e) => {
    const current = getMenuItem(recipeIngredientId);
    if (!e.target.checked && current?.archived) {
      recipeIngredientId = firstLiveMenuId();
      renderRecipeDetail();
    }
    renderRecipeList();
  });
}

// Mobile only: bring the detail pane into view after selecting / adding an item.
function scrollRecipeDetailIntoView() {
  if (window.innerWidth >= 1024) return;
  const pane = $('#menu-recipes-detail-pane');
  if (pane) pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ═══════════════════════════════════════════
   2. SUPPLIES MANAGEMENT (CRUD + HISTORY)
   ═══════════════════════════════════════════ */

async function refreshSupplies() {
  const perms = POS.user?.permissions || {};
  if (!perms.view_supplies) return true;
  try {
    await loadSupplies();
    renderSuppliesTable();
    return true;
  } catch {
    return false;
  }
}

function renderSuppliesTable() {
  const tbody = $('#supplies-table-body');
  if (!tbody) return;

  const query = ($('#supplies-search')?.value || '').trim().toLowerCase();

  tbody.innerHTML = SUPPLIES
    .filter(sup => !query || sup.name.toLowerCase().includes(query))
    .map(sup => {
    const current = currentSupplyPrice(sup);
    return `
      <tr data-supply-id="${escapeAttr(sup.id)}">
        <td data-label="Supply" class="font-semibold">${escapeAttr(sup.name)}</td>
        <td data-label="Unit" class="font-mono text-xs">${escapeAttr(sup.unit)}</td>
        <td data-label="Stock" class="tabular-nums">${sup.stock.toLocaleString()}</td>
        <td data-label="Cost/Unit" class="tabular-nums font-semibold">&#8369;${current.toFixed(2)}<span class="text-xs font-normal text-slate-600"> / ${escapeAttr(sup.unit)}</span></td>
        <td data-label="Price History">
          <span class="badge badge-brewing cursor-pointer view-history" data-supply-id="${escapeAttr(sup.id)}" title="View price history">${sup.priceLogs.length} change${sup.priceLogs.length > 1 ? 's' : ''}</span>
        </td>
        <td data-label="Actions" class="td-actions">
          <div class="flex gap-1">
            <button class="btn btn-sm btn-ghost edit-supply" data-supply-id="${escapeAttr(sup.id)}">Edit</button>
            <button class="btn btn-sm btn-void delete-supply" data-supply-id="${escapeAttr(sup.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function bindSuppliesEvents() {
  $('#btn-add-supply')?.addEventListener('click', () => openSupplyModal(null));
  $('#btn-supply-save')?.addEventListener('click', saveSupply);
  $('#btn-supply-cancel')?.addEventListener('click', closeSupplyModal);
  $('#btn-supply-cancel2')?.addEventListener('click', closeSupplyModal);
  $('#btn-add-pricelog')?.addEventListener('click', addPriceLogRow);
  $('#supplies-search')?.addEventListener('input', renderSuppliesTable);

  // History modal
  $('#btn-close-history')?.addEventListener('click', () => closeModal('supply-history-modal'));
  $('#supply-history-modal')?.addEventListener('click', (e) => { if (e.target.id === 'supply-history-modal') closeModal('supply-history-modal'); });
  $('#supplies-modal')?.addEventListener('click', (e) => { if (e.target.id === 'supplies-modal') closeSupplyModal(); });

  // Row actions — delegated so they survive table re-renders
  $('#supplies-table-body')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-supply');
    const delBtn = e.target.closest('.delete-supply');
    const histBadge = e.target.closest('.view-history');
    if (editBtn) openSupplyModal(editBtn.dataset.supplyId);
    else if (delBtn) deleteSupply(delBtn.dataset.supplyId);
    else if (histBadge) viewSupplyHistory(histBadge.dataset.supplyId);
  });
}

function openSupplyModal(id) {
  editingSupplyId = id || null;
  const isEdit = !!editingSupplyId;
  const sup = isEdit ? getSupply(editingSupplyId) : null;

  $('#supplies-form-title').textContent = isEdit ? `Edit Supply — ${sup.name}` : 'Add Supply';
  $('#sup-name').value = sup ? sup.name : '';
  const unit = sup?.unit ?? 'g';
  $('#sup-unit').value = unit === 'pcs' ? 'pc' : unit;
  $('#sup-stock').value = sup ? sup.stock : 0;

  // Price log rows. Existing entries are historical records and stay read-only;
  // new entries can be appended to record a price change.
  const container = $('#sup-price-logs');
  container.innerHTML = '';
  const logs = sup ? sup.priceLogs : [];
  logs.forEach(log => addPriceLogRow(log.price, toDateInput(log.date), container, true));
  if (!sup) addPriceLogRow(0, toDateInput(new Date()), container, false);

  openModal('supplies-modal');
}

function addPriceLogRow(price = 0, date = null, container, existing = false) {
  const box = container || $('#sup-price-logs');
  if (!box) return;
  const wrapper = document.createElement('div');
  wrapper.className = `plog-row flex items-center gap-2 flex-1${existing ? ' opacity-80' : ''}`;
  if (existing) wrapper.dataset.existing = 'true';
  wrapper.innerHTML = `
    <label class="text-[11px] font-semibold text-slate-600 uppercase w-9 flex-shrink-0">Date</label>
    <input type="date" class="plog-date field-input field-input-sm flex-1 tabular-nums" value="${date || toDateInput(new Date())}" ${existing ? 'disabled' : ''}>
    <label class="text-[11px] font-semibold text-slate-600 uppercase flex-shrink-0">Cost/${getUnitLabel()}</label>
    <input type="number" step="0.001" min="0" class="plog-price field-input field-input-sm w-24 tabular-nums" value="${price}" ${existing ? 'disabled' : ''}>
    ${existing
      ? '<span class="inline-flex items-center justify-center text-slate-600 w-5 h-5" title="Saved price history entry"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg></span>'
      : '<button type="button" class="btn btn-xs btn-void plog-remove" aria-label="Remove price log">&#10005;</button>'}
  `;
  wrapper.querySelector('.plog-remove')?.addEventListener('click', () => {
    wrapper.remove();
  });
  box.appendChild(wrapper);
}

function getUnitLabel() {
  return escapeAttr($('#sup-unit')?.value || 'unit');
}

function collectPriceLogs() {
  return Array.from($$('#sup-price-logs > .plog-row:not([data-existing])')).map(row => ({
    price: parseFloat(row.querySelector('.plog-price').value) || 0,
    date: new Date(row.querySelector('.plog-date').value + 'T00:00:00').toISOString(),
  })).filter(l => !isNaN(new Date(l.date).getTime()));
}

async function saveSupply() {
  const name = $('#sup-name').value.trim();
  const unit = $('#sup-unit').value;
  const stock = parseFloat($('#sup-stock').value) || 0;
  if (!name) { showToast('Please enter a supply name', 'error'); return; }

  const priceLogs = collectPriceLogs();
  // Sort ascending by date.
  priceLogs.sort((a, b) => new Date(a.date) - new Date(b.date));

  const isEdit = !!editingSupplyId;
  try {
    if (isEdit) {
      await fetchJson(`/api/supplies/${encodeURIComponent(editingSupplyId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, unit, stock }),
      });
      for (const log of priceLogs) {
        await fetchJson(`/api/supplies/${encodeURIComponent(editingSupplyId)}/price-logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ price: log.price, effectiveAt: log.date }),
        });
      }
    } else {
      const body = { name, unit, stock };
      if (priceLogs.length) {
        body.price = priceLogs[0].price;
        body.effectiveAt = priceLogs[0].date;
      }
      const created = await fetchJson('/api/supplies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      for (const log of priceLogs.slice(1)) {
        await fetchJson(`/api/supplies/${encodeURIComponent(created.id)}/price-logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ price: log.price, effectiveAt: log.date }),
        });
      }
    }

    await Promise.all([loadSupplies(), loadRecipes()]);
    closeSupplyModal();
    renderSuppliesTable();
    renderRecipeList();
    renderRecipeDetail();
    showToast(isEdit ? 'Supply updated' : 'Supply added', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function deleteSupply(id) {
  const sup = getSupply(id);
  if (!sup) return;
  pendingDelete = { type: 'supply', id };
  $('#delete-modal-title').textContent = 'Delete Supply';
  $('#btn-delete-confirm').textContent = 'Delete';
  $('#delete-modal-msg').textContent = `Delete supply "${sup.name}"? Records referencing it may lose recipe mappings. This cannot be undone.`;
  openModal('delete-confirm-modal');
}

async function doDeleteSupply(id) {
  const sup = getSupply(id);
  if (!sup) return;

  try {
    await fetchJson(`/api/supplies/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await Promise.all([loadSupplies(), loadRecipes()]);
    renderSuppliesTable();
    renderRecipeList();
    renderRecipeDetail();
    showToast('Supply deleted', 'warning');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ═══════════════════════════════════════════
   DELETE CONFIRMATION MODAL HOSTING
   ═══════════════════════════════════════════ */

function bindDeleteConfirmEvents() {
  $('#btn-delete-confirm')?.addEventListener('click', confirmDelete);
  $('#btn-delete-cancel')?.addEventListener('click', cancelDeleteConfirm);
  $('#delete-confirm-modal')?.addEventListener('click', (e) => { if (e.target.id === 'delete-confirm-modal') cancelDeleteConfirm(); });
}

function cancelDeleteConfirm() {
  pendingDelete = null;
  closeModal('delete-confirm-modal');
}

function confirmDelete() {
  if (!pendingDelete) return;
  const { type, id } = pendingDelete;
  pendingDelete = null;
  closeModal('delete-confirm-modal');
  if (type === 'menu') doDeleteMenuItem(id);
  else if (type === 'supply') doDeleteSupply(id);
}

function viewSupplyHistory(id) {
  const sup = getSupply(id);
  if (!sup) return;
  const list = sup.priceLogs.map(log =>
    `<div class="flex justify-between items-center py-2 border-b border-slate-200/80 last:border-0">
       <span class="text-xs text-slate-600 tabular-nums">${new Date(log.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
       <span class="text-sm font-semibold tabular-nums">&#8369;${log.price.toFixed(2)} / ${sup.unit}</span>
     </div>`
  ).join('');
  $('#history-card-title').textContent = `Price History — ${sup.name}`;
  $('#history-card-body').innerHTML = list || '<p class="text-xs text-slate-600 italic">No price history recorded.</p>';
  openModal('supply-history-modal');
}

function closeSupplyModal() {
  editingSupplyId = null;
  closeModal('supplies-modal');
}

/* ═══════════════════════════════════════════
   3. ITEM-BASED REPORTS (date range)
   ═══════════════════════════════════════════ */

function bindReportEvents() {
  const apply = () => {
    reportStartISO = $('#report-start').value;
    reportEndISO = $('#report-end').value;
    renderAnalytics();
  };
  ['#report-start', '#report-end'].forEach(sel => {
    $(sel)?.addEventListener('change', apply);
  });

  $('#btn-report-print')?.addEventListener('click', generatePDFReport);

  // Collapsible detailed breakdown
  const toggleBtn = $('#btn-toggle-breakdown');
  const body = $('#breakdown-body');
  if (toggleBtn && body) {
    toggleBtn.addEventListener('click', () => {
      const open = body.classList.toggle('hidden');
      toggleBtn.setAttribute('aria-expanded', String(!open));
    });
  }
}

function formatMoney(n) {
  return '\u20B1' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function generatePDFReport() {
  if (!canViewModule('analytics') || !permitted('export_reports')) return;
  const params = new URLSearchParams({ from: reportStartISO, to: reportEndISO });
  try {
    const response = await fetch('/api/orders/report-export?' + params, { cache: 'no-store' });
    if (!response.ok) throw Error('Report download unavailable (' + response.status + ')');
    if (response.headers.get('Content-Type')?.startsWith('text/html')) {
      const html = await response.text();
      const win = window.open('', '_blank');
      if (!win) throw Error('Allow popups to print the report');
      win.document.write(html);
      win.document.close();
      win.print();
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Tagak_Sales_Report_' + params.get('from') + '_to_' + params.get('to') + '.pdf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('PDF report downloaded', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderReportTable() {
  const tbody = $('#report-tbody');
  if (!tbody) return;

  const rows = generateItemReport(reportStartISO, reportEndISO);
  const visible = rows.filter(r => r.sold > 0 || r.revenue > 0);

  // Summary (includes Pay-Ins in branch revenue and net profit)
  const summary = generateSummaryReport(reportStartISO, reportEndISO);
  $('#report-summary-revenue').textContent = formatMoney(summary.revenue);
  const payInsEl = $('#report-summary-pay-ins');
  if (payInsEl) payInsEl.textContent = formatMoney(summary.payIns);
  $('#report-summary-cogs').textContent = formatMoney(summary.cogs);
  const cashExpEl = $('#report-summary-cash-expenses');
  if (cashExpEl) cashExpEl.textContent = formatMoney(summary.cashExpenses);
  $('#report-summary-profit').textContent = formatMoney(summary.profit);
  $('#report-summary-orders').textContent = summary.orders;

  const dateLabel = `${
    reportStartISO ? new Date(reportStartISO).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Start'
  } — ${
    reportEndISO ? new Date(reportEndISO).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'End'
  }`;
  $('#report-range-label').textContent = dateLabel;

  if (visible.length === 0 && summary.payIns <= 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No completed sales in the selected date range.</td></tr>';
    return;
  }

  const itemMarkup = visible.map(row => {
    const margin = row.revenue > 0 ? (row.profit / row.revenue) * 100 : 0;
    const breakdown = row.deductions.map(d =>
      `<div class="report-deduction">
        <span class="text-slate-600">${escapeAttr(d.ingredient)} <span class="whitespace-nowrap">(${servingLabel(d)})</span></span>
        <span class="font-semibold whitespace-nowrap tabular-nums">${d.totalDeducted.toLocaleString()} ${escapeAttr(d.unit)}</span>
      </div>`
    ).join('');
    return `
      <tr>
        <td data-label="Item" class="font-semibold">${escapeAttr(row.name)}</td>
        <td data-label="Category">
          <span class="badge ${row.category === 'Drinks' ? 'badge-brewing' : 'badge-queued'}">${row.category}</span>
        </td>
        <td data-label="Qty Sold" class="tabular-nums">${row.sold}</td>
        <td data-label="Revenue" class="tabular-nums font-semibold">${formatMoney(row.revenue)}</td>
        <td data-label="COGS" class="tabular-nums text-slate-700">${formatMoney(row.cogs)}</td>
        <td data-label="Net Profit" class="tabular-nums font-semibold ${row.profit >= 0 ? 'text-crema' : 'text-espresso'}">${formatMoney(row.profit)}</td>
      </tr>
      <tr class="report-breakdown-row">
        <td colspan="6" class="!pt-0 !pb-3 bg-foam/60">
          <div class="flex items-start gap-2">
            <span class="text-[11px] font-semibold text-slate-600 uppercase tracking-wider w-24 pt-0.5">Breakdown</span>
            <div class="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              ${breakdown}
              ${row.deductions.length === 0 ? '<p class="text-xs text-slate-600 italic">No ingredients mapped</p>' : ''}
            </div>
            <span class="text-[11px] font-semibold text-slate-600 uppercase tracking-wider pt-0.5 tabular-nums">Margin ${margin.toFixed(1)}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const payInRowMarkup = summary.payIns > 0 ? `
    <tr class="bg-foam">
      <td data-label="Item" class="font-semibold">Cash Drawer Pay-Ins</td>
      <td data-label="Category"><span class="badge badge-ready">Pay-In</span></td>
      <td data-label="Qty Sold" class="tabular-nums">${summary.payInCount}</td>
      <td data-label="Revenue" class="tabular-nums font-semibold">${formatMoney(summary.payIns)}</td>
      <td data-label="COGS" class="tabular-nums text-slate-700">${formatMoney(0)}</td>
      <td data-label="Net Profit" class="tabular-nums font-semibold text-crema">${formatMoney(summary.payIns)}</td>
    </tr>
  ` : '';

  tbody.innerHTML = itemMarkup + payInRowMarkup;
}

/* ═══════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════ */

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** "18 g/serv" or, when a Large amount differs, "18 g reg / 24 g large". */
function servingLabel(d) {
  const u = escapeAttr(d.unit);
  if (d.largeQtyPerServing == null || d.largeQtyPerServing === d.qtyPerServing) {
    return `${d.qtyPerServing} ${u}/serv`;
  }
  return `${d.qtyPerServing} ${u} reg / ${d.largeQtyPerServing} ${u} large`;
}

function toDateInput(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
