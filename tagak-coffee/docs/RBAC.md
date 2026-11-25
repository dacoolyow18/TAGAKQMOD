# Admin and POS permissions

The source of authority is the employee's current account role and its row in PostgreSQL `role_permissions`. The [Admin toggle definitions](../admin-app/js/permissions.js) supply the labels and keys for individual updates. Saving a toggle changes one JSON property atomically. The existing role assignments, seed defaults and app entry rules still apply.

| Admin setting | Permission | Controlled features |
| --- | --- | --- |
| Orders / View Orders | `view_orders` | Orders navigation, board, detail, order list API, live notifications and local order history. |
| Orders / Manage Orders | `manage_orders` | Status transitions on visible orders. Branch recovery also requires the existing Manager role and terminal access. |
| Orders / Void Orders | `void_orders` | Void controls and cancellation, together with View Orders and Manage Orders. |
| Analytics / View Analytics | `view_analytics` | Charts, financial summaries and branch-scoped reporting data. Reports can use completed sales when order history or inventory management is disabled. |
| Analytics / Export Reports | `export_reports` | The download action and server-generated PDF or printable fallback. Requires View Analytics. |
| Menu & Recipes / View, Edit | `view_menu`, `edit_menu` | The management list and recipes. Editing also controls images, availability, archiving, restoring and saving recipes. |
| Supplies / View, Edit | `view_supplies`, `edit_supplies` | Inventory and price history. Editing also controls creation, updates, price entries and deletion. Recipe and add-on forms can request ingredient choices separately. |
| Add-ons / View, Manage | `view_addons`, `edit_addons` | Add-on management. Editing controls creation, supply links, enablement and deletion. |
| Tools / View, Edit | `view_tools`, `edit_tools` | Storefront tools and carousel changes. Saving pricing and preparation settings also requires the existing `edit_menu` authority. |
| Cash Drawer / Access Cash Drawer | `access_cash_drawer` | The cash drawer dialog and pay-in/pay-out writes. Analytics uses ledger entries in financial reports. |
| POS Access / Access POS Terminal | `access_terminal` | Register, checkout, store status, offline preparation and replay. Register staff can read the sale catalog independently of management permissions. |
| Admin / Manage User Accounts | `manage_users` | Employee, administrator and branch management within the actor's role hierarchy. |
| Admin / Manage Roles & Permissions | `manage_roles` | Reading and editing the role matrix. Admins may change employee roles' permissions. Only Super Admin may change the Admin row. The Super Admin row is locked. |

The existing `fulfill_own_offline_orders` exception applies to the employee's own eligible emergency sales. It requires View Orders and the original shift's fulfillment authority. It does not grant branch-wide order management.

## Active sessions and disconnected registers

Protected requests resolve the current database permissions. The order event stream also checks authorization before sending a ticket notification. Connected POS and Admin pages refresh authorization on focus, reconnect and a 30-second timer. A revoked POS view closes and the first permitted view opens. An open register cart survives an unrelated permission change.

Enrolled registers retain their existing expiring offline shift. A register can learn about a remote change only after it reconnects. Upon reconnect it updates its cached permissions and checks current authority before replaying transactions. Pending receipts remain available for authorized recovery. A saved receipt or an earlier download already in a user's possession cannot be recalled.

## Implementation files

| Area | Files |
| --- | --- |
| Admin | `admin-app/index.html`, `admin-app/js/admin.js`, `admin-app/js/permissions.js` |
| Session and authorization | `auth.js`, `server/auth/routes.js`, `server/auth/sessions.js`, `server/middleware/requireSession.js`, `server/routes/permissions.js` |
| POS | `pos-app/index.html`, `pos-app/css/styles.css`, and `app.js`, `dashboard.js`, `data.js`, `inventory.js`, `offline-pos.js`, `orders.js`, `register.js`, `settings.js` under `pos-app/js/` |
| Server features | `server/orderEvents.js`, `server/offlinePos.js`, `server/salesReport.js`, and `addOns.js`, `branches.js`, `carousel.js`, `cashLogs.js`, `menuItems.js`, `offlinePos.js`, `orders.js`, `settings.js`, `supplies.js` under `server/routes/` |
| Packaging and regression tests | `scripts/build-public.js`, `tests/api/pos-report.spec.js`, `tests/api/rbac-views.spec.js`, `tests/e2e/pos-offline.spec.js`, `tests/e2e/pos-rbac.spec.js` |

## Verification

The full local `npm test` run rebuilt the application and finished with **190 passed, 36 skipped, 0 failed** across API, database, desktop and mobile projects. Regression cases cover revocation and restoration with existing staff and Admin sessions, protected hierarchy rows, read-only management views, report downloads, separate analytics access, offline refresh and replay, and end-to-end checkout.
