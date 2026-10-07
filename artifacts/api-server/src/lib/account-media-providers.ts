import { deleteBunnyVideo, findOrphanCandidateByTitle } from "./bunny-stream";
import { deleteClosetMedia, deletePrivateMedia } from "./private-media-storage";

// Injectable transports let recovery tests use real ledger transactions without
// contacting either provider. Runtime callers use the existing idempotent helpers.
export const accountMediaProviders = {
  deleteCreatorPhoto: deletePrivateMedia,
  deleteClosetPhoto: deleteClosetMedia,
  deleteVideo: deleteBunnyVideo,
  findVideo: findOrphanCandidateByTitle,
};
export type AccountMediaProviders = typeof accountMediaProviders;
