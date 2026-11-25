let allowPaymentSimulation = false;
function enableQrCheckout() {
return fetch('/api/xendit/enabled').then(response => response.json()).then(config => {
  allowPaymentSimulation = config.simulation === true;
  if (!config.enabled) return;
  const button = document.querySelector('#pay-qr, .reg-tender-opt[data-method="qr"]');
  if (button) {
    button.disabled = false;
    button.querySelector('.pay-label, .reg-tender-opt-title').textContent = 'QR Ph (test)';
  }
}).catch(() => {});
}
if (!location.pathname.startsWith('/pos-app/')) enableQrCheckout();

let pendingQrRequest;

const qrRetryStorageKey = 'tagak.qrRetry.' + location.pathname;

async function qrRetryHeaders(body, guestCash = false) {
  if (body.payment !== 'qr' && !guestCash) return {};
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (!pendingQrRequest) {
    try { pendingQrRequest = JSON.parse(sessionStorage.getItem(qrRetryStorageKey)); } catch (_) {}
  }
  if (pendingQrRequest?.fingerprint !== fingerprint || !pendingQrRequest?.key) {
    pendingQrRequest = { fingerprint, key: crypto.randomUUID() };
    try { sessionStorage.setItem(qrRetryStorageKey, JSON.stringify(pendingQrRequest)); } catch (_) {}
  }
  return { 'Idempotency-Key': pendingQrRequest.key };
}

function clearQrRetryKey() {
  pendingQrRequest = undefined;
  try { sessionStorage.removeItem(qrRetryStorageKey); } catch (_) {}
}

async function waitForQrCheckout({ checkoutId, qrImage }) {
  const checkoutToken = pendingQrRequest?.key;
  const dialog = document.createElement('dialog');
  dialog.className = 'qr-payment';
  const title = document.createElement('h2');
  title.id = 'qr-payment-title';
  title.textContent = 'QR Ph ? Demo / test payment';
  dialog.setAttribute('aria-labelledby', title.id);
  const message = document.createElement('p');
  message.textContent = 'Use test funds to pay for this demo order.';
  const image = document.createElement('img');
  image.src = qrImage;
  image.alt = 'QR Ph test payment code';
  const simulate = document.createElement('button');
  simulate.type = 'button';
  simulate.className = 'btn btn-primary btn-lg';
  simulate.textContent = 'Simulate test payment (Demo)';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-secondary';
  close.textContent = 'Close';
  close.onclick = () => dialog.close();
  message.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.className = 'qr-payment-actions';
  if (allowPaymentSimulation && checkoutToken) actions.append(simulate);
  actions.append(close);
  dialog.append(title, image, message, actions);
  document.body.append(dialog);
  dialog.showModal();
  let pollTimer;
  const controller = new AbortController();
  const signal = controller.signal;
  const id = encodeURIComponent(checkoutId);
  try {
    return await new Promise((resolve, reject) => {
      dialog.onclose = () => reject(new Error('Payment status closed'));
      simulate.onclick = async () => {
        if(typeof offlinePOS!=='undefined' && offlinePOS.offline) return;
        simulate.disabled = true;
        message.textContent = 'Waiting for Xendit to confirm your test payment…';
        try {
          const response = await fetch('/api/xendit/simulate/' + id, { method: 'POST', headers: { 'X-Checkout-Token': checkoutToken }, signal });
          if (!response.ok) throw new Error();
        } catch {
          if (!signal.aborted) {
            message.textContent = 'Could not confirm the simulation request. You can try again.';
            simulate.disabled = false;
          }
        }
      };
      async function checkStatus() {
        if(typeof offlinePOS!=='undefined' && offlinePOS.offline){
          simulate.disabled=true;
          message.textContent='Offline. Keep this checkout open until the payment can be verified.';
          pollTimer=setTimeout(checkStatus,3000);
          return;
        }
        try {
          const response = await fetch('/api/xendit/status/' + id, { signal, cache: 'no-store' });
          if (response.status === 404) {
            message.textContent = 'Checkout could not be found. Close this window and start again.';
            simulate.hidden = image.hidden = true;
            return;
          }
          if (!response.ok) throw new Error();
          const status = await response.json();
          if (status.ticketNo) {
            const order = await fetch('/api/public/orders/' + encodeURIComponent(status.ticketNo), { signal });
            if (!order.ok) throw new Error('Could not load the confirmed order. Try again.');
            const receipt = { ...await order.json(), trackingToken: status.trackingToken };
            clearQrRetryKey();
            return resolve(receipt);
          } else if (status.failed || status.expired) {
            clearQrRetryKey();
            message.textContent = status.failed ? 'Payment failed.' : 'QR checkout expired.';
            image.hidden = simulate.hidden = true;
            return;
          }
        } catch {
          if (!signal.aborted) message.textContent = 'Rechecking payment status…';
        }
        if (!signal.aborted) pollTimer = setTimeout(checkStatus, 3000);
      }
      checkStatus();
    });
  } finally {
    controller.abort();
    clearTimeout(pollTimer);
    dialog.remove();
  }
}
