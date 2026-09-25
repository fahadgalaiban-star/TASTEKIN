---
name: GitHub PR publishing in this workspace
description: Reliable review-branch creation when shell Git authentication fails but the connected GitHub API works.
---

The GitHub connector can be authorized even when `gh` has no login and a normal `git push` fails authentication. For a review branch in this situation, the connected GitHub REST API can create a tree based on the intended parent tree, a commit with that parent, a branch reference, and a PR. Compare the created tree SHA with the tested local commit's tree before creating the reference. GitHub may assign its API-created commit a different SHA even when its tree and parent are identical; if the remote branch is fetchable, align only the local **feature** branch after verifying both trees and the parent. Never reset a preserved `main` branch to do this.

**Why:** Shell Git and the workspace's GitHub connector use different authorization paths. The tree/parent checks prevent posting a different change than the one tested, and aligning the feature branch avoids later non-fast-forward pushes.

**How to apply:** Only when a user requests a PR and Git push authentication fails. Use the authorized connector without exposing credentials; verify the base SHA, matching trees, and branch state before posting or aligning anything. Do not use this as a reason to force-push or alter `main`.