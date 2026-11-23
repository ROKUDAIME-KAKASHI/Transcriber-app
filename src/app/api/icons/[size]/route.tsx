import { ImageResponse } from "next/og";

/** Generates the app's PNG icons on the fly, so there are no binary files to maintain. */
const ALLOWED = new Set([180, 192, 512]);

export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!ALLOWED.has(size)) return new Response("Not found", { status: 404 });

  // Maskable icons need the artwork inside the central 80% safe zone.
  const maskable = new URL(req.url).searchParams.has("maskable");
  const radius = maskable ? 0 : size * 0.22;
  const mic = size * (maskable ? 0.42 : 0.55);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0E0F17",
          borderRadius: radius,
        }}
      >
        <svg width={mic} height={mic} viewBox="0 0 24 24" fill="none" stroke="#8EA2FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
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
