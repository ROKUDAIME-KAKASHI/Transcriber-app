import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

// Applies the saved in-app "Reduce motion" choice before first paint.
const MOTION_SCRIPT =
  'try{if(localStorage.getItem("transcriber.motion")==="reduced")document.documentElement.dataset.motion="reduced"}catch(e){}';

export const metadata: Metadata = {
  title: "Minutely",
  description: "Meeting minutes, tasks and follow-ups. Record on any device, get speaker-labelled transcripts and AI minutes.",
  applicationName: "Minutely",
  appleWebApp: { capable: true, title: "Minutely", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/api/icons/192?v=2", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/api/icons/180?v=2", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F7FB" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0F17" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_SCRIPT + THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
