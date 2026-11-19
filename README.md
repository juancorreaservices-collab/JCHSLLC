# Kuadra

Estimates, invoices, projects and bookkeeping for a home-services business.
One page (`public/index.html`) plus a few serverless functions, deployed on Vercel.

| Piece | What it does |
|---|---|
| `public/index.html` | The whole app (generated; do not edit by hand) |
| `public/runtime.js` | Login, live data sync, files, and the bridge to the `/api` functions |
| `api/ai.js` | Builds estimates and invoices from text, voice, photos and PDFs (Claude API) |
| `api/gmail.js`, `api/google.js` | Sends and reads email through the owner's Gmail (Google OAuth) |
| `api/commas.js` | Creates a payment link per invoice and checks whether it was paid (Commas) |
| `api/sign.js`, `public/e.html` | Public page where a client reviews an estimate, reads the agreement and signs |
| `api/blob.js` | Serves private files (receipts, photos) through short-lived signed links |
| `api/setup.js`, `api/signup.js` | First-run setup: create the tables and the accounts |
| `supabase/schema.sql` | Database tables, access rules and the private file bucket |

## Environment variables (Vercel → Settings → Environment Variables)

| Name | Needed for | Where it comes from |
|---|---|---|
| `SUPABASE_URL` | everything | Supabase → Project Settings → API |
| `SUPABASE_ANON_KEY` | everything | same page, "anon public" |
| `SUPABASE_SERVICE_ROLE_KEY` | files, AI, Gmail, Commas | same page, "service_role" (keep secret) |
| `ANTHROPIC_API_KEY` | AI | console.anthropic.com → API keys |
| `GMAIL_APP_PASSWORD` (optional `GMAIL_USER`) | Gmail, simple way | Google Account → Security → App passwords (needs 2-Step Verification) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Gmail, OAuth way | Google Cloud → Credentials → OAuth client (Web). Redirect URI: `https://<your-domain>/api/google` |
| `COMMAS_API_KEY` | payment links | Commas dashboard → API keys |

The app works with only the three Supabase values; each of the others switches on its feature.

## First run

The site sets itself up. With the Supabase integration for Vercel connected (it provides
`POSTGRES_URL` and the Supabase keys), the first visit creates the tables from
`supabase/schema.sql` and shows "create the owner account". No confirmation email is needed.
After that, only emails listed under Cuenta → Usuarios can create an account.

Without `POSTGRES_URL`, run `supabase/schema.sql` once in Supabase → SQL Editor.
