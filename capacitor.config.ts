import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android app is a native shell around the web app: screens come from the server, and
 * recording runs in a native foreground service (android/app/src/main/java/.../recorder) so it
 * keeps going with the screen off.
 *
 * CAP_SERVER_URL is the server the app opens, set when syncing:
 *   CAP_SERVER_URL=https://your-app.vercel.app npx cap sync android
 * For testing against the laptop's dev server on the same Wi-Fi: http://<laptop-ip>:3001
 * Over a USB cable: `adb reverse tcp:3001 tcp:3001`, then CAP_SERVER_URL=http://localhost:3001
 */
const serverUrl = process.env.CAP_SERVER_URL || "http://192.168.100.152:3001";

const config: CapacitorConfig = {
  appId: "in.transcriber.app",
  appName: "Minutely",
  webDir: "mobile/www",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    errorPath: "index.html",
  },
  // Capacitor logs every plugin call; the Record screen polls 4×/s, which is noise (and battery) over a long meeting.
  loggingBehavior: "none",
  android: {
    allowMixedContent: false,
  },
};

export default config;
