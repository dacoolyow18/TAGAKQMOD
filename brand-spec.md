# Brand Spec — Tagak Coffee

## 1. Brand Identity
- **Brand Name:** Tagak Coffee ("Tagak" = heron / egret in Filipino)
- **Surfaces in Scope:**
  - **Tagak POS (`tagak-coffee/pos-app`):** Counter Register, Live Orders Kanban, Sales & COGS Analytics, Menu & Recipes (with Regular/Large ingredient measurements and Archive/Restore), Add-ons Management, Supplies & Historical Costing, Storefront Tools & Settings.
  - **Tagak Admin (`tagak-coffee/admin-app`):** Workspace Overview, Branch Management, Employee Accounts (grouped by branch + PIN), Admin Accounts, Roles & Permissions RBAC Matrix.

## 2. Official Brand Assets on Disk (Verified)
- **Primary Emblem (`tagak-coffee/LOGO/TAGAKLOGO.png`):**
  - Motif: Stylized heron rising gracefully from a coffee cup, with two rising steam ribbons forming a warm spiral inside the silhouette.
  - Extracted Brand Colors:
    - **Heron Cobalt:** `#003087`
    - **Steam Amber / Marigold:** `#FFA300`
- **Dark-Surface Mark (`tagak-coffee/admin-app/assets/tagak-logo-admin-v2.png`):**
  - Motif: White heron-cup silhouette with soft sage-celadon steam ribbons (`#B2C2B5`).
  - Existing POS/Customer Botanical Tokens: Deep Forest `#1F2D24` / `#2B3A30`, Sage Mist `#EBEEE7` / `#C8D1C7`, Warm Roast `#7A5543`.

## 3. Hard Technical & DOM Invariants
- Zero removal or renaming of any DOM `id`, `data-view`, `data-testid`, `data-cat`, `data-preset`, `data-method`, or modal container across `pos-app/index.html`, `pos-app/js/*.js`, `admin-app/index.html`, and `admin-app/js/admin.js`.
- All 16 RBAC permissions, 5 roles, recipe Regular/Large supply quantities, soft-delete archiving (`is_archived` + restore), PWD/Senior 20% discount math, VAT calculation, and PDF/print reports must work identically.
