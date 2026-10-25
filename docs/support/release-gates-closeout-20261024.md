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

## Encrypted archive coverage and size (owner's Acer, manual scan)
- Recovery Checkpoints: 23 encrypted .gpg/.age files, 1.09 GiB combined, 0 zero-byte files, 0 Hub-name path matches, 0 Tiquet-name path matches. Generic names do not establish missing coverage.
- Portfolio Checkpoints: 73 encrypted files, 3.84 GiB combined, 0 zero-byte files, 36 Hub-name path matches and 15 Tiquet-name path matches. Matches are path/name signals only; they may overlap or repeat and cannot verify file content.
- Total: 96 encrypted files, 4.93 GiB rounded, zero empty archives.
- REDTEAM decision: avoid repetitive discovery or decrypting customer-bearing snapshots without separate authorization. Next permitted evidence step is manifest/checksum discovery and ciphertext hash verification only, with no live access and no decryption.
- Release decision remains **NO-GO** until coverage, integrity, decryption and isolated complete recoverability are independently verified; no RTO/RPO claim.

## Ciphertext SHA-256 verification — Acer manual check, 2026-10-24
The owner executed the manifest-driven **read-only** SHA-256 and expected-size verifier from the Acer `firelion-Aspire-A315-51`. The three manifest lists use recorded `name`, `bytes`, `sha256` entries; the checker resolved archive references without ambiguity and streamed the encrypted bytes without decrypting them:
- S2 October 22 (s2-20261022T182118Z-4fc56843): **15/15 PASS**.
- S2 October 21 (s2-20261021T123846Z-f7b53863): **14/14 PASS**.
- R18 October 19 (r18-d9Yt4fJ1): **12/12 PASS**.
- Total **41/41 manifest-listed ciphertext references PASS**. MISSING=0; AMBIGUOUS=0; SIZE_MISMATCH=0; HASH_MISMATCH=0; INVALID_RECORD=0.
- Operator output explicitly states CIPHERTEXT_INTEGRITY=PASS_41_OF_41, DECRYPTION=NONE, FILES_MODIFIED=NONE, PRODUCTION_CONTACT=NONE.
- These are *manifest entries*, not a claim of 41 different physical files or all 96 discovered backups; independent signature/trust of manifests was not established.
- **Closed gate:** the listed ciphertext files presently match their stored checksums and sizes on the Acer. **Open gates:** manifest authenticity, decryption, archive contents/completeness, cross-store consistent recovery, actual off-host encrypted restore with measurements, and production authorization. Commercial beta still **NO-GO**.
- REDTEAM: no further discovery loop and no implicit authorization to decrypt any customer-bearing archive. Separately approve and isolate any real backup decryption/restoration, with least-privilege keys, no external network, no customer data export and exact path guards.

## S2 Acer restore preflight and cached-image identity inventory (owner run, Oct 24)
- Current S2 2026-10-22: 15/15 verified encrypted files (0.77 GiB), 10/10 mount-artifact references, GPG recipient private key matched; 642.2 GiB free disk, 7.7 GiB available RAM, 5.8 GiB free /dev/shm. All three required Hub/Tiquet data mount destinations MAPPED.
- Early S2 role-hint counter incorrectly counted substring `pg` inside `.gpg` extension. Corrected metadata-only inventory verified: one Hub DB-name hint, one Tiquet DB-name hint, one encrypted images-name hint, 10 mount-name hints, one config-name hint and one unclassified; names are **not contents proof**.
- Rootless Podman = true; cached images = 7; PostgreSQL 16 candidates = 2 and PostgreSQL 17 candidates = 2 by local image metadata. **None** of five S2 image digests directly matches cached reported IDs; no image identity proof yet.
- Swapfile 2 GiB in size, **0 bytes used**. It remains enabled. Network active/default routes were observed at earlier preflight. No decryption, image import, container boot, backup write, or production contact occurred.
- REDTEAM selected: code-reviewable, separately hash-pinned S2-specific OCI identity proof that operates only **after network interfaces/routes are disabled and swap disabled**, streams encrypted images through GPG to a bounded in-memory TAR parser without extraction or importing. Synthetic OCI positive/negative tests PASS, but owner Acer execution **NOT YET PERFORMED**. Full restoration still blocked until image identity and complete layout/capacity gates clear.
- **No release GO.** Existing R1 pinned image proof uses older images and cannot be treated as S2 identity proof. This record does not authorize live operations.

## S2 guarded offline OCI run — Acer safe-stop and v2 correction (2026-10-24)
- Owner hash-verified the initial `v79_s2_offline_oci_proof_v1.py` and `RUN_V79_S2_Guarded_Offline_OCI_v1.sh` and subsequently the reversible isolation wrapper. First isolated wrapper attempt returned `SAFE_STOP=INTERFACE_ACTIVE_OR_UNKNOWN`; network inventory later identified active Wi-Fi and Tailscale/default routes.
- After hash-validating `RUN_V79_S2_Reversible_Isolation_v1.sh`, owner's next run returned **`SAFE_STOP=SWAP_IN_USE`** immediately after script hash output; reversible wrapper evaluates swap *before* registering cleanup or touching Wi-Fi/Tailscale/swap. No OCI image proof, import, restoration or decryption is claimed.
- Source review identified exact string comparisons `swapon --noheadings --show=USED --bytes == '0'` in both original shell runners. A whitespace-padded zero can falsely trigger STOP, but actual nonzero usage is still possible; current swap usage must not be assumed zero.
- Prepared only local downloadable **v2** variants of inner OCI runner and outer reversible isolation wrapper with whitespace-tolerant **zero-only** regex; nonzero/unknown/blank still stop. Syntax tests of both scripts PASS; isolated parser test cases PASS 10/10 (zero and invalid). Existing v1 OCI Python proof remains unchanged and SHA-pinned. No CI/prod code or live containers altered by these local script preparations.
- Next step requires owner to hash-verify both v2 shell files, confirm current swap with read-only `swapon --show=NAME,USED --bytes`, and run *only at the physical Acer terminal*. Network/swap restoration must be confirmed. Commercial release **NO-GO** until real isolated recovery is proven.

## S2 OCI offline proof on Acer — 81/81 verified, database indexes need platform-aware proof (owner run)
- User verified original OCI proof and reversible isolation script hashes. Their **real offline execution** on Acer passed S2 image ciphertext SHA256, offline/no swap guard, TAR members 86, OCI blob hashes **81/81**, three application pins (Hub, Tiquet manager, Business Agent) **PASS**.
- PostgreSQL pins `v79-hub-postgres` and `tiquet-postgres` reported **REVIEW_REQUIRED**. Aggregate resolved configuration count **7**, while direct pin links were **3/5**. A likely explanation is multi-platform OCI image index entries including non-Linux/amd64 manifests or attestations; this is a *hypothesis*, not yet proven by inspection of actual index internals. No image was imported and no data restored.
- Post-run safeguards explicitly reported `SWAP_RESTORED=PASS`, `SWAP_BASELINE_RESTORED=PASS`, `WIFI_RADIO_RESTORED=PASS`, `TAILSCALE_SERVICE_RESTORED=PASS`, `LOCAL_BASELINE_RESTORE=PASS_CONFIGURATION_ONLY`. These prove restoration of sampled configuration, not full connectivity testing.
- REDTEAM: reject assuming arbitrary PG16/17 image versions match the pinned OCI images, reject altering live containers and reject bypassing the offline guard. Prepared a local **v2 platform-aware OCI resolver and v3 pinned/reversible runners**, generated deterministically from previously verified Acer scripts (no download needed). Tests on synthetic single-platform image IDs and missing-pin negative cases PASSED; the exact v2 script + v3 shell wrapper hashes verified locally. A real run **HAS NOT OCCURRED**.
- Scope next: recreate pinned files on Acer, self-test, then run guarded physical-terminal isolation for a **single** repeat of OCI metadata proof; stop if either PG pin remains ambiguous. No restoration/merge/production access authorized by this result; beta remains NO-GO.

## S2 image proof: complete (Acer operator report, Oct 24)
- Owner's offline V3 run passed 81/81 OCI blob digests and all 5/5 Linux amd64 image identity links, including both PostgreSQL roles.
- Reported host isolation and swap-off checks passed. The wrapper also reported successful swap, Wi-Fi and Tailscale configuration restoration.
- No image import, container startup, data recovery or production contact occurred.
- The next gate is an isolated S2 dual-database restore with exact local image selection and cleanup proof. Commercial release remains NO-GO.

## S2 PostgreSQL cached image selection — owner read-only Acer check
- S2 manifest PG image pins match R1: **PASS 2/2**. Acer rootless Podman cache currently shows two PG16 candidates (`275447c94b11b151`, `75f5a96988cdf694`) and two PG17 candidates (`327daa8fae7178d6`, `79bd7c99e923138f`), reported as 16-character image ID prefixes only.
- The number and major versions of local images do NOT prove the exact S2 config identities. No image imported, no archive decrypted and no production contacted during this local cache inventory.
- Added a source-hash-pinned **local generator** on isolated Hub feature branch, commit `31bb3665b0c02d2ae650614eecdd71d364e29f08`, path `scripts/GENERATE_V79_S2_PG_Cache_Gate_v1.py`; source Git blob `8eaf87f0e452f21d607836eb2a2a9e4be8415a14` confirmed.
- The generator is not a DB restoration: it creates a separate platform-aware exact-OCI-configuration-to-rootless-Podman-PG-image comparison and guarded isolation runners from the original pinned Acer files. Synthetic creation checks passed; **no owner run of this new gate yet**.
- Pending: exact PG16/17 cache config ID match under offline guard, then new real-data PostgreSQL restore design/preflight, rootless network=none tmpfs-backed disposable containers and cleanup evidence. NO production or beta authorization.

## S2 exact cached PostgreSQL image gate — PASS
On Oct 24, the owner ran the guarded Acer v4 proof: all 81 OCI blobs verified, all five S2 OCI identities verified, and both Tiquet PG16 and Hub PG17 exact local Podman image configurations matched. Reported swap/Wi-Fi/Tailscale configuration restoration passed. No image import, database restore, or production contact occurred.
The isolated Hub feature branch now has a separately pinned S2 offline dual-database restore runner, commit 8ec9ce5accffca17be2d1da7747eefcf7ae58450, script SHA256 a5029eeb2b98a2363df3ef7aee57375c2fc6df356f33f25687303e3a0404ac4d. Local synthetic selection, tamper, and cleanup checks passed. Real database recovery NOT RUN. Commercial release remains NO-GO.

## S2 actual offline DB restore first attempt — SAFE STOP, not a restore PASS
Owner ran guarded offline dual-PG restore on Acer, 2026-10-24. Backup/archive role selection PASS 2/2; all 81 OCI hashes and five image pins PASS; both exact cached PG image configurations PASS. The Hub DB container started but the **first pre-decryption container mount verification stopped**: `SAFE_STOP=DATABASE_NOT_TMPFS_BACKED`. The operator log confirms `S2_HUB_PG_CONTAINER_REMOVED=PASS`; no Hub/Tiquet dump was decrypted, no data restored, and the Tiquet container was not created. Swap, Wi-Fi, Tailscale configuration restoration PASS. Production contact NONE, beta release NO-GO.
Cause of guard stop: the v1 checker assumed Docker-style `HostConfig.Tmpfs` metadata, but Podman's inspect representation may omit tmpfs mounts; this is a verification mismatch, not proven filesystem failure.
REDTEAM: reject disabling the tmpfs check or forcing restore. On Hub feature branch, added S2 dual-PG restore **v2** source (commit `c95c0e5ef333fbadad165a9839c25457d04c8170`): it explicitly ignores image-declared anonymous volumes, rejects persistent/user binds and non-isolated networks, and checks kernel runtime filesystem type `tmpfs` for PGDATA, PG socket directory and /tmp before any archive decryption.
Mock-based tests cover three tmpfs mounts, overlay non-tmpfs refusal, persistent volume/bind refusal, network/rootfs violations, and a failed-start cleanup path; CI **40144176480 SUCCESS** at commit `78942b942b34bdd0907faa7cd8785969064f2afd`.
**Real v2 execution NOT YET PERFORMED.** No merge, production restart/write, image import, customer outreach or deployment authorized.
  
## S2 v2 database restore — swap preflight safe stop (Oct 24)
- Acer V2 source integrity, script self-test and guarded runner preparation all PASS.
- Read-only `swapon --show=NAME,USED --bytes` reported `/swapfile 12288` (12 KiB in use).
- The owner's guarded V2 invocation passed source hash checks and returned `SAFE_STOP=SWAP_IN_USE` **before offline isolation or database restore**. No PostgreSQL archive decryption or startup occurred in this attempt.
- Keep fail-closed guard; do not bypass. Next step is separately guarded, minimal swap reset **only if** current Acer RAM safety checks and no leftover S2 containers pass. Then repeat V2 once when swap usage is exactly zero.
- Actual real S2 Hub/Tiquet database restores remain **NOT VERIFIED**, commercial release **NO-GO**.

## S2 dual-PG v2 first actual database restore — structural stage reached; validation bug
The owner ran guarded S2 V2 on the Acer after a successful zero-usage swap drain. The offline host, archive role selection, 81 OCI blob hashes, five saved image pins and both exact cached PostgreSQL image configurations passed. The Hub disposable container started; three actual runtime tmpfs checks passed and the pg_restore command returned without raising a reported error. The table-count query then raised Python AttributeError because it called `.isdecimal()` on **bytes**, not str. The report includes `S2_HUB_PG_CONTAINER_REMOVED=PASS`; the Tiquet restore was not attempted. Guarded cleanup reported swap, Wi-Fi and Tailscale restoration PASS. This is **NOT** a complete real database restore PASS, despite strong evidence Hub reached the final structural validation stage.
Fix: new S2 V3 runner on isolated Hub feature branch, pinned immutable source commit `fc19652be1d65673605c1e371a4571bee6538963`, Git blob `538bf675671119f6a58c74ec61151591e47011cf`, strictly validates a positive integer encoded as bytes and prints only count. The existing offline isolation, no network, tmpfs, exact cached image identity, removal and fail-closed guards remain. Synthetic self-tests and runtime mock tests **CI PASS** in run `40146189420`. The v3 owner run and real Tiquet database restore are **NOT YET DONE**. No production contact. Commercial release NO-GO.

## S2 real offline dual-PostgreSQL restore — PASS (owner Acer run, Oct 24)
- Guarded S2 V3 real-backup restore completed successfully in an isolated Acer execution. Image archive: **81/81** OCI blobs hash verified, **5/5** Linux/amd64 pins matched, and both exact local PostgreSQL 16/17 configurations matched the S2 image IDs.
- Original Hub and Tiquet encrypted S2 PostgreSQL dumps were streamed into separate temporary rootless PostgreSQL containers with `network=none`; the runtime filesystem check reported `ISOLATED_PG_RUNTIME_TMPFS=PASS_3_OF_3` for both databases.
- **`S2_HUB_DB_RESTORE=PASS`, `S2_HUB_USER_TABLE_COUNT=1`; `S2_TIQUET_DB_RESTORE=PASS`, `S2_TIQUET_USER_TABLE_COUNT=25`; `S2_TWO_REAL_PG_DATABASE_RESTORES=PASS`.**
- Both disposable database containers were independently verified removed: `S2_HUB_PG_CONTAINER_REMOVED=PASS`, `S2_TIQUET_PG_CONTAINER_REMOVED=PASS`. No archived customer-record values were output.
- Network/offline guard passed. Post-cleanup configuration: `SWAP_RESTORED=PASS`, `SWAP_BASELINE_RESTORED=PASS`, `WIFI_RADIO_RESTORED=PASS`, `TAILSCALE_SERVICE_RESTORED=PASS`. `PRODUCTION_CONTACT=NONE`.
- This **closes the real S2 database decryptability and structural restore gate**. Do not repeat the database stage without a new reason. Counts are not proof of application compatibility, complete business workflow recovery, cross-store capture consistency or production RTO/RPO. The test was a memory-only rehearsal, not a retained recovered database.
- **Next scope:** selectively validate/restore only Hub `/app/data`, Tiquet `/app/data`, and Tiquet `/app/uploads` from the ten S2 mount artifacts, excluding archived secrets and live configuration. Then isolated application acceptance with synthetic credentials and no providers. Commercial release remains **NO-GO**; no merge/deployment is authorized.

## S2 selected application-data archive coverage — PASS 3/3 (owner Acer)
The read-only October 22 S2 manifest cross-reference identified unique encrypted file records for Hub `/app/data` (rounded 0.0 MiB), Tiquet `/app/data` (0.2 MiB) and Tiquet `/app/uploads` (1.1 MiB), with **APP_DATA_ARCHIVE_MAPPINGS=3/3**. `DECRYPTION=NONE`, `RESTORE=NONE` and `PRODUCTION_CONTACT=NONE` for this inventory. Rounding does not imply empty backup.
Prepared a local standalone Acer-only archive extractor and synthetic tests with strict 3-mount selection, SHA256 checks, GPG stream to bounded /dev/shm, TAR path/symlink/device and size caps, randomized scratch directory and verified removal. Generated pinned reversible v4-derived wrappers with explicit fail-closed handling if RAM scratch remains. Unit self-test, wrapper shell syntax and exact script digests PASSED locally; **real S2 application archives have NOT been decrypted/extracted or functionally accepted yet**. This preparation does not establish full application restore or production readiness. Commercial release remains **NO-GO**.

## S2 application-data offline V1 safe stop (owner report, 2026-10-24)
- The owner ran the guarded S2 RAM-only app-data restore on the Acer. Offline and swap-off verification PASS; S2 three archive ciphertext checks PASS. A decrypted TAR member failed the allowlisted path prefix: `SAFE_STOP=TAR_MEMBER_OUTSIDE_APPROVED_MOUNT`. **No complete application-data restore is proven.**
- Original temporary scratch cleanup `S2_APP_RAM_SCRATCH_REMOVED=PASS`; swap, Wi-Fi and Tailscale baseline configuration reported PASS; production contact NONE. Do not repeat V1 unchanged or bypass path safety.
- REDTEAM: possible inert archive ancestor directory header (e.g. `app/`), not yet confirmed. Prepared V2 isolated offline app-data artifact using the verified V1 source, permitting **only directory** header for root `.` and strict ancestor `app`; ordinary file paths remain restricted to their original `app/data` or `app/uploads` subtree. This is a hypothesis-based compatibility fix; unexpected paths still stop.
- V2 package generated locally, SHA-256 `50f2f2ea27f8e63c9115ecffcbac6fda3e9c67d2abf1c14ed6b8e1515bd1842e`; isolated extractor unit test, shell syntax and ZIP integrity checks PASS. **Not yet run on real S2 backups**. Commercial beta NO-GO until verified real app-data recovery, cleanup and separate app acceptance.

## S2 application-data V2 retry — same TAR-prefix safe stop (Oct 24)
- Owner ran guarded offline S2 V2 on Acer: network/swap isolation PASS; original ciphertext 3/3 verified; extractor stopped again at `SAFE_STOP=TAR_MEMBER_OUTSIDE_APPROVED_MOUNT`. V2 did **not** confirm or complete any three-mount filesystem restore. Its temporary /dev/shm scratch was removed (`S2_APP_RAM_SCRATCH_REMOVED=PASS`), and swap/Wi-Fi/Tailscale configuration restoration reported PASS; production contact NONE.
- Earlier hypothesis that an inert `app/` ancestor directory was sufficient is refuted. Do NOT broaden allowed extraction paths or rerun V2 unchanged.
- Prepared `V79_S2_TAR_Layout_Metadata_Probe_v1.zip` SHA256 `fb64e03a3cf27b08b0e2a75a38269bd4120b4412b19e2bad8e13cdb52a47eb38` with hash-pinned V2-derived physical-Acer network/swap isolation wrappers. This is a read-only **TAR header class/count diagnostic**: verifies manifest/file checksums and v2 source; streams decrypted TAR metadata without extracting member contents or printing real filenames. Path-classification self-tests, Python compilation, shell syntax and ZIP integrity PASS. **Real archive layout unknown until owner runs probe**. Production release NO-GO.

## S2 application TAR metadata probe — mount basename confirmed (Oct 24)
- Owner ran guarded metadata-only TAR probe on Acer. Offline isolation and original encrypted ciphertext hashes **PASS 3/3**; 0 plaintext files extracted; no production contact; swap/Wi-Fi/Tailscale configuration restored PASS.
- **HUB_DATA**: 21 headers; 19 files, 2 dirs; exactly one `MOUNT_BASENAME_DIRECTORY` plus twenty `MOUNT_BASENAME_PREFIX` entries. **TIQUET_DATA**: same 21/19/2 pattern. **TIQUET_UPLOADS**: 9 headers; 3 files, 6 dirs; one mount basename root plus eight prefix entries. Special TAR entries 0 in all three archives. The V2 extractor's first rejection for each was the basename root **directory**.
- Confirmed archive structure uses `data/` for each distinct Hub and Tiquet `/app/data` backup and `uploads/` for Tiquet `/app/uploads`, not `app/data/` or `app/uploads/`. Each archive is separately mapped by manifest container/destination, so identical basename `data/` across Hub and Tiquet is not ambiguous.
- REDTEAM choice: no wildcard allowed prefixes, no disabling validation. Prepared standalone `V79_S2_AppData_Offline_Recovery_v3.zip`, SHA256 `c17951abe1300483d22bb7c81ce9c416f75534e6433d2b95e5a31d85977f8451`, from the verified v2 extractor with a strict per-mount **basename** prefix. V3 rejects cross-mount paths, absolute/parent traversal, special members, duplicate file entries, unexpected archive paths; retains original hash-pinned V4-derived network/swap wrappers and RAM-only cleanup. V3 self-test and 7 synthetic negative/integration tests PASS; shell syntax, ZIP CRC and inner-file SHA256 3/3 PASS.
- **Real V3 app-data extraction not yet performed.** No application boot, merge or production deployment. Commercial release **NO-GO** pending owner offline test and later app acceptance.

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
