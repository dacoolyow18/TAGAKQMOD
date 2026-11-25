/**
 * File: dashboard.js
 * Path: pos-app/js/dashboard.js
 * Description: Analytics module for the POS.
 *              Renders the merged Analytics view — summary cards, Chart.js
 *              graphs for sales revenue and order counts, and the item-based
 *              breakdown table — all driven by real POS.orders data within a
 *              single user-selected date range (from the Start/End pickers).
 *              Quick-filter presets (Today / Daily / Monthly / Yearly) simply
 *              populate the date pickers so every section reflects the same
 *              real data dates.
 */

let salesChart = null;
let ordersChart = null;
let activePreset = null;

/* ═══════════════════════════════════════════
   REAL DATA AGGREGATION (from POS.orders)
   ═══════════════════════════════════════════
   Groups completed orders within [startISO, endISO] into buckets whose width
   adapts to the range length (day / month / year), returning labels plus
   revenue and order-count totals per bucket.
   ═══════════════════════════════════════════ */

function aggregateOrdersByRange(startISO, endISO) {
  const start = startISO ? dayStart(startISO) : -Infinity;
  const end = endISO ? dayEnd(endISO) : Infinity;

  const inRange = analyticsOrders
    .map(order => {
      const t = new Date(order.timeOut || order.timeIn).getTime();
      return { order, t };
    })
    .filter(x => x.t >= start && x.t <= end);

  const payInsInRange = (typeof getCashLogsInRange === 'function' ? getCashLogsInRange(startISO, endISO, 'payIn') : [])
    .map(log => {
      const t = new Date(log.timestamp || log.createdAt).getTime();
      return { log, t };
    })
    .filter(x => x.t >= start && x.t <= end);

  if (inRange.length === 0 && payInsInRange.length === 0) return { labels: [], revenue: [], counts: [] };

  const spanDays = (end - start) / (1000 * 60 * 60 * 24);
  // Choose bucket width: day for ranges <= ~90 days, month up to ~2.5 years, else year.
  const mode = spanDays > 1100 ? 'year' : (spanDays > 90 ? 'month' : 'day');

  const buckets = new Map();
  const ensureBucket = (t) => {
    const d = new Date(t);
    let key;
    let label;
    if (mode === 'day') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      label = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    } else if (mode === 'month') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      label = d.toLocaleDateString('en-PH', { month: 'short' });
    } else {
      key = `${d.getFullYear()}`;
      label = String(d.getFullYear());
    }
    if (!buckets.has(key)) buckets.set(key, { label, revenue: 0, count: 0 });
    return buckets.get(key);
  };

  inRange.forEach(({ order, t }) => {
    const b = ensureBucket(t);
    b.revenue += order.total || 0;
    b.count += 1;
  });

  payInsInRange.forEach(({ log, t }) => {
    const b = ensureBucket(t);
    b.revenue += Number(log.amount) || 0;
  });

  // Sort buckets chronologically by key (lexicographic works for these key forms).
  const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1);

  return {
    labels: sorted.map(([, b]) => b.label),
    revenue: sorted.map(([, b]) => b.revenue),
    counts: sorted.map(([, b]) => b.count),
  };
}

/* ═══════════════════════════════════════════
   CHARTS
   ═══════════════════════════════════════════ */

function createCharts() {
  const salesCtx = document.getElementById('chart-sales');
  const ordersCtx = document.getElementById('chart-orders');
  if (!salesCtx || !ordersCtx) return;

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1B261F',
        titleFont: { family: 'Inter', size: 11, weight: '600' },
        bodyFont: { family: 'Inter', size: 11 },
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { family: 'Inter', size: 11 }, color: '#4B5950', maxRotation: 45, minRotation: 0 },
      },
      y: {
        grid: { color: '#E5E8E0' },
        ticks: {
          font: { family: 'Inter', size: 11 },
          color: '#4B5950',
          precision: 2,
          callback: formatMoney,
        },
      },
    },
    interaction: { intersect: false, mode: 'index' },
    elements: {
      point: { radius: 3, hoverRadius: 5 },
      line: { tension: 0.35 },
    },
  };

  salesChart = new Chart(salesCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: '#2B3A30',
        backgroundColor: 'rgba(43, 58, 48, 0.10)',
        fill: true,
        borderWidth: 2,
      }],
    },
    options: commonOptions,
  });

  ordersChart = new Chart(ordersCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: '#2B3A30',
        hoverBackgroundColor: '#1F2D24',
        borderRadius: 4,
        maxBarThickness: 32,
      }],
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: {
          ...commonOptions.scales.y,
          ticks: {
            ...commonOptions.scales.y.ticks,
            precision: 0,
            callback: (v) => v,
          },
        },
      },
    },
  });
}

function updateCharts(startISO, endISO) {
  if (!salesChart || !ordersChart) return;

  const agg = aggregateOrdersByRange(startISO, endISO);

  salesChart.data.labels = agg.labels;
  salesChart.data.datasets[0].data = agg.revenue;
  salesChart.update();

  ordersChart.data.labels = agg.labels;
  ordersChart.data.datasets[0].data = agg.counts;
  ordersChart.update();
}

/* ═══════════════════════════════════════════
   PRESET FILTER BUTTONS
   ═══════════════════════════════════════════ */

function bindPresetButtons() {
  $$('.chart-filter[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      applyPreset(btn.dataset.preset);
    });
  });
}

function applyPreset(preset) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end;

  switch (preset) {
    case 'today':
      start = today;
      end = today;
      break;
    case 'daily':
      start = new Date(today);
      start.setDate(start.getDate() - 6);
      end = today;
      break;
    case 'monthly':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = today;
      break;
    case 'yearly':
      start = new Date(now.getFullYear(), 0, 1);
      end = today;
      break;
    default:
      return;
  }

  $('#report-start').value = toDateInput(start);
  $('#report-end').value = toDateInput(end);
  activePreset = preset;
  $$('.chart-filter[data-preset]').forEach(b =>
    b.classList.toggle('active-filter', b.dataset.preset === preset));

  renderAnalytics();
}

/* ═══════════════════════════════════════════
   RENDER ANALYTICS (single entry point)
   ═══════════════════════════════════════════ */

async function renderAnalytics() {
  if (!canViewModule('analytics')) return;
  const startISO = $('#report-start').value;
  const endISO = $('#report-end').value;
  reportStartISO = startISO;
  reportEndISO = endISO;

  if (startISO && endISO) {
    try {
      const perms = POS.user?.permissions || {};
      const canLoadCash = perms.access_cash_drawer || perms.view_analytics;
      await Promise.all([
        loadAnalyticsOrders(startISO, endISO),
        canLoadCash ? loadCashLogs().catch(() => {}) : Promise.resolve(),
      ]);
    } catch (err) {
      showToast(err.message, 'error');
    }
    // A newer date change may have started while this request was in flight.
    if (reportStartISO !== startISO || reportEndISO !== endISO) return;
  }

  // Clear preset highlight when dates were edited manually (matches no preset).
  if (activePreset) {
    // Optionally verify preset still matches; otherwise mark as custom.
    if (!presetMatchesDates(activePreset, startISO, endISO)) {
      activePreset = null;
      $$('.chart-filter[data-preset]').forEach(b => b.classList.remove('active-filter'));
    }
  }

  // Keep the active preset button highlighted to match current dates.
  if (activePreset) {
    $$('.chart-filter[data-preset]').forEach(b =>
      b.classList.toggle('active-filter', b.dataset.preset === activePreset));
  }

  // Update the cash pay-ins and cash expenses summary cards
  const payIns = computeCashPayIns(startISO, endISO);
  const payInsEl = $('#report-summary-pay-ins');
  if (payInsEl) payInsEl.textContent = formatMoney(payIns);

  const cashExpenses = computeCashExpenses(startISO, endISO);
  const cashExpensesEl = $('#report-summary-cash-expenses');
  if (cashExpensesEl) cashExpensesEl.textContent = formatMoney(cashExpenses);

  updateCharts(startISO, endISO);
  renderReportTable();
}

function presetMatchesDates(preset, startISO, endISO) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end;
  switch (preset) {
    case 'today':
      start = toDateInput(today); end = toDateInput(today); break;
    case 'daily':
      const s = new Date(today); s.setDate(s.getDate() - 6);
      start = toDateInput(s); end = toDateInput(today); break;
    case 'monthly':
      start = toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
      end = toDateInput(today); break;
    case 'yearly':
      start = toDateInput(new Date(now.getFullYear(), 0, 1));
      end = toDateInput(today); break;
    default:
      return false;
  }
  return startISO === start && endISO === end;
}
