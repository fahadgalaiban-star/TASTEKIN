---
name: TASTEKIN Bunny playback validation
description: Browser-codec constraint affecting end-to-end validation of Bunny HLS playback.
---

Do not treat `manifestIncompatibleCodecsError` in Replit’s automated Chromium as proof that a valid Bunny HLS stream is broken when the manifest advertises H.264/AAC.

**Why:** The test browser exposes MediaSource but reports both H.264 and AAC unsupported. Bunny’s own embed player fails identically there, while the referrer-qualified master manifest, every rendition playlist, and media segments are valid and reachable.

**How to apply:** Validate URL generation, manifest/rendition/segment responses, CORS/referrer behavior, and stream codecs in Replit. Confirm real-time playback progression in a codec-enabled browser before release.