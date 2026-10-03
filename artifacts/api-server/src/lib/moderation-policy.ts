export const MODERATION_ACTIONS = [
  "hide_edit", "restore_edit", "hide_comment", "restore_comment", "suspend_user", "unsuspend_user",
] as const;
export type ModerationAction = typeof MODERATION_ACTIONS[number];
export class ModerationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type ModerationTarget = {
  targetType: "edit" | "comment" | "profile";
  targetId: string; creatorId: string; ownerUserId: string;
  hidden: boolean; suspended: boolean; protectedAccount: boolean;
  data: Record<string, unknown>;
};
export type ActionAudit = {
  id: string; reportId: string; adminUserId: string; action: ModerationAction;
  targetType: string; targetId: string; note: string; createdAt: string;
  previousState: Record<string, unknown>; newState: Record<string, unknown>;
};
export interface ModerationTransaction {
  isAdmin(id: string): Promise<boolean>;
  target(reportId: string): Promise<ModerationTarget | null>;
  lock(key: string): Promise<void>;
  changeContent(target: ModerationTarget, hidden: boolean): Promise<void>;
  changeAccount(userId: string, suspended: boolean): Promise<void>;
  expireSessions(userId: string): Promise<void>;
  audit(reportId: string, entry: Omit<ActionAudit, "id" | "reportId" | "createdAt">): Promise<ActionAudit>;
}
export interface ModerationRepository {
  transaction<T>(callback: (tx: ModerationTransaction) => Promise<T>): Promise<T>;
}
export function accountLock(userId: string) { return `moderation-account:${userId}`; }

/** No client-supplied owner/target/state is trusted. Lock, re-resolve, state and audit share a transaction. */
export async function applyModeration(repo: ModerationRepository, adminId: string, reportId: string, input: unknown) {
  const body = input as { action?: unknown; reason?: unknown; confirmed?: unknown } | null;
  if (!body || !MODERATION_ACTIONS.includes(body.action as ModerationAction)
      || typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 1000
      || body.confirmed !== true) throw new ModerationError(400, "Choose an action, confirm it, and provide a reason.");
  const action = body.action as ModerationAction, reason = body.reason.trim();
  return repo.transaction(async (tx) => {
    if (!await tx.isAdmin(adminId)) throw new ModerationError(403, "Administrator access required.");
    let target = await tx.target(reportId);
    if (!target) throw new ModerationError(404, "Report target unavailable.");
    const account = action === "suspend_user" || action === "unsuspend_user";
    if (!account && !action.endsWith(`_${target.targetType}`)) throw new ModerationError(400, "Action does not match report target.");
    const key = account ? accountLock(target.ownerUserId) : `moderation-content:${target.targetType}:${target.creatorId}:${target.targetId}`;
    await tx.lock(key);
    const fresh = await tx.target(reportId);
    if (!fresh || fresh.targetId !== target.targetId || fresh.creatorId !== target.creatorId || fresh.ownerUserId !== target.ownerUserId) {
      throw new ModerationError(409, "Target ownership changed. Reload before acting.");
    }
    target = fresh;
    if (!await tx.isAdmin(adminId)) throw new ModerationError(403, "Administrator access required.");
    if (account && (target.ownerUserId === adminId || target.protectedAccount)) {
      throw new ModerationError(403, "Self, owner and administrator accounts are protected.");
    }
    const next = action.startsWith("hide_") || action === "suspend_user";
    const previousState = account ? { suspended: target.suspended } : { hidden: target.hidden, creatorId: target.creatorId };
    const newState = account ? { suspended: next } : { hidden: next, creatorId: target.creatorId };
    if (account) {
      await tx.changeAccount(target.ownerUserId, next);
      if (next) await tx.expireSessions(target.ownerUserId);
    } else await tx.changeContent(target, next);
    const audit = await tx.audit(reportId, {
      adminUserId: adminId, action, targetType: account ? "user" : target.targetType,
      targetId: account ? target.ownerUserId : target.targetId, note: reason, previousState, newState,
    });
    return { action, hidden: account ? target.hidden : next, suspended: account ? next : target.suspended, audit };
  });
}