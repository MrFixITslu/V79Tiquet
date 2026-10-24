// Phase 9: read-only static parity and release safety contract.
import assert from "node:assert/strict";
import fs from "node:fs";
import {execFileSync} from "node:child_process";
const must=(ok,why)=>assert.ok(ok,"PHASE9_STOP_"+why);
must(process.env.CI_SUPPORT_SYNTHETIC==="1"&&process.env.NODE_ENV==="test"&&
 process.env.V79_ALLOW_PRODUCTION_DEPLOY==="0"&&
 process.env.V79_SUPPORT_DESK_ENABLED==="0"&&process.env.GITHUB_ACTIONS==="true","ISOLATION");
must(process.env.GITHUB_REF==="refs/heads/feature/support-desk-phase1-20261024","BRANCH");
const hubDir=process.env.PHASE9_HUB_ROOT||"phase9-hub-source";
const read=f=>fs.readFileSync(f,"utf8");
const hub=(f)=>read(hubDir+"/"+f);
const tiqDocker=read("Dockerfile"),hubDocker=hub("Dockerfile");
const tCompose=read("docker-compose.yml"),hCompose=hub("docker-compose.yml");
const main=read("server/index.js"),auth=read("server/hubAwareAuthentication.js");
const hubServer=hub("server.ts");
must(execFileSync("git",["-C",hubDir,"rev-parse","HEAD"],{encoding:"utf8"}).trim()==="ee79ec9353ee4248eb8276fee2e6c3476b3af491","HUB_UNPINNED");
must(/^ARG NODE_BASE=node:22-alpine/m.test(tiqDocker),"TIQUET_NODE_IMAGE_DRIFT");
must(/^ARG NODE_BASE=node:22-alpine/m.test(hubDocker),"HUB_NODE_IMAGE_DRIFT");
must((tiqDocker.match(/npm ci\b/g)||[]).length>=2,"NONDETERMINISTIC_TIQUET_INSTALL");
must(/V79_ENTITLEMENT_RECHECK_ENABLED=\$\{V79_ENTITLEMENT_RECHECK_ENABLED:-0\}/.test(tCompose),"ENTITLEMENT_FLAG_NOT_DEFAULT_OFF");
must(/V79_TIQUET_SESSION_BINDING_ENABLED=\$\{V79_TIQUET_SESSION_BINDING_ENABLED:-0\}/.test(tCompose),"SESSION_FLAG_NOT_DEFAULT_OFF");
must(main.includes('V79_TIQUET_SESSION_BINDING_ENABLED === "1"')&&
 main.includes('V79_ENTITLEMENT_RECHECK_ENABLED === "1"'),"TIQUET_FLAG_GUARD_MISSING");
must(auth.includes("checkHubSession")&&auth.includes("HUB_SESSION_INACTIVE"),"SESSION_REVOKE_MISSING");
must(hubServer.includes('V79_HUB_TIQUET_SESSION_BINDING === "1"'),"HUB_FLAG_GUARD_MISSING");
must(/V79_TIQUET_LAUNCH_SECRET/.test(tCompose)&&/V79_TIQUET_LAUNCH_SECRET/.test(hCompose),"LAUNCH_SECRET_CONFIG_MISSING");
must(!main.includes('phase6AuthHarness')&&!main.includes('phase7-hub-source'),'TEST_IDENTITY_IMPORTED_PRODUCTION');
must(/NODE_ENV=production/.test(tCompose)&&/V79_ALLOW_LEGACY_AUTH=\$\{V79_ALLOW_LEGACY_AUTH:-0\}/.test(tCompose),"PRODUCTION_AUTH_GUARD_DRIFT");
// Full production cutover requires Hub Compose to opt in explicitly as well.
// A missing Hub flag is a BLOCKER, never fabricated as a PASS.
const hubHasFlag=/V79_HUB_TIQUET_SESSION_BINDING:/.test(hCompose);
const gate={image_contract:"PASS_IMAGE_SOURCE_NODE22_NOT_RUNTIME_ATTESTATION",
 flags_tiquet:"DEFAULT_OFF_OK",hub_source_flag:"DEFAULT_OFF",
 hub_compose_flag:hubHasFlag?"EXPLICIT":"NOT_EXPLICIT_RELEASE_BLOCKER",
 pairing:"REQUIRES_SIMULTANEOUS_HUB_AND_TIQUET_APPROVAL",
 secrets:"NOT_READ_OR_COMPARED_WITH_LIVE",docker_push:"NOT_AUTHORIZED",
 beta_release:"NO_GO"};
console.log("SUPPORT_P9_STATIC_BUILD_AND_FLAG_PARITY=PASS");
console.log("SUPPORT_P9_GATE="+JSON.stringify(gate));
