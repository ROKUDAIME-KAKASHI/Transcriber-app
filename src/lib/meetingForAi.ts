import { prisma } from "@/lib/prisma";
import { withLegacyFallback } from "@/lib/meetingSelect";
import { aiSpeakerLabel, parseTranscript, type SpeakerNames, type TranscriptPart } from "@/lib/transcript";

export interface AiMeeting {
  title: string;
  durationSec: number;
  document: string | null;
  template: string | null;
  parts: TranscriptPart[];
  names: SpeakerNames;
}

/** Owner-scoped read of what the AI routes need. Null when the meeting is not this user's. Throws when the database is down. */
export async function loadMeetingForAi(id: string, userId: string): Promise<AiMeeting | null> {
  const m = await withLegacyFallback(async (legacy) => {
    const where = { id, userId };
    if (legacy) {
      const r = await prisma.meeting.findFirst({
        where,
        select: { title: true, durationSec: true, document: true, template: true, transcript: true },
      });
      return r && { ...r, speakerNames: null as unknown };
    }
    return prisma.meeting.findFirst({
      where,
      select: { title: true, durationSec: true, document: true, template: true, transcript: true, speakerNames: true },
    });
  });
  if (!m) return null;
  const sn = m.speakerNames;
  const names: SpeakerNames =
    sn && typeof sn === "object" && !Array.isArray(sn) && Object.values(sn).every((v) => typeof v === "string")
      ? (sn as Record<string, string>)
      : null;
  return { title: m.title, durationSec: m.durationSec, document: m.document, template: m.template, parts: parseTranscript(m.transcript), names };
}

/** "Name: text" lines, one per phrase (the same shape the action-item extractor reads). */
export function labelledLines(parts: TranscriptPart[], names: SpeakerNames): string[] {
  const multi = new Set(parts.map((p) => p.speaker)).size > 1;
  return parts
    .map((p) => ({ who: aiSpeakerLabel(p.speaker, names), text: p.text.replace(/\s+/g, " ").trim() }))
    .filter((p) => p.text)
    .map((p) => (multi ? `${p.who}: ${p.text}` : p.text));
}
