# Setup: Google sign-in, API-access gating & admin

This adds accounts (Google), an admin-granted **API access** gate on the
compute-consuming routes (build / run / train / eval / generate), and an admin
panel to manage users. There is **no billing** — users without access are told to
text **Adi at 678-313-6244** to request it, and an admin grants access from the
panel.

## 0. Install (already done in this branch)

```bash
npm install        # next-auth, drizzle, @neondatabase/serverless, etc.
```

## 1. Environment variables

Add these to `.env.local` (gitignored). Keep the existing HUD/SYNTH vars.

```bash
# --- Database (Neon Postgres) ---
DATABASE_URL=postgresql://<user>:<pass>@<host>/<db>?sslmode=require

# --- Auth.js / Google OAuth ---
AUTH_SECRET=            # generate with: npx auth secret
AUTH_GOOGLE_ID=         # Google OAuth client id
AUTH_GOOGLE_SECRET=     # Google OAuth client secret
AUTH_URL=http://localhost:3000   # canonical origin; prod URL in production

# --- Admin allowlist (comma-separated emails) ---
ADMIN_EMAILS=aneesh.iyer29@gmail.com
```

That's the full list — no Stripe keys needed.

## 2. Database (Neon + Drizzle)

1. Create a free Postgres database at https://neon.tech and copy the **pooled**
   connection string into `DATABASE_URL`.
2. Apply the schema:

   ```bash
   npm run db:migrate     # applies drizzle/0000_*.sql
   ```

   (If you change `src/db/schema.ts` later: `npm run db:generate` then `db:migrate`.)

## 3. Google OAuth

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: set User
   Type = External and add yourself under **Test users** (otherwise Google blocks
   sign-in before it reaches the app).
2. **Credentials** → Create OAuth client ID → **Web application**.
   - Authorized JavaScript origins: `http://localhost:3000` (+ your prod origin)
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://YOUR_PROD_DOMAIN/api/auth/callback/google`
3. Copy the client id/secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

The first time an `ADMIN_EMAILS` address signs in, it's auto-promoted to `admin`
(admins always have API access).

## 4. Run

```bash
npm run dev
```

- Sign in via the header → **Sign in with Google**.
- A non-admin **without access** who tries to Build / Run / Train / or use AI
  assist gets: _"API access required. Text Adi at 678-313-6244 to request
  access."_ The header shows a **Request access** chip linking to `/account`,
  which explains the same.
- As an **admin**, open **/admin → Users → Manage** and click **Grant access**
  for that user. They can now use every gated action immediately (no re-login
  needed — access is read per request).
- Admins can also suspend accounts, change roles, and toggle per-user feature
  flags from the same page.

## How it fits together

| Concern        | Where |
|----------------|-------|
| Auth config    | `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts` |
| Route guard    | `proxy.ts` (optimistic), `src/lib/dal.ts` (enforced) |
| DB schema      | `src/db/schema.ts` (`users.apiAccess`), migrations in `drizzle/` |
| Access gate    | `src/lib/access.ts` (`checkApiAccess`, `gatedJobPOST`, `jobGET`, `ACCESS_MESSAGE`) |
| Gated routes   | `src/app/api/{deploy,run,train,eval,generate}/route.ts` |
| Account page   | `src/app/account/` (shows access status / how to request) |
| Admin          | `src/app/admin/**`, `src/app/admin/actions.ts` (`setApiAccess`, …) |

## The access rule

A user may use a gated route when they are **signed in**, **not suspended**, and
either an **admin** or have **`apiAccess = true`** (`hasApiAccess` in
`src/lib/access.ts`). Everyone else gets a `403` with the contact message. The
contact number lives in `ACCESS_CONTACT` in `src/lib/access.ts` (and a fallback
copy in `src/lib/apiError.ts`) — change it in those two spots if it ever moves.

## Known limitation (v1)

- **Projects still live in browser localStorage** (`src/lib/library.ts`), not the
  DB — accounts/access/admin are fully server-side, but project sync across
  devices is a separate follow-up.
