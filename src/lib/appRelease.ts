// Single source of truth for the newest installable Android app.
// Bump this together with versionCode/versionName in android/app/build.gradle AND replace
// public/downloads/Transcriber.apk on every release, or the in-app update prompt lies.
export const LATEST_APK = {
  versionCode: 2,
  versionName: "1.1",
  url: "/downloads/Transcriber.apk",
  notes: "Offline recording with the screen locked, speaker name suggestions",
};
