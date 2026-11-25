-- Tracker (Phase 16). Additive: one nullable column, no default, no index. The old app version ignores it.

-- AlterTable
ALTER TABLE "ActionItem" ADD COLUMN     "ownerStakeholderId" TEXT;
