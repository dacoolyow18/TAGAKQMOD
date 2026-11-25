# Tagak Café — QMODSIM Implementation & Simulation Suite (`PBLQMOD`)

This folder contains the full **Option B (Operational + Quantitative Modeling & Simulation)** implementation of the 7 QMODSIM topics for **Tagak Café**.

## Running the Standalone QMODSIM Simulation Suite

- **Node.js Runner (100,000 Monte Carlo iterations + all 7 topics):**
  ```bash
  node qmodsim/run_qmodsim.js
  ```
- **Python / SciPy Runner (`scipy.optimize.linprog` + `numpy`):**
  ```bash
  python qmodsim/qmodsim_suite.py
  ```

Both runners output verified mathematical results to `qmodsim/qmodsim_results.json`.

## Live POS & Backend Integration (`tagak-coffee/`)

1. **Topic 1 (Modules 1 & 3 — Stochastic Arrivals & Break-Hour Surges):**
   - Stationary Poisson baseline $\lambda_{\text{base}}$ + Gaussian-modulated NHPP $\lambda(t)$ across 10:00 AM, 12:00 PM, and 3:00 PM break windows + Gamma/Lognormal barista drink prep distributions in `pos-app/js/qmodsim.js` and `/api/qmodsim/telemetry`.
2. **Topic 2 (Module 6 — $M/M/c/K$ Queueing & Multi-Channel Sizing):**
   - Tracks `channel` (`'pos'` vs. `'mobile'`) and `brewing_at` / `ready_at` timestamps on `orders` (`db/migrations/012_qmodsim_operational.sql`), computing $\rho$, $P_0$, $P_{\text{drop}} = P_K$, and Little's Law turnaround latency $W = L / \lambda_{\text{eff}}$.
3. **Topic 3 (Module 5 — Discrete-Time Markov Chains & Order Lifecycle):**
   - Expands the order state space to $\mathcal{S} = \{S_0\text{: Held}, S_1\text{: Queued}, S_2\text{: Brewing}, S_3\text{: Ready}, S_4\text{: Completed}, S_5\text{: Voided}, S_6\text{: Refunded}\}$, adds **Hold Order ($S_0$)** in the POS Register and **Refund ($S_6$)** on the POS Orders board, logs empirical transitions in `order_state_transitions`, and computes the Fundamental Matrix $\mathbf{N} = (\mathbf{I}-\mathbf{Q})^{-1}$ and Absorption Matrix $\mathbf{B} = \mathbf{N}\mathbf{R}$.
4. **Topic 4 (Module 4 — FAIR Risk Framework & 100k Monte Carlo Simulation):**
   - Implements **Blind Shift Drawer Close** (`POST /api/cash-logs/blind-close` & `shift_reconciliations` table) inside the POS Cash Drawer modal, plus 100,000-iteration Monte Carlo simulation of $\text{TEF} \sim \text{Beta-PERT}(2, 12, 45)$ and $\text{PLM} \sim \text{Lognormal}(6.2, 0.8)$ producing the Loss Exceedance Curve (LEC), $\text{ALE}$, $\text{VaR}_{95\%}$, and $\text{ROSI}$.
5. **Topic 5 (Module 7 — Game Theory in Cashier Audit & Void Authorization):**
   - Solves the $2 \times 2$ Strategic Inspection Game for Mixed-Strategy Nash Equilibrium $(\sigma_C^*, \sigma_M^*)$ and wires $\sigma_M^*$ directly into the POS Void/Refund Modal (`#void-modal`) with Manager 4-digit PIN verification (`POST /api/auth/verify-manager`) and `audit_events` logging.
6. **Topic 6 (Modules 2 & 10 — Information Entropy & POS Terminal PIN Cryptanalysis):**
   - Enforces the **3 failed attempts → 5-minute terminal lockout** rule on `POST /api/auth/pin` (`server/auth/routes.js`, `server/middleware/rateLimit.js`) with a live countdown timer in `unified-login/script.js` and Shannon Entropy $H(X) \approx 13.29\text{ bits}$ cryptanalysis in the QMODSIM Lab.
7. **Topic 7 (Module 12 — System Reliability Block Diagrams & Offline Queue Resilience):**
   - Implements `pos-app/js/offline-queue.js` (`window.TAGAK_OFFLINE`) and `POST /api/orders/sync`, providing SHA-256 cryptographically signed local order queueing during campus Wi-Fi outages and idempotent synchronization upon reconnect, elevating system availability from Two Nines ($99.0\%$) to Four Nines ($99.99\%$).
