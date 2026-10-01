---
name: GitHub connector uploads
description: GitHub connector access and source-upload behavior that differs from command-line Git authentication.
---

GitHub connector authorization does not automatically authenticate `gh` or command-line Git. Keep credentials within the connector proxy rather than extracting them to authenticate shell commands.

**Why:** The connector could read and write repositories while the GitHub CLI remained unauthenticated.

**How to apply:** Use the authenticated Git Data API when shell Git has no usable authentication. Preserve file modes, commit metadata, and parent relationships when retaining local history.

Prefer base64 Git blob uploads followed by SHA-only tree entries for source imports through the connector.

**Why:** Valid inline source in a tree request received a non-JSON 403 from the proxy, while the same source uploaded as base64 blobs succeeded. This was not an expired authorization.

**How to apply:** Check response status and content type before parsing JSON. A non-JSON proxy error alone is not a reason to request OAuth reconnection.