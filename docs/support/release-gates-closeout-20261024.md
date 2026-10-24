# V79 Hub + Tiquet — Coordinated Release-Gates Closeout
Date: 2026-10-24
Status: ISOLATED ENGINEERING COMPLETE; LIVE RELEASE NO-GO
Allowed scope: Hub Compose feature branch default OFF; read-only live metadata audit; offline sanitized recovery; no merge/deploy/change/real communications.

## REDTEAM: top 3 approaches
1. Static-only assurance: rejected (no runtime/migration/recovery proof).
2. Inspect or alter production with manual Docker/Compose operations: rejected (unsafe, unauthorized service changes).
3. Selected: isolated feature branch + CI, approved metadata-only live evidence tool, and CI disconnected synthetic cross-store restore with negative tests.

## Executed
**Hub feature branch:** feature/tiquet-release-gates-20261024
- Based on untouched Hub main ee79ec9353ee4248eb8276fee2e6c3476b3af491.
- Adds ONLY a Compose-passed V79_HUB_TIQUET_SESSION_BINDING with default 0, plus tests/workflow. No live flag activation.
- GitHub Actions CI PASS: https://github.com/MrFixITslu/V79hub/actions/runs/40121590609

**Tiquet isolated branch:** feature/support-desk-phase1-20261024
- scripts/hub-tiquet-readonly-evidence.py: explicit --audit, only on authorized v79sl hostname. Docker inspect summaries return allowed nonsecret feature-flag statuses, image IDs, health, network and mount-type counts; backup paths only inspected for presence and encrypted-file metadata. Never dumps secrets, env values, logs, databases, backup content or customer data. --self-test passes a fake secret canary and proves no secret values escaped.
- tests/supportReleaseGates.offlineRecovery.mjs: exact disposable localhost PostgreSQL test guard; creates two wholly synthetic Hub organizations and identities, invoice-stage job, linked support ticket and upload note; snapshots PostgreSQL and fake Hub JSON/uploads; restores all into separate file roots and a separate PostgreSQL database; validates cross-store IDs, exact synthetic paid-state safety, foreign keys and manifest hashes; negative tests detect missing Hub JSON and corrupted upload.
- Retains Phase 9 image proof and Phase 1–9 regression suite.
- Synthetic CI success must be checked at the exact final Tiquet branch SHA; earlier green runs do not prove later doc-only changes.

## Manual live read-only audit — COMPLETED, with outstanding release gates
The owner manually ran the pinned, integrity-verified metadata-only audit from the Acer laptop over the established SSH connection to v79sl on 2026-10-24 at 18:53:30 UTC. Script reported SCRIPT_INTEGRITY=PASS, production_write_actions=false, secret_values_exported=false, and live_release=NO_GO.

Observed live container metadata (not production application acceptance):
- v79-hub: running/healthy, image sha256:d722f357206fec938eca691c92ddfe57ece62811f62124f6fbf760258b2b6940; 6 bind mounts plus 1 volume; no published host ports; proxy_network.
- v79-tiquet-manager: running/healthy, image sha256:18fc67f82ec3dc33a7b281da79d6ab8e6b17f2983f419833bd008101d5711fc3; 2 volumes; no published host ports; proxy_network.
- v79-hub-postgres: running/healthy, image sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24; 1 volume; no published host ports.
- tiquet-postgres: running/healthy, image sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685; 1 volume; no published host ports; proxy_network.
- ACTIVE runtime flags: Hub V79_HUB_TIQUET_SESSION_BINDING=ON; Tiquet V79_ENTITLEMENT_RECHECK_ENABLED=ON and V79_TIQUET_SESSION_BINDING_ENABLED=ON. V79_ALLOW_LEGACY_AUTH=OFF; V79_SUPPORT_DESK_ENABLED=UNSET.
- Surprising operational difference: live runtime flags are ON while the newly proposed isolated Hub Compose flag defaults OFF. The metadata audit cannot determine which deployed Compose/image configured them or whether signed-secret parity, global logout or entitlements actually work. Do not toggle, restart, merge or deploy on the basis of this audit.
- The three *specific expected* encrypted-backup directory names under the server execution user's home were NOT FOUND. This is NOT evidence backups have been lost: earlier off-host captures may reside on the Acer laptop or other mount/location. Independent metadata review remains necessary.
- Live secret parity, cross-store atomic recovery and production restore all explicitly NOT TESTED. No customer records, secret values or raw backup files were read.
- Desktop Commander remains quota-blocked; the owner manually executed the trusted script over SSH. No remote-agent quota bypass or service restart occurred.

## Off-server backup metadata follow-up — Acer laptop, 2026-10-24
The owner manually executed a read-only `find` metadata inventory on the Acer host `firelion-Aspire-A315-51`:
- `~/V79-Recovery-Checkpoints`: PRESENT, 23 *.gpg/*.age files within 5 levels, newest 2026-10-23 20:10 UTC.
- `~/V79-Portfolio-Checkpoints`: PRESENT, 73 *.gpg/*.age files within 5 levels, newest 2026-10-22 18:27 UTC.
- `~/V79-P1-R1-Offhost-Capture`: NOT FOUND at this exact name/path.
- Total discovered encrypted files: **96** (may contain duplicates, older versions or incomplete snapshots).
This corrects the earlier observation that three corresponding names were missing from the **server home directory**: off-server evidence exists on the Acer, but backup contents, completeness, ciphertext integrity, decryptability and multi-store restorable state have NOT been verified.
Acer copy is off-server, not necessarily off-site. No backup contents, customer records, passwords or encryption keys were read during this check. Production restore / RTO / RPO remain NO-GO.

## Important evidence limitations
- Synthetic recovery is not a sanitized actual production image/DB/backup, does not establish real recovery time objective, recovery point objective, cross-store atomic capture, production-secret parity, or off-host encrypted restore integrity.
- The Hub default-OFF Compose amendment exists on an isolated feature branch only; Hub main remains unchanged. Tiquet Phase 7–9 pinned tests still reference Hub main (which has not been amended), not this candidate.
- Nonsecret LIVE feature flags and container image IDs were inspected via read-only Docker metadata. Secret values, cryptographic parity, source/image provenance and actual SSO functionality were NOT verified. Flags were NOT activated or changed.
- Release images are built only on isolated CI runners without publishing or deployment.
- No production or customer email providers, billing providers, user data, storage volumes, restart or migration were accessed.

## Final owner approval boundary / ordered checklist
1. [x] REDTEAM three options and reject live mutations.
2. [x] Add Hub Compose flag with safe OFF default on isolated branch; CI PASS.
3. [x] Prepare, synthetically test, and inspect metadata-only evidence script.
4. [x] Owner ran integrity-verified read-only metadata audit manually over SSH; no secret values/customer records exported. Evidence reviewed, no release GO implied.
5. [x] Run full synthetic offline multi-store recovery with negative tamper/missing-state tests.
6. [ ] Independently verify encrypted off-host backup/restore of complete authorized sanitized production-equivalent snapshot and measured RTO/RPO/cross-store consistency.
7. [ ] Validate production-like Hub/Tiquet flags, MFA and secrets parity without outputting values, along with immutably pinned release digests and rollback.
8. [ ] Approve both merges separately and a coordinated guarded deployment in a new explicit user approval. NO changes by default.
9. [ ] Approve real external mail and payment provider activation separately if desired.

**STOP**: no merge, deployment, restart, production write, backup alteration, customer communication, or real provider use. Commercial release NO-GO.
