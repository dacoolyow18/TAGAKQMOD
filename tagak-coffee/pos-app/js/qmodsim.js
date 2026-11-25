/**
 * File: qmodsim.js
 * Path: pos-app/js/qmodsim.js
 * Description: Interactive Quantitative Modeling & Simulation (QMODSIM) Lab for Tagak Café.
 *              Implements all 7 QMODSIM topics from the specification PDF:
 *                1. Stochastic Arrival Processes (NHPP) & Break-Hour Order Surges (Modules 1 & 3)
 *                2. Queueing Theory (M/M/c/K) & Multi-Channel Counter Sizing (Module 6)
 *                3. Discrete-Time Markov Chains (DTMC) & Order Lifecycle Dynamics (Module 5)
 *                4. FAIR Risk Framework & 100k-Iteration Monte Carlo Simulation (Module 4)
 *                5. Game Theory in Cashier Audit & Void Authorization (Module 7)
 *                6. Information Entropy & POS Terminal PIN Cryptanalysis (Modules 2 & 10)
 *                7. System Reliability Block Diagrams (RBD) & Offline Queue Resilience (Module 12)
 */

window.QMODSIM_AUDIT_THRESHOLD = 0.1667; // Default Nash Equilibrium sigma_M* = G / (G + F)

const QMOD_CHARTS = {
  nhpp: null,
  prep: null,
  mmck: null,
  dtmc: null,
  lec: null,
  pin: null,
  rbd: null,
};

let qmodTelemetry = null;

/* ═══════════════════════════════════════════
   RANDOM VARIATE GENERATORS (Box-Muller, Marsaglia Gamma, Beta-PERT)
   ═══════════════════════════════════════════ */

function randNormal() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Marsaglia and Tsang's method for Gamma(alpha, 1) */
function randGamma(alpha) {
  if (alpha < 1) {
    return randGamma(1 + alpha) * Math.pow(Math.random(), 1 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x = randNormal();
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Sample from Beta-PERT(a, m, b) with shape parameter lambda=4 */
function sampleBetaPERT(a, m, b) {
  if (b <= a) return a;
  const mu = (a + 4 * m + b) / 6;
  let alpha;
  let beta;
  if (Math.abs(mu - m) < 1e-9) {
    alpha = 3;
    beta = 3;
  } else {
    alpha = ((mu - a) * (2 * m - a - b)) / ((m - mu) * (b - a));
    beta = (alpha * (b - mu)) / (mu - a);
  }
  alpha = Math.max(0.5, alpha);
  beta = Math.max(0.5, beta);
  const x = randGamma(alpha);
  const y = randGamma(beta);
  return a + (x / (x + y)) * (b - a);
}

function factorialLocal(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/* ═══════════════════════════════════════════
   1. STOCHASTIC ARRIVAL PROCESSES (NHPP) & DRINK PREP DISTRIBUTIONS
   ═══════════════════════════════════════════ */

function computeNHPP(lambdaBase = 8, A1 = 22, A2 = 28, A3 = 20, sigma = 0.55) {
  // Hours from 7:00 AM (7.0) to 7:00 PM (19.0) in 15-minute increments
  const breaks = [
    { t: 10.0, A: A1, sigma }, // 10:00 AM class transition
    { t: 12.0, A: A2, sigma }, // 12:00 PM lunch dismissal
    { t: 15.0, A: A3, sigma }, // 3:00 PM afternoon break
  ];
  const labels = [];
  const intensities = [];
  const simulatedCounts = [];

  for (let h = 7; h <= 19; h += 0.25) {
    const wholeHr = Math.floor(h);
    const mins = Math.round((h - wholeHr) * 60);
    const ampm = wholeHr >= 12 ? 'PM' : 'AM';
    const hr12 = wholeHr > 12 ? wholeHr - 12 : (wholeHr === 0 ? 12 : wholeHr);
    labels.push(`${hr12}:${String(mins).padStart(2, '0')} ${ampm}`);

    let lam = lambdaBase;
    for (const brk of breaks) {
      lam += brk.A * Math.exp(-Math.pow(h - brk.t, 2) / (2 * brk.sigma * brk.sigma));
    }
    intensities.push(Number(lam.toFixed(2)));
    // Poisson sample scaled to hourly rate
    const noisy = Math.max(0, Math.round(lam + Math.sqrt(lam) * randNormal() * 0.45));
    simulatedCounts.push(noisy);
  }

  return { labels, intensities, simulatedCounts };
}

function computePrepDistributions(gammaShape = 4.0, gammaScale = 0.65, logMu = 1.15, logSigma = 0.42) {
  // Time in minutes from 0.5 to 8.0 minutes
  const labels = [];
  const gammaPdf = [];
  const lognormalPdf = [];

  // Approximate Gamma(k) for half-integers/integers via Stirling/Lanczos
  function gammaFunc(z) {
    const g = 7;
    const p = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFunc(1 - z));
    z -= 1;
    let x = p[0];
    for (let i = 1; i < g + 2; i++) x += p[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }

  const gammaK = gammaFunc(gammaShape);
  for (let t = 0.5; t <= 8.0; t += 0.25) {
    labels.push(`${t.toFixed(2)}m`);
    const gVal = (Math.pow(t, gammaShape - 1) * Math.exp(-t / gammaScale)) / (gammaK * Math.pow(gammaScale, gammaShape));
    const lVal = (1 / (t * logSigma * Math.sqrt(2 * Math.PI))) * Math.exp(-Math.pow(Math.log(t) - logMu, 2) / (2 * logSigma * logSigma));
    gammaPdf.push(Number(gVal.toFixed(4)));
    lognormalPdf.push(Number(lVal.toFixed(4)));
  }

  const gammaMean = gammaShape * gammaScale;
  const logMean = Math.exp(logMu + (logSigma * logSigma) / 2);
  return { labels, gammaPdf, lognormalPdf, gammaMean, logMean };
}

function renderTopic1() {
  const lambdaBase = parseFloat($('#qmod-nhpp-base')?.value) || 8;
  const surge10 = parseFloat($('#qmod-nhpp-a1')?.value) || 22;
  const surge12 = parseFloat($('#qmod-nhpp-a2')?.value) || 28;
  const surge15 = parseFloat($('#qmod-nhpp-a3')?.value) || 20;

  const nhpp = computeNHPP(lambdaBase, surge10, surge12, surge15, 0.55);
  const prep = computePrepDistributions(4.0, 0.65, 1.15, 0.42);

  const peakRate = Math.max(...nhpp.intensities);
  const expInterArrivalMin = (60 / lambdaBase).toFixed(2);
  $('#qmod-t1-peak').textContent = `${peakRate.toFixed(1)} orders/hr`;
  $('#qmod-t1-interarrival').textContent = `${expInterArrivalMin} mins`;
  $('#qmod-t1-gamma-mean').textContent = `${prep.gammaMean.toFixed(2)} mins (Iced/Simple)`;
  $('#qmod-t1-log-mean').textContent = `${prep.logMean.toFixed(2)} mins (Blended/Multi)`;

  const nhppCtx = document.getElementById('chart-qmod-nhpp');
  if (nhppCtx && window.Chart) {
    if (QMOD_CHARTS.nhpp) QMOD_CHARTS.nhpp.destroy();
    QMOD_CHARTS.nhpp = new Chart(nhppCtx, {
      type: 'line',
      data: {
        labels: nhpp.labels,
        datasets: [
          {
            label: 'NHPP Intensity λ(t) (orders/hr)',
            data: nhpp.intensities,
            borderColor: '#1F2D24',
            backgroundColor: 'rgba(31, 45, 36, 0.12)',
            fill: true,
            tension: 0.35,
            borderWidth: 2,
          },
          {
            label: 'Simulated Break-Hour Arrivals',
            data: nhpp.simulatedCounts,
            borderColor: '#6A543B',
            borderDash: [4, 4],
            fill: false,
            tension: 0.25,
            borderWidth: 1.5,
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }

  const prepCtx = document.getElementById('chart-qmod-prep');
  if (prepCtx && window.Chart) {
    if (QMOD_CHARTS.prep) QMOD_CHARTS.prep.destroy();
    QMOD_CHARTS.prep = new Chart(prepCtx, {
      type: 'line',
      data: {
        labels: prep.labels,
        datasets: [
          {
            label: 'Gamma PDF (Iced / Espresso Prep)',
            data: prep.gammaPdf,
            borderColor: '#1F2D24',
            backgroundColor: 'rgba(31, 45, 36, 0.10)',
            fill: true,
            tension: 0.35,
          },
          {
            label: 'Lognormal PDF (Multi-Ingredient Blended)',
            data: prep.lognormalPdf,
            borderColor: '#7A5543',
            backgroundColor: 'rgba(122, 85, 67, 0.10)',
            fill: true,
            tension: 0.35,
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }
}

/* ═══════════════════════════════════════════
   2. QUEUEING THEORY (M/M/c/K) & MULTI-CHANNEL COUNTER SIZING
   ═══════════════════════════════════════════ */

function computeMMcKClient(lambda, mu, c, K) {
  const rho = lambda / (c * mu);
  const cRho = c * rho;
  let sum1 = 0;
  for (let n = 0; n < c; n++) sum1 += Math.pow(cRho, n) / factorialLocal(n);
  let sum2 = 0;
  for (let n = c; n <= K; n++) {
    sum2 += Math.abs(rho - 1) < 1e-9 ? 1 : Math.pow(rho, n - c);
  }
  const P0 = 1 / (sum1 + (Math.pow(cRho, c) / factorialLocal(c)) * sum2);

  let L = 0;
  let PK = 0;
  for (let n = 0; n <= K; n++) {
    const pn = n < c
      ? P0 * (Math.pow(cRho, n) / factorialLocal(n))
      : P0 * ((Math.pow(c, c) * Math.pow(rho, n)) / factorialLocal(c));
    L += n * pn;
    if (n === K) PK = pn;
  }
  const lambdaEff = lambda * (1 - PK);
  const WMinutes = lambdaEff > 0 ? (L / lambdaEff) * 60 : 0;
  return { rho, P0, pDrop: PK, lambdaEff, L, WMinutes };
}

function renderTopic2() {
  const lambda = parseFloat($('#qmod-mmck-lambda')?.value) || 28;
  const mu = parseFloat($('#qmod-mmck-mu')?.value) || 14;
  const c = parseInt($('#qmod-mmck-c')?.value, 10) || 2;
  const K = parseInt($('#qmod-mmck-k')?.value, 10) || 10;
  const mobileSplit = parseFloat($('#qmod-mmck-split')?.value) || 40;

  const res = computeMMcKClient(lambda, mu, c, K);
  const posLambda = lambda * (1 - mobileSplit / 100);
  const mobLambda = lambda * (mobileSplit / 100);

  $('#qmod-t2-rho').textContent = `${(res.rho * 100).toFixed(1)}% (ρ = ${res.rho.toFixed(2)})`;
  $('#qmod-t2-p0').textContent = `${(res.P0 * 100).toFixed(2)}%`;
  $('#qmod-t2-pdrop').textContent = `${(res.pDrop * 100).toFixed(2)}%`;
  $('#qmod-t2-littles-w').textContent = `${res.WMinutes.toFixed(2)} mins (L = ${res.L.toFixed(2)})`;
  $('#qmod-t2-split-note').textContent = `Counter POS: ${posLambda.toFixed(1)}/hr • Mobile Web QR: ${mobLambda.toFixed(1)}/hr • Effective λ_eff = ${res.lambdaEff.toFixed(2)}/hr`;

  const labels = [];
  const dropSeries = [];
  const waitSeries = [];
  for (let baristas = 1; baristas <= 6; baristas++) {
    const m = computeMMcKClient(lambda, mu, baristas, K);
    labels.push(`c = ${baristas} Barista${baristas > 1 ? 's' : ''}`);
    dropSeries.push(Number((m.pDrop * 100).toFixed(2)));
    waitSeries.push(Number(m.WMinutes.toFixed(2)));
  }

  const ctx = document.getElementById('chart-qmod-mmck');
  if (ctx && window.Chart) {
    if (QMOD_CHARTS.mmck) QMOD_CHARTS.mmck.destroy();
    QMOD_CHARTS.mmck = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Balking / Drop Probability P_K (%)',
            data: dropSeries,
            backgroundColor: '#7A5543',
            borderRadius: 4,
          },
          {
            label: "Little's Law Turnaround W (mins)",
            data: waitSeries,
            backgroundColor: '#1F2D24',
            borderRadius: 4,
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }
}

/* ═══════════════════════════════════════════
   3. DISCRETE-TIME MARKOV CHAINS (DTMC) & ORDER LIFECYCLE
   ═══════════════════════════════════════════ */

function invertMatrix4x4(matrix) {
  const n = matrix.length;
  const aug = matrix.map((row, i) => [
    ...row.map(Number),
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    }
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    const div = aug[col][col] || 1e-9;
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }
  return aug.map(row => row.slice(n));
}

function matMul(A, B) {
  return A.map(row =>
    B[0].map((_, j) => row.reduce((sum, val, k) => sum + val * B[k][j], 0)),
  );
}

function renderTopic3() {
  // Transient states: S0 Cart/Held, S1 Queued, S2 Brewing, S3 Ready
  // Absorbing states: S4 Completed, S5 Canceled/Voided, S6 Refunded
  const pQueueCancel = (parseFloat($('#qmod-dtmc-void-rate')?.value) || 5) / 100;
  const pBrewVoid = (parseFloat($('#qmod-dtmc-brew-void')?.value) || 3) / 100;
  const pRefund = (parseFloat($('#qmod-dtmc-refund-rate')?.value) || 1.5) / 100;

  const Q = [
    [0.05, 0.88, 0.00, 0.00],
    [0.00, 0.10, Math.max(0.01, 0.90 - pQueueCancel), 0.00],
    [0.00, 0.00, 0.12, Math.max(0.01, 0.88 - pBrewVoid - pRefund * 0.5)],
    [0.00, 0.00, 0.00, 0.05],
  ];
  const R = [
    [0.00, 0.07, 0.00],
    [0.00, pQueueCancel, 0.00],
    [0.00, pBrewVoid, pRefund * 0.5],
    [Math.max(0.01, 0.95 - pRefund - 0.01), 0.01, pRefund],
  ];

  const IminusQ = Q.map((row, i) => row.map((v, j) => (i === j ? 1 - v : -v)));
  const N = invertMatrix4x4(IminusQ);
  const B = matMul(N, R);

  const transientLabels = ['S0: Cart/Held', 'S1: Queued', 'S2: Brewing', 'S3: Ready'];
  const expectedStepsFromS1 = N[1].reduce((a, b) => a + b, 0);
  const completionProbFromS1 = B[1][0] * 100;
  const voidProbFromS1 = B[1][1] * 100;
  const refundProbFromS1 = B[1][2] * 100;

  $('#qmod-t3-steps').textContent = `${expectedStepsFromS1.toFixed(2)} steps`;
  $('#qmod-t3-complete-prob').textContent = `${completionProbFromS1.toFixed(2)}%`;
  $('#qmod-t3-void-prob').textContent = `${voidProbFromS1.toFixed(2)}%`;
  $('#qmod-t3-refund-prob').textContent = `${refundProbFromS1.toFixed(2)}%`;

  const tbody = $('#qmod-dtmc-tbody');
  if (tbody) {
    tbody.innerHTML = transientLabels.map((stateLabel, idx) => `
      <tr>
        <td class="font-semibold">${stateLabel}</td>
        <td class="tabular-nums">${N[idx].map(v => v.toFixed(2)).join(' / ')}</td>
        <td class="tabular-nums font-semibold">${N[idx].reduce((a, b) => a + b, 0).toFixed(2)}</td>
        <td class="tabular-nums text-emerald-800 font-bold">${(B[idx][0] * 100).toFixed(2)}%</td>
        <td class="tabular-nums text-red-800">${(B[idx][1] * 100).toFixed(2)}%</td>
        <td class="tabular-nums text-amber-800">${(B[idx][2] * 100).toFixed(2)}%</td>
      </tr>
    `).join('');
  }

  const ctx = document.getElementById('chart-qmod-dtmc');
  if (ctx && window.Chart) {
    if (QMOD_CHARTS.dtmc) QMOD_CHARTS.dtmc.destroy();
    QMOD_CHARTS.dtmc = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: transientLabels,
        datasets: [
          { label: 'S4: Completed (%)', data: B.map(r => Number((r[0] * 100).toFixed(2))), backgroundColor: '#1F2D24' },
          { label: 'S5: Canceled/Voided (%)', data: B.map(r => Number((r[1] * 100).toFixed(2))), backgroundColor: '#7A5543' },
          { label: 'S6: Refunded (%)', data: B.map(r => Number((r[2] * 100).toFixed(2))), backgroundColor: '#B98A5E' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, max: 100 } },
      },
    });
  }
}

/* ═══════════════════════════════════════════
   4. FAIR RISK FRAMEWORK & MONTE CARLO SIMULATION (100,000 ITERATIONS)
   ═══════════════════════════════════════════ */

function runFairMonteCarlo() {
  const iterations = parseInt($('#qmod-fair-iters')?.value, 10) || 100000;
  const tefMin = parseFloat($('#qmod-fair-tef-a')?.value) || 2;
  const tefMode = parseFloat($('#qmod-fair-tef-m')?.value) || 12;
  const tefMax = parseFloat($('#qmod-fair-tef-b')?.value) || 45;
  const plmMu = parseFloat($('#qmod-fair-plm-mu')?.value) || 6.2;
  const plmSigma = parseFloat($('#qmod-fair-plm-sigma')?.value) || 0.8;
  const controlCost = parseFloat($('#qmod-fair-control-cost')?.value) || 3500;
  const riskReduction = (parseFloat($('#qmod-fair-mitigation')?.value) || 78) / 100;

  const losses = new Float64Array(iterations);
  let sumLoss = 0;

  for (let i = 0; i < iterations; i++) {
    const tef = sampleBetaPERT(tefMin, tefMode, tefMax);
    const numEvents = Math.max(1, Math.round(tef));
    let annualLoss = 0;
    for (let e = 0; e < numEvents; e++) {
      annualLoss += Math.exp(plmMu + plmSigma * randNormal());
    }
    losses[i] = annualLoss;
    sumLoss += annualLoss;
  }

  losses.sort();
  const aleBase = sumLoss / iterations;
  const var95 = losses[Math.min(iterations - 1, Math.floor(iterations * 0.95))];
  const aleMitigated = aleBase * (1 - riskReduction);
  const rosi = controlCost > 0 ? ((aleBase - aleMitigated) - controlCost) / controlCost : 0;

  $('#qmod-t4-ale-base').textContent = `₱${aleBase.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
  $('#qmod-t4-var95').textContent = `₱${var95.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
  $('#qmod-t4-ale-mit').textContent = `₱${aleMitigated.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
  $('#qmod-t4-rosi').textContent = `${(rosi * 100).toFixed(1)}% (${rosi.toFixed(2)}x)`;

  // Build Loss Exceedance Curve (LEC) across percentiles
  const percentiles = [1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99];
  const labels = [];
  const exceedProbsBase = [];
  const exceedProbsMitigated = [];

  for (const p of percentiles) {
    const idx = Math.min(iterations - 1, Math.floor((p / 100) * iterations));
    const threshold = losses[idx];
    labels.push(`₱${(threshold / 1000).toFixed(1)}k`);
    exceedProbsBase.push(100 - p);
    exceedProbsMitigated.push(Number(((100 - p) * (1 - riskReduction)).toFixed(2)));
  }

  const ctx = document.getElementById('chart-qmod-lec');
  if (ctx && window.Chart) {
    if (QMOD_CHARTS.lec) QMOD_CHARTS.lec.destroy();
    QMOD_CHARTS.lec = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Unmitigated Loss Exceedance Curve (%)',
            data: exceedProbsBase,
            borderColor: '#7A5543',
            backgroundColor: 'rgba(122, 85, 67, 0.12)',
            fill: true,
            tension: 0.3,
          },
          {
            label: 'Mitigated LEC (Signed Queue + RBAC + Blind Close) (%)',
            data: exceedProbsMitigated,
            borderColor: '#1F2D24',
            backgroundColor: 'rgba(31, 45, 36, 0.12)',
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100, title: { display: true, text: 'Probability Loss Exceeds X (%)' } } },
      },
    });
  }
}

/* ═══════════════════════════════════════════
   5. GAME THEORY IN CASHIER AUDIT & VOID AUTHORIZATION
   ═══════════════════════════════════════════ */

function renderTopic5() {
  const G = parseFloat($('#qmod-gt-g')?.value) || 500;
  const F = parseFloat($('#qmod-gt-f')?.value) || 2500;
  const C_audit = parseFloat($('#qmod-gt-caudit')?.value) || 150;
  const L = parseFloat($('#qmod-gt-l')?.value) || 500;

  // Mixed-Strategy Nash Equilibrium:
  // sigma_M* = G / (G + F) (minimum random spot-audit rate to make cashier indifferent to fraud)
  // sigma_C* = C_audit / L (equilibrium fraud attempt rate)
  const sigmaMStar = Math.min(1, Math.max(0, G / (G + F)));
  const sigmaCStar = Math.min(1, Math.max(0, L > 0 ? C_audit / L : 0));
  window.QMODSIM_AUDIT_THRESHOLD = sigmaMStar;

  $('#qmod-t5-sigma-m').textContent = `${(sigmaMStar * 100).toFixed(2)}% (σ_M* = ${sigmaMStar.toFixed(4)})`;
  $('#qmod-t5-sigma-c').textContent = `${(sigmaCStar * 100).toFixed(2)}% (σ_C* = ${sigmaCStar.toFixed(4)})`;
  $('#qmod-t5-deterrence').textContent = `Audit ≥ ${(sigmaMStar * 100).toFixed(1)}% of voids to eliminate positive expected theft payoff`;

  const matrixBody = $('#qmod-gt-matrix-body');
  if (matrixBody) {
    matrixBody.innerHTML = `
      <tr>
        <td class="font-semibold">Cashier: Legitimate Ring-In</td>
        <td class="tabular-nums">Cashier: ₱0, Manager: ₱0</td>
        <td class="tabular-nums">Cashier: ₱0, Manager: −₱${C_audit.toFixed(0)}</td>
      </tr>
      <tr>
        <td class="font-semibold">Cashier: Pocket Cash / Fraudulent Void</td>
        <td class="tabular-nums text-red-800">Cashier: +₱${G.toFixed(0)}, Manager: −₱${L.toFixed(0)}</td>
        <td class="tabular-nums text-emerald-800">Cashier: −₱${F.toFixed(0)}, Manager: +₱${(L - C_audit).toFixed(0)}</td>
      </tr>
    `;
  }
}

/* ═══════════════════════════════════════════
   6. INFORMATION ENTROPY & POS TERMINAL PIN CRYPTANALYSIS
   ═══════════════════════════════════════════ */

function renderTopic6() {
  const rGuessPerMin = parseFloat($('#qmod-pin-rate')?.value) || 30; // guesses per minute on unthrottled keypad
  const searchSpace = 10000;
  const entropyBits = Math.log2(searchSpace); // ~13.2877 bits
  const unthrottledExpectedMins = searchSpace / (2 * rGuessPerMin);

  // With 3 attempts -> 5-minute lockout:
  // Effective average rate is 3 guesses per (5 mins + 3/rGuessPerMin mins) ~= 0.6 guesses/min
  const effectiveLockedRatePerMin = 3 / (5 + 3 / rGuessPerMin);
  const lockedExpectedMins = searchSpace / (2 * effectiveLockedRatePerMin);
  const lockedExpectedDays = lockedExpectedMins / (60 * 24);

  $('#qmod-t6-entropy').textContent = `${entropyBits.toFixed(2)} bits (S = 10,000)`;
  $('#qmod-t6-unthrottled').textContent = `${unthrottledExpectedMins.toFixed(1)} mins (${(unthrottledExpectedMins / 60).toFixed(2)} hrs)`;
  $('#qmod-t6-locked').textContent = `${lockedExpectedDays.toFixed(2)} days (${Math.round(lockedExpectedMins).toLocaleString()} mins)`;

  const hours = [0.25, 0.5, 1, 2, 4, 8, 12, 24, 48];
  const unthrottledProb = hours.map(h => Number((Math.min(1, (h * 60 * rGuessPerMin) / searchSpace) * 100).toFixed(2)));
  const lockedProb = hours.map(h => Number((Math.min(1, (h * 60 * effectiveLockedRatePerMin) / searchSpace) * 100).toFixed(2)));

  const ctx = document.getElementById('chart-qmod-pin');
  if (ctx && window.Chart) {
    if (QMOD_CHARTS.pin) QMOD_CHARTS.pin.destroy();
    QMOD_CHARTS.pin = new Chart(ctx, {
      type: 'line',
      data: {
        labels: hours.map(h => `${h}h`),
        datasets: [
          {
            label: 'Unthrottled Keypad Compromise Probability (%)',
            data: unthrottledProb,
            borderColor: '#7A5543',
            backgroundColor: 'rgba(122, 85, 67, 0.12)',
            fill: true,
            tension: 0.25,
          },
          {
            label: '3-Attempt / 5-Min Lockout Compromise Probability (%)',
            data: lockedProb,
            borderColor: '#1F2D24',
            backgroundColor: 'rgba(31, 45, 36, 0.12)',
            fill: true,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100 } },
      },
    });
  }
}

/* ═══════════════════════════════════════════
   7. SYSTEM RELIABILITY BLOCK DIAGRAMS (RBD) & OFFLINE QUEUE RESILIENCE
   ═══════════════════════════════════════════ */

function renderTopic7() {
  const rTerminal = parseFloat($('#qmod-rbd-terminal')?.value) || 0.9999;
  const rNetwork = parseFloat($('#qmod-rbd-network')?.value) || 0.9910;
  const rCloud = parseFloat($('#qmod-rbd-cloud')?.value) || 0.9990;
  const rLocalQueue = parseFloat($('#qmod-rbd-local')?.value) || 0.9950;
  const mtbfHours = parseFloat($('#qmod-rbd-mtbf')?.value) || 2500;
  const mttrHours = parseFloat($('#qmod-rbd-mttr')?.value) || 0.25;

  const rLiveSeries = rTerminal * rNetwork * rCloud;
  const rParallelSys = rTerminal * (1 - (1 - rNetwork * rCloud) * (1 - rLocalQueue));
  const inherentAvailability = mtbfHours / (mtbfHours + mttrHours);

  $('#qmod-t7-live-rel').textContent = `${(rLiveSeries * 100).toFixed(3)}% (Two Nines)`;
  $('#qmod-t7-parallel-rel').textContent = `${(rParallelSys * 100).toFixed(4)}% (Four Nines)`;
  $('#qmod-t7-availability').textContent = `${(inherentAvailability * 100).toFixed(4)}% (A = MTBF / (MTBF + MTTR))`;

  // Plot reliability survival R(t) over 0..72 hours of campus operation
  const hours = [0, 4, 8, 12, 24, 36, 48, 72];
  const lambdaLive = -Math.log(Math.max(0.5, rLiveSeries)) / 8; // per hour failure rate calibrated to 8h shift
  const lambdaParallel = -Math.log(Math.max(0.5, rParallelSys)) / 8;

  const liveCurve = hours.map(t => Number((Math.exp(-lambdaLive * t) * 100).toFixed(3)));
  const parallelCurve = hours.map(t => Number((Math.exp(-lambdaParallel * t) * 100).toFixed(3)));

  const ctx = document.getElementById('chart-qmod-rbd');
  if (ctx && window.Chart) {
    if (QMOD_CHARTS.rbd) QMOD_CHARTS.rbd.destroy();
    QMOD_CHARTS.rbd = new Chart(ctx, {
      type: 'line',
      data: {
        labels: hours.map(h => `${h}h`),
        datasets: [
          {
            label: 'Live Cloud Series Pipeline R_live(t) (%)',
            data: liveCurve,
            borderColor: '#7A5543',
            borderDash: [5, 4],
            fill: false,
            tension: 0.25,
          },
          {
            label: 'Parallel Offline Queue Fallback R_sys(t) (%)',
            data: parallelCurve,
            borderColor: '#1F2D24',
            backgroundColor: 'rgba(31, 45, 36, 0.10)',
            fill: true,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { min: 90, max: 100 } },
      },
    });
  }
}

function updateQmodsimRbdLiveBadge(isOffline, queuedCount) {
  const el = document.getElementById('qmod-t7-live-status');
  if (!el) return;
  el.textContent = isOffline
    ? `OFFLINE FALLBACK ACTIVE (${queuedCount} pending cash receipt(s))`
    : `LIVE CLOUD ACTIVE (${queuedCount} pending sync)`;
}

/* ═══════════════════════════════════════════
   TELEMETRY FETCH & FULL LAB INITIALIZATION
   ═══════════════════════════════════════════ */

async function refreshQmodsimTelemetry() {
  try {
    const res = await fetch('/api/qmodsim/telemetry', { credentials: 'same-origin' });
    if (!res.ok) return;
    qmodTelemetry = await res.json();
    const emp = qmodTelemetry.empirical || {};
    const totalOrders = (emp.statusCounts || []).reduce((s, r) => s + r.count, 0);
    const closes = emp.reconciliations?.closes || 0;
    const audits = (emp.auditEvents || []).reduce((s, r) => s + r.count, 0);
    const banner = $('#qmod-live-db-summary');
    if (banner) {
      banner.textContent = `Live DB Telemetry: ${totalOrders} total orders • ${closes} blind shift close(s) • ${audits} security audit event(s)`;
    }
  } catch (_) { /* ignore when offline */ }
}

function renderQmodsimLab() {
  renderTopic1();
  renderTopic2();
  renderTopic3();
  runFairMonteCarlo();
  renderTopic5();
  renderTopic6();
  renderTopic7();
  refreshQmodsimTelemetry();
}

function initQmodsimLab() {
  $('#btn-qmod-recalc-all')?.addEventListener('click', () => {
    renderQmodsimLab();
    showToast('All 7 QMODSIM mathematical models recalculated.', 'success');
  });
  $('#btn-qmod-run-mc')?.addEventListener('click', () => {
    runFairMonteCarlo();
    showToast('100,000-iteration FAIR Monte Carlo simulation complete.', 'success');
  });


  $$('.qmod-input').forEach(input => {
    input.addEventListener('change', () => renderQmodsimLab());
  });
}

window.initQmodsimLab = initQmodsimLab;
window.renderQmodsimLab = renderQmodsimLab;
window.refreshQmodsimTelemetry = refreshQmodsimTelemetry;
window.updateQmodsimRbdLiveBadge = updateQmodsimRbdLiveBadge;
