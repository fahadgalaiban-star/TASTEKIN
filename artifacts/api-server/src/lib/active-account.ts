import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { accountLock, ModerationError } from "./moderation-policy";
type Executor = Pick<typeof db, "select" | "insert" | "update" | "execute">;
export async function isAccountSuspended(userId: string): Promise<boolean> {
  const [row] = await db.select({ suspended: usersTable.isSuspended }).from(usersTable).where(eq(usersTable.id, userId));
  return !row || row.suspended;
}
/** Same account lock as suspension: no session can race between checking and issuing credentials. */
export async function withActiveAccount<T>(userId: string, write: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${accountLock(userId)}))`);
    const [row] = await tx.select({ suspended: usersTable.isSuspended }).from(usersTable).where(eq(usersTable.id, userId));
    if (!row || row.suspended) throw new ModerationError(403, "Account unavailable.");
    return write(tx);
  });
}