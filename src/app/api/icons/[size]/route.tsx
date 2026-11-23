import { ImageResponse } from "next/og";

/** Generates the app's PNG icons on the fly, so there are no binary files to maintain. */
const ALLOWED = new Set([180, 192, 512]);

export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!ALLOWED.has(size)) return new Response("Not found", { status: 404 });

  // Maskable icons need the artwork inside the central 80% safe zone, on a full-bleed background.
  // Artwork mirrors assets/icon-art.svg ("live bubble"): speech that turns into text.
  const maskable = new URL(req.url).searchParams.has("maskable");
  const radius = maskable ? 0 : size * 0.22;
  const art = size * (maskable ? 0.78 : 0.92);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#171926",
          borderRadius: radius,
        }}
      >
        <svg width={art} height={art} viewBox="0 0 108 108">
          <path d="M26 30h56a8 8 0 0 1 8 8v28a8 8 0 0 1-8 8H50l-14 11v-11h-10a8 8 0 0 1-8-8V38a8 8 0 0 1 8-8z" fill="#3651F5" />
          <rect x="33" y="46" width="5" height="12" rx="2.5" fill="#FFFFFF" />
          <rect x="42" y="40" width="5" height="24" rx="2.5" fill="#FFFFFF" />
          <rect x="51" y="35" width="5" height="34" rx="2.5" fill="#FFFFFF" />
          <rect x="60" y="42" width="5" height="20" rx="2.5" fill="#FFFFFF" />
          <rect x="69" y="47" width="5" height="10" rx="2.5" fill="#FFFFFF" />
          <circle cx="80" cy="34" r="6" fill="#FF6369" />
        </svg>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    }
  );
}
