import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { actionItemsMissing, isActionItemsMissing } from "@/lib/actionItemsDb";
import { withLive } from "@/lib/actionItemHistory";
import { parseDateOnly } from "@/lib/taskTracker";
import { NO_STORE, trackerPlusOn } from "@/lib/trackerPlusDb";
import { isFlagOn } from "@/lib/flags";

export const dynamic = "force-dynamic";

/** Lightweight counts for the Tasks badge and reminders. `?today=YYYY-MM-DD` is the caller's local day (default: UTC today). */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  if (!(await trackerPlusOn()) || !(await isFlagOn("taskTracker"))) {
    return Response.json({ error: "Task alerts are paused" }, { status: 503, headers: NO_STORE });
  }
  const todayParam = new URL(req.url).searchParams.get("today");
  const today = parseDateOnly(todayParam) ?? parseDateOnly(new Date().toISOString().slice(0, 10))!;
  try {
    const open = { userId, status: { not: "DONE" } };
    const [overdue, dueToday, total] = await withLive((live) =>
      Promise.all([
        prisma.actionItem.count({ where: { ...open, ...live, dueDate: { lt: today } } }),
        prisma.actionItem.count({ where: { ...open, ...live, dueDate: today } }),
        prisma.actionItem.count({ where: { ...open, ...live } }),
      ])
    );
    return Response.json({ overdue, dueToday, open: total }, { headers: NO_STORE });
  } catch (err) {
    if (isActionItemsMissing(err)) return actionItemsMissing();
    console.error("Task summary error:", err instanceof Error ? err.message : "unknown");
    return Response.json({ error: "Couldn't load the task summary." }, { status: 503, headers: NO_STORE });
  }
}
