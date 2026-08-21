---
name: TASTEKIN featured collections
description: Scope and persistence rules for Creator Profile featured collection presentation.
---

Featured collection selection and ordering are browser-persisted presentation preferences, capped at three. They intentionally do not alter the creator workspace API payload or collection records.

**Why:** The profile refinement required persistent owner-controlled presentation while explicitly avoiding backend and existing creator-data changes.

**How to apply:** Read and write the ordered collection identifiers locally, derive displayed cards only from collections that still exist, and keep the manage controls in the existing owner workspace. Do not promote this preference into published collection data without an explicit product/API decision.