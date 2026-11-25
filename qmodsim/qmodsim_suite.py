#!/usr/bin/env python3
"""
Tagak Café — QMODSIM Topic-by-Topic Mathematical & Simulation Suite
====================================================================
Implements all 7 QMODSIM recommendations from the specification PDF:
  1. Stochastic Arrival Processes (Poisson + NHPP Gaussian Break-Hour Surges & Gamma/Lognormal Prep)
  2. Queueing Theory & Multi-Channel Counter Sizing (M/M/c/K + Little's Law)
  3. Discrete-Time Markov Chains (DTMC) & Order Lifecycle Dynamics (N = (I - Q)^-1, B = N*R)
  4. FAIR Risk Framework & 100,000-Iteration Monte Carlo Simulation (Beta-PERT TEF, Lognormal PLM, LEC, VaR95, ROSI)
  5. Game Theory in Cashier Audit & Void Authorization (2x2 Strategic Inspection Game via scipy.optimize.linprog)
  6. Information Entropy & POS Terminal PIN Cryptanalysis (Shannon Entropy H(X), 3-Strike/5-Min Lockout)
  7. System Reliability Block Diagrams (RBD) & Offline Queue Resilience (Live Cloud vs. Parallel Local Queue, Availability)
"""

import json
import math
import random
from pathlib import Path

try:
    import numpy as np
except ImportError:
    np = None

try:
    from scipy.optimize import linprog
except ImportError:
    linprog = None


# ============================================================================
# 1. STOCHASTIC ARRIVAL PROCESSES & BREAK-HOUR ORDER SURGES (Modules 1 & 3)
# ============================================================================
def run_topic_1_stochastic_arrivals(lambda_base=8.0):
    breaks = [
        {"label": "10:00 AM Break", "t_break": 10.0, "A": 22.0, "sigma": 0.55},
        {"label": "12:00 PM Dismissal", "t_break": 12.0, "A": 28.0, "sigma": 0.55},
        {"label": "03:00 PM Break", "t_break": 15.0, "A": 20.0, "sigma": 0.55},
    ]

    def nhpp_intensity(t):
        total = lambda_base
        for b in breaks:
            total += b["A"] * math.exp(-((t - b["t_break"]) ** 2) / (2 * (b["sigma"] ** 2)))
        return total

    hourly_profile = {f"{h:02d}:00": round(nhpp_intensity(float(h)), 3) for h in range(7, 20)}

    # Gamma(k=4.0, theta=0.65) for simple iced drinks; Lognormal(mu=1.15, sigma=0.42) for blended drinks
    gamma_mean = 4.0 * 0.65
    lognormal_mean = math.exp(1.15 + (0.42 ** 2) / 2.0)

    return {
        "lambda_base_per_hr": lambda_base,
        "mean_exponential_interarrival_min": round(60.0 / lambda_base, 3),
        "peak_12pm_intensity_per_hr": round(nhpp_intensity(12.0), 3),
        "hourly_nhpp_intensity": hourly_profile,
        "prep_time_models": {
            "simple_iced_gamma_mean_min": round(gamma_mean, 3),
            "blended_drink_lognormal_mean_min": round(lognormal_mean, 3),
        },
    }


# ============================================================================
# 2. QUEUEING THEORY & MULTI-CHANNEL COUNTER SIZING (M/M/c/K, Module 6)
# ============================================================================
def run_topic_2_mmck_queueing(lam=28.0, mu=14.0, c=2, K=10):
    rho = lam / (c * mu)
    c_rho = c * rho

    sum1 = sum((c_rho ** n) / math.factorial(n) for n in range(c))
    sum2 = sum((rho ** (n - c)) for n in range(c, K + 1))
    P0 = 1.0 / (sum1 + ((c_rho ** c) / math.factorial(c)) * sum2)

    probs = []
    for n in range(K + 1):
        if n < c:
            pn = P0 * ((c_rho ** n) / math.factorial(n))
        else:
            pn = P0 * (((c ** c) * (rho ** n)) / math.factorial(c))
        probs.append(pn)

    P_drop = probs[K]
    lam_eff = lam * (1.0 - P_drop)
    L = sum(n * probs[n] for n in range(K + 1))
    W_hours = L / lam_eff if lam_eff > 0 else 0.0

    return {
        "parameters": {"lambda": lam, "mu": mu, "c": c, "K": K},
        "utilization_rho": round(rho, 4),
        "P0_idle_prob": round(P0, 6),
        "P_drop_abandonment_prob": round(P_drop, 6),
        "effective_arrival_rate_per_hr": round(lam_eff, 4),
        "avg_orders_in_system_L": round(L, 4),
        "littles_law_turnaround_W_min": round(W_hours * 60.0, 3),
    }


# ============================================================================
# 3. DISCRETE-TIME MARKOV CHAINS (DTMC) & ORDER LIFECYCLE DYNAMICS (Module 5)
# ============================================================================
def invert_matrix(mat):
    n = len(mat)
    aug = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(mat)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
        aug[col], aug[pivot] = aug[pivot], aug[col]
        div = aug[col][col]
        aug[col] = [v / div for v in aug[col]]
        for r in range(n):
            if r != col:
                fac = aug[r][col]
                aug[r] = [aug[r][j] - fac * aug[col][j] for j in range(2 * n)]
    return [row[n:] for row in aug]


def mat_mul(A, B):
    return [
        [sum(A[i][k] * B[k][j] for k in range(len(B))) for j in range(len(B[0]))]
        for i in range(len(A))
    ]


def run_topic_3_dtmc_lifecycle():
    # Transient: S0=Cart/Held, S1=Queued, S2=Brewing, S3=Ready
    # Absorbing: S4=Completed, S5=Canceled/Voided, S6=Refunded
    Q = [
        [0.05, 0.88, 0.00, 0.00],
        [0.00, 0.10, 0.85, 0.00],
        [0.00, 0.00, 0.12, 0.84],
        [0.00, 0.00, 0.00, 0.05],
    ]
    R = [
        [0.00, 0.07, 0.00],
        [0.00, 0.05, 0.00],
        [0.00, 0.03, 0.01],
        [0.93, 0.01, 0.01],
    ]
    I_minus_Q = [
        [(1.0 if i == j else 0.0) - Q[i][j] for j in range(4)]
        for i in range(4)
    ]
    N = invert_matrix(I_minus_Q)
    B = mat_mul(N, R)

    return {
        "transient_states": ["S0: Cart/Held", "S1: Queued", "S2: Brewing", "S3: Ready"],
        "absorbing_states": ["S4: Completed", "S5: Canceled/Voided", "S6: Refunded"],
        "fundamental_matrix_N": [[round(x, 4) for x in row] for row in N],
        "expected_active_steps_from_S1_queued": round(sum(N[1]), 4),
        "absorption_probabilities_B": [[round(x, 4) for x in row] for row in B],
    }


# ============================================================================
# 4. FAIR RISK FRAMEWORK & MONTE CARLO SIMULATION (100,000 ITERATIONS, Module 4)
# ============================================================================
def run_topic_4_fair_monte_carlo(iterations=100_000, seed=42):
    random.seed(seed)
    a, m, b = 2.0, 12.0, 45.0
    mu_pert = (a + 4.0 * m + b) / 6.0
    alpha = ((mu_pert - a) * (2.0 * m - a - b)) / ((m - mu_pert) * (b - a))
    beta = (alpha * (b - mu_pert)) / (mu_pert - a)

    plm_mu, plm_sigma = 6.2, 0.8
    control_cost = 3500.0
    mitigation_reduction = 0.78

    if np is not None:
        rng = np.random.default_rng(seed)
        u = rng.beta(alpha, beta, size=iterations)
        tef_samples = np.maximum(1, np.rint(a + u * (b - a)).astype(int))
        # Vectorized compound lognormal approximation + exact sampling
        mean_single = math.exp(plm_mu + (plm_sigma ** 2) / 2.0)
        var_single = (math.exp(plm_sigma ** 2) - 1.0) * math.exp(2 * plm_mu + plm_sigma ** 2)
        annual_losses = np.empty(iterations, dtype=np.float64)
        for idx, count in enumerate(tef_samples):
            annual_losses[idx] = rng.lognormal(plm_mu, plm_sigma, size=int(count)).sum()
        annual_losses.sort()
        ale_base = float(annual_losses.mean())
        var_95 = float(annual_losses[int(0.95 * iterations)])
    else:
        losses = []
        for _ in range(iterations):
            u = random.betavariate(alpha, beta)
            events = max(1, round(a + u * (b - a)))
            loss = sum(random.lognormvariate(plm_mu, plm_sigma) for _ in range(events))
            losses.append(loss)
        losses.sort()
        ale_base = sum(losses) / iterations
        var_95 = losses[int(0.95 * iterations)]

    ale_mitigated = ale_base * (1.0 - mitigation_reduction)
    rosi = ((ale_base - ale_mitigated) - control_cost) / control_cost

    return {
        "iterations": iterations,
        "ALE_base_PHP": round(ale_base, 2),
        "ALE_mitigated_PHP": round(ale_mitigated, 2),
        "VaR_95_PHP": round(var_95, 2),
        "control_cost_PHP": control_cost,
        "ROSI": round(rosi, 4),
        "ROSI_percent": round(rosi * 100.0, 2),
    }


# ============================================================================
# 5. GAME THEORY IN CASHIER AUDIT & VOID AUTHORIZATION (Module 7)
# ============================================================================
def run_topic_5_game_theory(G=500.0, F=2500.0, C_audit=150.0, L=500.0):
    # Analytical Mixed-Strategy Nash Equilibrium:
    # Cashier indifference: (1 - sigma_M)*G + sigma_M*(-F) = 0  => sigma_M* = G / (G + F)
    # Manager indifference: sigma_C*(-L) = -C_audit            => sigma_C* = C_audit / L
    sigma_M_analytical = G / (G + F)
    sigma_C_analytical = C_audit / L

    lp_solver_used = False
    sigma_M_lp = sigma_M_analytical
    if linprog is not None:
        # Solve via scipy.optimize.linprog:
        # Find minimum audit probability p_audit = x[1] such that Cashier's expected fraud payoff <= 0:
        #   G * x[0] - F * x[1] <= 0,  x[0] + x[1] = 1,  x >= 0
        c_obj = [0.0, 1.0]
        A_ub = [[G, -F]]
        b_ub = [0.0]
        A_eq = [[1.0, 1.0]]
        b_eq = [1.0]
        res = linprog(c_obj, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=b_eq, bounds=[(0, 1), (0, 1)], method="highs")
        if res.success:
            lp_solver_used = True
            sigma_M_lp = float(res.x[1])

    return {
        "parameters": {"G": G, "F": F, "C_audit": C_audit, "L": L},
        "scipy_linprog_used": lp_solver_used,
        "sigma_M_star_audit_prob": round(sigma_M_lp, 4),
        "sigma_C_star_fraud_prob": round(sigma_C_analytical, 4),
        "min_random_audit_threshold_percent": round(sigma_M_lp * 100.0, 2),
    }


# ============================================================================
# 6. INFORMATION ENTROPY & POS TERMINAL PIN CRYPTANALYSIS (Modules 2 & 10)
# ============================================================================
def run_topic_6_pin_entropy(r_guess_per_min=30.0):
    search_space = 10 ** 4
    shannon_entropy = math.log2(search_space)
    unthrottled_expected_min = search_space / (2.0 * r_guess_per_min)

    # With 3 failed attempts -> 5-minute lockout:
    effective_rate_per_min = 3.0 / (5.0 + 3.0 / r_guess_per_min)
    locked_expected_min = search_space / (2.0 * effective_rate_per_min)

    return {
        "search_space_S": search_space,
        "shannon_entropy_bits": round(shannon_entropy, 4),
        "unthrottled_expected_compromise_min": round(unthrottled_expected_min, 2),
        "lockout_3_attempts_5_min_expected_compromise_days": round(locked_expected_min / (60.0 * 24.0), 2),
    }


# ============================================================================
# 7. SYSTEM RELIABILITY BLOCK DIAGRAMS (RBD) & OFFLINE QUEUE RESILIENCE (Module 12)
# ============================================================================
def run_topic_7_rbd_reliability(
    r_terminal=0.9999,
    r_network=0.9910,
    r_cloud=0.9990,
    r_local_queue=0.9950,
    mtbf_hours=2500.0,
    mttr_hours=0.25,
):
    r_live_series = r_terminal * r_network * r_cloud
    r_sys_parallel = r_terminal * (1.0 - (1.0 - r_network * r_cloud) * (1.0 - r_local_queue))
    availability = mtbf_hours / (mtbf_hours + mttr_hours)

    return {
        "live_cloud_series_reliability_percent": round(r_live_series * 100.0, 4),
        "offline_fallback_parallel_reliability_percent": round(r_sys_parallel * 100.0, 4),
        "inherent_availability_percent": round(availability * 100.0, 4),
    }


def main():
    report = {
        "topic_1_stochastic_arrivals": run_topic_1_stochastic_arrivals(),
        "topic_2_mmck_queueing": run_topic_2_mmck_queueing(),
        "topic_3_dtmc_lifecycle": run_topic_3_dtmc_lifecycle(),
        "topic_4_fair_monte_carlo": run_topic_4_fair_monte_carlo(iterations=100_000),
        "topic_5_game_theory_audit": run_topic_5_game_theory(),
        "topic_6_pin_cryptanalysis": run_topic_6_pin_entropy(),
        "topic_7_rbd_offline_resilience": run_topic_7_rbd_reliability(),
    }
    out_path = Path(__file__).parent / "qmodsim_results.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
