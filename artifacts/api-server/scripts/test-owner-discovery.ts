import assert from "node:assert/strict";
import { creatorWorkspaces, db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSession } from "../src/lib/auth";

async function main() {
  const apiBaseUrl = process.env.TASTEKIN_API_URL ?? "http://127.0.0.1:8080";
  const ownerId = `taste-match-owner-test-${Date.now()}`;
  const [workspace] = await db
    .select()
    .from(creatorWorkspaces)
    .where(eq(creatorWorkspaces.creatorId, "fheed"));

  assert.ok(workspace, "The Fheed workspace must exist before owner discovery can be tested.");
  const originalOwnerId = workspace.ownerUserId;
  let sid: string | undefined;

  try {
    await db
      .update(creatorWorkspaces)
      .set({ ownerUserId: ownerId, updatedAt: new Date() })
      .where(eq(creatorWorkspaces.creatorId, "fheed"));
    sid = await createSession({
      user: {
        id: ownerId,
        email: "taste-match-owner-test@example.com",
        firstName: "Taste",
        lastName: "Owner",
        profileImageUrl: null,
      },
      accessToken: "test-only",
      expiresAt: Date.now() + 60_000,
    });

    for (const suffix of [
      "?sort=best",
      "?sort=new",
      "?sort=best&category=Fashion",
      "?sort=best&q=Fheed",
    ]) {
      const response = await fetch(`${apiBaseUrl}/api/explore${suffix}`, {
        headers: { Cookie: `sid=${sid}` },
      });
      assert.equal(response.status, 200, `Explore request ${suffix} should succeed.`);
      const body = await response.json() as { authenticated: boolean; creators: Array<{ username: string; matchScore: number | null }> };
      assert.equal(body.authenticated, true, `Explore request ${suffix} must use the owner session.`);
      assert.ok(body.creators.every((creator) => creator.username !== "fheed"), `Explore request ${suffix} must exclude Fheed from their own results.`);
      assert.ok(body.creators.every((creator) => creator.matchScore === null || creator.username !== "fheed"), `Explore request ${suffix} must not expose a self-match.`);
    }

    console.log("Authenticated owner Explore self-exclusion tests passed.");
  } finally {
    if (sid) {
      await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
    }
    await db
      .update(creatorWorkspaces)
      .set({ ownerUserId: originalOwnerId, updatedAt: new Date() })
      .where(eq(creatorWorkspaces.creatorId, "fheed"));
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});