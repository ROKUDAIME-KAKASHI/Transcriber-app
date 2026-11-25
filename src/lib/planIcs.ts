import { buildIcs } from "./scheduling";
import { attendeeLine, endOf, type PlanDTO } from "./planning";
import type { IcsMethod } from "./calendar";

/** The .ics text for one plan: stable UID per plan, the organizer is the plan's owner. */
export function planIcs(p: PlanDTO, organizerEmail: string, invite?: { method: IcsMethod; sequence: number }): string {
  const description = [
    p.callUrl ? `Join: ${p.callUrl}` : "",
    p.attendees.length ? `With: ${p.attendees.map(attendeeLine).join(", ")}` : "",
    p.agenda?.trim() ? `Agenda\n${p.agenda.trim()}` : "",
  ].filter(Boolean).join("\n\n");
  return buildIcs({
    uid: `plan-${p.id}@transcriber`,
    start: new Date(p.startAt),
    end: endOf(p),
    title: p.title,
    description: description || null,
    location: p.venue ?? p.callUrl,
    organizerName: organizerEmail.split("@")[0] || "Organizer",
    organizerEmail,
    attendees: p.attendees.filter((a) => a.email).map((a) => ({ name: a.name, email: a.email as string })),
    cancelled: p.status === "CANCELLED",
    ...(invite ? { method: invite.method, sequence: invite.sequence, rsvp: invite.method === "REQUEST" } : {}),
  });
}
