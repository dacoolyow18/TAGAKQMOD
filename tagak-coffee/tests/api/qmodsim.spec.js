const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient, startServer } = require('./helpers');
const { computeOfflineOrderDigest } = require('../../server/routes/orders');

let server;
let managerCookie;
let cashierCookie;

async function cookieFrom(res) {
  const header = res.headers()['set-cookie'] || '';
  return `tagak_session=${header.match(/tagak_session=([^;]+)/)[1]}`;
}

function call(request, method, path, cookie, data) {
  return request.fetch(`${server.baseURL}${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
    data,
  });
}

test.beforeAll(async ({ request }) => {
  await resetDatabase();
  await withClient(async c => {
    await c.query(`INSERT INTO branches (id, code, name, location) VALUES ('brn-main', '1001805', 'Tagak Main', 'Davao')`);
    await c.query(`INSERT INTO menu_items (id, name, category, price, has_temperature, branch_id) VALUES
      ('menu-latte', 'Cafe Latte', 'Drinks', 100, true, 'brn-main'),
      ('menu-scone', 'Scone', 'Pastries', 70, false, 'brn-main')`);
    await c.query(`INSERT INTO settings (key, value) VALUES ('vat_rate', '0.12'), ('large_upcharge', '30')`);
  });

  await insertAccount({ id: 'emp-mgr', name: 'Juan Dela Cruz', role: 'Manager', branchId: 'brn-main', pin: '5678' });
  await insertAccount({ id: 'emp-cashier', name: 'Maria Santos', role: 'Cashier', branchId: 'brn-main', pin: '2468' });

  server = await startServer();
  managerCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-mgr@tagak.test', pin: '5678' },
  }));
  cashierCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-cashier@tagak.test', pin: '2468' },
  }));
});

test.afterAll(async () => {
  await server?.close();
});

test('Topic 6: PIN security telemetry and 3-attempt / 5-minute lockout rule', async ({ request }) => {
  const secRes = await request.get(`${server.baseURL}/api/auth/pin-security`);
  expect(secRes.status()).toBe(200);
  const sec = await secRes.json();
  expect(sec.searchSpace).toBe(10000);
  expect(sec.shannonEntropyBits).toBeCloseTo(13.2877, 3);
  expect(sec.lockoutRule.maxAttempts).toBe(3);
  expect(sec.lockoutRule.lockoutMinutes).toBe(5);
});

test('Topic 3 & 5: DTMC 7-state lifecycle (held -> queued -> brewing -> ready -> completed -> refunded) and Manager PIN override', async ({ request }) => {
  // Create held order (S0)
  const heldRes = await call(request, 'POST', '/api/orders', managerCookie, {
    branchId: 'brn-main',
    customerName: 'DtmcUser',
    payment: 'cash',
    status: 'held',
    lines: [{ menuItemId: 'menu-latte', temperature: 'iced', size: 'Regular', addOnIds: [], qty: 1 }],
  });
  expect(heldRes.status()).toBe(201);
  const heldOrder = await heldRes.json();
  expect(heldOrder.status).toBe('held');
  expect(heldOrder.paymentStatus).toBe('unpaid');
  expect(heldOrder.cashDueAt).toBeNull();

  // Move S0 -> S1 (queued) -> S2 (brewing) -> S3 (ready) -> S4 (completed)
  for (const nextState of ['queued', 'brewing', 'ready', 'completed']) {
    const patchRes = await call(request, 'PATCH', `/api/orders/${heldOrder.ticketNo}`, managerCookie, { status: nextState });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).status).toBe(nextState);
    if (nextState === 'queued') {
      const collected = await call(request, 'POST', `/api/orders/${heldOrder.ticketNo}/collect-cash`, cashierCookie);
      expect((await collected.json()).paymentStatus).toBe('paid');
    }
  }

  // Refund S4 -> S6 (refunded) with Manager Override PIN
  const refundRes = await call(request, 'PATCH', `/api/orders/${heldOrder.ticketNo}`, managerCookie, {
    status: 'refunded',
    voidReason: 'Customer order remake',
    managerPin: '5678',
    spotAuditTriggered: true,
  });
  expect(refundRes.status()).toBe(200);
  const refunded = await refundRes.json();
  expect(refunded.status).toBe('refunded');
  expect(refunded.approvedBy).toBe('emp-mgr');
});

test('Topic 4: Blind shift drawer close calculates expected cash and discrepancy', async ({ request }) => {
  const res = await call(request, 'POST', '/api/cash-logs/blind-close', managerCookie, {
    countedCash: 500,
    notes: 'End of afternoon shift',
  });
  expect(res.status()).toBe(201);
  const recon = await res.json();
  expect(recon.countedCash).toBe(500);
  expect(typeof recon.expectedCash).toBe('number');
  expect(typeof recon.discrepancy).toBe('number');
});

test('Topic 7: Offline Queue Sync Manager verifies SHA-256 signature and deduplicates via idempotencyKey', async ({ request }) => {
  const payload = {
    idempotencyKey: 'IDEMP-TEST-0001',
    branchId: 'brn-main',
    customerName: 'OfflineGuest',
    orderMode: 'takeout',
    payment: 'cash',
    pwdDiscount: false,
    lines: [{ menuItemId: 'menu-scone', addOnIds: [], qty: 2 }],
  };
  payload.offlineSignature = computeOfflineOrderDigest(payload);

  // Sync first time
  const sync1 = await call(request, 'POST', '/api/orders/sync', managerCookie, { orders: [payload] });
  expect(sync1.status()).toBe(200);
  const body1 = await sync1.json();
  expect(body1.synced.length).toBe(1);
  expect(body1.rejected.length).toBe(0);
  const ticket1 = body1.synced[0].order.ticketNo;

  // Sync second time with same idempotencyKey -> returns exact same ticket without duplicating sale
  const sync2 = await call(request, 'POST', '/api/orders/sync', managerCookie, { orders: [payload] });
  expect(sync2.status()).toBe(200);
  const body2 = await sync2.json();
  expect(body2.synced[0].order.ticketNo).toBe(ticket1);

  // Tampered payload is rejected
  const tampered = { ...payload, idempotencyKey: 'IDEMP-TEST-TAMPER', offlineSignature: 'bad-signature' };
  const sync3 = await call(request, 'POST', '/api/orders/sync', managerCookie, { orders: [tampered] });
  const body3 = await sync3.json();
  expect(sync3.status()).toBe(409);
  expect(body3.rejected.length).toBe(1);
});

test('All 7 QMODSIM telemetry models return valid mathematical structures', async ({ request }) => {
  const res = await call(request, 'GET', '/api/qmodsim/telemetry', managerCookie);
  expect(res.status()).toBe(200);
  const data = await res.json();
  expect(data.referenceModels.queueing.c).toBe(2);
  expect(data.referenceModels.dtmc.N.length).toBe(4);
  expect(data.referenceModels.dtmc.B.length).toBe(4);
  expect(data.referenceModels.gameTheory.nashEquilibrium.sigmaMStar).toBeCloseTo(0.1667, 3);
});
