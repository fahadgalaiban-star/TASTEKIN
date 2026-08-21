---
name: TASTEKIN crop media lifecycle
description: Rules for safely persisting and cleaning creator crop renditions.
---

Fresh source, cropped, and blurred-preview renditions must be tracked as discardable only until the creator workspace save starts. Cleanup applies to canceled, failed, or conflicted saves—not an in-flight or successful save.

**Why:** A navigation or page-exit cleanup racing a successful workspace commit can delete media that the newly persisted Edit references.

**How to apply:** Any future change to the crop, publish, navigation, or unload flow must preserve this state transition: mark fresh paths non-discardable before a workspace PUT; clear tracking after success; clean only the freshly tracked paths after failure or explicit abandonment.

Crop confirmation applies a local rendered preview first and retains the three File renditions in memory; protected uploads occur only on Save Draft or Publish.

**Why:** Authentication or network failure must not stop a creator from seeing and adjusting the crop they just made.

**How to apply:** Keep local previews and unuploaded Files alive across composer and preview navigation. On a successful save, replace the object URL with private storage paths; on cancellation, discard the local URLs and files.

The private-upload cleanup endpoint must reject any rendition path that is already referenced by a workspace Edit.

**Why:** A client can lose a successful save response and mistakenly try to clean media that the server already committed.

**How to apply:** Treat workspace references as the server-authoritative committed state; only allow deletion of valid UUID-backed private paths that are not referenced by source, delivery, or locked-preview fields.

Replacing a saved crop creates a new rendition trio; clean the old trio only after the replacement workspace revision commits.

**Why:** Cleanup before commit risks breaking the existing Edit when the save fails, while never cleaning after success leaves private object orphans.

**How to apply:** Snapshot only UUID-backed prior rendition paths, save the replacement first, then delete the prior paths that are no longer referenced by the committed workspace.