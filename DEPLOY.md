# Deploying Rankflix (free tier: Render + Supabase)

This deploys the whole app for $0/month: the API and frontend on Render's free plan, Postgres +
Auth on Supabase's free plan, kept awake by a free GitHub Actions cron ping (see
`.github/workflows/keep-alive.yml`).

## 1. Supabase (already set up for Auth) - get the Postgres connection string

You're already using this project for Supabase Auth (`VITE_SUPABASE_URL`). Reuse the same
project's Postgres database instead of standing up a separate one:

1. Supabase dashboard -> **Project Settings -> Database -> Connection string**.
2. Use the **Session pooler** string (port `5432`), not the Transaction pooler (port `6543`) -
   the API is a long-lived server (not serverless functions), and EF Core's prepared statements
   need the Transaction pooler's connection affinity, which the Session pooler provides.
3. Convert it to the Npgsql key=value format EF Core expects, e.g.:
   ```
   Host=aws-0-<region>.pooler.supabase.com;Port=5432;Database=postgres;Username=postgres.<project-ref>;Password=<your-db-password>;SSL Mode=Require
   ```
   This is the value for the `ConnectionStrings__RankflixDatabase` env var below. The API runs
   `dbContext.Database.Migrate()` on startup, so the schema provisions itself automatically on
   first deploy - no manual migration step needed.

## 2. Render - deploy via Blueprint

1. Push this repo to GitHub (if not already).
2. Render dashboard -> **New + -> Blueprint** -> select this repo. Render reads `render.yaml`
   at the repo root and creates two services: `rankflix-webapi` (Docker) and `rankflix-webapp`
   (static site).
3. During setup, Render prompts for each `sync: false` env var:

   **rankflix-webapi**
   | Key | Value |
   |---|---|
   | `ConnectionStrings__RankflixDatabase` | From step 1 |
   | `Supabase__Url` | `https://<project-ref>.supabase.co` |
   | `Supabase__SecretKey` | Project Settings -> API Keys -> **secret** key (`sb_secret_...`). Server-side only. |
   | `Tmdb__ApiKey` | Your TMDb API key |
   | `Cors__AllowedOrigins__0` | The frontend's Render URL (fill in *after* step 4, once you know it - e.g. `https://rankflix-webapp.onrender.com`) |

   **rankflix-webapp**
   | Key | Value |
   |---|---|
   | `VITE_API_URL` | The API's Render URL (e.g. `https://rankflix-webapi.onrender.com`) |
   | `VITE_SUPABASE_URL` | Same as `Supabase__Url` above |
   | `VITE_SUPABASE_ANON_KEY` | Project Settings -> API Keys -> **publishable** key (`sb_publishable_...`) - safe to expose to the browser |

4. Both services will deploy. Note their `*.onrender.com` URLs, then go back and fill in
   `Cors__AllowedOrigins__0` on the API service (Render dashboard -> service -> Environment) if
   you didn't know it yet in step 3, and redeploy the API.

The very first person to sign up on the deployed site automatically becomes admin (see
`SupabaseClaimsTransformation.cs`) - no manual DB step needed.

## 3. Keep both services (and the free Postgres) alive

Render's free web services spin down after 15 minutes of no traffic (next request pays a
30-60s cold-start), and Supabase pauses free Postgres projects after 7 days of no database
activity. `.github/workflows/keep-alive.yml` pings the API's `/health` endpoint (which runs a
real `SELECT 1`, not just a 200) every 10 minutes to prevent both, for free.

To enable it: repo **Settings -> Secrets and variables -> Actions -> New repository secret**,
name `RANKFLIX_API_URL`, value = the API's Render URL (no trailing slash), e.g.
`https://rankflix-webapi.onrender.com`. The workflow runs automatically on that schedule once
merged to the default branch (GitHub Actions cron only fires from the default branch).

## 4. Supabase Auth settings for production (optional but recommended)

Under **Authentication -> URL Configuration**, set the **Site URL** to the deployed frontend
URL. This app never sends real email (usernames are mapped to a synthetic
`@rankflix.local` address - see `src/rankflix-webapp/src/lib/syntheticEmail.ts`), so no
redirect-URL configuration is required for login/signup itself.
