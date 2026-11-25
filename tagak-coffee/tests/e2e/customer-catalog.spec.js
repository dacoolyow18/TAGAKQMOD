const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient } = require('../api/helpers');

test.skip(({ viewport }) => viewport.width < 800, 'Customer catalog is checked on desktop');

const BRANCH_ID = 'brn-customer';
const BRANCH_CODE = '1001805';

test.beforeAll(async () => {
  await resetDatabase();
  await withClient(async (c) => {
    await c.query(
      `INSERT INTO branches (id, code, name, location) VALUES ($1, $2, 'Tagak Main', 'Davao')`,
      [BRANCH_ID, BRANCH_CODE],
    );
    await c.query(`INSERT INTO menu_items (id, name, category, price, description, has_temperature) VALUES
      ('menu-latte', 'Cafe Latte', 'Drinks', 100, 'Espresso folded into steamed milk.', true),
      ('menu-tea', 'Chamomile Tea', 'Drinks', 90, 'A caffeine-free cup for the afternoon.', true),
      ('menu-scone', 'Butter Scone', 'Pastries', 70, 'Baked fresh every morning.', false)`);
    await c.query(`INSERT INTO add_ons (name, applies_to, price) VALUES
      ('Extra Shot', 'drink', 20),
      ('Butter', 'pastry', 10)`);
    await c.query(`INSERT INTO settings (key, value) VALUES
      ('vat_rate', '0.12'), ('large_upcharge', '30'), ('estimated_minutes', '5')`);
  });
  await insertAccount({
    id: 'e2e-customer-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678', branchId: BRANCH_ID,
  });
});

async function enterShop(page) {
  await page.goto('/customer-app/index.html');
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await page.fill('#branch-input', BRANCH_CODE);
  await page.click('#btn-enter');
  await expect(page.locator('#modal-welcome')).not.toHaveClass(/hidden/);
  await page.click('#btn-continue');
  await expect(page.locator('#screen-menu')).toHaveClass(/active/);
}

async function managerCookie(request, baseURL) {
  const res = await request.post(`${baseURL}/api/auth/pin`, {
    data: { email: 'e2e-customer-mgr@tagak.test', pin: '5678' },
  });
  expect(res.status()).toBe(200);
  const header = res.headers()['set-cookie'] || '';
  return `tagak_session=${header.match(/tagak_session=([^;]+)/)[1]}`;
}

async function confirmCash(page, request, baseURL) {
  await expect(page.locator('#cash-dialog')).toBeVisible();
  const ticket = await page.locator('#cash-ticket').textContent();
  const cookie = await managerCookie(request, baseURL);
  expect((await request.post(baseURL + '/api/orders/' + ticket + '/collect-cash', { headers: { Cookie: cookie } })).status()).toBe(200);
  await expect(page.locator('#screen-tracker')).toHaveClass(/active/);
  await page.getByText('View receipt', { exact: true }).last().click();
}

function liveCard(page, ticket) {
  return page.locator(`.live-card[data-ticket="${ticket}"]`);
}

test('the menu, add-ons, Hot / Iced choice, totals, and tracker come from the API', async ({ page, request, baseURL }) => {
  await enterShop(page);

  const tabs = (await page.locator('#category-tabs .tab').allTextContents()).map(tab => tab.trim());
  expect(tabs).toEqual(['Drinks', 'Pastries']);
  await expect(page.locator('#menu-list .item-card')).toHaveCount(2);
  await expect(page.locator('#menu-list .item-card', { hasText: 'Cafe Latte' })).toBeVisible();
  await expect(page.locator('#menu-list .item-thumb.img-mono').first()).toBeVisible();

  await page.locator('#menu-list .item-card', { hasText: 'Cafe Latte' }).click();
  await expect(page.locator('#temperature-modal')).toHaveCount(0);
  await expect(page.locator('#sheet-item')).not.toHaveClass(/hidden/);
  await expect(page.locator('#temperature-option-row')).not.toHaveClass(/hidden/);
  await expect(page.locator('#temperature-options .chip.active')).toHaveText('Hot');
  await page.locator('#temperature-options [data-temp="iced"]').click();
  await expect(page.locator('#temperature-options .chip.active')).toHaveText('Iced');

  await expect(page.locator('#size-option-row')).not.toHaveClass(/hidden/);
  const drinkAddOns = await page.locator('#addons-container').innerText();
  expect(drinkAddOns).toContain('Extra Shot');
  expect(drinkAddOns).not.toContain('Butter');

  await page.click('#size-large');
  await expect(page.locator('#item-price')).toHaveText('₱130.00');
  await page.locator('#addons-container .chip', { hasText: 'Extra Shot' }).click();
  await expect(page.locator('#item-price')).toHaveText('₱150.00');
  await expect(page.locator('#btn-add-price')).toHaveText('₱150.00');
  await page.click('#btn-add-order');

  await expect(page.locator('#sheet-item')).toHaveClass(/hidden/);
  await expect(page.locator('#basket-total')).toHaveText('₱150.00');
  await page.click('#basket-pill');

  await expect(page.locator('#screen-checkout')).toHaveClass(/active/);
  await expect(page.locator('#vat-label')).toHaveText('VAT (12%)');
  await expect(page.locator('#b-subtotal')).toHaveText('₱150.00');
  await expect(page.locator('#b-vat')).toHaveText('₱18.00');
  await expect(page.locator('#b-total')).toHaveText('₱168.00');

  await page.click('#btn-place-order');
  await expect(page.locator('#modal-confirm-payment')).toHaveClass(/hidden/);
  await expect(page.locator('#order-nickname-error')).toContainText('nickname');
  await expect(page.locator('#order-nickname')).toBeFocused();

  await page.fill('#order-nickname', 'Sam');
  await expect(page.locator('#mode-dine-in')).toHaveClass(/active/);
  await page.click('#mode-takeout');
  await expect(page.locator('#mode-takeout')).toHaveClass(/active/);
  await page.click('#btn-place-order');
  await expect(page.locator('#modal-confirm-payment')).not.toHaveClass(/hidden/);
  await expect(page.locator('#confirm-method')).toHaveText('Cash');
  await expect(page.locator('#confirm-nickname')).toHaveText('Sam');
  await expect(page.locator('#confirm-order-mode')).toHaveText('Take-Out');
  await expect(page.locator('#confirm-total')).toHaveText('₱168.00');
  await page.click('#btn-confirm-pay');

  await confirmCash(page, request, baseURL);
  await expect(page.locator('#receipt-body')).toContainText('Cafe Latte');
  await expect(page.locator('#receipt-body')).toContainText('Take-Out');
  await expect(page.locator('#receipt-body .receipt-nickname')).toHaveText('Sam');
  await page.click('#btn-receipt-close');
  await expect(page.locator('#screen-tracker')).toHaveClass(/active/);

  const card = page.locator('.live-card').first();
  const ticket = (await card.locator('.order-code-value').textContent()).trim();
  expect(ticket).toMatch(/^TK-\d{8}-\d{4}$/);
  await expect(card).toContainText('Order received of 1 item');
  await expect(card).toContainText('Take-Out');
  await expect(card.locator('.order-code-name')).toHaveText('For Sam');

  const tracked = await (await page.request.get(`${baseURL}/api/public/orders/${ticket}`)).json();
  expect(tracked).toMatchObject({ ticketNo: ticket, status: 'queued', payment: 'cash', customerName: 'Sam', orderMode: 'takeout' });
  expect(tracked.items[0]).toMatchObject({
    menuItemId: 'menu-latte',
    temperature: 'iced',
    size: 'Large',
    qty: 1,
    unitPrice: 130,
    addOnPrice: 20,
  });
  expect(tracked.items[0].addOns[0]).toMatchObject({ name: 'Extra Shot', price: 20 });

  const cookie = await managerCookie(request, baseURL);
  let patch = await request.patch(`${baseURL}/api/orders/${ticket}`, {
    headers: { Cookie: cookie },
    data: { status: 'ready' },
  });
  expect(patch.status()).toBe(200);
  await expect(liveCard(page, ticket).locator('.tl-step.ready')).toHaveClass(/current/, { timeout: 8000 });
  await expect(liveCard(page, ticket).locator('[data-dismiss]')).toHaveText('Order Picked Up');

  await liveCard(page, ticket).locator('[data-dismiss]').click();
  await expect(liveCard(page, ticket)).toHaveCount(0);
  await expect(page.locator('#tracker-list')).toContainText('You have no live orders');
});

test('a pastry opens without Hot / Iced and only lists pastry add-ons', async ({ page }) => {
  await enterShop(page);
  await page.click('#category-tabs .tab[data-cat="Pastries"]');
  await expect(page.locator('#menu-list .item-card')).toHaveCount(1);
  await page.locator('#menu-list .item-card', { hasText: 'Butter Scone' }).click();

  await expect(page.locator('#sheet-item')).not.toHaveClass(/hidden/);
  await expect(page.locator('#size-option-row')).toHaveClass(/hidden/);
  await expect(page.locator('#temperature-option-row')).toHaveClass(/hidden/);

  const pastryAddOns = await page.locator('#addons-container').innerText();
  expect(pastryAddOns).toContain('Butter');
  expect(pastryAddOns).not.toContain('Extra Shot');
});

test('a cash order needs confirmation, and the receipt shows the bill with no discount line', async ({ page, request, baseURL }) => {
  await enterShop(page);
  await page.click('#category-tabs .tab[data-cat="Pastries"]');
  await page.locator('#menu-list .item-card', { hasText: 'Butter Scone' }).click();
  await page.click('#btn-add-order');
  await page.click('#basket-pill');

  await expect(page.locator('#pwd-discount-toggle')).toHaveCount(0);
  await expect(page.locator('#b-vat')).toHaveText('₱8.40');
  await expect(page.locator('#b-total')).toHaveText('₱78.40');

  await page.click('#pay-cash');
  await page.fill('#order-nickname', 'Cash Customer');
  await page.click('#btn-place-order');
  await expect(page.locator('#confirm-method')).toHaveText('Cash');
  await page.click('#btn-confirm-cancel');
  await expect(page.locator('#modal-confirm-payment')).toHaveClass(/hidden/);
  await page.click('#btn-place-order');
  await page.click('#btn-confirm-pay');

  await confirmCash(page, request, baseURL);
  await expect(page.locator('#receipt-body')).toContainText('₱78.40');
  await expect(page.locator('#receipt-body')).not.toContainText('discount');
  await expect(page.locator('#btn-receipt-print')).toHaveCount(0);
  const ticket = (await page.locator('#receipt-body strong').textContent()).trim();
  await page.click('#btn-receipt-close');

  const tracked = await (await page.request.get(`${baseURL}/api/public/orders/${ticket}`)).json();
  expect(tracked).toMatchObject({ status: 'queued', payment: 'cash', subtotal: 70, discount: 0, vat: 8.4, total: 78.4 });
});

test('a customer can change the quantity in the item sheet and in the basket', async ({ page, request, baseURL }) => {
  await enterShop(page);
  await page.click('#category-tabs .tab[data-cat="Pastries"]');
  await page.locator('#menu-list .item-card', { hasText: 'Butter Scone' }).click();
  await expect(page.locator('#sheet-item')).not.toHaveClass(/hidden/);
  await page.click('#qty-plus');
  await page.click('#qty-plus');
  await expect(page.locator('#qty-value')).toHaveText('3');
  await expect(page.locator('#btn-add-price')).toHaveText('₱210.00');
  await page.click('#qty-minus');
  await expect(page.locator('#qty-value')).toHaveText('2');
  await page.click('#btn-add-order');
  await expect(page.locator('#basket-total')).toHaveText('₱140.00');

  await page.click('#basket-pill');
  await expect(page.locator('.cart-line .stepper-val')).toHaveText('2');
  await page.locator('.cart-line [data-qty-step="1"]').click();
  await expect(page.locator('.cart-line .stepper-val')).toHaveText('3');
  await expect(page.locator('#b-subtotal')).toHaveText('₱210.00');
  await page.locator('.cart-line [data-qty-step="-1"]').click();
  await page.locator('.cart-line [data-qty-step="-1"]').click();
  await page.locator('.cart-line [data-qty-step="-1"]').click();
  await expect(page.locator('.cart-line .stepper-val')).toHaveText('1');
  await expect(page.locator('#b-total')).toHaveText('₱78.40');
});

test('several live orders stay visible together, and survive a reload', async ({ page, request, baseURL }) => {
  await enterShop(page);
  await page.click('#category-tabs .tab[data-cat="Pastries"]');
  await page.locator('#menu-list .item-card', { hasText: 'Butter Scone' }).click();
  await page.click('#btn-add-order');
  await page.click('#basket-pill');
  await page.fill('#order-nickname', 'Repeat Guest');
  await page.click('#btn-place-order');
  await page.click('#btn-confirm-pay');
  await confirmCash(page, request, baseURL);
  await page.click('#btn-receipt-close');
  const firstTicket = (await page.locator('#tracker-list .live-card .order-code-value').first().textContent()).trim();

  await page.click('#tracker-back');
  await expect(page.locator('#screen-menu')).toHaveClass(/active/);
  await page.locator('#menu-list .item-card', { hasText: 'Butter Scone' }).click();
  await page.click('#btn-add-order');
  await page.click('#basket-pill');
  await page.click('#btn-place-order');
  await page.click('#btn-confirm-pay');
  await confirmCash(page, request, baseURL);
  await page.click('#btn-receipt-close');
  await expect(page.locator('#tracker-list .live-card')).toHaveCount(2);

  const cookie = await managerCookie(request, baseURL);
  const patch = await request.patch(`${baseURL}/api/orders/${firstTicket}`, {
    headers: { Cookie: cookie },
    data: { status: 'ready' },
  });
  expect(patch.status()).toBe(200);
  await expect(liveCard(page, firstTicket).locator('.tl-step.ready')).toHaveClass(/current/, { timeout: 8000 });
  await expect(page.locator('#tracker-list .live-card')).toHaveCount(2);

  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await page.fill('#branch-input', BRANCH_CODE);
  await page.click('#btn-enter');
  await page.click('#btn-continue');
  await expect(page.locator('#menu-order-code')).toHaveText('2 live orders');
  await page.click('#menu-order-status');
  await expect(page.locator('#tracker-list .live-card')).toHaveCount(2);
  // The nickname stays attached to both orders after the refresh.
  await expect(page.locator('#tracker-list .order-code-name')).toHaveText(['For Repeat Guest', 'For Repeat Guest']);
  // And the checkout keeps it ready for the next order.
  await expect(page.locator('#order-nickname')).toHaveValue('Repeat Guest');
  await expect(liveCard(page, firstTicket).locator('.tl-step.ready')).toHaveClass(/current/);
});
