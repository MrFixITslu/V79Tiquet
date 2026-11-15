# Tiquet live server baseline for FFPRO planning integration

Production container source: v79-tiquet-manager, localhost/v79-tiquet-customer-workflow:20261109-r1.
Exact server/index.js SHA256 a1ef9f6babc4765a9b69a9e69e6d719fb0891a948b4cd3efe84536f7adfd88a5.
This review branch was created from historical Git HEAD 074a1d8 with deployed /app/server overlaid byte-for-byte.
The original V79Tiquet main with 36 WIP paths is untouched.
Pure account-link and billing-signature tests: 6/6 PASS in isolated worktree.
Only production *server source* is preserved here, not a verified byte-for-byte complete production image.
Additional front-end/static/database compatibility work is required before a releasable candidate.
No Tiquet or FFPRO production changes, GitHub push, merge or deployment.
See /home/firelion/v79-integration-review-20261114/READINESS.md for workflow contract and red-team.
