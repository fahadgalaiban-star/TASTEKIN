---
name: TASTEKIN Bunny TUS authentication
description: Provider-specific authentication behavior for direct Bunny Stream resumable uploads.
---

Bunny Stream requires `AuthorizationSignature`, `AuthorizationExpire`, `VideoId`, and `LibraryId` on every TUS operation, including resource `HEAD` and chunk `PATCH`, not only the initial `POST`.

**Why:** Bunny accepts an authenticated upload-creation `POST` with HTTP 201, then returns HTTP 400 for the immediate `HEAD` when those headers are omitted. The same `HEAD` succeeds with HTTP 200 when they are present.

**How to apply:** Any TUS implementation or refactor must attach the same current authorization headers to create, offset-check, and chunk-upload requests. Provider fakes should reject unauthenticated `HEAD` and `PATCH` requests.