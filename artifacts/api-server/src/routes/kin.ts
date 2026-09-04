import { closetItems, db } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";

import { isFeatureEnabled } from "../lib/feature-flags";
import { runKinSearch, validateKinSearchRequest } from "../lib/kin-search";
import { requireUser } from "./engagement";

const router: IRouter = Router();

function requireUserMw(req: Request, res: Response, next: NextFunction) {
  const user = requireUser(req, res);
  if (!user) return;
  next();
}

async function kinSearchFlagMw(_req: Request, res: Response, next: NextFunction) {
  if (!(await isFeatureEnabled("kin_search"))) {
    res.status(403).json({ error: "KIN is not available right now" });
    return;
  }
  next();
}

/**
 * Builds a short, text-only description of a member's own wardrobe item to
 * hand to the model as context. Never the image itself, never the private
 * object key — only the taxonomy fields the member already entered. Scoped
 * to the requesting user regardless of whether my_things itself is
 * currently enabled: the item already belongs to them either way, and
 * my_things's flag only gates the My Things UI/API surface, not whether an
 * owner's own existing data can be referenced elsewhere.
 */
async function myThingsItemContext(ownerUserId: string, itemId: string): Promise<string | null> {
  const [item] = await db
    .select({
      itemType: closetItems.itemType, primaryColor: closetItems.primaryColor,
      style: closetItems.style, occasion: closetItems.occasion,
      season: closetItems.season, brand: closetItems.brand,
    })
    .from(closetItems)
    .where(and(eq(closetItems.id, itemId), eq(closetItems.ownerUserId, ownerUserId)));
  if (!item) return null;
  const parts = [item.itemType, item.primaryColor];
  if (item.style) parts.push(item.style);
  if (item.occasion) parts.push(item.occasion);
  if (item.season) parts.push(item.season);
  if (item.brand) parts.push(item.brand);
  return parts.join(", ");
}

/**
 * Authenticated KIN search foundation for KIN Looks and KIN Travel. Never
 * persists a search — no request, response, or wardrobe context is written
 * anywhere. Always responds 200 with `{ status: "ok", ... }` or
 * `{ status: "unavailable", reason }` for any well-formed, authorized
 * request; the only non-200s are validation (400), auth (401), and the
 * feature flag (403).
 */
router.post("/kin/search", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const validated = validateKinSearchRequest(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  let itemContext: string | undefined;
  if (validated.value.myThingsItemId) {
    const context = await myThingsItemContext(user.id, validated.value.myThingsItemId);
    if (!context) {
      res.status(400).json({ error: "Selected item not found" });
      return;
    }
    itemContext = context;
  }

  const result = await runKinSearch(validated.value, itemContext);
  if (result.status !== "ok") {
    if (result.reason !== "not configured") {
      req.log.warn({ reason: result.reason, userId: user.id, mode: validated.value.mode }, "KIN search unavailable");
    }
    res.json({ status: "unavailable", reason: "unavailable" });
    return;
  }
  res.json(result);
});

export default router;
