/**
 * File: data.js
 * Path: pos-app/js/data.js
 * Description: API-backed application data + helpers for the Vendor POS system.
 *              The menu, supplies (with price history), recipes, cash logs,
 *              settings, and branches all come from the server. Nothing in this
 *              file is seeded with demo data.
 *
 * Historical costing model: every supply carries a chronological `priceLogs`
 * array. The cost of a supply at any point in time is the most recent log whose
 * date is <= that point. Reports compute COGS from the price in effect on the
 * date the order was COMPLETED, so retroactively changing a supply's price never
 * rewrites past profit.
 */

/* ═══════════════════════════════════════════
   SERVER-BACKED STATE
   ═══════════════════════════════════════════ */

let POS_MENU = [];

/** Settings entered in the POS (VAT rate, large upcharge, prep estimate). */
const POS_SETTINGS = { vatRate: 0, largeUpcharge: 0, estimatedMinutes: 0 };

/** Branches the signed-in employee can ring sales for. */
let POS_BRANCHES = [];

/** Supplies with their dated price history. */
let SUPPLIES = [];

/** Recipe lines keyed by menu item id: { [menuItemId]: [{ supplyId, qty }] }. */
const RECIPES = {};

/** Cash drawer entries, newest first. */
let CASH_LOGS = [];

/** Completed orders inside the Analytics date range, loaded from the server. */
let analyticsOrders = [];
let analyticsItems = null;

function activePosBranchId() {
  if (typeof POS !== 'undefined' && POS.user?.branchId) return POS.user.branchId;
  return null;
}

async function fetchJson(path, options = {}) {
  const branchId = activePosBranchId();
  const headers = { ...(options.headers || {}) };
  if (branchId && !headers['X-Branch-Id']) headers['X-Branch-Id'] = branchId;
  const res = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `${path} could not be loaded (${res.status})`);
  return data;
}

/** Local midnight at the start of a YYYY-MM-DD day (a bare date string would parse as UTC). */
function dayStart(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** Last millisecond of a YYYY-MM-DD day, in local time. */
function dayEnd(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/** Fetch every completed order whose business date falls in [startISO, endISO]. */
async function loadAnalyticsOrders(startISO, endISO) {
  const report = await fetchJson(`/api/orders/analytics?from=${startISO}&to=${endISO}`);
  analyticsOrders = report.sales;
  analyticsItems = report.items;
  return analyticsOrders;
}

async function loadPosSettings() {
  const settings = await fetchJson('/api/settings');
  POS_SETTINGS.vatRate = Number(settings.vat_rate) || 0;
  POS_SETTINGS.largeUpcharge = Number(settings.large_upcharge) || 0;
  POS_SETTINGS.estimatedMinutes = Number(settings.estimated_minutes) || 0;
  return POS_SETTINGS;
}

async function loadBranches() {
  POS_BRANCHES = await fetchJson('/api/branches');
  return POS_BRANCHES;
}

/**
 * Load the menu from the server. Items use the server's text IDs.
 * Archived items are included (flagged `archived`) so reports and order history
 * can still name and cost them; the register and menu editor filter them out.
 */
async function loadMenuItems() {
  const branchId = activePosBranchId();
  const q = branchId ? `&branchId=${encodeURIComponent(branchId)}` : '';
  const items = await fetchJson(`/api/menu-items?includeArchived=true${q}`);
  POS_MENU = items
    .filter(item => !branchId || !item.branchId || item.branchId === branchId)
    .map(item => ({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      category: item.category,
      soldOut: item.soldOut,
      imgUrl: item.imagePath,
      imagePath: item.imagePath,
      description: item.description,
      hasTemperature: item.hasTemperature,
      active: item.active,
      archived: item.archived === true,
      archivedAt: item.archivedAt || null,
      branchId: item.branchId || branchId || null,
    }));
  return POS_MENU;
}

/** Menu items that can still be sold or edited (everything not archived). */
function liveMenuItems() {
  const branchId = activePosBranchId();
  return POS_MENU.filter(item => !item.archived && (!branchId || !item.branchId || item.branchId === branchId));
}

/** Load every supply and map the server's dated price logs for client costing. */
async function loadSupplies() {
  const branchId = activePosBranchId();
  const q = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  const path = permitted('view_supplies') ? '/api/supplies' : '/api/supplies/ingredients';
  const supplies = await fetchJson(path + q);
  SUPPLIES = supplies
    .filter(supply => !branchId || !supply.branchId || supply.branchId === branchId)
    .map(supply => ({
      id: supply.id,
      name: supply.name,
      unit: supply.unit,
      stock: Number(supply.stock || 0),
      currentPrice: Number(supply.currentPrice || 0),
      branchId: supply.branchId || branchId || null,
      priceLogs: (supply.priceLogs || []).map(log => ({
        price: Number(log.price),
        date: log.effectiveAt,
      })),
    }));
  return SUPPLIES;
}

/** Load the recipe for every menu item currently in POS_MENU. */
async function loadRecipes() {
  const entries = await Promise.all(POS_MENU.map(async item => {
    const lines = await fetchJson(`/api/menu-items/${encodeURIComponent(item.id)}/recipe`);
    return [item.id, lines.map(line => ({
      supplyId: line.supplyId,
      qty: Number(line.qty),
      largeQty: line.largeQty == null ? null : Number(line.largeQty),
    }))];
  }));
  Object.keys(RECIPES).forEach(id => { delete RECIPES[id]; });
  entries.forEach(([id, lines]) => { RECIPES[id] = lines; });
  return RECIPES;
}

/** Load cash drawer entries, newest first. */
async function loadCashLogs() {
  const logs = await fetchJson('/api/cash-logs');
  CASH_LOGS = logs.map(log => ({
    id: log.id,
    type: log.type,
    amount: Number(log.amount),
    reason: log.reason,
    timestamp: log.createdAt,
  }));
  return CASH_LOGS;
}

/* ═══════════════════════════════════════════
   HISTORICAL COSTING HELPERS
   ═══════════════════════════════════════════ */

/**
 * Return the effective per-unit price of a supply at a given point in time.
 * Uses the most recent priceLog whose date is <= `date`. Falls back to the
 * earliest log when `date` precedes every log (or when there are no logs).
 */
function getSupplyPriceAt(supply, date) {
  if (!supply?.priceLogs?.length) return supply?.currentPrice || 0;
  const t = new Date(date).getTime();
  let price = supply.priceLogs[0].price;
  for (const log of supply.priceLogs) {
    if (new Date(log.date).getTime() <= t) price = log.price;
    else break;
  }
  return price;
}

/** Current per-unit price of a supply (latest log). */
function currentSupplyPrice(supply) {
  if (!supply?.priceLogs?.length) return supply?.currentPrice || 0;
  return supply.priceLogs[supply.priceLogs.length - 1].price;
}

/** Resolve a supply object by id. */
function getSupply(id) {
  return SUPPLIES.find(s => s.id === id);
}

/** Resolve a menu item object by id. */
function getMenuItem(id) {
  return POS_MENU.find(m => m.id === id);
}

/** Resolve a menu item id from an order line name (fallback for legacy lines). */
function menuIdByName(menu, name) {
  const item = menu.find(m => m.name.toLowerCase() === String(name).toLowerCase());
  return item ? item.id : null;
}

/**
 * Compute the ingredient-level COGS of a single sold line item, using the
 * supply prices in effect at `date` (the order's completion time).
 */
/** Amount of one ingredient a single serving uses; a Large drink uses the Large quantity when one is set. */
function recipeQty(ingredient, size) {
  return size === 'Large' && ingredient.largeQty != null ? ingredient.largeQty : ingredient.qty;
}

function computeLineCOGS(line, date, menu, recipes, supplyById, addons) {
  const menuId = line.menuItemId != null ? line.menuItemId : menuIdByName(menu, line.name);
  const recipe = recipes[menuId] || [];
  const perServing = recipe.reduce((sum, r) => {
    return sum + getSupplyPriceAt(supplyById.get(r.supplyId), date) * recipeQty(r, line.size);
  }, 0);
  const addOnCost = (line.addOns || []).reduce((sum, picked) => {
    const addOn = addons.find(a => a.id === picked.id);
    return sum + (addOn?.supplies || []).reduce((s, l) => {
      return s + getSupplyPriceAt(supplyById.get(l.supplyId), date) * l.qty;
    }, 0);
  }, 0);
  return (perServing + addOnCost) * (line.qty || 1);
}

/* ═══════════════════════════════════════════
   ITEM-BASED SALES REPORT
   ═══════════════════════════════════════════
   Builds a per-menu-item report for the given date range [startISO, endISO].
   Revenue comes from completed orders in range. COGS uses the supply price in
   effect when each order was COMPLETED (historical costing), so changing a
   supply's price now never rewrites past profit.
   ═══════════════════════════════════════════ */

function generateItemReport() {
  return analyticsItems || calculateItemSales(analyticsOrders, POS_MENU, RECIPES, SUPPLIES,
    typeof ADD_ONS === 'undefined' ? [] : ADD_ONS);
}

function calculateItemSales(orders, menu, recipes, supplies, addons) {
  const supplyById = new Map(supplies.map(item => [item.id, item]));
  const rows = menu.map(item => ({
    id: item.id,
    name: item.name,
    category: item.category,
    price: item.price,
    sold: 0,
    revenue: 0,
    cogs: 0,
    profit: 0,
    usage: {},
    deductions: [],
  }));

  orders.forEach(order => {
    const completedAt = new Date(order.timeOut || order.timeIn).getTime();
    const keptShare = order.subtotal > 0 ? 1 - (order.discount || 0) / order.subtotal : 1;
    order.items.forEach(line => {
      const menuId = line.menuItemId != null ? line.menuItemId : menuIdByName(menu, line.name);
      const row = rows.find(r => r.id === menuId);
      if (!row) return;

      const qty = line.qty || 1;
      row.sold += qty;
      row.revenue += ((Number(line.unitPrice) || 0) + (Number(line.addOnPrice) || 0)) * qty * keptShare;
      row.cogs += computeLineCOGS(line, new Date(completedAt).toISOString(), menu, recipes, supplyById, addons);
      (recipes[row.id] || []).forEach(r => {
        row.usage[r.supplyId] = (row.usage[r.supplyId] || 0) + recipeQty(r, line.size) * qty;
      });
    });
  });

  rows.forEach(row => {
    // Ingredient deductions add up what each sold size really used, so Large drinks count their own amounts.
    const recipe = recipes[row.id] || [];
    row.deductions = recipe.map(r => {
      const sup = supplyById.get(r.supplyId);
      return {
        ingredient: sup ? sup.name : '?',
        unit: sup ? sup.unit : '',
        qtyPerServing: r.qty,
        largeQtyPerServing: r.largeQty,
        totalDeducted: row.usage[r.supplyId] || 0,
      };
    });
    row.profit = row.revenue - row.cogs;
  });

  return rows;
}

/* ═══════════════════════════════════════════
   CASH DRAWER & SUMMARY REPORT HELPERS
   ═══════════════════════════════════════════ */

function getCashLogsInRange(startISO, endISO, type = null) {
  const start = startISO ? dayStart(startISO) : -Infinity;
  const end = endISO ? dayEnd(endISO) : Infinity;
  return (CASH_LOGS || [])
    .filter(log => !type || log.type === type)
    .filter(log => {
      const t = new Date(log.timestamp || log.createdAt).getTime();
      return t >= start && t <= end;
    });
}

function computeCashPayIns(startISO, endISO) {
  return getCashLogsInRange(startISO, endISO, 'payIn')
    .reduce((sum, log) => sum + (Number(log.amount) || 0), 0);
}

function computeCashExpenses(startISO, endISO) {
  return getCashLogsInRange(startISO, endISO, 'payOut')
    .reduce((sum, log) => sum + (Number(log.amount) || 0), 0);
}

function generateSummaryReport(startISO, endISO) {
  return summarizeSales(generateItemReport(), analyticsOrders.length, getCashLogsInRange(startISO, endISO));
}

function summarizeSales(rows, orders, cashLogs) {
  const salesRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const cogs = rows.reduce((s, r) => s + r.cogs, 0);
  const itemProfit = rows.reduce((s, r) => s + r.profit, 0);
  const deposits = cashLogs.filter(log => log.type === 'payIn');
  const payouts = cashLogs.filter(log => log.type === 'payOut');
  const payIns = deposits.reduce((sum, log) => sum + log.amount, 0);
  const cashExpenses = payouts.reduce((sum, log) => sum + log.amount, 0);
  const payInCount = deposits.length;
  const payOutCount = payouts.length;
  return {
    orders,
    salesRevenue,
    payIns,
    payInCount,
    cashExpenses,
    payOutCount,
    revenue: salesRevenue + payIns,
    cogs,
    itemProfit,
    profit: itemProfit + payIns,
  };
}

if (typeof module !== 'undefined') module.exports = { calculateItemSales, summarizeSales };
