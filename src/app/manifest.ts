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
    background_color: "#fafaf9",
    theme_color: "#4f46e5",
    categories: ["productivity", "business"],
    icons: [
      { src: "/api/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/icons/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
