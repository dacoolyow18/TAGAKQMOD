#!/usr/bin/env node
/**
 * File: run_qmodsim.js
 * Path: qmodsim/run_qmodsim.js
 * Description: Standalone Node.js CLI runner for all 7 Tagak Café QMODSIM models.
 *              Executes the exact mathematical models and writes qmodsim_results.json.
 */

const fs = require('node:fs');
const path = require('node:path');

function randNormal() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function randGamma(alpha) {
  if (alpha < 1) return randGamma(1 + alpha) * Math.pow(Math.random(), 1 / alpha);
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = randNormal();
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBetaPERT(a, m, b) {
  const mu = (a + 4 * m + b) / 6;
  const alpha = Math.max(0.5, ((mu - a) * (2 * m - a - b)) / ((m - mu) * (b - a)));
  const beta = Math.max(0.5, (alpha * (b - mu)) / (mu - a));
  const x = randGamma(alpha);
  const y = randGamma(beta);
  return a + (x / (x + y)) * (b - a);
}

function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function invertMatrix(matrix) {
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
    const div = aug[col][col];
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
  return A.map(row => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
}

function runAll() {
  // 1. NHPP & Prep Distributions
  const lambdaBase = 8.0;
  const breaks = [
    { label: '10:00 AM', t: 10.0, A: 22.0, sigma: 0.55 },
    { label: '12:00 PM', t: 12.0, A: 28.0, sigma: 0.55 },
    { label: '03:00 PM', t: 15.0, A: 20.0, sigma: 0.55 },
  ];
  const nhppAt = (t) => lambdaBase + breaks.reduce((s, b) => s + b.A * Math.exp(-Math.pow(t - b.t, 2) / (2 * b.sigma * b.sigma)), 0);
  const hourlyNhpp = {};
  for (let h = 7; h <= 19; h++) hourlyNhpp[`${String(h).padStart(2, '0')}:00`] = Number(nhppAt(h).toFixed(3));

  // 2. M/M/c/K Queueing
  const lam = 28.0;
  const mu = 14.0;
  const c = 2;
  const K = 10;
  const rho = lam / (c * mu);
  const cRho = c * rho;
  let sum1 = 0;
  for (let n = 0; n < c; n++) sum1 += Math.pow(cRho, n) / factorial(n);
  let sum2 = 0;
  for (let n = c; n <= K; n++) sum2 += Math.abs(rho - 1) < 1e-9 ? 1 : Math.pow(rho, n - c);
  const P0 = 1 / (sum1 + (Math.pow(cRho, c) / factorial(c)) * sum2);
  let L = 0;
  let PK = 0;
  for (let n = 0; n <= K; n++) {
    const pn = n < c
      ? P0 * (Math.pow(cRho, n) / factorial(n))
      : P0 * ((Math.pow(c, c) * Math.pow(rho, n)) / factorial(c));
    L += n * pn;
    if (n === K) PK = pn;
  }
  const lamEff = lam * (1 - PK);
  const WMin = (L / lamEff) * 60;

  // 3. DTMC Lifecycle
  const Q = [
    [0.05, 0.88, 0.00, 0.00],
    [0.00, 0.10, 0.85, 0.00],
    [0.00, 0.00, 0.12, 0.84],
    [0.00, 0.00, 0.00, 0.05],
  ];
  const R = [
    [0.00, 0.07, 0.00],
    [0.00, 0.05, 0.00],
    [0.00, 0.03, 0.01],
    [0.93, 0.01, 0.01],
  ];
  const N = invertMatrix(Q.map((row, i) => row.map((v, j) => (i === j ? 1 - v : -v))));
  const B = matMul(N, R);

  // 4. FAIR Risk Monte Carlo (100,000 iterations)
  const iterations = 100000;
  const losses = new Float64Array(iterations);
  let sumLoss = 0;
  for (let i = 0; i < iterations; i++) {
    const events = Math.max(1, Math.round(sampleBetaPERT(2, 12, 45)));
    let annual = 0;
    for (let e = 0; e < events; e++) annual += Math.exp(6.2 + 0.8 * randNormal());
    losses[i] = annual;
    sumLoss += annual;
  }
  losses.sort();
  const aleBase = sumLoss / iterations;
  const var95 = losses[Math.floor(0.95 * iterations)];
  const aleMitigated = aleBase * (1 - 0.78);
  const controlCost = 3500;
  const rosi = ((aleBase - aleMitigated) - controlCost) / controlCost;

  // 5. Game Theory
  const G = 500;
  const F = 2500;
  const C_audit = 150;
  const L_loss = 500;
  const sigmaMStar = G / (G + F);
  const sigmaCStar = C_audit / L_loss;

  // 6. PIN Cryptanalysis
  const searchSpace = 10000;
  const entropyBits = Math.log2(searchSpace);
  const rGuess = 30;
  const unthrottledMin = searchSpace / (2 * rGuess);
  const effLockedRate = 3 / (5 + 3 / rGuess);
  const lockedDays = (searchSpace / (2 * effLockedRate)) / (60 * 24);

  // 7. RBD & Availability
  const rTerminal = 0.9999;
  const rNetwork = 0.9910;
  const rCloud = 0.9990;
  const rLocal = 0.9950;
  const rLive = rTerminal * rNetwork * rCloud;
  const rSys = rTerminal * (1 - (1 - rNetwork * rCloud) * (1 - rLocal));
  const availability = 2500 / (2500 + 0.25);

  const report = {
    topic_1_stochastic_arrivals: {
      lambda_base_per_hr: lambdaBase,
      mean_exponential_interarrival_min: Number((60 / lambdaBase).toFixed(3)),
      peak_12pm_intensity_per_hr: Number(nhppAt(12.0).toFixed(3)),
      hourly_nhpp_intensity: hourlyNhpp,
      prep_time_models: {
        simple_iced_gamma_mean_min: 2.6,
        blended_drink_lognormal_mean_min: Number(Math.exp(1.15 + (0.42 * 0.42) / 2).toFixed(3)),
      },
    },
    topic_2_mmck_queueing: {
      parameters: { lambda: lam, mu, c, K },
      utilization_rho: Number(rho.toFixed(4)),
      P0_idle_prob: Number(P0.toFixed(6)),
      P_drop_abandonment_prob: Number(PK.toFixed(6)),
      effective_arrival_rate_per_hr: Number(lamEff.toFixed(4)),
      avg_orders_in_system_L: Number(L.toFixed(4)),
      littles_law_turnaround_W_min: Number(WMin.toFixed(3)),
    },
    topic_3_dtmc_lifecycle: {
      transient_states: ['S0: Cart/Held', 'S1: Queued', 'S2: Brewing', 'S3: Ready'],
      absorbing_states: ['S4: Completed', 'S5: Canceled/Voided', 'S6: Refunded'],
      fundamental_matrix_N: N.map(r => r.map(v => Number(v.toFixed(4)))),
      expected_active_steps_from_S1_queued: Number(N[1].reduce((a, b) => a + b, 0).toFixed(4)),
      absorption_probabilities_B: B.map(r => r.map(v => Number(v.toFixed(4)))),
    },
    topic_4_fair_monte_carlo: {
      iterations,
      ALE_base_PHP: Number(aleBase.toFixed(2)),
      ALE_mitigated_PHP: Number(aleMitigated.toFixed(2)),
      VaR_95_PHP: Number(var95.toFixed(2)),
      control_cost_PHP: controlCost,
      ROSI: Number(rosi.toFixed(4)),
      ROSI_percent: Number((rosi * 100).toFixed(2)),
    },
    topic_5_game_theory_audit: {
      parameters: { G, F, C_audit, L: L_loss },
      sigma_M_star_audit_prob: Number(sigmaMStar.toFixed(4)),
      sigma_C_star_fraud_prob: Number(sigmaCStar.toFixed(4)),
      min_random_audit_threshold_percent: Number((sigmaMStar * 100).toFixed(2)),
    },
    topic_6_pin_cryptanalysis: {
      search_space_S: searchSpace,
      shannon_entropy_bits: Number(entropyBits.toFixed(4)),
      unthrottled_expected_compromise_min: Number(unthrottledMin.toFixed(2)),
      lockout_3_attempts_5_min_expected_compromise_days: Number(lockedDays.toFixed(2)),
    },
    topic_7_rbd_offline_resilience: {
      live_cloud_series_reliability_percent: Number((rLive * 100).toFixed(4)),
      offline_fallback_parallel_reliability_percent: Number((rSys * 100).toFixed(4)),
      inherent_availability_percent: Number((availability * 100).toFixed(4)),
    },
  };

  const outPath = path.join(__dirname, 'qmodsim_results.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

runAll();
