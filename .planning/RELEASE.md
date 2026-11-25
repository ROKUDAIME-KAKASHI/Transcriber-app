# Releasing Minutely

## The rule for every change

**Branch -> CI -> Vercel preview on a Neon branch DB -> owner approval -> merge to main.**

1. Work on a branch (never commit to `main`). One branch per change.
2. Push the branch and open a pull request. GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, tests and build. It must be green.
3. Vercel builds a preview URL for the branch. The preview must use the Neon `preview` branch database, not the live one (one-time setup: `.planning/PREVIEW-SETUP.md`).
4. If the change has a schema change, apply its migration to the preview database first (`npm run db:migrate` with the preview connection string; see `.planning/DB-MIGRATIONS.md`).
5. The owner tries the preview and approves.
6. Merge to `main`. Vercel deploys production. If there was a migration, run `npm run db:migrate` against production right after (before or together with the deploy; migrations are additive so either order is safe).
7. Anything risky can be hidden behind a feature switch (`/admin` > Feature switches) and turned off without a deploy.

## Releasing a new Android APK

The APK is a shell around the live website, so most changes need no new APK. Build one only when native code, plugins or the server address change.

Prerequisites on the build machine: `android/keystore.properties` (not in git), Android SDK, JDK.

```bash
node scripts/release-apk.mjs 1.3 "What changed, in one short sentence"
```

The script:

1. checks `android/app/build.gradle` and `src/lib/appRelease.ts` agree on the current version,
2. bumps `versionCode` (+1) and `versionName` in **both** files,
3. runs `npx cap sync android` with `CAP_SERVER_URL=https://transcriber-app-ten.vercel.app`,
4. runs `gradlew assembleRelease`,
5. copies the APK to `public/downloads/Minutely.apk` and `dist/Minutely.apk`.

If a step fails the version files are restored. `--dry-run` only prints the planned version change.

Then: commit `android/app/build.gradle`, `src/lib/appRelease.ts` and `public/downloads/Minutely.apk` on a branch and follow the rule above. Once merged, installed apps see the in-app update banner (it compares the installed versionCode with `LATEST_APK` served by the site). Share `dist/Minutely.apk` with people who do not have the app yet.

## Versioning rules

- `versionCode` is a whole number that goes up by exactly 1 every APK release. Android refuses to install a lower or equal code over an installed app. Never reuse one.
- `versionName` is what people see: `MAJOR.MINOR` (for example `1.3`), or `MAJOR.MINOR.PATCH` for a hotfix. It must change on every release.
- `build.gradle` and `appRelease.ts` always carry the same pair. The script is the only thing that edits them.
- `public/downloads/Minutely.apk` is the single published APK. `/downloads/Transcriber.apk` is just a redirect to it for old links.
- Never change `applicationId` (`in.transcriber.app`): it would install as a different app.
