# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Plain HTML, CSS, and vanilla JavaScript (with Tailwind CDN utility support, Chart.js, Cropper.js, and jsPDF in POS), backed by an Express + PostgreSQL server (`tagak-coffee/server.js`).

## Users

- **Cashiers & Baristas (POS App):** Working behind the counter at Tagak Coffee branches under time pressure; taking walk-in and QR orders, customizing drink size (Regular/Large), temperature (Hot/Iced), and add-ons, applying PWD/Senior discounts, managing the live order queue (Queued → Brewing → Ready → Completed/Voided), and logging cash drawer pay-in/pay-out events.
- **Branch Managers (POS App):** Everything above plus editing menu items and multi-size ingredient recipes (with Regular and Large supply quantities), archiving/restoring menu items, managing add-ons and supply stock/cost history, uploading 16:9 storefront carousel promos, configuring store settings (VAT, Large upcharge, prep time, store open/closed status), and reviewing historical COGS/Net Profit sales analytics and PDF reports.
- **Admins & Super Admins (Admin App):** Managing multi-branch store records, employee PIN/password accounts grouped by branch, Admin/Super Admin accounts, and the 5-role × 16-permission RBAC matrix (`Super Admin`, `Admin`, `Manager`, `Barista`, `Cashier`).

## Product Purpose

Tagak Coffee ("Tagak" = heron in Filipino) is an integrated multi-branch cafe point-of-sale, inventory/recipe costing, and workforce/RBAC administration platform built for real Philippine specialty coffee counter operations (PHP `₱` currency, 12% VAT, 20% PWD/Senior Citizen statutory discount, GCash/Maya QR + cash tender, historical batch supply costing).

## Positioning

Unlike generic retail POS templates, Tagak ties every drink size (Regular vs. Large) and add-on directly to gram/milliliter/piece supply deductions and historical dated supply price logs, so changing a supply cost today never rewrites past COGS or net profit reports, while archiving a drink preserves all historical order and recipe data.

## Operating Context

- Used on counter tablets and desktop terminals (`1024px–1440px+`) and mobile/compact viewports (`390px–768px`) during active cafe service.
- High-frequency, repetitive operational workflows where scanability, touch target size, tabular numeral alignment, and instant state recognition (Store Open/Closed, Sold Out/In Stock, Draft/Published/Archived, Queued/Brewing/Ready) matter most.

## Capabilities and Constraints

- **Zero Feature Loss:** Must retain 100% of existing views, modals, controls, DOM IDs, `data-*` attributes, `data-testid` hooks, and JS event bindings in `pos-app` and `admin-app`.
- **Backend Alignment:** Must match the existing Express API routes and PostgreSQL schema without breaking any Playwright API, DB, or E2E tests.

## Brand Commitments

- Brand name: **Tagak Coffee** (`Tagak POS`, `Tagak Admin`).
- Existing brand marks on disk:
  - `tagak-coffee/LOGO/TAGAKLOGO.png` — Cobalt blue heron (`#003087`) rising from a coffee cup with warm golden-amber steam (`#FFA300`).
  - `tagak-coffee/admin-app/assets/tagak-logo-admin-v2.png` — White heron-cup mark with sage-green steam (`#B2C2B5`).

## Evidence on Hand

- Live Express + PostgreSQL backend with real branches (`0000001` Tagak Main), menu items, recipes, supplies, add-ons, orders, cash logs, carousel uploads, and RBAC matrix.
- Full Playwright test suite (`tests/api`, `tests/db`, `tests/e2e`).

## Product Principles

1. **Counter Speed First:** Every cashier and barista action (tapping a drink, picking Hot/Iced + Large, tendering Cash/QR, advancing a ticket) must be legible at arm's length and executable without visual friction.
2. **Unified System Across POS & Admin:** `pos-app` and `admin-app` belong to one coherent Tagak design system rather than mismatched stylesheets and conflicting token blocks.
3. **Honest Operational Data:** Tabular numerals (`tabular-nums`), clear unit labels (`g`, `ml`, `pc`, `₱`), and unmistakable status badges (Queued, Brewing, Ready, Sold Out, Draft, Archived).
4. **Zero DOM Contract Breakage:** Every existing `id`, `data-view`, `data-testid`, class hook, and modal structure consumed by JS and Playwright stays intact.
