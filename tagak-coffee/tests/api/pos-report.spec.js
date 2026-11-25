const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DATA_JS = path.join(__dirname, '..', '..', 'pos-app', 'js', 'data.js');

function loadReportContext(orders) {
  const context = vm.createContext({ fetch: () => {}, console });
  vm.runInContext(fs.readFileSync(DATA_JS, 'utf8'), context);
  vm.runInContext(`POS_MENU = [{ id: 'menu-scone', name: 'Scone', category: 'Pastries', price: 100 }]`, context);
  vm.runInContext('analyticsOrders = ' + JSON.stringify(orders), context);
  return context;
}

function localIso(y, m, d, h, min) {
  return new Date(y, m - 1, d, h, min).toISOString();
}

function order(overrides = {}) {
  return {
    status: 'completed',
    timeIn: localIso(2026, 11, 11, 13, 55),
    timeOut: localIso(2026, 11, 11, 14, 0),
    subtotal: 100,
    discount: 20,
    vat: 0,
    total: 80,
    items: [{ menuItemId: 'menu-scone', name: 'Scone', qty: 1, unitPrice: 100, addOnPrice: 0 }],
    ...overrides,
  };
}

test('item revenue counts the PWD / Senior discount, not the full price', () => {
  const context = loadReportContext([order()]);
  const summary = vm.runInContext("generateSummaryReport('2026-11-11', '2026-11-11')", context);
  const rows = vm.runInContext("generateItemReport()", context);
  expect(summary.revenue).toBeCloseTo(80, 2);
  expect(summary.orders).toBe(1);
  expect(rows[0].revenue).toBeCloseTo(80, 2);
});

test('an order without a discount still counts its full price', () => {
  const context = loadReportContext([order({ discount: 0, total: 100 })]);
  const summary = vm.runInContext("generateSummaryReport('2026-11-11', '2026-11-11')", context);
  expect(summary.revenue).toBeCloseTo(100, 2);
});

test('a same-day sale in the afternoon is counted for a one-day range', () => {
  const context = loadReportContext([order({ timeOut: localIso(2026, 11, 11, 15, 30) })]);
  const summary = vm.runInContext("generateSummaryReport('2026-11-11', '2026-11-11')", context);
  expect(summary.orders).toBe(1);
  expect(summary.revenue).toBeCloseTo(80, 2);
});

test('a day string spans local midnight to the last millisecond of that day', () => {
  const context = loadReportContext([]);
  expect(vm.runInContext("dayStart('2026-11-11')", context)).toBe(new Date(2026, 10, 11).getTime());
  expect(vm.runInContext("dayEnd('2026-11-11')", context)).toBe(new Date(2026, 10, 11, 23, 59, 59, 999).getTime());
});

test('the cost of an add-on counts toward COGS from its linked supply', () => {
  const context = loadReportContext([order({
    discount: 0, total: 100, subtotal: 100,
    items: [{ menuItemId: 'menu-scone', name: 'Scone', qty: 1, unitPrice: 100, addOnPrice: 0,
      addOns: [{ id: 'addon-1', name: 'Butter', price: 0 }] }],
  })]);
  vm.runInContext(`SUPPLIES = [{ id: 'sup-butter', name: 'Butter', unit: 'g', stock: 0,
      priceLogs: [{ price: 0.5, date: '2026-01-01T00:00:00Z' }] }];
    ADD_ONS = [{ id: 'addon-1', supplies: [{ supplyId: 'sup-butter', qty: 10 }] }]`, context);
  const summary = vm.runInContext("generateSummaryReport('2026-11-11', '2026-11-11')", context);
  expect(summary.cogs).toBeCloseTo(5, 2);
});

test('pay-in transactions within the date range are included in branch revenue, profit, and chart buckets', () => {
  const DASHBOARD_JS = path.join(__dirname, '..', '..', 'pos-app', 'js', 'dashboard.js');
  const context = loadReportContext([order({ discount: 0, total: 100, subtotal: 100 })]);
  vm.runInContext(fs.readFileSync(DASHBOARD_JS, 'utf8'), context);
  vm.runInContext(
    `CASH_LOGS = [
      { id: 1, type: 'payIn', amount: 250, reason: 'Opening float addition', timestamp: '${localIso(2026, 11, 11, 10, 0)}' },
      { id: 2, type: 'payOut', amount: 60, reason: 'Bought ice', timestamp: '${localIso(2026, 11, 11, 12, 0)}' },
      { id: 3, type: 'payIn', amount: 999, reason: 'Out of range deposit', timestamp: '${localIso(2026, 11, 10, 10, 0)}' }
    ]`,
    context,
  );

  const summary = vm.runInContext("generateSummaryReport('2026-11-11', '2026-11-11')", context);
  expect(summary.salesRevenue).toBeCloseTo(100, 2);
  expect(summary.payIns).toBeCloseTo(250, 2);
  expect(summary.payInCount).toBe(1);
  expect(summary.cashExpenses).toBeCloseTo(60, 2);
  expect(summary.payOutCount).toBe(1);
  expect(summary.revenue).toBeCloseTo(350, 2);
  expect(summary.profit).toBeCloseTo(350, 2);

  const chartAgg = vm.runInContext("aggregateOrdersByRange('2026-11-11', '2026-11-11')", context);
  expect(chartAgg.revenue).toEqual([350]);
  expect(chartAgg.counts).toEqual([1]);
});

test('printable Item Sales Report uses the Tagak POS system palette and includes Pay-In & Cash Drawer sections', () => {
  const context = loadReportContext([order({ discount: 0, total: 100, subtotal: 100 })]);
  const cashLogs = [{ type: 'payIn', amount: 150, reason: 'Petty cash top-up', timestamp: localIso(2026, 11, 11, 9, 30) }];
  context.cashLogs = cashLogs;
  vm.runInContext('CASH_LOGS = cashLogs', context);
  const report = {
    rows: vm.runInContext('generateItemReport()', context),
    summary: vm.runInContext("generateSummaryReport('2026-11-11', '2026-11-11')", context),
    cashLogs, branchName: 'Main Branch', preparedBy: 'Main Manager', reportStartISO: '2026-11-11', reportEndISO: '2026-11-11',
  };
  const { renderPdf, renderPrintable } = require('../../server/salesReport');
  expect(renderPdf(report).subarray(0, 5).toString()).toBe('%PDF-');
  const capturedHtml = renderPrintable(report);

  expect(capturedHtml).toContain('--pos-forest:        #1F2D24');
  expect(capturedHtml).toContain('--pos-ink:           #141E18');
  expect(capturedHtml).toContain('--pos-bg:            #F3F5F4');
  expect(capturedHtml).toContain('--pos-surface-alt:   #EAECE9');
  expect(capturedHtml).toContain('Pay-In Transactions');
  expect(capturedHtml).toContain('Petty cash top-up');
  expect(capturedHtml).toContain('BRANCH GRAND TOTAL');
  expect(capturedHtml).toContain('₱250.00');
});
