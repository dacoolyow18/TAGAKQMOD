// Recovery reader for receipts written by the previous register.
const OFFLINE_STORAGE_KEY = 'tagak_offline_order_queue_v1';
function readLegacyReceipts() {
  const queue = JSON.parse(localStorage.getItem(OFFLINE_STORAGE_KEY) || '[]');
  if (!Array.isArray(queue)) throw Error('Legacy receipt storage needs review');
  return queue;
}
function showLegacyReceipts() {
  const panel = document.getElementById('legacy-receipts');
  const message = document.getElementById('legacy-result');
  try {
    const count = readLegacyReceipts().length;
    panel.hidden = !count;
    document.getElementById('offline-queue-count').textContent = count + ' legacy receipts';
  } catch (error) { panel.hidden = false; message.textContent = error.message; }
}
async function reconcileLegacyCash(event) {
  const button = event.currentTarget;
  const message = document.getElementById('legacy-result');
  button.disabled = true;
  try {
    const entries = readLegacyReceipts().filter(entry => entry.payload?.payment === 'cash');
    for (const {payload} of entries) {
      const response = await fetch('/api/orders/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({orders:[payload]})});
      if (!response.ok) throw Error('Receipt needs review: ' + payload.idempotencyKey);
      const result = await response.json();
      if (!result.synced?.some(entry => entry.idempotencyKey === payload.idempotencyKey)) throw Error('Receipt was not acknowledged');
      const remaining = readLegacyReceipts().filter(entry => entry.payload?.idempotencyKey !== payload.idempotencyKey);
      localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(remaining));
    }
    message.textContent = 'Remaining QR receipts require payment reconciliation.';
  } catch(error) { message.textContent = error.message; }
  finally { button.disabled = false; showLegacyReceipts(); }
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-sync-offline-queue').addEventListener('click',reconcileLegacyCash);
  showLegacyReceipts();
});
