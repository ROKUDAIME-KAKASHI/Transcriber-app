import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { isFlagOn } from "./flags";
import { findPossibleDuplicate, type DupReason, type PersonLite } from "./stakeholders";

/** True when the Stakeholder table (or a column) isn't in the database yet: 3_stakeholders hasn't been applied. */
export function isStakeholdersMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022");
}

export const STAKEHOLDERS_MISSING_MESSAGE = "Stakeholders need a database update";

export const NO_STORE = { "Cache-Control": "no-store" };

export function stakeholdersMissing(): Response {
  return Response.json({ error: STAKEHOLDERS_MISSING_MESSAGE }, { status: 503, headers: NO_STORE });
}

export const PERSON_SELECT = {
  id: true, name: true, designation: true, organisation: true, area: true, email: true, phone: true, notes: true,
} as const;

/** Set when the owner has switched the People directory off in Admin. */
export async function pausedResponse(): Promise<Response | null> {
  if (await isFlagOn("stakeholders")) return null;
  return Response.json({ error: "People are paused for now. Please check back later." }, { status: 503, headers: NO_STORE });
}

/** The user's live people, for duplicate checks. */
export async function livePeople(userId: string): Promise<PersonLite[]> {
  return prisma.stakeholder.findMany({
    where: { userId, deletedAt: null },
    select: { id: true, name: true, email: true },
    take: 5000,
  });
}

export function duplicateResponse(d: { person: PersonLite; reason: DupReason }): Response {
  const email = d.reason === "email";
  return Response.json(
    {
      error: email ? `${d.person.name} already uses this email.` : `Possible duplicate of ${d.person.name}.`,
      code: email ? "email_taken" : "similar_name",
      duplicate: { id: d.person.id, name: d.person.name },
    },
    { status: 409, headers: NO_STORE }
  );
}

export { findPossibleDuplicate };
