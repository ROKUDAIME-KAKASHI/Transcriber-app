import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { defaultFlags, mergeFlags, type FlagKey, type Flags } from "./flagsCore";

const TTL_MS = 60_000;
let cache: { at: number; flags: Flags; available: boolean } | null = null;

/** Drops the in-memory copy so the next read sees a just-saved change. */
export function clearFlagsCache(): void {
  cache = null;
}

/** Effective flags (database rows over defaults), cached 60 s per server instance. Missing table => defaults. */
export async function getFlagsState(): Promise<{ flags: Flags; available: boolean }> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return { flags: cache.flags, available: cache.available };
  let flags = defaultFlags();
  let available = true;
  try {
    flags = mergeFlags(await prisma.featureFlag.findMany({ select: { key: true, enabled: true } }));
  } catch (err) {
    available = false;
    const missing = err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022");
    if (!missing) console.error("[server-error] flags: could not read feature switches, using defaults");
  }
  cache = { at: now, flags, available };
  return { flags, available };
}

export async function getFlags(): Promise<Flags> {
  return (await getFlagsState()).flags;
}

export async function isFlagOn(key: FlagKey): Promise<boolean> {
  return (await getFlags())[key];
}
