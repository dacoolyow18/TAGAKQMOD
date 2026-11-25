# Google sign-in setup (admin unified login)

The admin login page offers "Log in with Google". Google handles the sign-in, then the server exchanges the code using the client secret and checks the Google email against the `accounts` table in PostgreSQL.

## 1. Create the OAuth client in Google Cloud Console

1. Open https://console.cloud.google.com/ and create or select a project.
2. Go to **APIs & Services → OAuth consent screen**. Choose **External** (or **Internal** for a Google Workspace domain), fill in the app name and support email, and add the scopes `openid`, `.../auth/userinfo.email`, and `.../auth/userinfo.profile`.
3. While the app is in *Testing*, add each admin's Google account under **Test users**.
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
5. Application type: **Web application**.
6. Under **Authorized redirect URIs**, add the callback URL for each environment:
   - Local: `http://localhost:3000/auth/google/callback`
   - Production: `https://your-domain.example/auth/google/callback`
7. Click **Create** and copy the **Client ID** and **Client secret**.

## 2. Configure and run the server

Set these environment variables before starting the server. Never commit the secret.

| Variable | Required | Example |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Yes | `123-abc.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Yes | `GOCSPX-...` |
| `PUBLIC_BASE_URL` | Production | `https://your-domain.example` (must match the redirect URI host) |
| `PORT` | No | `3000` (default) |

PowerShell example:

```powershell
$env:GOOGLE_CLIENT_ID = "your-client-id.apps.googleusercontent.com"
$env:GOOGLE_CLIENT_SECRET = "your-client-secret"
cd tagak-coffee
npm start
```

Then open http://localhost:3000/unified-login/index.html?app=admin.

## 3. How admin matching works

- The `accounts` table lists the admin accounts allowed to sign in with Google. The account needs an `email`, a `role` of `Admin` or `Super Admin`, and `active = true`.
- The Google email is matched case-insensitively. Only verified Google emails are accepted.
- If no admin matches, the user is returned to the login page with: "No admin account matches this Google email."

Add or update admin accounts in the admin Employees page (or the `accounts` table) to control who can sign in with Google.
