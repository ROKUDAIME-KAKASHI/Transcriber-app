import { Prisma } from "@prisma/client";

/** True when the ActionItem table (or a column) isn't in the database yet: `prisma db push` hasn't run. */
export function isActionItemsMissing(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022");
}

export const ACTION_ITEMS_MISSING_MESSAGE = "Action items need a database update";

export function actionItemsMissing(): Response {
  return Response.json({ error: ACTION_ITEMS_MISSING_MESSAGE }, { status: 503 });
}
