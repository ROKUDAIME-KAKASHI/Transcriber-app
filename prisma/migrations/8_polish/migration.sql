-- Polish. Additive: two nullable columns, no default, no index. The old app version ignores them.

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "summary" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "displayName" TEXT;
