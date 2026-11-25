# Tagak Café — ordering, point of sale and quantitative modeling

Tagak Café connects customer orders, branch registers and administrative controls to one PostgreSQL database. The QMODSIM lab uses order transitions and branch telemetry to explore staffing, service times, cash reconciliation and offline resilience.

**Live website:** [Open TAGAKQMOD](https://tagakqmod.onrender.com), hosted on Render with Neon PostgreSQL, as reported by the project owner. Anonymous verification on 25 November 2026 confirmed the storefront, login, deployed QMODSIM assets and database readiness. The deployed POS and QMODSIM scripts match the submitted source. All seven model renderers executed successfully using those assets in an isolated Chromium page. Authenticated production telemetry and transaction workflows were outside this check.

The owner reports successful manual tests of online ordering, POS, offline emergency mode and Xendit QR payment simulation. Read-only verification confirmed that QR checkout and simulation are enabled.

## System and data flow

Customers choose a branch and place an order. The register confirms guest cash before preparation. Staff advance tickets through the board, reconcile cash and manage inventory according to their permissions. The admin app manages branches, employees and role grants. Server-side branch checks protect staff workflows. Customers track individual tickets with tracking credentials.

The browser apps use HTML, CSS and JavaScript. Express serves the apps and JSON APIs on one origin. PostgreSQL stores accounts, sessions, role grants, branches, catalog and recipe relationships, order lines and supply usage, cash logs, checkout records and offline sales. Migrations add QMOD transition history, drawer reconciliations and audit events. Stored branch identifiers link operational records to their branch. Server-sent events refresh order views.

| Location | Purpose |
| --- | --- |
| `tagak-coffee/customer-app`, `pos-app`, `admin-app`, `unified-login` | Four browser entry points |
| `tagak-coffee/server`, `server.js`, `api/` | Authentication, API routes, long-running and serverless entry points |
| `tagak-coffee/db` | Database connection, ordered migrations, seed and security checks |
| `tagak-coffee/scripts`, `tests` | Public-asset build and Playwright API, database and browser tests |
| `qmodsim` | Standalone JavaScript and Python models, archived and rerun results |

## Run and assess

See the [installation and deployment guide](tagak-coffee/README.md), [role and permission reference](tagak-coffee/docs/RBAC.md), [mathematical verification](qmodsim/VERIFICATION.md), [security and skill audit](SECURITY_AND_SKILL_AUDIT.md) and [submission checklist](FINAL_SUBMISSION.md).

The shared-core reference is `deploy/render-neon` at `e0e8eca`. This submission includes PBLQMOD-specific additions. The current repository is [dacoolyow18/TAGAKQMOD](https://github.com/dacoolyow18/TAGAKQMOD), branch `main`. Deployed asset parity confirms the inspected scripts. The hosting service does not expose a deployment commit through these public checks.
