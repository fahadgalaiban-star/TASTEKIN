---
name: TASTEKIN OpenAPI URL fields
description: How private object-path fields should be represented in the generated API contract.
---

Private media is represented by app-relative object paths such as `/objects/uploads/<id>`, rather than externally resolvable absolute URLs. Do not mark these fields with an OpenAPI `uri` format.

**Why:** The current Zod generation stack validates URI-formatted fields as absolute URLs, which rejects valid private storage paths and prevents the generated contract from matching the app’s protected-media routing.

**How to apply:** Keep object-path fields as plain bounded strings in the OpenAPI schema. Resolve them to the API storage route only in the web client.