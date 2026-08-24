import {
  conversationMessages,
  conversations,
  creatorViewEvents,
  creatorWorkspaces,
  db,
  editComments,
  editLikes,
  editSaves,
  usersTable,
} from "@workspace/db";
import {
  CreateConversationBody,
  CreateConversationMessageBody,
  CreateConversationMessageParams,
  CreateConversationMessageResponse,
  CreateConversationResponse,
  CreateEditCommentBody,
  CreateEditCommentParams,
  CreateEditCommentResponse,
  DeleteEditCommentParams,
  GetConversationParams,
  GetConversationResponse,
  GetCreatorInsightsResponse,
  GetEditEngagementParams,
  GetEditEngagementResponse,
  ListConversationsResponse,
  ListEditCommentsParams,
  ListEditCommentsResponse,
  ListSavedEditsResponse,
  RecordCreatorViewBody,
  RecordCreatorViewParams,
  RecordCreatorViewResponse,
  UpdateEditLikeBody,
  UpdateEditLikeParams,
  UpdateEditLikeResponse,
  UpdateEditSaveBody,
  UpdateEditSaveParams,
  UpdateEditSaveResponse,
} from "@workspace/api-zod";
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

import { creatorByUsername, requireCreator } from "../lib/creator-account";

const router: IRouter = Router();

type WorkspaceEdit = { id?: unknown; status?: unknown; access?: unknown };

function privateResponse(res: Response) {
  res.set("Cache-Control", "private, no-store");
}

function requireUser(req: Request, res: Response) {
  if (req.isAuthenticated() && req.user) return req.user;
  res.status(401).json({ error: "Sign in to continue" });
  return null;
}

async function getEditContext(editId: string, userId?: string) {
  const workspaces = await db.select().from(creatorWorkspaces);
  const workspace = workspaces.find((candidate) => (candidate.edits as WorkspaceEdit[]).some((item) => item && item.id === editId));
  if (!workspace) return null;
  const edit = (workspace.edits as WorkspaceEdit[]).find((item) => item && item.id === editId)!;
  const owner = Boolean(userId && workspace.ownerUserId === userId);
  const publicEdit = edit.status === "published" && edit.access === "public";
  return { workspace, edit, owner, canRead: owner || publicEdit };
}

function viewerName(user: { email: string | null; firstName: string | null; lastName: string | null }) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email?.split("@")[0] || "TASTEKIN member";
}

async function engagementFor(editId: string, userId?: string) {
  const [[likes], [comments], likedRows, savedRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(editLikes).where(eq(editLikes.editId, editId)),
    db.select({ count: sql<number>`count(*)::int` }).from(editComments).where(eq(editComments.editId, editId)),
    userId ? db.select().from(editLikes).where(and(eq(editLikes.editId, editId), eq(editLikes.userId, userId))) : Promise.resolve([]),
    userId ? db.select().from(editSaves).where(and(eq(editSaves.editId, editId), eq(editSaves.userId, userId))) : Promise.resolve([]),
  ]);
  return { editId, likeCount: Number(likes?.count ?? 0), commentCount: Number(comments?.count ?? 0), liked: likedRows.length > 0, saved: savedRows.length > 0 };
}

async function conversationPreview(conversation: typeof conversations.$inferSelect, userId: string) {
  const otherUserId = conversation.participantA === userId ? conversation.participantB : conversation.participantA;
  const [[other], [latest], [unread]] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, otherUserId)),
    db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id)).orderBy(desc(conversationMessages.createdAt)).limit(1),
    db.select({ count: sql<number>`count(*)::int` }).from(conversationMessages).where(and(
      eq(conversationMessages.conversationId, conversation.id),
      ne(conversationMessages.senderUserId, userId),
      isNull(conversationMessages.readAt),
    )),
  ]);
  return {
    id: conversation.id,
    participantName: other ? viewerName(other) : "TASTEKIN member",
    participantAvatar: other?.profileImageUrl ?? null,
    lastMessage: latest?.body ?? null,
    lastMessageAt: latest?.createdAt ?? null,
    unreadCount: Number(unread?.count ?? 0),
  };
}

async function conversationForViewer(conversationId: string, userId: string) {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation) return { kind: "missing" as const };
  if (conversation.participantA !== userId && conversation.participantB !== userId) return { kind: "forbidden" as const };
  await db.update(conversationMessages)
    .set({ readAt: new Date() })
    .where(and(eq(conversationMessages.conversationId, conversation.id), ne(conversationMessages.senderUserId, userId), isNull(conversationMessages.readAt)));
  const [preview, messages] = await Promise.all([
    conversationPreview(conversation, userId),
    db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id)).orderBy(conversationMessages.createdAt),
  ]);
  return { kind: "ready" as const, conversation, payload: { ...preview, messages } };
}

router.get("/edits/:editId/engagement", async (req, res): Promise<void> => {
  privateResponse(res);
  const params = GetEditEngagementParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid Edit" }); return; }
  const context = await getEditContext(params.data.editId, req.user?.id);
  if (!context) { res.status(404).json({ error: "Edit not found" }); return; }
  if (!context.canRead) { res.status(403).json({ error: "This Edit is not available to this account" }); return; }
  res.json(GetEditEngagementResponse.parse(await engagementFor(params.data.editId, req.user?.id)));
});

async function updateEngagement(req: Request, res: Response, kind: "like" | "save"): Promise<void> {
  privateResponse(res);
  const user = requireUser(req, res);
  if (!user) return;
  const params = (kind === "like" ? UpdateEditLikeParams : UpdateEditSaveParams).safeParse(req.params);
  const body = (kind === "like" ? UpdateEditLikeBody : UpdateEditSaveBody).safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid engagement update" }); return; }
  const context = await getEditContext(params.data.editId, user.id);
  if (!context) { res.status(404).json({ error: "Edit not found" }); return; }
  if (!context.canRead) { res.status(403).json({ error: "This Edit is not available to this account" }); return; }
  const table = kind === "like" ? editLikes : editSaves;
  if (body.data.active) {
    await db.insert(table).values({ editId: params.data.editId, userId: user.id }).onConflictDoNothing();
  } else {
    await db.delete(table).where(and(eq(table.editId, params.data.editId), eq(table.userId, user.id)));
  }
  const result = await engagementFor(params.data.editId, user.id);
  res.json((kind === "like" ? UpdateEditLikeResponse : UpdateEditSaveResponse).parse(result));
}

router.put("/edits/:editId/like", async (req, res): Promise<void> => updateEngagement(req, res, "like"));
router.put("/edits/:editId/save", async (req, res): Promise<void> => updateEngagement(req, res, "save"));

router.get("/edits/:editId/comments", async (req, res): Promise<void> => {
  privateResponse(res);
  const params = ListEditCommentsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid Edit" }); return; }
  const context = await getEditContext(params.data.editId, req.user?.id);
  if (!context) { res.status(404).json({ error: "Edit not found" }); return; }
  if (!context.canRead) { res.status(403).json({ error: "Comments are protected with this Edit" }); return; }
  const rows = await db.select({
    id: editComments.id, editId: editComments.editId, body: editComments.body, createdAt: editComments.createdAt,
    userId: editComments.userId, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email,
  }).from(editComments).leftJoin(usersTable, eq(editComments.userId, usersTable.id))
    .where(eq(editComments.editId, params.data.editId)).orderBy(editComments.createdAt);
  res.json(ListEditCommentsResponse.parse(rows.map((row) => ({
    id: row.id, editId: row.editId, body: row.body, createdAt: row.createdAt,
    authorName: viewerName({ firstName: row.firstName, lastName: row.lastName, email: row.email }),
    canDelete: Boolean(req.user && (row.userId === req.user.id || context.owner)),
  }))));
});

router.post("/edits/:editId/comments", async (req, res): Promise<void> => {
  privateResponse(res);
  const user = requireUser(req, res);
  if (!user) return;
  const params = CreateEditCommentParams.safeParse(req.params);
  const body = CreateEditCommentBody.safeParse(req.body);
  if (!params.success || !body.success || !body.data.body.trim()) { res.status(400).json({ error: "A comment is required" }); return; }
  const context = await getEditContext(params.data.editId, user.id);
  if (!context) { res.status(404).json({ error: "Edit not found" }); return; }
  if (!context.canRead) { res.status(403).json({ error: "Comments are protected with this Edit" }); return; }
  const [comment] = await db.insert(editComments).values({ editId: params.data.editId, userId: user.id, body: body.data.body.trim() }).returning();
  res.status(201).json(CreateEditCommentResponse.parse({
    id: comment.id, editId: comment.editId, body: comment.body, createdAt: comment.createdAt, authorName: viewerName(user), canDelete: true,
  }));
});

router.delete("/edits/:editId/comments/:commentId", async (req, res): Promise<void> => {
  privateResponse(res);
  const user = requireUser(req, res);
  if (!user) return;
  const params = DeleteEditCommentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid comment" }); return; }
  const context = await getEditContext(params.data.editId, user.id);
  if (!context) { res.status(404).json({ error: "Edit not found" }); return; }
  if (!context.canRead) { res.status(403).json({ error: "Comments are protected with this Edit" }); return; }
  const [comment] = await db.select().from(editComments).where(and(eq(editComments.id, params.data.commentId), eq(editComments.editId, params.data.editId)));
  if (!comment) { res.status(404).json({ error: "Comment not found" }); return; }
  if (comment.userId !== user.id && !context.owner) { res.status(403).json({ error: "You cannot delete this comment" }); return; }
  await db.delete(editComments).where(eq(editComments.id, comment.id));
  res.status(204).send();
});

router.get("/me/saved-edits", async (req, res): Promise<void> => {
  privateResponse(res);
  const user = requireUser(req, res);
  if (!user) return;
  const rows = await db.select({ editId: editSaves.editId }).from(editSaves).where(eq(editSaves.userId, user.id)).orderBy(desc(editSaves.createdAt));
  res.json(ListSavedEditsResponse.parse(rows.map((row) => row.editId)));
});

router.post("/creators/:username/views", async (req, res): Promise<void> => {
  const params = RecordCreatorViewParams.safeParse(req.params);
  const body = RecordCreatorViewBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(404).json({ error: "Creator not found" }); return; }
  const workspace = await creatorByUsername(params.data.username);
  if (!workspace) { res.status(404).json({ error: "Creator not found" }); return; }
  const user = req.user;
  if (!user) { res.status(201).json(RecordCreatorViewResponse.parse({ recorded: false })); return; }
  let owner = workspace.ownerUserId === user.id;
  if (body.data.editId) {
    const context = await getEditContext(body.data.editId, user.id);
    if (!context || !context.canRead || context.workspace.creatorId !== workspace.creatorId) { res.status(404).json({ error: "Edit not found" }); return; }
    owner = context.owner;
  }
  if (owner) { res.status(201).json(RecordCreatorViewResponse.parse({ recorded: false })); return; }
  const viewedSince = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const existingConditions = [
    eq(creatorViewEvents.creatorId, workspace.creatorId),
    eq(creatorViewEvents.viewerUserId, user.id),
    gt(creatorViewEvents.createdAt, viewedSince),
    body.data.editId ? eq(creatorViewEvents.editId, body.data.editId) : isNull(creatorViewEvents.editId),
  ];
  const dedupeKey = `${workspace.creatorId}:${user.id}:${body.data.editId ?? "profile"}`;
  const recorded = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${dedupeKey}))`);
    const [existing] = await tx.select({ id: creatorViewEvents.id }).from(creatorViewEvents).where(and(...existingConditions)).limit(1);
    if (existing) return false;
    await tx.insert(creatorViewEvents).values({ creatorId: workspace.creatorId, editId: body.data.editId ?? null, viewerUserId: user.id });
    return true;
  });
  res.status(201).json(RecordCreatorViewResponse.parse({ recorded }));
});

router.get("/conversations", async (req, res): Promise<void> => {
  privateResponse(res);
  const user = requireUser(req, res);
  if (!user) return;
  const rows = await db.select().from(conversations).where(or(eq(conversations.participantA, user.id), eq(conversations.participantB, user.id))).orderBy(desc(conversations.updatedAt));
  res.json(ListConversationsResponse.parse(await Promise.all(rows.map((row) => conversationPreview(row, user.id)))));
});

router.post("/conversations", async (req, res): Promise<void> => {
  privateResponse(res);
  const user = requireUser(req, res);
  if (!user) return;
  const body = CreateConversationBody.safeParse(req.body);
  if (!body.success) { res.status(404).json({ error: "Creator not found" }); return; }
  const workspace = await creatorByUsername(body.data.creatorUsername);
  if (!workspace) { res.status(404).json({ error: "Creator not found" }); return; }
  if (!workspace.ownerUserId) { res.status(409).json({ error: "Creator messaging is not available yet" }); return; }
  const [creatorAccount] = await db.select({ isVerified: usersTable.isVerified }).from(usersTable).where(eq(usersTable.id, workspace.ownerUserId)).limit(1);
  if (!creatorAccount?.isVerified) { res.status(403).json({ error: "Private messages are available only on verified creator profiles" }); return; }
  if (workspace.ownerUserId === user.id) { res.status(403).json({ error: "You cannot message yourself" }); return; }
  const [participantA, participantB] = [user.id, workspace.ownerUserId].sort();
  await db.insert(conversations).values({ participantA, participantB }).onConflictDoNothing();
  const [conversation] = await db.select().from(conversations).where(and(eq(conversations.participantA, participantA), eq(conversations.participantB, participantB)));
  if (!conversation) { res.status(500).json({ error: "Conversation could not be created" }); return; }
  const loaded = await conversationForViewer(conversation.id, user.id);
  if (loaded.kind !== "ready") { res.status(500).json({ error: "Conversation could not be loaded" }); return; }
  res.status(201).json(CreateConversationResponse.parse(loaded.payload));
});

router.get("/conversations/:conversationId", async (req, res): Promise<void> => {
  privateResponse(res);
  const user = requireUser(req, res);
  if (!user) return;
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid conversation" }); return; }
  const loaded = await conversationForViewer(params.data.conversationId, user.id);
  if (loaded.kind === "missing") { res.status(404).json({ error: "Conversation not found" }); return; }
  if (loaded.kind === "forbidden") { res.status(403).json({ error: "You are not part of this conversation" }); return; }
  res.json(GetConversationResponse.parse(loaded.payload));
});

router.post("/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  privateResponse(res);
  const user = requireUser(req, res);
  if (!user) return;
  const params = CreateConversationMessageParams.safeParse(req.params);
  const body = CreateConversationMessageBody.safeParse(req.body);
  if (!params.success || !body.success || !body.data.body.trim()) { res.status(400).json({ error: "A message is required" }); return; }
  const loaded = await conversationForViewer(params.data.conversationId, user.id);
  if (loaded.kind === "missing") { res.status(404).json({ error: "Conversation not found" }); return; }
  if (loaded.kind === "forbidden") { res.status(403).json({ error: "You are not part of this conversation" }); return; }
  const [message] = await db.insert(conversationMessages).values({ conversationId: loaded.conversation.id, senderUserId: user.id, body: body.data.body.trim() }).returning();
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, loaded.conversation.id));
  res.status(201).json(CreateConversationMessageResponse.parse(message));
});

router.get("/creator-insights", async (req, res): Promise<void> => {
  privateResponse(res);
  const user = requireUser(req, res);
  if (!user) return;
  const authorization = await requireCreator(user);
  if (!authorization.ok) { res.status(authorization.status).json({ error: authorization.error }); return; }
  const workspace = authorization.workspace;
  if (workspace.ownerUserId && workspace.ownerUserId !== user.id) { res.status(403).json({ error: "Creator ownership is required" }); return; }
  const editIds = (workspace.edits as WorkspaceEdit[]).filter((edit) => edit.status === "published" && typeof edit.id === "string").map((edit) => edit.id as string);
  const countFor = async (table: typeof editLikes | typeof editSaves | typeof editComments, editId?: string) => {
    const where = editId ? eq(table.editId, editId) : editIds.length ? inArray(table.editId, editIds) : sql`false`;
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(table).where(where);
    return Number(row?.count ?? 0);
  };
  const [profileViews, totalLikes, totalSaves, totalComments] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(creatorViewEvents).where(and(eq(creatorViewEvents.creatorId, workspace.creatorId), isNull(creatorViewEvents.editId))),
    countFor(editLikes), countFor(editSaves), countFor(editComments),
  ]);
  const edits = await Promise.all(editIds.map(async (editId) => {
    const [[likes], [saves], [comments], [views]] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(editLikes).where(eq(editLikes.editId, editId)),
      db.select({ count: sql<number>`count(*)::int` }).from(editSaves).where(eq(editSaves.editId, editId)),
      db.select({ count: sql<number>`count(*)::int` }).from(editComments).where(eq(editComments.editId, editId)),
      db.select({ count: sql<number>`count(*)::int` }).from(creatorViewEvents).where(eq(creatorViewEvents.editId, editId)),
    ]);
    return { editId, likes: Number(likes?.count ?? 0), saves: Number(saves?.count ?? 0), comments: Number(comments?.count ?? 0), views: Number(views?.count ?? 0) };
  }));
  res.json(GetCreatorInsightsResponse.parse({
    profileViews: Number(profileViews[0]?.count ?? 0), totalLikes, totalSaves, totalComments, edits,
  }));
});

export default router;
