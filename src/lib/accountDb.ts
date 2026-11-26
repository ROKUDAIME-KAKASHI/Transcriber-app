import { prisma } from "@/lib/prisma";
import { ACCOUNT_DELETE_ORDER, type AccountDeleteStep } from "./privacyCore";

/** Deletes everything the user owns in one transaction, in ACCOUNT_DELETE_ORDER. Throws on a database error. */
export async function deleteAccountData(userId: string): Promise<void> {
  const ops: Record<AccountDeleteStep, ReturnType<typeof prisma.user.deleteMany>> = {
    actionItemEvent: prisma.actionItemEvent.deleteMany({ where: { OR: [{ userId }, { actionItem: { userId } }] } }),
    actionItem: prisma.actionItem.deleteMany({ where: { userId } }),
    planReference: prisma.planReference.deleteMany({ where: { userId } }),
    plannedAttendee: prisma.plannedAttendee.deleteMany({ where: { plannedMeeting: { userId } } }),
    plannedMeeting: prisma.plannedMeeting.deleteMany({ where: { userId } }),
    meetingSeries: prisma.meetingSeries.deleteMany({ where: { userId } }),
    booking: prisma.booking.deleteMany({ where: { hostUserId: userId } }),
    eventType: prisma.eventType.deleteMany({ where: { userId } }),
    availability: prisma.availability.deleteMany({ where: { userId } }),
    agendaDraft: prisma.agendaDraft.deleteMany({ where: { userId } }),
    stakeholder: prisma.stakeholder.deleteMany({ where: { userId } }),
    meeting: prisma.meeting.deleteMany({ where: { userId } }),
    clientError: prisma.clientError.deleteMany({ where: { userId } }),
    user: prisma.user.deleteMany({ where: { id: userId } }),
  };
  await prisma.$transaction(ACCOUNT_DELETE_ORDER.map((step) => ops[step]));
}
