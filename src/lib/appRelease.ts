// Single source of truth for the newest installable Android app.
// Bump this together with versionCode/versionName in android/app/build.gradle AND replace
// public/downloads/Minutely.apk on every release, or the in-app update prompt lies.
export const LATEST_APK = {
  versionCode: 3,
  versionName: "1.2",
  url: "/downloads/Minutely.apk",
  notes: "New name: Minutely. Simpler booking.",
};
