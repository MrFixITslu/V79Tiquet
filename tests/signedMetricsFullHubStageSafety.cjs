// Fail-closed safety guard for the *unexecuted* full Hub+Tiquet stage.
// Standalone, pure and intentionally usable by the ordinary npm test suite.
// Never accept any production database, host, signer, account or SMTP config.
const EXPECTED = Object.freeze({
  V79_HUB_STORE_BACKEND: "json",
  V79_REQUIRE_ADMIN_MFA: "1",
  V79_TIQUET_SIGNED_METRICS_ENABLED: "1",
  V79_TIQUET_STAGE_JOINT_TEST: "1",
  V79_TIQUET_SOURCE_ED25519_KEY_FILE: "/run/secrets/ci-only-tiquet-source.pem",
  V79_HUB_ADMIN_PASSWORD: "ci-only-stage-owner-password-20261009",
  V79_PLATFORM_SHARED_SECRET: "synthetic_stage_platform_0123456789abcdef0123456789abcdef",
  DATABASE_URL: "postgresql://tiquet_stage:synthetic_ci_only_password@127.0.0.1:5432/tiquet_signed_stage",
  V79_TIQUET_CI_HUB_TOTP_PATH: "hub-source-stage/server/security-contract.mjs",
  SMTP_HOST: "",
  FFPRO_GATEWAY_URL: "",
});
const LOCAL_ENDPOINTS = Object.freeze({
  tiquet: "http://127.0.0.1:3000",
  hub: "http://127.0.0.1:3900",
});

function assertSafeJointStagingEnvironment(env = process.env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new Error("Disposable staging environment is not configured.");
  }
  for (const [key, value] of Object.entries(EXPECTED)) {
    if (env[key] !== value) {
      // Do not expose values; some might contain credentials.
      throw new Error("Refusing non-isolated Hub+Tiquet staging configuration: " + key);
    }
  }
  if (env.NODE_ENV && env.NODE_ENV !== "test") {
    throw new Error("Disposable staging requires test-only Node environment.");
  }
  if (env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME !== "pull_request") {
    throw new Error("Disposable staging may not run in a push/deployment GitHub event.");
  }
  if (env.V79_TIQUET_CI_PUBLIC_KEY_FILE !== "/tmp/v79-ci-tiquet-source-public.pem") {
    throw new Error("Refusing unexpected signer verification key location.");
  }
  // Explicitly prohibit accidental use of deployment or real mail settings.
  for (const key of ["DEPLOY_HOST", "DEPLOY_SSH_KEY", "STRIPE_SECRET_KEY",
    "WIPAY_API_KEY", "SMTP_PASSWORD", "RESEND_API_KEY"]) {
    if (env[key]) {
      throw new Error("Disposable staging may not be run with production integration settings: " + key);
    }
  }
  return LOCAL_ENDPOINTS;
}

module.exports = { assertSafeJointStagingEnvironment };
