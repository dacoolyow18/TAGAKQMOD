---
name: Tagak Coffee POS & Operations
description: Tactile counter-grade point-of-sale and café operations system built for high-throughput barista and cashier workflows.
colors:
  crema: "#1F2D24"
  crema-dark: "#141E18"
  emerald: "#15803D"
  emerald-soft: "#DCFCE7"
  cobalt: "#003087"
  amber: "#D97706"
  roast: "#6A543B"
  espresso: "#B91C1C"
  bg: "#F3F5F4"
  bg-elevated: "#FFFFFF"
  bg-subtle: "#EAECE9"
  ink: "#141E18"
  ink-secondary: "#2F3D34"
  muted: "#4B5950"
  line: "#DDE2DD"
  line-strong: "#C2CBC3"
typography:
  display:
    fontFamily: "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.04em"
  mono:
    fontFamily: "'JetBrains Mono', 'Courier New', monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.75rem"
  xl: "1rem"
  pill: "9999px"
spacing:
  xs: "0.375rem"
  sm: "0.625rem"
  md: "0.875rem"
  lg: "1.25rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.crema}"
    textColor: "{colors.bg-elevated}"
    rounded: "{rounded.md}"
    padding: "0.5625rem 1.0625rem"
  button-primary-hover:
    backgroundColor: "{colors.crema-dark}"
  button-secondary:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.9375rem"
  button-danger:
    backgroundColor: "{colors.espresso}"
    textColor: "{colors.bg-elevated}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.9375rem"
  chip-filter:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "0.4375rem 0.9375rem"
  chip-filter-active:
    backgroundColor: "{colors.crema}"
    textColor: "{colors.bg-elevated}"
    rounded: "{rounded.pill}"
    padding: "0.4375rem 0.9375rem"
---

# Design System: Tagak Coffee POS & Operations

## Overview

**Creative North Star: "The Tactile Counter Instrument"**

Tagak Coffee's POS and Unified Login surfaces are designed as daylight-legible, high-throughput operational instruments for baristas, cashiers, and store managers. Rather than treating the register like a marketing webpage or a dark dashboard, the system pairs a calm cool-alabaster counter ground (`#F3F5F4`) with crisp white elevated workspaces (`#FFFFFF`), photo-led product tiles, and Tagak's Deep Forest (`#1F2D24`) and Emerald (`#15803D`) operational accents.

Every primary workflow — ringing up customizable drinks, switching between Dine-in and Takeout, calculating cash change, and previewing thermal 58mm/80mm receipts — happens inside structured two-pane layouts that eliminate unnecessary scrolling and keep the live order total anchored in sight.

**Key Characteristics:**
- **Deep Forest Navigation Rail:** A slim 96px (`6rem`) Deep Forest green (`#1F2D24`) vertical rail with stacked icon-and-label navigation buttons and crisp White (`#FFFFFF`) active pill highlights.
- **Photo-First Register Grid:** Product cards pair 16:11 photography, category pills, live in-cart quantity badges, tabular prices, and tactile `+` action buttons.
- **Split Landscape Modals:** Drink Customization, Checkout Tender, and Payment Successful + Thermal Receipt views use two-column landscape dialogs divided by a single structural hairline rather than nested card boxes.
- **Tabular Precision:** Every price, quantity stepper, PIN field, VAT calculation, and ticket code enforces `tabular-nums` alignment.

## Colors

The palette balances daylight counter legibility with Tagak Coffee's Deep Forest identity and unmistakable semantic status coding.

### Primary
- **Deep Forest Crema** (`#1F2D24`): Primary interactive fill for active navigation items, selected category pills, selected drink size/temperature tiles, selected payment method cards, and primary checkout CTAs.
- **Deep Forest Press** (`#141E18`): Hover and active state for primary buttons and primary body ink.

### Secondary
- **Counter Emerald** (`#15803D`): Operational confirmation accent for `OPEN` store toggles, in-cart item count badges, selected add-on rows, change due readouts, and `Payment Successful!` confirmation states.
- **Soft Emerald Wash** (`#DCFCE7`): Tinted surface fill for active add-on rows, service-mode tags (`DINE-IN`), and ready status pills.

### Tertiary
- **Tagak Heron Cobalt** (`#003087`): Brand mark accent carried in the Tagak heron emblem across the login header, POS rail, and thermal receipt header.
- **Warm Amber** (`#D97706`) & **Roast Umber** (`#6A543B`): Brewing queue status highlights and pastry monogram accents.
- **Signal Crimson** (`#B91C1C`): Destructive actions (`Void Order`, `Delete`), closed-store indicators, and validation alerts.

### Neutral
- **Counter Alabaster** (`#F3F5F4`): App canvas background and recessed input/toolbar wells.
- **Pure Counter White** (`#FFFFFF`): Elevated cards, navigation rail, persistent order cart, split modal surfaces, and thermal receipt paper.
- **Subtle Stone** (`#EAECE9`): Table section headers, kanban column tracks, and secondary hover fills.
- **Secondary Forest Ink** (`#2F3D34`) & **Muted Sage** (`#4B5950`): Supporting labels, metadata, and input placeholders (all maintaining >= 4.5:1 contrast on light surfaces).
- **Structural Hairline** (`#DDE2DD`) & **Strong Field Border** (`#C2CBC3`): 1px structural dividers and form control strokes.

### Named Rules
**The Forest Authority Rule.** Deep Forest (`#1F2D24`) is reserved for the active state of a group and the primary commitment button on a screen or modal; inactive peer options rest on white or alabaster with a 1px hairline border (`#DDE2DD`).

**The Semantic Status Rule.** Queue status colors (`Queued` blue, `Brewing` amber, `Ready` emerald, `Void` crimson) are strictly reserved for operational state badges and store open/closed indicators — never used as decorative card fills.

## Typography

**Display & UI Font:** `Archivo` (with `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` fallback)
**Label/Mono Font:** `JetBrains Mono` (with `'Courier New', monospace` fallback)

**Character:** A single workhorse grotesque sans-serif (`Archivo`) handles all operational UI labels, headings, and controls for fast scannability under counter lighting, while `JetBrains Mono` renders ticket numbers (`TK-YYYYMMDD-NNNN`), 4-digit PIN inputs, and thermal paper receipts.

### Hierarchy
- **Display** (700, `1.25rem` / 20px, line-height `1.25`, letter-spacing `-0.02em`): View headings (`Today's Orders`, `Analytics`, `Menu & Recipes`, `Payment Successful!`) and login title (`Access System`).
- **Headline** (700, `1.0625rem` / 17px, line-height `1.25`, letter-spacing `-0.015em`): Top bar view title and modal item titles.
- **Title** (700, `0.9375rem` / 15px, line-height `1.3`): Section panes (`Current Order`, `Order Summary`, `Select Payment Method`) and primary checkout button text.
- **Body** (500–600, `0.8125rem`–`0.875rem` / 13–14px, line-height `1.5`): Product card titles, cart line names, form inputs, and data table cells.
- **Label** (700, `0.6875rem`–`0.75rem` / 11–12px, letter-spacing `0.04em`, uppercase): Field labels, category badges, service-mode tags (`DINE-IN`), and table headers. Never drop functional UI text below `11px` (`0.6875rem`).

### Named Rules
**The Tabular Currency Rule.** Every element displaying Philippine Peso amounts (`₱`), quantities, percentages, timestamps, or ticket IDs must set `font-variant-numeric: tabular-nums` so digits align vertically in carts, tables, and receipts.

**The No-Kicker Rule.** Section and card headings stand on their own without small uppercase eyebrow labels stacked above them.

## Layout

The POS uses a fixed viewport application shell (`100dvh`) divided into three persistent zones on desktop (`>= 1024px`):
1. **Left Navigation Rail (`5.75rem` / 92px fixed width):** Houses the Tagak brand emblem at top, 7 stacked icon-and-label view buttons in the scrollable middle, and the staff avatar + logout button pinned at the bottom.
2. **Global Operational Header (`3.5rem` / 56px min-height):** Displays the current view title on the left and the live Manila clock, `OPEN/CLOSED` store toggle pill, `Cash Drawer` button, and signed-in cashier badge on the right.
3. **Register Two-Pane Workspace (`minmax(0, 1fr) 23.5rem`):**
   - **Left Product Catalog (`1fr`):** Top search bar + branch selector row, horizontal category filter pill strip (`All Items`, `Drinks`, `Pastries`), and an auto-filling CSS Grid of photo-first product cards (`repeat(auto-fill, minmax(11.25rem, 1fr))`, `0.75rem` gap).
   - **Right Current Order Cart (`23.5rem` on desktop, `19.5rem` on tablet):** Top 2-column service-mode selector (`Dine-in`, `Takeout`), header with `Current Order` + mode pill + item count + `Clear` button, scrollable thumbnail line items, and pinned footer with Subtotal, 12% VAT, Total, and full-width `Checkout` button.

On mobile (`< 768px`), the navigation rail converts into an off-canvas slide-over drawer triggered by a `44x44px` hamburger button, and the Register view stacks the product grid above the order summary cart without scroll-container overlap.

## Elevation & Depth

The system uses a hybrid of **1px structural hairlines (`#DDE2DD`)** for workspace partitioning and **low-diffusion ambient shadows** for interactive cards and modal sheets.

### Shadow Vocabulary
- **Resting Tile** (`box-shadow: 0 1px 2px rgba(20, 30, 24, 0.04)`): Applied to product tiles, KPI cards, and secondary buttons at rest.
- **Interactive Hover** (`box-shadow: 0 6px 16px -3px rgba(20, 30, 24, 0.08), 0 2px 6px -2px rgba(20, 30, 24, 0.04)`): Applied when hovering a menu product card alongside a `-1px` vertical lift and `#1F2D24` border highlight.
- **Modal & Thermal Sheet** (`box-shadow: 0 20px 44px -8px rgba(20, 30, 24, 0.18), 0 8px 18px -6px rgba(20, 30, 24, 0.08)`): Elevates split landscape modals over the blurred backdrop (`rgba(20, 30, 24, 0.48)`) and floats the physical thermal receipt preview sheet inside its stage.

### Named Rules
**The Single-Container Split Rule.** Split two-column modals (`#item-customization-modal`, `#tender-modal`, `#receipt-modal`) are single elevated `.modal-card` surfaces divided internally by a `1px solid #DDE2DD` hairline (`border-right` on desktop, `border-bottom` on mobile). Never nest bordered, shadowed sub-cards inside a modal card.

## Shapes

- **Cards & Product Tiles:** `0.75rem` (`12px`, `--radius-lg`) outer radius with `0.5rem` (`8px`, `--radius-md`) inner image media corners so inset padding remains visually concentric.
- **Modals:** `1rem` (`16px`, `--radius-xl`) outer radius with generous `1.25rem`–`1.5rem` internal padding.
- **Buttons & Inputs:** `0.5rem` (`8px`, `--radius-md`) for standard buttons, choice cards, and text inputs.
- **Category & Status Pills:** Full capsule (`9999px`) for category filter chips, status badges, store open/close toggles, and cart quantity steppers.
- **Thermal Paper Sheet:** Crisp `0px` (unrounded rectangular paper edge) with `1px dashed #C2CBC3` internal section dividers to evoke real 58mm/80mm thermal roll stock.

## Components

### Buttons
- **Shape:** Gently rounded corners (`0.5rem` / 8px radius), `2.375rem` (38px) default height, `2.625rem` (42px) large height, and `3.125rem` (50px) for the primary Register `Checkout` bar.
- **Primary (`.btn-primary`, `.reg-pay`):** Deep Forest (`#1F2D24`) background, `#FFFFFF` text, `600`–`700` weight, transitioning to `#141E18` on hover.
- **Secondary (`.btn-secondary`):** White (`#FFFFFF`) background, `#141E18` text, `1px solid #C2CBC3` border, shifting border to `#1F2D24` on hover.
- **Destructive (`.btn-void`):** Crimson (`#B91C1C`) background, `#FFFFFF` text, shifting to `#991B1B` on hover.

### Chips & Service Mode Selectors
- **Category Filter Chips (`.reg-chip`):** Pill shape (`9999px`), white background with `1px solid #DDE2DD` at rest; Deep Forest (`#1F2D24`) with white label and translucent count badge when `.active`.
- **Service Mode Tiles (`.reg-mode-btn`):** 2-column segmented grid at the top of the cart (`Dine-in`, `Takeout`) with stacked 16px icon + `11px` bold label; `.active` fills with `#1F2D24`.

### Product Tiles (`.reg-tile`)
- **Corner Style:** `0.75rem` (12px) outer card with `0.5625rem` (9px) padding around a 16:11 rounded image container (`0.5rem` radius).
- **Overlays:** Top-left frosted category pill (`rgba(255, 255, 255, 0.92)`, `11px` uppercase) and top-right Emerald quantity badge (`#15803D`) when the item is in the active ticket.
- **Footer:** Item name (`0.875rem` bold, 2-line clamp) above a bottom row pairing tabular price with a `28x28px` rounded `+` button that fills with `#1F2D24` on card hover or when in cart.

### Inputs & PIN Fields
- **Style:** `1px solid #C2CBC3` border, `0.5rem` (8px) radius, `#FFFFFF` (or `#F9FAF9` on login) background, `#141E18` text, `#4B5950` placeholder.
- **Focus:** `1px solid #1F2D24` border with `0 0 0 3px rgba(31, 45, 36, 0.08)` focus ring.
- **PIN Input (`#pos-pin`):** `JetBrains Mono` `24px` bold, `0.45em` letter-spacing, centered tabular digits inside a `54px` tall field.

### Navigation Rail (`.sidebar`)
- **Desktop:** `6rem` (96px) Deep Forest green vertical rail (`#1F2D24`) with `1px solid rgba(255, 255, 255, 0.12)` dividers. Each `.sidebar-item` stacks a `19px` SVG icon above an `11px` centered label in `rgba(255, 255, 255, 0.78)`; `.active` receives a crisp White (`#FFFFFF`) fill and Deep Forest (`#1F2D24`) ink.
- **Mobile (`< 768px`):** `15.5rem` (248px) slide-over drawer with horizontal icon-and-label rows and backdrop scrim.

### Split Landscape Modals & Thermal Receipt Preview (Signature Components)
- **Drink Customization Modal (`#item-customization-modal`):** `50rem` max-width 2-column split. Left column (`18.5rem`) displays the 4:3 drink photo, item title, category badge, and 2-column radio cards for `Size` (`Regular` / `Large +₱25.00`) and `Temperature` (`Hot` / `Iced`). Right column displays scrollable `Add-ons for Drinks` checkboxes (highlighting in `#DCFCE7` with `#15803D` border when checked), `Special Instruction` input, and the `Add to Order` footer button showing the live computed item price.
- **Checkout Tender Modal (`#tender-modal`):** `54rem` max-width 2-column split. Left column (`20.5rem`) shows `Order Summary` with thumbnail item rows, the dashed `Apply PWD / Senior Citizen discount (20%)` toggle, and itemized Subtotal / Discount / VAT / Total Amount (`#15803D`). Right column shows tactile `Cash` and `QR — GCash / Maya` selection cards, the `Amount Received (₱)` input with quick bill chips (`Exact`, `₱100`, `₱200`, `₱500`, `₱1,000`), live `Change Due`, and `Confirm Payment`.
- **Payment Successful & Thermal Receipt Modal (`#receipt-modal`):** `52rem` max-width 2-column split. Left column centers the Emerald check badge, `Payment Successful!`, invoice number, `TOTAL AMOUNT PAID` (`2rem` Emerald), Amount Received / Change Due / Payment Method breakdown, and `+ New Order` / `Print Receipt` actions. Right column provides a live `58mm` / `80mm` width switcher and a monospace thermal paper sheet (`#receipt-body`).

## Do's and Don'ts

### Do:
- **Do** keep all functional labels, badges, and navigation text at or above `11px` (`0.6875rem`) and body/input text at or above `13px`–`14px`.
- **Do** apply `tabular-nums` to every price, quantity, discount, VAT line, clock readout, and ticket number.
- **Do** separate two-column modal panes with a single `1px solid #DDE2DD` divider inside a single `.modal-card` container.
- **Do** preserve all DOM IDs, `data-*` attributes, and PostgreSQL API payload shapes across `pos-app` and `unified-login`.

### Don't:
- **Don't** place uppercase eyebrow/kicker labels above `h1`–`h3` headings.
- **Don't** nest bordered, rounded, shadowed cards inside outer cards or modals.
- **Don't** use decorative two-axis CSS grid-line backgrounds on application or authentication surfaces.
- **Don't** hide radio or checkbox `<input>` elements with `pointer-events: none` beneath sibling text spans in a way that blocks direct input activation.
