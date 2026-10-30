# Subdesk

A Reddit account-based task platform. People create an account, submit their Reddit profile, and
an administrator reviews it by hand. Once approved, they see which subreddits and tasks their
verified account qualifies for and can apply to them. Rewards live in an internal ₹ ledger.

It is a working application, not a mockup: real sign-up and sessions, a real database, real
server-side permission checks, and a test suite that runs against the database.

> **What it deliberately does not do.** There are no payments of any kind: no UPI, bank transfer,
> payment gateway, deposits, withdrawals or crypto. The wallet is a ledger of balances and
> transactions only. The site never asks for a Reddit password, never invents Reddit data, and
> never marks an account "verified" unless Reddit (or a named administrator) actually supplied the numbers.

---

## Contents

1. [Features](#features)
2. [How verification works](#how-verification-works)
3. [Local setup](#local-setup)
4. [Database and migrations](#database-and-migrations)
5. [Create the first administrator](#create-the-first-administrator)
6. [Reddit API setup](#reddit-api-setup)
7. [Email setup](#email-setup)
8. [Deployment](#deployment)
9. [Things that need external credentials or manual setup](#things-that-need-external-credentials-or-manual-setup)
10. [Security model](#security-model)
11. [Testing](#testing)
12. [Limitations](#limitations)
13. [Project layout](#project-layout)

---

## Features

**For users**

- Sign up with email, password and username; email verification; forgot/reset password.
- Submit a Reddit profile link. The link is normalised live in the browser and again on the server;
  anything that is not a Reddit profile is rejected with a specific message.
- Application status tracker with the seven statuses: Not Submitted, Pending Verification,
  Pending Admin Review, Approved, Rejected, Needs More Information, Suspended.
- Eligibility page: every configured subreddit, shown as eligible or unavailable, with the exact
  requirement that is not met ("Comment karma: at least 2,000 required, yours is 500").
- Task marketplace limited to tasks the verified account qualifies for, task details, apply with an
  optional note, and "My tasks".
- Wallet: balance, pending/earned totals and a full transaction history. It states plainly that it is not a bank.
- Notifications, profile and settings (username, password), account deletion request, help/FAQ,
  editable privacy and terms pages.

**For administrators**

- Application queue with search and filters; one-click link that opens the Reddit profile in a new tab.
- Decisions: approve, reject (reason required), request more information, mark for manual
  verification, suspend, reinstate. Every decision is stored with who, when and why.
- Manual verification: the administrator reads the profile, enters creation date and karma, and
  records an evidence note. These values are labelled "Entered by an administrator" everywhere they appear.
- Subreddit rules (minimum age, comment karma, post karma, extra requirements, manual-review flag),
  categories, tasks with rewards, task applicants (under review, accept, reject, complete).
- Rewards are credited only when an administrator marks a task completed and ticks the credit box.
- Users: search, block/reactivate (ends all sessions), mark email verified, process deletion requests.
- Wallet: totals, ledger, and manual credits/debits with a required reason and an idempotency key.
- Platform settings (global minimums, whether applications and task applications are open, ownership
  code requirement, announcement banner) and an append-only audit log.
- Granular permissions: `review_applications`, `manage_tasks`, `manage_users`, `wallet_adjust`, `manage_settings`.

**Platform minimums (all three are required, not two out of three)**

| Requirement | Default |
|---|---|
| Account age | at least 3 months |
| Comment karma | at least 100 |
| Post karma | at least 100 |

The defaults can be changed by an administrator under Settings. Each subreddit can set stricter numbers.

---

## How verification works

1. The user pastes a profile link. The server extracts the username and rejects anything that is not a Reddit profile.
2. The user is given a personal code (for example `subdesk-ab12cd34`) to place in their Reddit
   profile bio. This is how ownership of the account is shown. No password is ever involved.
3. **If Reddit API credentials are configured**, the server looks up the account's creation date,
   karma and bio through Reddit's OAuth API, checks the code, and records exactly what Reddit returned.
   Rate limits and errors from Reddit are respected: the request is not retried around them.
4. **If the API is not configured or cannot be reached**, the application is marked
   **Manual Review Required**. No numbers are shown or guessed. The verification history says
   "Automatic check could not run", and an administrator enters the values by hand.
5. **An administrator always makes the final decision.** Even a fully verified account stays in
   *Pending Admin Review* until someone approves it. Approval is refused by the server unless
   verified values exist, the platform minimums are met and (when required) ownership is confirmed.
6. Eligibility for each subreddit is recomputed on the server every time someone views the
   marketplace or applies, so changing a rule takes effect immediately and cannot be bypassed from the browser.

---

## Local setup

Requirements: Node.js 20 or newer and npm (built and tested on Node.js 22).

```bash
npm install
cp .env.example .env.local        # optional for local use: the defaults work
npm run dev                        # http://localhost:3000
```

With no `DATABASE_URL`, the app uses an embedded PostgreSQL (PGlite) stored in `./.data`, so you can
run it with nothing else installed. The embedded database is for development only
(see [Deployment](#deployment)).

To try the whole flow without typing data in by hand, load clearly-labelled **test data**:

```bash
npm run db:seed-dev
```

This prints an administrator, an approved user and a pending user, each with a random password
that exists only in your terminal. It refuses to run in production or against a remote database. All test
subreddits and tasks are labelled `TEST DATA`, and the account numbers are marked as test fixtures,
not as data from Reddit. Nothing is seeded automatically, and there are no hardcoded accounts.

Useful commands:

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | Type-check (`tsc --noEmit`) |
| `npm test` | Run the test suite |
| `npm run db:migrate` | Apply database migrations |
| `npm run admin:create` | Create the first administrator |
| `npm run db:seed-dev` | Load labelled test data (local only) |

---

## Database and migrations

The schema is plain SQL in [`migrations/001_init.sql`](migrations/001_init.sql) and uses no extensions or
vendor features, so it should run on any recent PostgreSQL, including Supabase. It has been tested on a real
PostgreSQL 16.15 server (through the `pg` driver) and on the embedded PGlite. It has not been run against a
Supabase project from here, so do a first migration on a fresh project before relying on it.

```bash
# point DATABASE_URL at your database, then:
npm run db:migrate
```

Migrations are recorded in a `schema_migrations` table and are applied once each, in file-name
order. Set `AUTO_MIGRATE=true` if you would rather the server apply pending migrations on start.

What the database enforces on its own, regardless of application code:

- **Row Level Security** is enabled on every table with no policies for Supabase's `anon` and
  `authenticated` roles, so the Supabase public API cannot read or write anything. All access goes
  through the server using the connection string.
- **Append-only** `wallet_ledger` and `audit_logs`: updates and deletes are rejected by triggers.
- The wallet balance is maintained by a trigger from ledger entries and can never go negative.
- Check constraints, for example an application can only be Approved with fully verified values, verified values are
  all-or-nothing, a wallet balance cannot go negative, and money is stored as integer paise. (Requiring a reason
  to reject is enforced in the service layer, and tested there.)
- Unique constraints stop duplicate task applications and duplicate wallet adjustments (idempotency keys), and
  stop one Reddit account being actively claimed by two platform users.

---

## Create the first administrator

There is no default admin and no admin sign-up page. The first administrator is created from the
command line by someone with access to the server and database:

```bash
npm run admin:create -- --email you@example.com --username yourname
```

It asks for a password with hidden input (or reads `ADMIN_PASSWORD` from the environment for
automation), enforces the password rules (at least 10 characters, and it must not contain the username),
refuses duplicate accounts, creates the wallet row and writes an audit entry. Administrators log in at `/admin/login`, which uses its own cookie (`SameSite=Strict`,
12-hour lifetime) and does not accept ordinary user accounts. Ordinary users cannot log in there, and admins cannot log in through the user form.

To use it against your production database, run it from your machine with `DATABASE_URL`
pointing at that database. Do not leave `ADMIN_PASSWORD` in a file.

---

## Reddit API setup

This is optional. Without it, every application goes to manual review, which is fully supported.

1. Log in to Reddit and open <https://www.reddit.com/prefs/apps>.
2. Choose **create another app**. Pick **web app** (or **script**); set any redirect URI such as
   `http://localhost:3000` because this platform only uses app-only access to public profile data.
3. Copy the client ID (under the app name) and the secret.
4. Set these environment variables:

   ```
   REDDIT_CLIENT_ID=...
   REDDIT_CLIENT_SECRET=...
   REDDIT_USER_AGENT=web:your-app-name:v1.0 (by /u/your_reddit_username)
   ```

5. Restart the server. New applications are now checked automatically, and an administrator can
   press "Run the automatic check again" on any application.

Please read Reddit's current API terms and rate limits before going live. Reddit decides who may use
its API and for what; you are responsible for complying. The client caches its token and stops calling Reddit
for a while after being rate limited. It does not try to get around any limit, and it does not scrape pages.

---

## Email setup

Email is used for address verification and password resets.

- **Local development without SMTP:** the message is printed to the server console and the link is
  shown on the page, clearly labelled as development mode.
- **Production without SMTP:** nothing is sent and no link is shown. Users could not verify or reset
  a password, so configure `SMTP_URL` (any provider that offers SMTP). If you want to run without
  email for a while, set `EMAIL_VERIFICATION_REQUIRED=false`. Administrators can also mark a user's
  email as verified by hand, but password reset still needs working email.

Verification links open a page with a confirm button, so that mail scanners that pre-fetch links
do not use up the token.

---

## Deployment

Any Node host works (a VPS, Render, Railway, Fly.io, or Vercel). The app needs a PostgreSQL
database, so Supabase's free tier is a good fit. These steps describe a standard Node deployment. The app was
run here as a production build (`next build` and `next start`) against PostgreSQL 16, but it was not deployed to a
hosting provider from this environment.

1. **Create the database** and copy the server-side connection string.
2. **Set environment variables** on the host: at least `DATABASE_URL`, `APP_URL` (your public
   `https://` address) and `SMTP_URL`/`MAIL_FROM`. Add the Reddit variables if you have them.
   Never put any of these in the browser or in a public repository. Only the server reads them.
3. **Apply the schema:** `npm run db:migrate` from your machine against that database, or set `AUTO_MIGRATE=true`.
4. **Build and start:** `npm run build` then `npm start`. On Vercel, import the repository and the defaults work.
5. **Create the first administrator** with `npm run admin:create` (see above).
6. **Visit `/admin/login`**, then open Settings and Pages and replace the placeholder privacy policy and terms with your own.
7. Make sure the host forwards the real client address in `x-forwarded-for` or `x-real-ip`
   (almost all do). Rate limiting by IP depends on it.

### Deploying on Render

[`render.yaml`](render.yaml) describes one web service and one PostgreSQL database. In Render, choose
**New > Blueprint**, pick the Git repository with this project, and set the values it asks for. Notes:

- It is **untested on Render** (it was written without access to a Render account). Read the first deploy log.
- Migrations run automatically at start (`AUTO_MIGRATE=true`), because small plans may not include a shell.
- Set `APP_URL` to your public address after the first deploy.
- Both plans in the file are `free`. Free web services sleep when idle and free databases are not meant for data you
  must keep, so move to paid plans before real users or wallet balances depend on it.
- **Creating the first administrator needs a terminal.** If your plan has no shell, run `npm run admin:create` on
  your own computer with `DATABASE_URL` set to the database's *external* connection string (copy it from the Render
  dashboard; it contains a password, so do not paste it into chats or commit it).
- If the app cannot connect and the log says the server does not support SSL, set `DATABASE_SSL=false`.

The embedded database is **not** for production: it keeps its data on the server's local disk,
which most hosts wipe on every deploy and which cannot be shared between instances. The app refuses to start in
production with it unless you set `ALLOW_EMBEDDED_DB=true`, which is only appropriate for a single
long-lived server with a persistent disk.

Database TLS is on for any host other than localhost. The certificate is not verified by default
(a common requirement of managed poolers). Set `DATABASE_SSL=false` for a private network.

---

## Things that need external credentials or manual setup

| What | Why | Needed? |
|---|---|---|
| PostgreSQL connection string (`DATABASE_URL`) | Real data storage in production | Yes, for production |
| SMTP account (`SMTP_URL`, `MAIL_FROM`) | Verification and password-reset email | Yes, for production |
| Reddit app (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`) | Automatic account-age and karma checks | No. Without it, manual review is used |
| First administrator (`npm run admin:create`) | There is no default admin | Yes |
| Your own privacy policy and terms | The shipped pages are placeholders, not legal advice | Yes, before launch |
| Support email (Admin > Settings) | Shown on the Help page | Recommended |
| A real domain with HTTPS | Secure cookies and email links | Yes, for production |
| Real subreddits and tasks | None are shipped. The site shows empty states until you add them | Yes |

---

## Security model

- **Passwords** are hashed with scrypt and a per-user salt. They must be 10–128 characters. There is no
  complexity rule and no breached-password list (see Limitations).
- **Sessions** use 256-bit random tokens in `HttpOnly` cookies. Only a SHA-256 hash of the token is stored,
  so a database leak does not leak live sessions. In production the cookie names carry the `__Host-` prefix
  and `Secure`. User and admin sessions are separate cookies.
- **Roles and status are read from the database on every request**, not from the cookie. Blocking a user
  ends their sessions at once.
- **Permissions are enforced in the services layer**, not by hiding buttons. Each admin operation
  takes an explicit actor and re-checks role and permission, so a hand-crafted request fails the same
  way as a click. Tests cover these bypass attempts.
- **Rate limits** (stored in the database, so they hold across instances): login (per IP and per
  email), sign-up, password reset, verification email resend, Reddit submissions, task applications,
  password change and admin wallet adjustments.
- **Wallet:** integer paise, append-only ledger, database-maintained balance, idempotency keys, and a mandatory reason. A task application never credits anything by itself.
- **Headers:** strict Content-Security-Policy (fonts are self-hosted, so no third-party origins),
  `X-Frame-Options: DENY`, `nosniff`, HSTS, a restrictive Permissions-Policy, and form posts limited to your own origin.
- **No secrets in the browser:** every credential is read on the server only.
- **Data kept:** the Reddit username, account creation date and karma, plus platform activity. Users can request deletion, and an administrator processes it.
- **Error handling:** unexpected errors show a generic message and never a stack trace or SQL.
- Open redirects on the login `next` parameter are blocked, and login failures use one generic message for unknown email and wrong password.

---

## Testing

```bash
npm test                 # 105 tests, run against an in-memory PostgreSQL (PGlite)
npm run lint             # type-check
npm run build            # production build
```

To run the same suite against a real PostgreSQL server through the `pg` driver (this is what production uses):

```bash
createdb myapp_test
TEST_DATABASE_URL=postgres://user@localhost:5432/myapp_test npm test
```

The tests ignore `DATABASE_URL` completely, so `npm test` can never touch your real database. A
`TEST_DATABASE_URL` is used only when you set it, and the suite **drops and recreates the `public` schema** in
it before each test file, so it refuses any database whose name does not contain "test".

Last run: 105/105 passing on both PGlite and PostgreSQL 16.15.

The tests exercise the real services and the real schema (migrations, triggers and constraints included),
covering these scenarios from the brief:

1. Registration and login, including blocked users and wrong passwords.
2. Profile URL validation (valid forms, wrong sites, extra paths, look-alike domains).
3. Account too young, comment karma too low, post karma too low. Each one fails with its own reason.
4. A user who passes the numbers still stays *Pending Admin Review* until a person approves.
5. Admin approval, rejection (reason required), request for information and suspension.
6. Access control: users cannot reach admin operations; admins without a permission are refused.
7. Bypass attempts: calling approve without values, applying to an ineligible task, applying twice, forged identifiers.
8. Rule changes: raising a subreddit's threshold removes its tasks from users who no longer qualify; lowering it
   makes them available and notifies the users who gained access.
9. Wallet adjustments: credits, debits, no negative balances, idempotency, ledger immutability.
10. No payment methods: no payment-related columns or ledger kinds in the schema, no payment provider named in
    the code, no payment SDK installed, and the wallet pages say nothing here moves real money (browser test).
11. Manual review when the Reddit API is unavailable, with no fabricated values.

There is also a browser end-to-end script (Playwright) that drives the production build through
registration, submission, manual verification, approval, eligibility, applying, completing a task with a
reward, a wallet adjustment and the audit log, on both a 390px phone and a desktop viewport. It checks for
horizontal overflow and console errors. It is in [`e2e/e2e.py`](e2e/e2e.py), and the run instructions are at the top of that file (it needs a fresh
seeded database and `pip install playwright`). Its last run passed 44/44 checks against the production build, on
both the embedded database and PostgreSQL 16.15.

---

## Limitations

- **Reddit decides what the API can do.** Reddit may refuse or rate-limit requests, and its terms may
  change. The platform handles that by falling back to manual review, never by guessing.
- **Ownership proof relies on the bio code.** It proves control of the account at one moment. Reddit
  accounts can later be sold or hacked; an administrator can suspend a user at any time.
- **Karma is a snapshot.** Eligibility uses the verified values from when they were recorded. They are
  refreshed by re-running the check (or by the administrator), not continuously.
- **The wallet is a ledger only.** There are no payouts. Adding real money movement would need a payment provider, KYC and legal review. It is out of scope by design.
- **Task completion is judged by an administrator.** The platform does not check on Reddit that a user did the work.
- **Meeting the numbers does not guarantee anything.** Subreddit moderators make their own decisions, and the site says so.
- **Single language and currency** (English, ₹). Dates display in India time.
- **No breached-password check.** Passwords are only length-checked. Consider adding one before a public launch.
- **No file uploads, no two-factor authentication and no CAPTCHA.** Rate limits are the abuse control. Add a CAPTCHA before opening sign-ups to the public internet at scale.
- **The embedded database is single-server only** (see Deployment).
- Placeholder privacy and terms text is not legal advice.

---

## Project layout

```
migrations/001_init.sql     Schema, RLS, triggers, constraints
render.yaml                 Render Blueprint (web service + database), untested
scripts/                    migrate, create-admin, seed-dev
src/app/                    Pages (public, (app) for users, admin/(panel) for administrators)
src/app/actions/            Server actions (auth, user, admin)
src/services/               Business logic with explicit actors and permission checks
src/lib/                    db, eligibility engine, Reddit client, money, validation, rate limiting, mail
src/server/                 Sessions and cookies, action helpers
src/components/             UI components and page shells
tests/                      Unit and database-backed tests (vitest)
e2e/                        Browser end-to-end test (Playwright, Python)
```
