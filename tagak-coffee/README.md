# Tagak Café application guide

## Install locally

Use Node.js 22.x (the declared and Docker target) and PostgreSQL 16 or later. Start in `tagak-coffee/`. Create an empty local database owned by the application role. Copy `.env.example` to `.env` and set values locally.

1. Set `DATABASE_URL` to the local database, `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` for initial seeding, and a persistent `PIN_HMAC_KEY` of 64 random hexadecimal characters. Changing the PIN key invalidates existing verifiers.
2. Run `npm ci`, `npm run db:migrate`, then `npm run db:seed`. Execute them only against the intended database. The phone migration stops on invalid or duplicate existing values. Use `db/audit-account-phones.sql` for a read-only preflight.
3. Run `npm start`. Open `http://localhost:3000/` for customers, `/login` for unified sign-in, `/pos` for the register and `/admin` for administration. The default installation requires branch and menu setup.
4. Configure a separate disposable database with `TEST_DATABASE_URL` on localhost port 5433 named `tagak_test`. The suite repeatedly rebuilds its schema. Install the Playwright Chromium browser if necessary and run `npm test`.

## Roles and environment

Super Admin and Admin use the administrative interface. Manager, Cashier and Barista use branch and role permissions for register, fulfillment, inventory, cash and reporting operations. Some actions require multiple permissions. See [RBAC](docs/RBAC.md).

The [configuration template](.env.example) lists the settings. Set `PUBLIC_BASE_URL` to the external HTTPS origin on hosted services. Configure `PORT`, `TRUST_PROXY`, database pool size, optional listener/migration connections and certificate settings for the host. Keep local remote-database overrides disabled during ordinary development. Optional Google OAuth and Supabase identity/storage need their respective provider settings. Optional Xendit development QR requires its enable flag, server secret and webhook verification token. Cash ordering operates independently. Keep payment simulation disabled outside its intended demonstration environment.

## Deployment and operations

The Dockerfile installs locked production dependencies, builds public assets and runs migration, seed and server on startup. The Render blueprint describes the service, upload disk, health check and secret bindings. A configured PostgreSQL service such as Neon supplies the database connection. The submission audit verified public API connectivity but could not establish the hosting provider from that response. An existing service should be updated only after reviewing migration preflight, storage persistence, environment and rollback arrangements. The included serverless entry point supports a separate hosting path.

[Existing staging site](https://tagak-staging.onrender.com) · [System overview and assessment links](../README.md)
