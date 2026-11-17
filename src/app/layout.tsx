import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Transcriber",
  description: "Record meetings on any device, get live speaker-labelled transcripts and AI minutes.",
  applicationName: "Transcriber",
  appleWebApp: { capable: true, title: "Transcriber", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/api/icons/192", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/api/icons/180", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
