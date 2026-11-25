# Tagak Café | Security and skill audit

**Assessment date** 25 November 2026  
**Audited source** TAGAKCAFE/PBLQMOD, branch `submission`, application snapshot `ffe5870e82dd559abf5c074b4274df8a03f3cfc4`  
**Core reference** `deploy/render-neon` at `e0e8ecab2fcc93629de247cddd934d2dc200326b`

## Executive assessment

Local tests passed for authentication, branch scoping, payments, offline reconciliation, migrations and the QMODSIM lab. Two control-design findings need owner review. The hosted site serves the core storefront but lacks the submission's QMODSIM asset. A successful classroom demonstration of all seven models currently depends on running the submitted version locally.

## Scope and method

Reviewed application source, migrations, documented permissions, frontend rendering paths and the dependency lockfile. Ran the production-asset build, Playwright suite, live anonymous GET checks, a scoped Git secret scan, npm audit and both simulation engines. Testing used an isolated local PostgreSQL database. No hosted logins, payment transactions, record mutations or deployment changes were performed. The rubric is an evidence-based control review; instructor methodology has not been supplied.

Caveman guided concise evidence reporting, Ponytail guided scope and maintainability review, and Impeccable's audit guidance informed frontend inspection. These are agent skills. Playwright, Chromium, Git, npm audit, Node.js and Python executed checks. No security certification or penetration-test assurance is implied.

## Findings and actions

**High — Cash audit enforcement.** The register and order handler divide responsibility for selecting a spot audit and validating approval. Code review did not establish an independent server-enforced decision for every operation requiring a second approver. This weakens assurance over void/refund approvals. Have the server determine, persist and enforce approval requirements, then independently test eligible and ineligible approvals. Evidence: POS order actions and the authenticated order transition handler. No live bypass test was performed.

**Medium — Operational reporting permissions.** QMOD telemetry enforces an authenticated session and branch scope. Its aggregated financial and audit measures do not have a distinct reporting permission at the route. Confirm the intended audience with the business owner; apply a dedicated role grant if the measures are manager-only. Evidence: QMOD telemetry route and branch-scope helper.

**Medium — Submission deployment mismatch.** Anonymous reads found the QMODSIM script absent on staging; the deployed POS application script differed from the submitted file. The site cannot demonstrate the complete assessment. Review migration readiness, backups, static asset delivery and authorized deployment branch before approving a release.

**Low — Telemetry reliability and cost.** The telemetry handler groups historical transitions without a time bound, and some failed queries yield empty collections. An empty chart can mask a data error; historical growth can increase query cost. Distinguish unavailable from zero and measure representative query plans before deciding on indexes or reporting windows.

## Control evidence

- **Identity and sessions — tested locally.** Password policy requires mixed character classes and limits bcrypt input size. Local password hashes use bcrypt; staff PINs use a keyed HMAC verifier. Session tokens are hashed in storage. Cookie handling includes HttpOnly, SameSite and HTTPS-dependent Secure flags. Auth and login tests cover lockout, logout, inactive users and role-specific login.
- **RBAC and API isolation — tested with findings above.** Server middleware checks the current session, role and permissions; branch-aware routes constrain records. Role changes, cross-branch access, public tracking credentials and offline replay have automated coverage.
- **SQL injection, XSS and validation — sampled.** Reviewed parameterized database calls and controlled SQL fragments, frontend escaping helpers, and shared validation. Phone uniqueness/format is enforced in PostgreSQL, with collision and retry tests. Dynamic HTML rendering remains a manual-review surface. No exhaustive SQL or DOM data-flow analysis was performed.
- **CSRF, throttling and HTTP headers — reviewed.** Mutation middleware checks request origin and browser fetch metadata. The session and rate-limit implementations persist state. The staging customer page returned CSP, HSTS and X-Content-Type-Options. Cross-origin behavior across every browser was not verified.
- **Database access — tested locally.** Migration tests check repeat application and invoke the security checker for row-level security and browser grants. Actual Neon production grants, backups, database ownership and network controls were not inspected.
- **Files, errors and secrets — reviewed.** Uploads enforce size, signature, decoded format and pixel limits; Sharp re-encodes the data. Unexpected API failures return a generic 500 response. Server logs include error messages; production log retention and redaction were not available. The new branch excludes runtime environment files, uploads, tool collections and dependencies. A local scanner checked 179 text blobs in the application snapshot and 178 in the existing main history against selected credential patterns and local secret values, with zero matches. This was a scoped scan.
- **Payments and offline data — tested locally.** Xendit sandbox integration authenticates callbacks using a timing-safe token comparison; automated tests exercise fulfillment and retry behavior. Offline cash uses device/shift validation and idempotent transaction handling. A legacy unkeyed SHA-256 digest checks consistency and cannot alone authenticate the sender. Live provider settlement and physical-device compromise were outside scope.
- **Dependencies — passed.** npm audit against the public npm registry reported zero known advisories across all severities for the submitted lockfile. New advisories can change this result.

## Engineering and interface assessment

The apps share a same-origin API, validation helpers and an ordered migration system. The separation between apps and server routes is clear. POS order handling combines cash collection, offline replay, fulfillment and QMOD transitions, making cross-feature regression tests particularly important. The isolated suite supplies those tests. Large production workloads, sustained concurrent sales and recovery after real hardware loss remain unverified.

Impeccable review covered the unified login at 390 and 1440 CSS pixels in Chromium. Both widths had zero horizontal overflow and zero visible inputs missing label associations under the DOM check. The document declared English. The three app stylesheets contain focus or reduced-motion rules. This sample does not establish WCAG conformance; screen-reader flows, contrast across states and full keyboard navigation still need evaluation.

The submission README corrects the root entry route and documents the deployment gap. The math report separates simulation assumptions from operating measurements. Generated assets, archived developer tooling and run caches are excluded from Git. The application snapshot retains the database relationships and business logic of the working copy.

## Results and disposition

**Passed:** public build; 209 of 248 Playwright cases; Python fixed-seed reproduction; all six shared deterministic mathematical topics; anonymous hosted storefront, unified login, POS shell, admin login redirect and protected orders response. Thirty-nine browser cases were skipped under the suite's existing conditions. Zero executed cases failed.

**Failed:** hosted QMODSIM asset parity. **Unverified:** instructor access, hosted authenticated workflows, production database configuration, live payment settlement, production capacity and comprehensive accessibility. The security findings remain open. No application logic was changed as part of the assessment.
