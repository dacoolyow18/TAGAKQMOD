# Tagak Coffee

Web system for Tagak Coffee: customer ordering, POS, admin dashboard, and one
unified login. The backend is Express + PostgreSQL and serves every app from
the same origin.

> **Migration status:** the app is being prepared to leave Vercel + Supabase.
> See `docs/PRE_MIGRATION/` for the audit, local setup, database schema and
> readiness notes. The Vercel section at the bottom is retained only as a
> record of the previous deployment.

## Apps

| App | URL |
| --- | --- |
| Login | `/` or `/unified-login/index.html` |
| Admin | `/admin-app/index.html` |
| POS | `/pos-app/index.html` |
| Customer | `/customer-app/index.html` |

The server serves `index.html` explicitly. Folder URLs such as `/admin-app/`
return 404 by design, so always include `index.html` when opening an app
directly.

## Local setup

Requirements: Node.js 22 LTS (the `engines` field and Dockerfile target 22.x)
and PostgreSQL 16+.

1. Create a database and copy the environment file:

   ```bash
   cp .env.example .env
   ```

2. Configure a persistent `PIN_HMAC_KEY` (32 random bytes represented by 64 hexadecimal characters). Keep it with the local database backup. Existing staff PINs are converted during migration 018 and require the same key for subsequent login. Set `DATABASE_URL` in `.env`, plus `SUPER_ADMIN_EMAIL` and
   `SUPER_ADMIN_PASSWORD` for the first admin account.

3. Install dependencies and prepare the database:

   ```bash
   npm ci
   npm run db:migrate
   npm run db:seed
   ```

4. Start the server:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000`.

### Local database safety

`db/connection.js` refuses a non-local `DATABASE_URL` when `NODE_ENV` is not
`production` unless `ALLOW_REMOTE_DB=true` is set. This prevents local work
from writing to the hosted production database by accident. Leave
`ALLOW_REMOTE_DB` unset for normal development.

The reset-based test suite only accepts a disposable `localhost:5433/tagak_test`
database, configured with `TEST_DATABASE_URL`.

### Phone on the same Wi-Fi

Start the server on the PC, find the PC's LAN IP (`ipconfig`), allow TCP port
3000 through the firewall, then open `http://<PC-LAN-IP>:3000` on the phone.
The phone and PC must be on the same network and client isolation must be off.

## Deploy on Render (candidate, not executed)

The repository includes `render.yaml` and a `Dockerfile`. Nothing has been
deployed as part of the migration preparation.

1. In Render, choose **New > Blueprint** and select this repository.
2. Render creates the PostgreSQL database and the web service.
3. Enter `SUPER_ADMIN_PASSWORD` when prompted. `SUPER_ADMIN_EMAIL` defaults to
   `tagakcafe@gmail.com`.
4. Deploy. On every boot the container runs migrations, creates the Super Admin
   if missing (seed is idempotent), then starts the server.

After deployment, open the service URL and log in with the Super Admin email
and password. `PUBLIC_BASE_URL` is detected automatically from
`RENDER_EXTERNAL_URL`; set it manually if you use a custom domain.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. Remote hosts use TLS; append `?sslmode=require` only if your provider requires it. |
| `PORT` | No | HTTP port. Defaults to `3000`; hosting platforms set it automatically. |
| `PUBLIC_BASE_URL` | No | Public HTTPS origin, used for Google OAuth redirects and secure cookies. Auto-detected on Render/Railway; set it explicitly on other hosts. |
| `DB_POOL_MAX` | No | Maximum database pool size. Defaults to 10; serverless hosts should use 2-3. |
| `TRUST_PROXY` | No | Set to `1` when a reverse proxy terminates HTTPS so `req.ip` reflects the client address. |
| `ORDER_LISTEN_DATABASE_URL` | No | Session connection for LISTEN/NOTIFY when `DATABASE_URL` is a transaction pooler. |
| `SSE_LIFETIME_MS` | No | Cap on a server-sent-events response lifetime. Empty/0 keeps it open. |
| `SUPER_ADMIN_EMAIL` | Yes for seeding | Email for the first Super Admin. |
| `SUPER_ADMIN_PASSWORD` | Yes for seeding | Password for the first Super Admin. Change it after the first login. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | No | Enables Google sign-in. See `GOOGLE_SSO_SETUP.md`. |

### Docker or another host

```bash
docker build -t tagak-system .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="postgres://user:pass@host:5432/tagak?sslmode=require" \
  -e SUPER_ADMIN_EMAIL="tagakcafe@gmail.com" \
  -e SUPER_ADMIN_PASSWORD="replace-me" \
  tagak-system
```

Any host that can run a Docker image and reach PostgreSQL works. Ensure the
platform provides a public HTTPS URL, then set `PUBLIC_BASE_URL` to it if it is
not auto-detected.

### Uploaded images

Menu and carousel images are written to `server/uploads/`. Container filesystems
are usually ephemeral, so images disappear on redeploy unless you mount
persistent storage at `server/uploads` (for example, a Render disk) or move
uploads to object storage.

### Google sign-in

Google is optional and disabled when the client ID/secret are empty. To enable
it, set `PUBLIC_BASE_URL` to the deployed HTTPS URL and register
`https://your-domain/auth/google/callback` as an authorized redirect URI in the
Google Cloud console. Google does not accept private LAN IPs such as
`192.168.x.x`, so phone testing over Wi-Fi must use email/password login.

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the server (runs pending migrations first). |
| `npm run db:migrate` | Apply pending SQL migrations. |
| `npm run db:seed` | Create role permissions and the Super Admin if missing. |
| `npm test` | Run the Playwright API and browser tests. |

## Legacy Vercel Xendit test deployment

This section documents the previous deployment. It is not part of the new
provider-independent setup and should not be used for new work. The server no
longer reads `vercel.json` at runtime.

Use the private repository TAGAKCAFE/TAGAKSYSTEM, branch main, Vercel team tagak-cafe, and repository root as the Vercel Root Directory. This private repository starts at the local tagak-coffee folder. Use the Express preset and Node.js 22.x. The build copies only browser assets to public/. The default route opens customer ordering.

Use a separate Supabase demo project. Disable the Supabase Data API for the demo application tables since Express implements authentication and authorization. Create two dedicated Storage buckets. Set the published image bucket to public and the staging bucket to private. For each bucket set a 5 MiB limit and allow only image/jpeg, image/png, and image/webp. Give anon and authenticated roles no write policies on either bucket and no read policies on staging. Check existing policies on storage.objects for broad grants. Staff receive a signed upload URL for staging. The server decodes the image and publishes re-encoded bytes. Use fresh buckets for new installations. On upgrades, review previously published images and allow pre-upgrade upload grants to expire before treating legacy files as verified.

### Production controls

Set a Vercel project budget with alerts. Enable automatic pause only at a limit where a service interruption is acceptable. On Supabase Pro enable Spend Cap for covered usage and review separately billed resources. Keep preview databases, buckets and Xendit credentials separate. Register only the canonical HTTPS callback URL, disable unused signup providers and restrict auth redirects to the intended origins. Set ALLOW_PAYMENT_SIMULATION=true only in an isolated preview or local demo. The production handler disables simulation. XENDIT_DAILY_CHECKOUT_LIMIT bounds daily creation attempts per database.

After migrations run `node db/check-security.js` using a session connection to the intended Tagak database. This read-only check expects a dedicated public schema and reports missing migrations, missing RLS and effective client grants. A hosted project also requires dashboard verification of exposed schemas, storage policies, redirect URLs and spend controls. Check your full source clone with `gitleaks git --redact --log-opts="--all" .` before publishing. Rotate exposed credentials at their issuers and reset any staff PINs previously returned through account endpoints.

### Settings

| Vercel runtime variable | Source |
| --- | --- |
| DATABASE_URL | TLS connection to the demo project's transaction pooler |
| DATABASE_CA_CERT | Supabase CA in PEM format. With this setting, omit SSL query parameters from DATABASE_URL so the driver uses this CA and verifies the host. |
| PUBLIC_BASE_URL | Stable HTTPS domain for this deployment |
| XENDIT_SECRET_KEY | Xendit development secret |
| XENDIT_WEBHOOK_TOKEN | Xendit test callback verification token |
| XENDIT_QR_ENABLED | false until the webhook endpoint is verified, then true for the demo |
| SUPABASE_URL | Demo project's HTTPS API origin |
| SUPABASE_SECRET_KEY | Server-only demo project secret with Storage access |
| SUPABASE_STORAGE_BUCKET | Public bucket for published images |
| SUPABASE_STORAGE_STAGING_BUCKET | Separate private image staging bucket with enforced size and MIME limits |
| GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET | Optional for Google staff sign-in. Register PUBLIC_BASE_URL/auth/google/callback as the OAuth redirect URI. |

For one-time setup, verify the demo project reference in both the connection details and dashboard. Set MIGRATION_DATABASE_URL to its direct connection or session pooler, then run the following from tagak-coffee.

```sh
node db/migrate.js --direct
```

Verify schema_migrations includes every SQL file in db/migrations from this release before enabling traffic. Use DATABASE_URL for the verified demo database and set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD privately before running npm run db:seed. Then create a demo branch and menu through the admin and POS interfaces. Store the password outside the deployed runtime. The reset-based test suite is for disposable local PostgreSQL only.

After deployment, verify the landing page and staff login. An unsigned POST to https://<stable-domain>/api/webhooks/xendit should return 401 from Express. Ensure Xendit can reach the route without Vercel Deployment Protection. Register payment.capture, payment.failure, and payment_request.expiry in Xendit test mode. The webhook creates the paid order and preparation ticket. Customer tracking and POS orders receive committed order changes through PostgreSQL notifications and server-sent events. When using a transaction pooler other than Supabase, set ORDER_LISTEN_DATABASE_URL to a session connection for the listener.

### Staff credential migration

Generate a separate 32-byte random hex value for `PIN_HMAC_KEY` in each environment. For local development, this command appends a fresh value to the ignored `.env` file if it lacks this variable, without printing the secret.

```powershell
node -e "const fs=require('node:fs'),c=require('node:crypto'); const p='.env'; const src=fs.existsSync(p)?fs.readFileSync(p,'utf8'):''; if(!/^PIN_HMAC_KEY=.+$/m.test(src))fs.appendFileSync(p,'\nPIN_HMAC_KEY='+c.randomBytes(32).toString('hex')+'\n');"
```

Set the same key in the migration runner and application secret stores for a given database; keep a protected backup. Pause old application instances, take a protected database backup, apply migrations, and start the matching release. Migration 018 converts existing staff PINs in one database transaction and invalidates their existing sessions. Staff can use their existing PINs after migration. Reset previously exposed PINs through Admin. Restoring an earlier release requires the matching pre-migration database backup. Replacing the key later requires resetting staff PINs or a coordinated credential migration.

### Switch staff login to Supabase Auth

Apply migration 021 before selecting the provider. Disable public signups, configure the exact HTTPS site and redirect URLs, and invite staff to set a Supabase password. Create the corresponding Tagak staff profile with the correct email, role and branch. Using a trusted direct database connection in MIGRATION_DATABASE_URL, link each confirmed user explicitly:

    node scripts/link-auth-user.js <Tagak-account-ID> <confirmed-Supabase-user-UUID>

Check that every intended active staff profile, including a Super Admin, has a link. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, then set AUTH_PROVIDER=supabase and deploy the matching server and client together. Verify admin and POS sign-in, logout, and account deactivation in preview first. The server verifies the Supabase access token on protected requests; staff sign in again when it expires. Local credentials continue to apply until the provider switch. Keep old sessions revoked when changing provider.
