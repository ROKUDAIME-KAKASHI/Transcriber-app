import { buildIcs, formatInZone } from "@/lib/scheduling";

/** Email through Resend's HTTP API. Silent when RESEND_API_KEY / BOOKING_FROM_EMAIL aren't set. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.BOOKING_FROM_EMAIL);
}

async function send(payload: { to: string; subject: string; text: string; ics?: string; icsName?: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.BOOKING_FROM_EMAIL;
  if (!key || !from) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        text: payload.text,
        attachments: payload.ics
          ? [{ filename: payload.icsName ?? "meeting.ics", content: Buffer.from(payload.ics, "utf8").toString("base64") }]
          : undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("Booking email failed with status", res.status);
  } catch {
    // Never log the key or the request; a failed email must not fail the booking.
    console.error("Booking email could not be sent");
  }
}

export interface BookingMail {
  id: string;
  title: string;
  hostHandle: string;
  hostEmail: string;
  hostTimeZone: string;
  guestName: string;
  guestEmail: string;
  guestNote: string | null;
  agenda: string | null;
  startAt: Date;
  endAt: Date;
  origin: string;
  cancelToken: string;
}

export async function sendBookingEmails(b: BookingMail) {
  if (!emailConfigured()) return;
  const manage = `${b.origin}/book/confirmed/${b.id}?t=${b.cancelToken}`;
  const ics = buildIcs({
    uid: `${b.id}@transcriber`, start: b.startAt, end: b.endAt, title: `${b.title} with ${b.hostHandle}`,
    description: b.agenda ? `Agenda\n${b.agenda}` : null, organizerName: b.hostHandle,
    organizerEmail: process.env.BOOKING_FROM_EMAIL?.match(/<([^>]+)>/)?.[1] ?? process.env.BOOKING_FROM_EMAIL ?? "",
    attendeeName: b.guestName, attendeeEmail: b.guestEmail, url: manage,
  });
  await Promise.all([
    send({
      to: b.guestEmail,
      subject: `Confirmed: ${b.title} with ${b.hostHandle}`,
      text: `Hi ${b.guestName},\n\nYour meeting is booked.\n\n${b.title} with ${b.hostHandle}\n${formatInZone(b.startAt, "UTC")} UTC\n\nView, add to calendar or cancel:\n${manage}\n`,
      ics, icsName: "meeting.ics",
    }),
    send({
      to: b.hostEmail,
      subject: `New booking: ${b.guestName}, ${formatInZone(b.startAt, b.hostTimeZone)}`,
      text: `${b.guestName} (${b.guestEmail}) booked ${b.title}.\n\nWhen: ${formatInZone(b.startAt, b.hostTimeZone)} (${b.hostTimeZone})\n${b.guestNote ? `Note: ${b.guestNote}\n` : ""}${b.agenda ? `\nAgenda:\n${b.agenda}\n` : ""}\nManage it in Minutely under Schedule.\n`,
      ics, icsName: "meeting.ics",
    }),
  ]);
}

export async function sendCancelEmail(b: BookingMail, by: "guest" | "host") {
  if (!emailConfigured()) return;
  const when = formatInZone(b.startAt, b.hostTimeZone);
  if (by === "guest") {
    await send({
      to: b.hostEmail,
      subject: `Cancelled: ${b.guestName}, ${when}`,
      text: `${b.guestName} cancelled ${b.title} on ${when} (${b.hostTimeZone}).\n`,
    });
  } else {
    await send({
      to: b.guestEmail,
      subject: `Cancelled: ${b.title} with ${b.hostHandle}`,
      text: `Hi ${b.guestName},\n\n${b.hostHandle} cancelled your meeting on ${formatInZone(b.startAt, "UTC")} UTC.\n`,
    });
  }
}
