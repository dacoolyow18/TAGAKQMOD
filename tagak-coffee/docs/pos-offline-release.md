# POS emergency cash release

## Before manual deployment

1. In Render, verify that tagak-staging is linked to TAGAKCAFE/TAGAKSYSTEM on `deploy/render-neon` and record the live deploy's Git SHA. The staging parent used for this integration is `8d7d5280819a4c994ec428d807d69abd95508be8`. Compare that SHA with the candidate's base using `git merge-base --is-ancestor LIVE_SHA HEAD`. Review any intervening staging commits. In the service's Settings, set Auto-Deploy to Off before publishing changes to a linked branch.
2. On the Neon database used by staging, check the migration ledger with a read-only query. Confirm the connection belongs to the live service. Keep credentials out of screenshots and logs.

   ```sql
   SELECT name, applied_at FROM schema_migrations
   WHERE name IN ('021_managed_staff_identity.sql','022_pos_offline_cash.sql')
   ORDER BY name;
   ```

3. Verify 021 is present and that any existing 022 matches this release. Confirm the normal database recovery point. The existing Docker entrypoint runs migrations and the configured seed before starting the server. Its seed configuration must already match the live identity provider. Never use the Playwright reset or seed scripts on this connection.
4. Push the tested local staging branch with `git push origin deploy/render-neon:deploy/render-neon`. If Git rejects the push, fetch and retest the integration against the new staging tip. In Render's Deploys page choose **Manual Deploy → Deploy a specific commit** and paste the tested candidate's full SHA. This is a separate operator action. Leave the existing database, authentication and payment configuration in place.

## Enable one register

The new `POS_OFFLINE_REGISTERS` variable defaults to empty. Only enrolled branch/device pairs can obtain a shift. Use a dedicated HTTPS browser profile with sufficient free disk space. Open the POS, sign in and expand **Register online** to copy the displayed enrollment pair. Configure that exact `branch-id/device-uuid` in Render. Separate additional pairs with commas. Apply the setting during an approved release. Reopen the POS online and verify **Offline ready**, the assigned branch, the cashier and the shift end time. Confirm persistent storage is granted on pilot devices. A cleared browser profile has a different device ID.

Sign in while online at the beginning of each shift. When the backend is unavailable, use the cached POS entry URL on that same device. Reopening a prepared register resumes the unlocked cashier shift until the original session expires. Physical access to that profile is equivalent to access to the register during that shift. No provider tokens or cashier credentials are copied into its offline database.

## Cash reconciliation

Keep the local receipt number for each sale. The register writes the cash receipt before displaying success. Expand the connection indicator to see the pending count and ticket mappings. After reconnection, leave the POS open with the original employee signed in. **Retry synchronization** reuses the original IDs. Re-entering a paid order as a new sale creates a separate transaction.

A branch Manager with order-management permission can use **Review branch recovery** on the original register to post stranded paid receipts with their original employee attribution. For an inventory discrepancy, check the recipe usage and actual stock, correct inventory through the existing authorized workflow, then apply the missing usage once. Never delete the browser profile to clear an error.

## Rollback

Remove enrollment pairs to stop issuing new shifts. A disconnected register can continue selling until its cached shift expires. Keep the compatible server import endpoints, service worker and assets available while draining every register. Check each device's local history and compare the cash receipts, canonical tickets, tender, and change. Resolve stock discrepancies. An absent register is still outstanding. Roll back application code only after all registers are accounted for. Leave the additive migration and audit records in place. Browser eviction or physical loss before upload can destroy the only copy of an offline receipt.
