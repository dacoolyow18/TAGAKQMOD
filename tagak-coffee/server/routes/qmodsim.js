const express = require('express');
const { query } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { resolveSessionBranch } = require('../branchScope');

/**
 * Invert a 4x4 matrix (I - Q) using Gauss-Jordan elimination for DTMC Fundamental Matrix N = (I - Q)^(-1).
 */
function invertMatrix(matrix) {
  const n = matrix.length;
  const aug = matrix.map((row, i) => [
    ...row.map(Number),
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(aug[pivotRow][col]) < 1e-12) {
      throw new Error('Matrix (I - Q) is singular');
    }
    [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
    const div = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[r][j] -= factor * aug[col][j];
      }
    }
  }
  return aug.map(row => row.slice(n));
}

function multiplyMatrices(A, B) {
  const rowsA = A.length;
  const colsA = A[0].length;
  const colsB = B[0].length;
  const out = Array.from({ length: rowsA }, () => Array(colsB).fill(0));
  for (let i = 0; i < rowsA; i++) {
    for (let k = 0; k < colsA; k++) {
      for (let j = 0; j < colsB; j++) {
        out[i][j] += A[i][k] * B[k][j];
      }
    }
  }
  return out;
}

function factorial(n) {
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

/**
 * Compute M/M/c/K steady-state metrics (Module 6).
 */
function computeMMcK({ lambda = 24, mu = 12, c = 2, K = 10 }) {
  const rho = lambda / (c * mu);
  const cRho = c * rho;

  let sum1 = 0;
  for (let n = 0; n < c; n++) {
    sum1 += Math.pow(cRho, n) / factorial(n);
  }
  let sum2 = 0;
  for (let n = c; n <= K; n++) {
    sum2 += Math.pow(rho, n - c);
  }
  const term2 = (Math.pow(cRho, c) / factorial(c)) * sum2;
  const P0 = 1 / (sum1 + term2);

  const probs = [];
  let L = 0;
  let Lq = 0;
  for (let n = 0; n <= K; n++) {
    let pn;
    if (n < c) {
      pn = P0 * (Math.pow(cRho, n) / factorial(n));
    } else {
      pn = P0 * ((Math.pow(c, c) * Math.pow(rho, n)) / factorial(c));
    }
    probs.push(pn);
    L += n * pn;
    if (n > c) Lq += (n - c) * pn;
  }

  const pDrop = probs[K] || 0;
  const lambdaEff = lambda * (1 - pDrop);
  const WHours = lambdaEff > 0 ? L / lambdaEff : 0;
  const WqHours = lambdaEff > 0 ? Lq / lambdaEff : 0;

  return {
    lambda,
    mu,
    c,
    K,
    rho: Number(rho.toFixed(4)),
    P0: Number(P0.toFixed(6)),
    pDrop: Number(pDrop.toFixed(6)),
    lambdaEff: Number(lambdaEff.toFixed(4)),
    L: Number(L.toFixed(4)),
    Lq: Number(Lq.toFixed(4)),
    WMinutes: Number((WHours * 60).toFixed(2)),
    WqMinutes: Number((WqHours * 60).toFixed(2)),
    stateProbabilities: probs.map(p => Number(p.toFixed(6))),
  };
}

/**
 * Solve 2x2 Strategic Inspection Game Mixed-Strategy Nash Equilibrium (Module 7).
 * Cashier Actions: S_C = { Legitimate Ring-In, Pocket Cash / Fraudulent Void }
 * Manager Actions: S_M = { Routine Trust / EOD Review, Strict Spot Audits + Server Void Approval }
 */
function solveInspectionGame({ G = 500, F = 2500, C_audit = 150, L = 500 }) {
  // Payoff structure:
  // If Cashier plays Legitimate: Cashier payoff = 0; Manager payoff = -C_audit (if Audit) or 0 (if Trust)
  // If Cashier plays Fraud:
  //   - When Manager Audits: Cashier gets -F (caught & penalized); Manager gets -C_audit ( prevents loss L, net vs -L is L - C_audit )
  //   - When Manager Trusts: Cashier gets +G (steals cash); Manager gets -L (suffers theft loss)
  // Manager's audit probability sigma_M* makes Cashier indifferent between Legitimate (0) and Fraud:
  //   sigma_M * (-F) + (1 - sigma_M) * G = 0  =>  sigma_M* = G / (G + F)
  // Cashier's fraud probability sigma_C* makes Manager indifferent between Audit and Trust:
  //   sigma_C * (-C_audit) + (1 - sigma_C) * (-C_audit) = sigma_C * (-L) + (1 - sigma_C) * 0
  //   => -C_audit = -sigma_C * L  =>  sigma_C* = C_audit / L
  const sigmaMStar = Math.min(1, Math.max(0, G / (G + F)));
  const sigmaCStar = Math.min(1, Math.max(0, L > 0 ? C_audit / L : 0));

  return {
    parameters: { G, F, C_audit, L },
    payoffMatrix: {
      legitimate_trust: { cashier: 0, manager: 0 },
      legitimate_audit: { cashier: 0, manager: -C_audit },
      fraud_trust: { cashier: G, manager: -L },
      fraud_audit: { cashier: -F, manager: L - C_audit },
    },
    nashEquilibrium: {
      sigmaMStar: Number(sigmaMStar.toFixed(4)),
      sigmaCStar: Number(sigmaCStar.toFixed(4)),
      minAuditThresholdPercent: Number((sigmaMStar * 100).toFixed(2)),
      expectedFraudRatePercent: Number((sigmaCStar * 100).toFixed(2)),
    },
  };
}

function qmodsimRoutes() {
  const router = express.Router();

  router.get('/telemetry', requireSession(), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const branchId = scope.branchId;

    try {
      const [hourlyRes, statusRes, channelRes, reconRes, auditRes, transRes] = await Promise.all([
        query(
          `SELECT EXTRACT(HOUR FROM (time_in AT TIME ZONE 'Asia/Manila'))::int AS hour_of_day,
                  COUNT(*)::int AS count
             FROM orders
            WHERE ($1::text IS NULL OR branch_id = $1)
            GROUP BY 1
            ORDER BY 1`,
          [branchId],
        ),
        query(
          `SELECT status, COUNT(*)::int AS count
             FROM orders
            WHERE ($1::text IS NULL OR branch_id = $1)
            GROUP BY status`,
          [branchId],
        ),
        query(
          `SELECT COALESCE(channel, 'pos') AS channel,
                  COUNT(*)::int AS count,
                  AVG(EXTRACT(EPOCH FROM (COALESCE(ready_at, time_out, now()) - time_in)) / 60.0)::float8 AS avg_turnaround_min
             FROM orders
            WHERE ($1::text IS NULL OR branch_id = $1)
            GROUP BY 1`,
          [branchId],
        ),
        query(
          `SELECT COUNT(*)::int AS closes,
                  COALESCE(AVG(ABS(discrepancy)), 0)::float8 AS avg_abs_discrepancy,
                  COALESCE(SUM(CASE WHEN discrepancy < 0 THEN ABS(discrepancy) ELSE 0 END), 0)::float8 AS total_shortage
             FROM shift_reconciliations
            WHERE ($1::text IS NULL OR branch_id = $1)`,
          [branchId],
        ).catch(() => ({ rows: [{ closes: 0, avg_abs_discrepancy: 0, total_shortage: 0 }] })),
        query(
          `SELECT event_type, COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float8 AS total_amount
             FROM audit_events
            WHERE ($1::text IS NULL OR branch_id = $1)
            GROUP BY event_type`,
          [branchId],
        ).catch(() => ({ rows: [] })),
        query(
          `SELECT from_state, to_state, COUNT(*)::int AS count
             FROM order_state_transitions
            WHERE ($1::text IS NULL OR branch_id = $1)
            GROUP BY from_state, to_state`,
          [branchId],
        ).catch(() => ({ rows: [] })),
      ]);

      // Canonical DTMC Q (4x4: S0 Held, S1 Queued, S2 Brewing, S3 Ready) and R (4x3: S4 Completed, S5 Voided, S6 Refunded)
      const Q = [
        [0.05, 0.88, 0.00, 0.00], // S0: Cart/Held
        [0.00, 0.10, 0.85, 0.00], // S1: Queued
        [0.00, 0.00, 0.12, 0.84], // S2: Brewing
        [0.00, 0.00, 0.00, 0.05], // S3: Ready
      ];
      const R = [
        [0.00, 0.07, 0.00], // S0 -> S5 (Abandoned/Canceled in cart)
        [0.00, 0.05, 0.00], // S1 -> S5 (Voided in queue)
        [0.00, 0.03, 0.01], // S2 -> S5/S6 (Voided/Refunded during brewing)
        [0.93, 0.01, 0.01], // S3 -> S4 (Completed), S5 (Void), S6 (Refund)
      ];
      const IminusQ = Q.map((row, i) => row.map((val, j) => (i === j ? 1 - val : -val)));
      const N = invertMatrix(IminusQ);
      const B = multiplyMatrices(N, R);

      res.json({
        empirical: {
          hourlyArrivals: hourlyRes.rows,
          statusCounts: statusRes.rows,
          channels: channelRes.rows,
          reconciliations: reconRes.rows[0] || { closes: 0, avg_abs_discrepancy: 0, total_shortage: 0 },
          auditEvents: auditRes.rows,
          transitions: transRes.rows,
        },
        referenceModels: {
          queueing: computeMMcK({ lambda: 24, mu: 12, c: 2, K: 10 }),
          dtmc: {
            states: ['S0: Cart/Held', 'S1: Queued', 'S2: Brewing', 'S3: Ready', 'S4: Completed', 'S5: Canceled/Voided', 'S6: Refunded'],
            Q,
            R,
            N: N.map(row => row.map(v => Number(v.toFixed(4)))),
            B: B.map(row => row.map(v => Number(v.toFixed(4)))),
          },
          gameTheory: solveInspectionGame({ G: 500, F: 2500, C_audit: 150, L: 500 }),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { qmodsimRoutes, computeMMcK, solveInspectionGame, invertMatrix, multiplyMatrices };
