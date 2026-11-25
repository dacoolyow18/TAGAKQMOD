/**
 * Add-ons management for the POS. Add-ons are stored on the server and shown
 * in two sections: "Add-ons for Drinks" and "Add-ons for Pastries".
 */

const ADD_ON_SECTIONS = [
  { scope: 'drink', label: 'Add-ons for Drinks' },
  { scope: 'pastry', label: 'Add-ons for Pastries' },
];

let ADD_ONS = [];
let editingAddOnId = null;

function mapAddOnForPos(record) {
  const section = ADD_ON_SECTIONS.find(s => s.scope === record.appliesTo);
  return {
    id: record.id,
    name: record.name,
    price: record.price,
    appliesTo: record.appliesTo,
    group: section ? section.label : record.appliesTo,
    active: record.active,
    supplies: record.supplies || [],
  };
}

async function loadAddOns() {
  const branchId = typeof activePosBranchId === 'function' ? activePosBranchId() : (typeof POS !== 'undefined' ? POS.user?.branchId : null);
  const q = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  const res = await fetch(`/api/add-ons${q}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Add-ons could not be loaded (${res.status})`);
  const rows = await res.json();
  ADD_ONS = rows
    .filter(record => !branchId || !record.branchId || record.branchId === branchId)
    .map(mapAddOnForPos);
  return ADD_ONS;
}

function getActiveAddOns(scope) {
  return ADD_ONS.filter(addOn => addOn.active && (!scope || addOn.appliesTo === scope));
}

function addonEsc(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function sendAddOn(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    showToast(data?.error || 'Add-on could not be saved', 'error');
    return null;
  }
  await loadAddOns();
  renderAddOnsManagement();
  return data;
}

function initAddOns() {
  if (ADD_ONS.length) {
    renderAddOnsManagement();
    return;
  }
  loadAddOns()
    .then(renderAddOnsManagement)
    .catch(err => showToast(err.message, 'error'));
}

let addOnDraftSupplies = [];

function resetAddOnForm() {
  editingAddOnId = null;
  const form = $('#addon-form');
  if (!form) return;
  form.reset();
  $('#addon-active').checked = true;
  $('#addon-form-title').textContent = 'Add an add-on';
  $('#addon-cancel').classList.add('hidden');
  addOnDraftSupplies = [];
  renderAddOnSupplyPicker();
}

function renderAddOnSupplyPicker() {
  const select = $('#addon-supply-select');
  const list = $('#addon-supply-list');
  if (!select || !list) return;
  const chosen = new Set(addOnDraftSupplies.map(line => line.supplyId));
  select.innerHTML = '<option value="">Select a supply…</option>'
    + SUPPLIES.filter(s => !chosen.has(s.id))
      .map(s => `<option value="${addonEsc(s.id)}">${addonEsc(s.name)} (${addonEsc(s.unit)})</option>`).join('');
  list.innerHTML = addOnDraftSupplies.map(line => {
    const supply = getSupply(line.supplyId);
    return `<li class="flex items-center justify-between gap-2">
      <span>${addonEsc(supply ? supply.name : 'Unknown')} — ${line.qty} ${addonEsc(supply ? supply.unit : '')}</span>
      <button type="button" class="btn btn-ghost btn-xs text-red-700" data-addon-remove-supply="${addonEsc(line.supplyId)}">Remove</button>
    </li>`;
  }).join('') || '<li class="text-xs text-slate-600 italic">No supplies connected yet.</li>';
}

async function showAddOnForm() {
  const form = $('#addon-form');
  if (!form) return;
  await loadSupplies().catch(() => {});
  if (SUPPLIES.length === 0) {
    showToast('Add a supply in Supplies Management first', 'error');
    return;
  }
  form.classList.remove('hidden');
  $('#addons-grid')?.classList.add('addons-grid--form-open');
  renderAddOnSupplyPicker();
  $('#addon-name')?.focus();
}

function hideAddOnForm() {
  const form = $('#addon-form');
  if (!form) return;
  form.classList.add('hidden');
  $('#addons-grid')?.classList.remove('addons-grid--form-open');
  resetAddOnForm();
}

function addOnRow(addOn) {
  return `
    <tr>
      <td class="font-semibold text-text-dark">${addonEsc(addOn.name)}</td>
      <td>${addonEsc(addOn.group)}</td>
      <td class="tabular-nums font-semibold">₱${addOn.price.toFixed(2)}</td>
      <td><span class="badge ${addOn.active ? 'badge-completed' : 'badge-cancelled'}">${addOn.active ? 'Active' : 'Inactive'}</span></td>
      <td>
        <div class="flex flex-wrap gap-1">
          <button class="btn btn-ghost btn-sm" data-addon-edit="${addonEsc(addOn.id)}">Edit</button>
          <button class="btn btn-ghost btn-sm" data-addon-toggle="${addonEsc(addOn.id)}">${addOn.active ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-ghost btn-sm text-red-700" data-addon-delete="${addonEsc(addOn.id)}">Delete</button>
        </div>
      </td>
    </tr>
  `;
}

function renderAddOnsManagement() {
  const body = $('#addons-table-body');
  if (!body) return;
  const noSupplies = SUPPLIES.length === 0;
  $('#btn-add-addon')?.toggleAttribute('disabled', noSupplies);
  $('#addon-no-supply-note')?.classList.toggle('hidden', !noSupplies);
  const query = String($('#addons-search')?.value || '').trim().toLowerCase();
  const records = ADD_ONS.filter(addOn => `${addOn.name} ${addOn.group}`.toLowerCase().includes(query));

  body.innerHTML = ADD_ON_SECTIONS.map(section => {
    const rows = records.filter(addOn => addOn.appliesTo === section.scope);
    const content = rows.length
      ? rows.map(addOnRow).join('')
      : '<tr><td colspan="5" class="text-center text-slate-600 py-4 italic">No add-ons yet.</td></tr>';
    return `<tr class="addon-section-head"><th colspan="5" class="text-left text-[11px] uppercase tracking-wider text-slate-700 bg-foam px-3.5 py-2">${section.label}</th></tr>${content}`;
  }).join('');
}

function bindAddOnManagement() {
  $('#btn-add-addon')?.addEventListener('click', () => {
    resetAddOnForm();
    $('#addon-cancel')?.classList.remove('hidden');
    showAddOnForm();
  });
  $('#addon-cancel')?.addEventListener('click', hideAddOnForm);
  $('#addons-search')?.addEventListener('input', renderAddOnsManagement);
  $('#btn-addon-add-supply')?.addEventListener('click', () => {
    const supplyId = $('#addon-supply-select').value;
    const qty = Number($('#addon-supply-qty').value);
    if (!supplyId) return showToast('Choose a supply to connect', 'error');
    if (!(qty > 0)) return showToast('Quantity must be above zero', 'error');
    addOnDraftSupplies.push({ supplyId, qty });
    $('#addon-supply-qty').value = 1;
    renderAddOnSupplyPicker();
  });
  $('#addon-supply-list')?.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-addon-remove-supply]');
    if (!remove) return;
    addOnDraftSupplies = addOnDraftSupplies.filter(line => line.supplyId !== remove.dataset.addonRemoveSupply);
    renderAddOnSupplyPicker();
  });
  $('#addon-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#addon-name').value.trim();
    const price = Number($('#addon-price').value);
    const appliesTo = $('#addon-applies').value;
    if (!name) return showToast('Please enter an add-on name', 'error');
    if (!Number.isFinite(price) || price < 0) return showToast('Price cannot be negative', 'error');
    if (addOnDraftSupplies.length === 0) return showToast('Connect at least one supply to this add-on', 'error');
    const body = { name, price, appliesTo, active: $('#addon-active').checked, supplies: addOnDraftSupplies };
    const saved = editingAddOnId
      ? await sendAddOn('PUT', `/api/add-ons/${editingAddOnId}`, body)
      : await sendAddOn('POST', '/api/add-ons', body);
    if (!saved) return;
    hideAddOnForm();
    showToast('Add-on saved', 'success');
  });
  $('#addons-table-body')?.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-addon-edit]');
    const toggle = event.target.closest('[data-addon-toggle]');
    const remove = event.target.closest('[data-addon-delete]');
    const id = edit?.dataset.addonEdit || toggle?.dataset.addonToggle || remove?.dataset.addonDelete;
    if (!id) return;
    const addOn = ADD_ONS.find(record => record.id === id);
    if (!addOn) return;
    if (edit) {
      editingAddOnId = id;
      $('#addon-form-title').textContent = 'Edit add-on';
      $('#addon-name').value = addOn.name;
      $('#addon-price').value = addOn.price;
      $('#addon-applies').value = addOn.appliesTo;
      $('#addon-active').checked = addOn.active;
      $('#addon-cancel').classList.remove('hidden');
      addOnDraftSupplies = addOn.supplies.map(line => ({ ...line }));
      showAddOnForm();
    } else if (toggle) {
      await sendAddOn('PUT', `/api/add-ons/${id}`, {
        name: addOn.name, price: addOn.price, appliesTo: addOn.appliesTo, active: !addOn.active,
      });
    } else if (remove && window.confirm(`Delete ${addOn.name}?`)) {
      const result = await sendAddOn('DELETE', `/api/add-ons/${id}`);
      if (result) showToast(result.deactivated ? 'Add-on hidden — it appears on past orders' : 'Add-on deleted', 'success');
    }
  });
}

document.addEventListener('DOMContentLoaded', bindAddOnManagement);
