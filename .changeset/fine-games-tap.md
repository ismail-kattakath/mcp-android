---
"@ismail-kattakath/mcp-android": patch
---

Fix multi-platform Docker build: use --platform=$BUILDPLATFORM in builder stage to avoid QEMU arm64 illegal instruction crash during npm install.
