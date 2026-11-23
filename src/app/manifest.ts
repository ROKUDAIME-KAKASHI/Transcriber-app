import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Transcriber",
    short_name: "Transcriber",
    description: "Record meetings on any device, get live speaker-labelled transcripts and AI minutes.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0E0F17",
    theme_color: "#0E0F17",
    categories: ["productivity", "business"],
    icons: [
      { src: "/api/icons/192?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/icons/512?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/icons/512?maskable=1&v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
