/**
 * File: settings.js
 * Path: pos-app/js/settings.js
 * Description: Store settings view. The VAT rate, large-drink upcharge, and
 *              estimated prep time live in the database and are edited here.
 */

function settingsVatPercent() {
  return Number((POS_SETTINGS.vatRate * 100).toFixed(4));
}

function renderSettingsForm() {
  const form = $('#settings-form');
  if (!form) return;

  $('#settings-vat').value = settingsVatPercent();
  $('#settings-large-upcharge').value = POS_SETTINGS.largeUpcharge;
  $('#settings-estimated-minutes').value = POS_SETTINGS.estimatedMinutes;

  const canEdit = permitted('edit_menu') && permitted('edit_tools');
  form.querySelectorAll('input').forEach(input => { input.disabled = !canEdit; });
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.hidden = !canEdit;
}

async function saveSettings(event) {
  event.preventDefault();

  const vatPercent = parseFloat($('#settings-vat').value);
  const largeUpcharge = parseFloat($('#settings-large-upcharge').value);
  const estimatedMinutes = parseInt($('#settings-estimated-minutes').value, 10);

  if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100) {
    showToast('VAT rate must be between 0 and 100', 'error');
    return;
  }
  if (!Number.isFinite(largeUpcharge) || largeUpcharge < 0) {
    showToast('Large drink upcharge must be zero or more', 'error');
    return;
  }
  if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 0) {
    showToast('Estimated prep time must be a whole number of minutes', 'error');
    return;
  }

  try {
    await fetchJson('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vat_rate: vatPercent / 100,
        large_upcharge: largeUpcharge,
        estimated_minutes: estimatedMinutes,
      }),
    });
    await loadPosSettings();
    applyPosSettings();
    renderSettingsForm();
    renderRegisterGrid();
    if (typeof renderRegisterCart === 'function') renderRegisterCart();
    showToast('Settings saved', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#settings-form')?.addEventListener('submit', saveSettings);
});
