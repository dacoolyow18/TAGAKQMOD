function formatMoney(n) {
  return '\u20B1' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

function renderPdf({ rows, summary, cashLogs, branchName, preparedBy, reportStartISO, reportEndISO }) {
  const { jsPDF } = require('jspdf');
  const { autoTable } = require('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  // The built-in PDF font has no peso glyph, which corrupts widths and clips amounts.
  const formatMoney = n => 'PHP ' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  // Exact Tagak POS System Palette (RGB)
  const PALETTE = {
    forest:       [31, 45, 36],     // #1F2D24 — Primary Accent
    forestDark:   [22, 32, 25],     // #162019 — Deep Forest
    ink:          [20, 30, 24],     // #141E18 — Primary Ink
    inkSecondary: [47, 61, 52],     // #2F3D34 — Secondary Ink
    muted:        [75, 89, 80],     // #4B5950 — Muted Sage
    alabaster:    [243, 245, 244],  // #F3F5F4 — Cool Alabaster
    stone:        [234, 236, 233],  // #EAECE9 — Soft Stone
    white:        [255, 255, 255],  // #FFFFFF — Pure White
    border:       [221, 226, 221],  // #DDE2DD — Hairline
    borderStrong: [194, 203, 195],  // #C2CBC3 — Strong Hairline
    roast:        [106, 84, 59],    // #6A543B — Warm Roast
    terracotta:   [122, 85, 67],    // #7A5543 — Muted Terracotta
  };

  const visible = rows.filter(r => r.sold > 0 || r.revenue > 0);
  const dateLabel = `${reportStartISO || '—'} to ${reportEndISO || '—'}`;
  const generatedLabel = new Date().toLocaleString('en-PH');

  // ── Masthead Banner ──
  doc.setFillColor(...PALETTE.forest);
  doc.rect(margin, y, pageW - margin * 2, 16, 'F');
  doc.setTextColor(...PALETTE.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('TAGAK COFFEE — ITEM SALES & FINANCIAL REPORT', margin + 5, y + 6.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...PALETTE.stone);
  doc.text(`Branch: ${branchName}   |   Reporting Period: ${dateLabel}`, margin + 5, y + 12);
  doc.text(`Prepared by: ${preparedBy}   |   Generated: ${generatedLabel}`, pageW - margin - 5, y + 12, { align: 'right' });
  y += 20;

  // ── Executive Summary Strip (6 structured KPI cells) ──
  const kpis = [
    { label: 'TOTAL REVENUE', value: formatMoney(summary.revenue), sub: `Sales ${formatMoney(summary.salesRevenue)} + Pay-Ins` },
    { label: 'PAY-IN TRANSACTIONS', value: formatMoney(summary.payIns), sub: `${summary.payInCount} drawer deposit(s)` },
    { label: 'HISTORICAL COGS', value: formatMoney(summary.cogs), sub: 'Batch supply costing' },
    { label: 'CASH EXPENSES', value: formatMoney(summary.cashExpenses), sub: `${summary.payOutCount} drawer payout(s)` },
    { label: 'NET PROFIT', value: formatMoney(summary.profit), sub: `Item ${formatMoney(summary.itemProfit)} + Pay-Ins` },
    { label: 'COMPLETED ORDERS', value: String(summary.orders), sub: `${visible.reduce((s, r) => s + r.sold, 0)} units sold` },
  ];
  const cellW = (pageW - margin * 2) / kpis.length;
  const cellH = 15;
  kpis.forEach((kpi, idx) => {
    const x = margin + idx * cellW;
    doc.setFillColor(...(idx % 2 === 0 ? PALETTE.alabaster : PALETTE.stone));
    doc.setDrawColor(...PALETTE.borderStrong);
    doc.setLineWidth(0.2);
    doc.rect(x, y, cellW, cellH, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...PALETTE.muted);
    doc.text(kpi.label, x + 3, y + 4.2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...(kpi.label === 'CASH EXPENSES' ? PALETTE.terracotta : PALETTE.ink));
    doc.text(kpi.value, x + 3, y + 9.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(...PALETTE.inkSecondary);
    doc.text(kpi.sub, x + 3, y + 13.2);
  });
  y += cellH + 5;

  // ── Section 1: Itemized Sales & Historical Cost Table ──
  const head = [['Item', 'Category', 'Unit Price', 'Qty Sold', 'Sales Revenue', 'Historical COGS', 'Item Profit', 'Margin']];
  const body = [];
  const totalRowIndices = new Set();
  const breakdownRowIndices = new Set();

  visible.forEach(row => {
    const marginPct = row.revenue > 0 ? `${((row.profit / row.revenue) * 100).toFixed(1)}%` : '0.0%';
    body.push([
      row.name,
      row.category,
      formatMoney(row.price || 0),
      String(row.sold),
      formatMoney(row.revenue),
      formatMoney(row.cogs),
      formatMoney(row.profit),
      marginPct,
    ]);
    if (row.deductions.length > 0) {
      const breakdownStr = row.deductions.map(d =>
        `${d.ingredient} (${servingLabel(d)}) × ${row.sold} = ${d.totalDeducted} ${d.unit}`
      ).join('   •   ');
      breakdownRowIndices.add(body.length);
      body.push([
        {
          content: `Ingredient Deductions: ${breakdownStr}`,
          colSpan: 8,
          styles: {
            fontSize: 7,
            textColor: PALETTE.muted,
            fillColor: PALETTE.alabaster,
            cellPadding: { top: 1.5, bottom: 2, left: 4, right: 3 },
          },
        },
      ]);
    }
  });

  if (visible.length > 0) {
    const totalSalesRev = visible.reduce((s, r) => s + r.revenue, 0);
    const totalCogs = visible.reduce((s, r) => s + r.cogs, 0);
    const totalItemProfit = visible.reduce((s, r) => s + r.profit, 0);
    const totalMargin = totalSalesRev > 0 ? `${((totalItemProfit / totalSalesRev) * 100).toFixed(1)}%` : '0.0%';
    totalRowIndices.add(body.length);
    body.push([
      'ITEM SALES SUBTOTAL',
      '',
      '',
      String(visible.reduce((s, r) => s + r.sold, 0)),
      formatMoney(totalSalesRev),
      formatMoney(totalCogs),
      formatMoney(totalItemProfit),
      totalMargin,
    ]);
  }

  if (summary.payIns > 0) {
    totalRowIndices.add(body.length);
    body.push([
      'PAY-IN TRANSACTIONS (CASH DRAWER)',
      'Pay-In',
      '—',
      String(summary.payInCount),
      formatMoney(summary.payIns),
      formatMoney(0),
      formatMoney(summary.payIns),
      '100.0%',
    ]);
  }

  if (visible.length > 0 || summary.payIns > 0) {
    const overallMargin = summary.revenue > 0 ? `${((summary.profit / summary.revenue) * 100).toFixed(1)}%` : '0.0%';
    totalRowIndices.add(body.length);
    body.push([
      'BRANCH GRAND TOTAL (SALES + PAY-INS)',
      '',
      '',
      String(visible.reduce((s, r) => s + r.sold, 0)),
      formatMoney(summary.revenue),
      formatMoney(summary.cogs),
      formatMoney(summary.profit),
      overallMargin,
    ]);
  }

  autoTable(doc, {
    startY: y,
    head,
    body,
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 8,
      cellPadding: 2.2,
      overflow: 'linebreak',
      lineWidth: 0.15,
      lineColor: PALETTE.border,
      textColor: PALETTE.ink,
    },
    headStyles: {
      fillColor: PALETTE.forest,
      textColor: PALETTE.white,
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: 2.6,
    },
    bodyStyles: {
      textColor: PALETTE.ink,
      fillColor: PALETTE.white,
    },
    columnStyles: {
      0: { cellWidth: 'auto', fontStyle: 'bold' },
      1: { cellWidth: 24 },
      2: { cellWidth: 24, halign: 'right' },
      3: { cellWidth: 18, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
      5: { cellWidth: 28, halign: 'right' },
      6: { cellWidth: 28, halign: 'right' },
      7: { cellWidth: 20, halign: 'right' },
    },
    didParseCell(data) {
      if (data.section === 'head' && data.column.index >= 2) {
        data.cell.styles.halign = 'right';
      }
      if (data.section === 'body') {
        if (totalRowIndices.has(data.row.index)) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = PALETTE.stone;
          data.cell.styles.textColor = PALETTE.forestDark;
        } else if (!breakdownRowIndices.has(data.row.index) && data.column.index >= 2) {
          data.cell.styles.halign = 'right';
        }
      }
    },
  });

  // ── Section 2: Cash Drawer Activity Ledger (Pay-Ins & Pay-Outs) ──
  if (cashLogs.length > 0) {
    const nextY = (doc.lastAutoTable?.finalY || y) + 6;
    autoTable(doc, {
      startY: nextY,
      head: [['Timestamp', 'Transaction Type', 'Reason / Reference', 'Amount']],
      body: cashLogs.map(log => [
        new Date(log.timestamp || log.createdAt).toLocaleString('en-PH'),
        log.type === 'payIn' ? 'Pay-In (Revenue Deposit)' : 'Pay-Out (Cash Expense)',
        log.reason || '—',
        (log.type === 'payIn' ? '+' : '-') + formatMoney(log.amount),
      ]),
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
        lineWidth: 0.15,
        lineColor: PALETTE.border,
        textColor: PALETTE.ink,
      },
      headStyles: {
        fillColor: PALETTE.inkSecondary,
        textColor: PALETTE.white,
        fontStyle: 'bold',
        fontSize: 7.5,
      },
      alternateRowStyles: { fillColor: PALETTE.alabaster },
      columnStyles: {
        0: { cellWidth: 46 },
        1: { cellWidth: 44, fontStyle: 'bold' },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
      },
    });
  }

  const pageH = doc.internal.pageSize.getHeight();
  const pageCount = doc.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFontSize(7);
    doc.setTextColor(...PALETTE.muted);
    doc.text(`Tagak Coffee POS — ${branchName} — Confidential Financial & Item Sales Report`, margin, pageH - 6);
    doc.text(`Page ${page} of ${pageCount}`, pageW - margin, pageH - 6, { align: 'right' });
  }

  return Buffer.from(doc.output('arraybuffer'));
}

function renderPrintable({ rows, summary, cashLogs, branchName, preparedBy, reportStartISO, reportEndISO }) {
  const visible = rows.filter(r => r.sold > 0 || r.revenue > 0);

  const dateLabel = `${reportStartISO || '—'} to ${reportEndISO || '—'}`;
  const now = new Date().toLocaleString('en-PH');
  const totalUnitsSold = visible.reduce((s, r) => s + r.sold, 0);

  const tableRows = visible.map(row => {
    const marginPct = row.revenue > 0 ? ((row.profit / row.revenue) * 100).toFixed(1) : '0.0';
    const breakdownChips = row.deductions.map(d =>
      `<span class="deduction-chip"><strong>${escapeAttr(d.ingredient)}</strong>: ${escapeAttr(servingLabel(d))} &times; ${row.sold} = <strong>${d.totalDeducted.toLocaleString()} ${escapeAttr(d.unit)}</strong></span>`
    ).join('');
    const profitClass = row.profit >= 0 ? 'tone-positive' : 'tone-negative';
    return `
      <tr class="item-row">
        <td class="item-name">${escapeAttr(row.name)}</td>
        <td><span class="cat-badge">${escapeAttr(row.category)}</span></td>
        <td class="num">${formatMoney(row.price || 0)}</td>
        <td class="num">${row.sold}</td>
        <td class="num font-semi">${formatMoney(row.revenue)}</td>
        <td class="num tone-muted">${formatMoney(row.cogs)}</td>
        <td class="num font-semi ${profitClass}">${formatMoney(row.profit)}</td>
        <td class="num tone-muted">${marginPct}%</td>
      </tr>
      <tr class="breakdown-row">
        <td colspan="8">
          <div class="breakdown-wrap">
            <span class="breakdown-tag">Recipe Deductions</span>
            <div class="breakdown-chips">${breakdownChips || '<span class="tone-muted">No ingredients mapped</span>'}</div>
          </div>
        </td>
      </tr>`;
  }).join('');

  const itemSalesSubtotalRow = visible.length > 0 ? (() => {
    const subMargin = summary.salesRevenue > 0 ? ((summary.itemProfit / summary.salesRevenue) * 100).toFixed(1) : '0.0';
    return `
      <tr class="subtotal-row">
        <td class="item-name">Item Sales Subtotal</td>
        <td></td>
        <td></td>
        <td class="num">${totalUnitsSold}</td>
        <td class="num">${formatMoney(summary.salesRevenue)}</td>
        <td class="num">${formatMoney(summary.cogs)}</td>
        <td class="num">${formatMoney(summary.itemProfit)}</td>
        <td class="num">${subMargin}%</td>
      </tr>`;
  })() : '';

  const payInSummaryRow = summary.payIns > 0 ? `
    <tr class="subtotal-row">
      <td class="item-name">Pay-In Transactions (${summary.payInCount} drawer deposit${summary.payInCount === 1 ? '' : 's'})</td>
      <td><span class="cat-badge">Pay-In</span></td>
      <td class="num">&mdash;</td>
      <td class="num">${summary.payInCount}</td>
      <td class="num">${formatMoney(summary.payIns)}</td>
      <td class="num">${formatMoney(0)}</td>
      <td class="num">${formatMoney(summary.payIns)}</td>
      <td class="num">100.0%</td>
    </tr>` : '';

  const grandTotalMargin = summary.revenue > 0 ? ((summary.profit / summary.revenue) * 100).toFixed(1) : '0.0';
  const totals = (visible.length > 0 || summary.payIns > 0) ? `
    ${itemSalesSubtotalRow}
    ${payInSummaryRow}
    <tr class="totals-row">
      <td class="item-name">BRANCH GRAND TOTAL</td>
      <td></td>
      <td></td>
      <td class="num">${totalUnitsSold}</td>
      <td class="num">${formatMoney(summary.revenue)}</td>
      <td class="num">${formatMoney(summary.cogs)}</td>
      <td class="num">${formatMoney(summary.profit)}</td>
      <td class="num">${grandTotalMargin}%</td>
    </tr>` : `
    <tr>
      <td colspan="8" style="text-align:center;padding:6mm;color:#4B5950;">No completed sales or pay-in activity in the selected period.</td>
    </tr>`;

  const cashDrawerRows = cashLogs.map(log => {
    const isPayIn = log.type === 'payIn';
    const ts = new Date(log.timestamp || log.createdAt).toLocaleString('en-PH');
    return `
      <tr>
        <td class="tabular">${escapeAttr(ts)}</td>
        <td><span class="tx-badge ${isPayIn ? 'tx-payin' : 'tx-payout'}">${isPayIn ? 'Pay-In' : 'Pay-Out'}</span></td>
        <td>${escapeAttr(log.reason || '—')}</td>
        <td class="num font-semi ${isPayIn ? 'tone-positive' : 'tone-negative'}">${isPayIn ? '+' : '-'}${formatMoney(log.amount)}</td>
      </tr>`;
  }).join('');

  const cashDrawerSection = cashLogs.length > 0 ? `
    <div class="section-block">
      <div class="section-header">
        <h2>Cash Drawer Financial Activity (Pay-In &amp; Pay-Out Log)</h2>
        <span>Net Drawer Flow: ${formatMoney(summary.payIns - summary.cashExpenses)}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:22%">Timestamp</th>
            <th style="width:16%">Type</th>
            <th>Reason / Description</th>
            <th style="width:16%;text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>${cashDrawerRows}</tbody>
      </table>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Tagak Coffee — Item Sales &amp; Financial Report</title>
<style>
  :root {
    --pos-forest:        #1F2D24;
    --pos-forest-dark:   #162019;
    --pos-ink:           #141E18;
    --pos-ink-2:         #2F3D34;
    --pos-muted:         #4B5950;
    --pos-bg:            #F3F5F4;
    --pos-surface-alt:   #EAECE9;
    --pos-surface:       #FFFFFF;
    --pos-border:        #DDE2DD;
    --pos-border-strong: #C2CBC3;
    --pos-warn:          #6A543B;
    --pos-danger:        #7A5543;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    font-size: 8.5pt;
    line-height: 1.4;
    color: var(--pos-ink);
    background: var(--pos-surface);
    padding: 10mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .masthead {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    background: var(--pos-forest);
    color: var(--pos-surface);
    padding: 5mm 6mm;
    border-radius: 2mm;
    margin-bottom: 4.5mm;
    border-bottom: 1mm solid var(--pos-forest-dark);
  }
  .masthead-kicker {
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--pos-border-strong);
    margin-bottom: 1mm;
  }
  .masthead h1 {
    font-size: 14pt;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--pos-surface);
  }
  .masthead-sub {
    font-size: 8pt;
    color: var(--pos-surface-alt);
    margin-top: 1mm;
  }
  .masthead-meta {
    text-align: right;
    font-size: 7.5pt;
    color: var(--pos-surface-alt);
    line-height: 1.5;
  }
  .masthead-meta strong {
    color: var(--pos-surface);
    font-weight: 600;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 2.5mm;
    margin-bottom: 5mm;
  }
  .summary-card {
    background: var(--pos-bg);
    border: 0.35pt solid var(--pos-border-strong);
    border-top: 1.8pt solid var(--pos-forest);
    border-radius: 1.5mm;
    padding: 2.5mm 3mm;
  }
  .summary-card.card-expense {
    border-top-color: var(--pos-danger);
  }
  .summary-label {
    font-size: 6.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--pos-muted);
    margin-bottom: 1mm;
  }
  .summary-value {
    font-size: 10.5pt;
    font-weight: 700;
    color: var(--pos-ink);
    font-variant-numeric: tabular-nums;
  }
  .summary-sub {
    font-size: 6.5pt;
    color: var(--pos-ink-2);
    margin-top: 0.8mm;
    font-variant-numeric: tabular-nums;
  }
  .section-block {
    margin-bottom: 5mm;
  }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--pos-surface-alt);
    border: 0.35pt solid var(--pos-border-strong);
    border-bottom: none;
    padding: 2mm 3mm;
  }
  .section-header h2 {
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--pos-ink);
  }
  .section-header span {
    font-size: 7.5pt;
    font-weight: 600;
    color: var(--pos-ink-2);
    font-variant-numeric: tabular-nums;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    border: 0.35pt solid var(--pos-border-strong);
  }
  thead th {
    background: var(--pos-forest);
    color: var(--pos-surface);
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2.2mm 2.8mm;
    text-align: left;
    border: 0.3pt solid var(--pos-forest-dark);
  }
  tbody td {
    padding: 2mm 2.8mm;
    border: 0.3pt solid var(--pos-border);
    font-size: 8pt;
    color: var(--pos-ink);
    vertical-align: middle;
  }
  .item-row td {
    background: var(--pos-surface);
  }
  .num, .tabular {
    font-variant-numeric: tabular-nums;
  }
  .num {
    text-align: right;
  }
  .item-name {
    font-weight: 700;
    color: var(--pos-ink);
  }
  .font-semi {
    font-weight: 600;
  }
  .tone-positive {
    color: var(--pos-forest);
  }
  .tone-negative {
    color: var(--pos-danger);
  }
  .tone-muted {
    color: var(--pos-muted);
  }
  .cat-badge {
    display: inline-block;
    padding: 0.5mm 2mm;
    font-size: 6.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--pos-surface-alt);
    color: var(--pos-ink-2);
    border: 0.3pt solid var(--pos-border-strong);
    border-radius: 1mm;
  }
  .tx-badge {
    display: inline-block;
    padding: 0.5mm 2mm;
    font-size: 6.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: 1mm;
  }
  .tx-payin {
    background: var(--pos-surface-alt);
    color: var(--pos-forest);
    border: 0.3pt solid var(--pos-border-strong);
  }
  .tx-payout {
    background: var(--pos-bg);
    color: var(--pos-danger);
    border: 0.3pt solid var(--pos-border-strong);
  }
  .breakdown-row td {
    background: var(--pos-bg);
    padding: 1.5mm 2.8mm 2mm;
    border-bottom: 0.5pt solid var(--pos-border-strong);
  }
  .breakdown-wrap {
    display: flex;
    align-items: flex-start;
    gap: 2.5mm;
  }
  .breakdown-tag {
    font-size: 6.2pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--pos-muted);
    white-space: nowrap;
    padding-top: 0.4mm;
  }
  .breakdown-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 1.2mm 2mm;
  }
  .deduction-chip {
    display: inline-block;
    font-size: 6.8pt;
    color: var(--pos-ink-2);
    background: var(--pos-surface);
    border: 0.3pt solid var(--pos-border);
    padding: 0.4mm 1.8mm;
    border-radius: 0.8mm;
    font-variant-numeric: tabular-nums;
  }
  .subtotal-row td {
    background: var(--pos-bg);
    font-weight: 600;
    color: var(--pos-ink-2);
    border-top: 0.5pt solid var(--pos-border-strong);
    padding: 2mm 2.8mm;
  }
  .totals-row td {
    background: var(--pos-surface-alt);
    color: var(--pos-ink);
    font-weight: 700;
    font-size: 8.5pt;
    border-top: 1.2pt solid var(--pos-forest);
    border-bottom: 1.2pt solid var(--pos-forest);
    padding: 2.4mm 2.8mm;
  }
  .footer {
    margin-top: 4mm;
    padding-top: 2.5mm;
    border-top: 0.4pt solid var(--pos-border-strong);
    font-size: 7pt;
    color: var(--pos-muted);
    display: flex;
    justify-content: space-between;
  }
  @media print {
    body { padding: 0; }
    @page { size: A4 landscape; margin: 8mm; }
  }
</style>
</head>
<body>
  <div class="masthead">
    <div>
      <div class="masthead-kicker">Tagak Coffee Point of Sale</div>
      <h1>Item Sales &amp; Branch Financial Report</h1>
      <div class="masthead-sub">Branch: <strong>${escapeAttr(branchName)}</strong> &ensp;&bull;&ensp; Period: <strong>${escapeAttr(dateLabel)}</strong></div>
    </div>
    <div class="masthead-meta">
      <div>Prepared by: <strong>${escapeAttr(preparedBy)}</strong></div>
      <div>Generated: <strong>${escapeAttr(now)}</strong></div>
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="summary-label">Total Revenue</div>
      <div class="summary-value">${formatMoney(summary.revenue)}</div>
      <div class="summary-sub">Sales ${formatMoney(summary.salesRevenue)} + Pay-Ins</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Pay-In Transactions</div>
      <div class="summary-value tone-positive">${formatMoney(summary.payIns)}</div>
      <div class="summary-sub">${summary.payInCount} drawer deposit${summary.payInCount === 1 ? '' : 's'}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Historical COGS</div>
      <div class="summary-value">${formatMoney(summary.cogs)}</div>
      <div class="summary-sub">Completed order batch costs</div>
    </div>
    <div class="summary-card card-expense">
      <div class="summary-label">Cash Expenses</div>
      <div class="summary-value tone-negative">${formatMoney(summary.cashExpenses)}</div>
      <div class="summary-sub">${summary.payOutCount} drawer payout${summary.payOutCount === 1 ? '' : 's'}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Net Profit</div>
      <div class="summary-value ${summary.profit >= 0 ? 'tone-positive' : 'tone-negative'}">${formatMoney(summary.profit)}</div>
      <div class="summary-sub">Item ${formatMoney(summary.itemProfit)} + Pay-Ins</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Completed Orders</div>
      <div class="summary-value">${summary.orders}</div>
      <div class="summary-sub">${totalUnitsSold} total units sold</div>
    </div>
  </div>

  <div class="section-block">
    <div class="section-header">
      <h2>Itemized Sales, Recipe Deductions &amp; Profit Margin</h2>
      <span>${visible.length} active SKU${visible.length === 1 ? '' : 's'} in range</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Category</th>
          <th style="text-align:right">Unit Price</th>
          <th style="text-align:right">Qty Sold</th>
          <th style="text-align:right">Sales Revenue</th>
          <th style="text-align:right">Historical COGS</th>
          <th style="text-align:right">Item Profit</th>
          <th style="text-align:right">Margin</th>
        </tr>
      </thead>
      <tbody>${tableRows}${totals}</tbody>
    </table>
  </div>

  ${cashDrawerSection}

  <div class="footer">
    <span>Tagak Coffee POS &mdash; ${escapeAttr(branchName)} &mdash; Confidential Operational Record</span>
    <span>Select &ldquo;Save as PDF&rdquo; in the print dialog to archive.</span>
  </div>
</body>
</html>`;
}

module.exports = { renderPdf, renderPrintable };
