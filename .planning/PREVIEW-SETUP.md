# Preview deployments on a separate database (one-time setup)

Goal: every pull request gets its own Vercel preview URL that uses a **copy** of the database, so testing a change can never touch real meetings.

> **WARNING: until step 2 below is done, preview deployments use the LIVE database.**
> Do not open a pull request preview and create, edit or delete data until you have finished steps 1 and 2.

The schema reads two variables: `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct). Both need a preview value.

## 1. Create the Neon preview branch

1. Open the Neon console and select the Minutely project.
2. Go to **Branches** > **Create branch**.
3. Name: `preview`. Parent: `main` (the production branch). Data: current data (a copy, so the preview has the real table shapes and the migration history).
4. Open the new branch > **Connect**. Copy **both** strings for the `preview` branch:
   - the **pooled** one (host contains `-pooler`) = `DATABASE_URL`
   - the **direct / unpooled** one = `DATABASE_URL_UNPOOLED`
5. A Neon branch is a copy. Real users' data is in it too: treat the preview branch as private. Refresh it later with **Reset from parent** when you want fresh data.

Do this baseline on production first (once): `.planning/DB-MIGRATIONS.md`. Create the `preview` branch **after** that, so it already contains the migration history.

## 2. Point Vercel Preview at the Neon preview branch

1. Vercel dashboard > the project > **Settings** > **Environment Variables**.
2. Find `DATABASE_URL`. Edit it so it is **not** shared with Preview: untick **Preview** from the existing entry (leave **Production** ticked and unchanged).
3. **Add New**: key `DATABASE_URL`, value = the Neon `preview` pooled string, Environments: tick **Preview only**. Save.
4. Repeat for `DATABASE_URL_UNPOOLED` with the unpooled `preview` string.
5. Check the list: each of the two keys must now appear twice, once for **Production** (the live string, unchanged) and once for **Preview** (the preview string). Never tick Production on the preview strings.
6. Make sure the other variables the app needs exist for **Preview** too, otherwise sign-in or AI will fail on previews: `NEXTAUTH_SECRET`, `ADMIN_PASSWORD_HASH` (optional), `DEEPGRAM_API_KEY`, `AICREDITS_API_KEY` (and `AICREDITS_BASE_URL` if you use it), `GOOGLE_GENERATIVE_AI_API_KEY`. Reuse the same values or separate test keys. Email (`RESEND_API_KEY`) is best left **unset** on Preview so test bookings do not email real people.
7. Env var changes apply to **new** deployments only: push a commit or press **Redeploy** on a preview.

### NEXTAUTH_URL on previews

Leave `NEXTAUTH_URL` **unset** for Preview (or set it for **Production only**). On Vercel, NextAuth (v4) takes the host from the request itself (it sees `VERCEL` is set, see `next-auth/utils/detect-origin.js`), so every preview URL signs in against itself. If `NEXTAUTH_URL` is ticked for Preview it points sign-in at the production address and logins on previews break or bounce to production. Only if you ever see that happen, add `AUTH_TRUST_HOST=true` for Preview.

## 3. Require CI before merging (optional but recommended)

1. GitHub > the repository > **Settings** > **Branches** > **Add branch ruleset** (or **Add rule**) for `main`.
2. Tick **Require a pull request before merging** and **Require status checks to pass**; add the check named `check` (job of the **CI** workflow). The check only appears in the search box after CI has run once on a pull request.
3. Save. Direct pushes to `main` are then blocked, which is the point.

## 4. Finding a preview URL

- Open the pull request on GitHub: the **Vercel** bot comment (and the checks list at the bottom) has a **Visit Preview** link.
- Or Vercel dashboard > **Deployments** > pick the one marked **Preview** for your branch > **Visit**.
- Each push to the branch makes a new deployment; the branch has a stable alias too (shown on the deployment page under **Domains**).
- If Vercel asks you to sign in to view a preview, that is Deployment Protection: sign in with your Vercel account.

## 5. Applying a migration to the preview database

When a pull request includes a new folder under `prisma/migrations/`, apply it to the preview branch before testing, from the project folder:

```bash
# PowerShell, with the preview strings (never commit them)
$env:DATABASE_URL="<preview pooled string>"
$env:DATABASE_URL_UNPOOLED="<preview unpooled string>"
npm run db:migrate
```

Production gets the same command with the live strings **after** you approve and merge.
