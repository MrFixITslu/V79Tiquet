const test = require("node:test");
const assert = require("node:assert/strict");
const { assertSafeJointStagingEnvironment } = require("./signedMetricsFullHubStageSafety.cjs");

const safe = Object.freeze({
  NODE_ENV: "test",
  APP_URL: "http://127.0.0.1:3900",
  TIQUET_INTERNAL_URL: "http://127.0.0.1:3000",
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "pull_request",
  V79_HUB_STORE_BACKEND: "json",
  V79_REQUIRE_ADMIN_MFA: "1",
  V79_TIQUET_SIGNED_METRICS_ENABLED: "1",
  V79_TIQUET_STAGE_JOINT_TEST: "1",
  V79_TIQUET_SOURCE_ED25519_KEY_FILE: "/run/secrets/ci-only-tiquet-source.pem",
  V79_TIQUET_CI_PUBLIC_KEY_FILE: "/tmp/v79-ci-tiquet-source-public.pem",
  V79_HUB_ADMIN_PASSWORD: "ci-only-stage-owner-password-20261009",
  V79_PLATFORM_SHARED_SECRET: "synthetic_stage_platform_0123456789abcdef0123456789abcdef",
  DATABASE_URL: "postgresql://tiquet_stage:synthetic_ci_only_password@127.0.0.1:5432/tiquet_signed_stage",
  V79_TIQUET_CI_HUB_TOTP_PATH: "hub-source-stage/server/security-contract.mjs",
  SMTP_HOST: "",
  FFPRO_GATEWAY_URL: "",
});

test("joint-app staging guard permits only the exact disposable test environment", () => {
  const endpoints = assertSafeJointStagingEnvironment(safe);
  assert.deepEqual(endpoints, {
    tiquet:"http://127.0.0.1:3000", hub:"http://127.0.0.1:3900",
  });
});

test("refuses any production database, missing MFA, signing flags, unsafe secret path or remote endpoint", () => {
  const cases = [
    ["DATABASE_URL","postgresql://prod:secret@192.168.100.163:5432/v79_tiquet"],
    ["DATABASE_URL","postgresql://tiquet_stage:synthetic_ci_only_password@localhost:5432/tiquet_signed_stage"],
    ["V79_HUB_STORE_BACKEND","postgres"],
    ["V79_REQUIRE_ADMIN_MFA","0"],
    ["V79_TIQUET_SIGNED_METRICS_ENABLED","0"],
    ["V79_TIQUET_STAGE_JOINT_TEST","0"],
    ["V79_TIQUET_SOURCE_ED25519_KEY_FILE","/home/firelion/real-signing-key.pem"],
    ["V79_HUB_ADMIN_PASSWORD","real-password"],
    ["V79_PLATFORM_SHARED_SECRET","another-signing-secret"],
    ["V79_TIQUET_CI_HUB_TOTP_PATH","hub-source-stage/../../prod/security-contract.mjs"],
    ["V79_TIQUET_CI_PUBLIC_KEY_FILE","/etc/real-public.pem"],
    ["SMTP_HOST","smtp.example.com"],
    ["FFPRO_GATEWAY_URL","https://ffpro.example.com"],
    ["NODE_ENV","production"],
    ["NODE_ENV",undefined],
    ["APP_URL","https://hub.v79sl.com"],
    ["APP_URL","http://192.168.100.163:3900"],
    ["APP_URL",undefined],
    ["TIQUET_INTERNAL_URL","http://127.0.0.1:3050"],
    ["TIQUET_INTERNAL_URL","https://tiquet.v79sl.com"],
    ["TIQUET_INTERNAL_URL",undefined],
    ["GITHUB_EVENT_NAME","push"],
  ];
  for (const [key,value] of cases) {
    assert.throws(() => assertSafeJointStagingEnvironment({...safe,[key]:value}),
      /Refusing|requires|may not/, key);
  }
  assert.throws(() => assertSafeJointStagingEnvironment({...safe,DEPLOY_SSH_KEY:"fake-key"}), /production integration/);
  assert.throws(() => assertSafeJointStagingEnvironment({...safe,RESEND_API_KEY:"fake-token"}), /production integration/);
  assert.throws(() => assertSafeJointStagingEnvironment({}), /Refusing/);
  assert.throws(() => assertSafeJointStagingEnvironment(null), /not configured/);
});

test("guard returns no credentials and does not modify environment input", () => {
  const before = structuredClone(safe);
  const actual = assertSafeJointStagingEnvironment(safe);
  assert.equal(Object.keys(actual).join(","), "tiquet,hub");
  assert.deepEqual(safe,before);
  assert.ok(!JSON.stringify(actual).includes("synthetic_stage_platform"));
});
