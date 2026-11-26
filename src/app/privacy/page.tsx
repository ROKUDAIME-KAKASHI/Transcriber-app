import type { Metadata } from "next";
import Link from "next/link";
import { AudioLines } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy | Minutely",
  description: "What Minutely stores, where, and who sees your audio or text.",
};

const UPDATED = "2026-11-26";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 space-y-2 text-ui leading-relaxed">{children}</div>
    </section>
  );
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border/70 bg-card pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4 sm:px-6">
          <span className="inline-flex items-center gap-2.5 text-ui font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-accent text-accent-foreground">
              <AudioLines className="h-4 w-4" aria-hidden />
            </span>
            Minutely
          </span>
          <Link href="/" className="text-ui font-semibold text-accent-text underline-offset-2 hover:underline">
            Open the app
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-1 text-meta text-muted-foreground">Last updated {UPDATED}</p>
        <p className="mt-4 text-ui leading-relaxed">
          Minutely records meetings, turns them into a transcript, and writes minutes. This page says what it keeps, where, and who else
          sees your audio or text.
        </p>

        <Section title="Audio is not stored">
          <p>
            Minutely does not save your recordings. On-device transcription (Moonshine and Whisper) turns the sound into text on your phone or
            laptop, and the audio stays there. On the Android app, sound may wait in a temporary file on the phone until it has been
            transcribed, then it is removed. Only the text is saved.
          </p>
        </Section>

        <Section title="What is stored, and where">
          <p>On our database (Neon Postgres), under your account:</p>
          <List
            items={[
              "Your email, your password (hashed, never readable) and the name you set for yourself.",
              "Meetings: title, language, device name, transcript text with speaker labels, duration, and the minutes and summary written for it.",
              "Tasks from your meetings, with their change history.",
              "People you add, meeting plans, agendas, attendee names and emails, and the text pulled out of reference files you attach (the files themselves are not kept).",
              "Your booking link, availability, event types, and bookings made with you (the guest's name, email and note).",
              "Error reports: what went wrong, the page address, browser and app version, and your account id if you were signed in. They never include transcript text.",
            ]}
          />
          <p>On your device (the browser or Android app), in IndexedDB and localStorage:</p>
          <List
            items={[
              "A copy of your meetings and transcripts so the app works without internet, and numbers that help tell voices apart.",
              "Settings such as theme, engine and language, your name, the last account you signed in with, summaries and Ask chats for each meeting, and that you have seen the recording reminder.",
              "The downloaded speech models, which contain no personal data.",
            ]}
          />
        </Section>

        <Section title="Who else sees your audio or text">
          <List
            items={[
              <>
                <strong>Deepgram</strong> hears the audio, only when you choose the cloud engine (the one that labels speakers). It goes from
                your device straight to Deepgram, which sends back text. On-device engines never send audio anywhere.
              </>,
              <>
                <strong>AI providers</strong> read the meeting text, never audio, when you make minutes, a summary, action items, an Ask answer,
                or a follow-up agenda. Requests go through AICredits to GLM Flash or Claude Haiku, whichever you pick. If the server has no
                AICredits key it can use Google Gemini instead.
              </>,
              <>
                <strong>Vercel</strong> hosts the app and handles each request your device makes to it.
              </>,
              <>
                <strong>Resend</strong> sends booking and invite emails (names, emails and meeting times), only if the owner has set it up.
              </>,
              <>
                <strong>Hugging Face</strong> is where the speech models are downloaded from. It receives no meeting data.
              </>,
            ]}
          />
          <p>Minutely does not sell your data and does not show ads.</p>
        </Section>

        <Section title="How long it is kept">
          <p>Until you delete it. You can delete one meeting at a time from your meetings list, or everything at once (below).</p>
        </Section>

        <Section title="Delete everything">
          <p>
            Sign in, open <strong>Profile</strong>, then <strong>Account</strong> and choose <strong>Delete account</strong>. Type DELETE to
            confirm. This removes your meetings, transcripts, minutes, tasks, people, plans, bookings and availability from our database, and
            clears the copy on the device you are using. Other devices keep their local copy until you sign out there or clear the app&apos;s
            data.
          </p>
        </Section>

        <Section title="Recording other people">
          <p>
            Tell everyone before you record. The Record screen reminds you, and Profile has a short note you can paste into a call chat or
            WhatsApp.
          </p>
        </Section>

        <Section title="Questions">
          <p>Contact the app owner.</p>
        </Section>
      </main>
    </div>
  );
}
