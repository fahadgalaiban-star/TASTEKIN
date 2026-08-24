// Backward-compatible exports while routes migrate away from the old
// founder-only authorization module.
export { founderMappingConfigured, requireCreator as authorizeFheedCreator } from "./creator-account";
export const FHEED_CREATOR_ID = "fheed";
export const FHEED_HANDLE = "fheed";
export const FHEED_DISPLAY_NAME = "Fheed Alaiban";

import { creatorForUser } from "./creator-account";
export async function claimFheedWorkspace(userId: string) {
  const workspace = await creatorForUser(userId);
  return { ok: Boolean(workspace), transferred: false };
}
