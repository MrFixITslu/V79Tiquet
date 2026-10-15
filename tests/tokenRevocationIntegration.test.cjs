"use strict";
// Runs ONLY in disposable GitHub Actions, on a localhost Tiquet server and
// a fresh CI PostgreSQL service. Never run against a production DB or address.
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const jwt = require("jsonwebtoken");
const pg = require("pg");

const dbUrl="postgresql://tiquet_test:tiquet_test_password@127.0.0.1:5432/tiquet_test";
if(process.env.GITHUB_ACTIONS!=="true" || process.env.NODE_ENV!=="test" ||
    process.env.DATABASE_URL!==dbUrl ||
    process.env.JWT_SECRET!=="ci_jwt_secret_0123456789abcdef0123456789abcdef" ||
    process.env.V79_ALLOW_LEGACY_AUTH!=="0") {
  throw Error("REFUSING_NON_CI_REVOCATION_TEST");
}
const root="http://127.0.0.1:3000";
const pool=new pg.Pool({connectionString:dbUrl});
async function request(route, token, asCookie=false, opts={}) {
  return fetch(root+route,{
    redirect:"manual",
    signal:AbortSignal.timeout(5000),
    ...opts,
    headers:{
      ...(asCookie?{"cookie":"tiquet_session="+encodeURIComponent(token)}:{"authorization":"Bearer "+token}),
      ...(opts.headers||{}),
    }
  });
}
(async()=>{
  const accountA="ci-revocation-a-"+randomUUID(), accountB="ci-revocation-b-"+randomUUID();
  const userA="ci-user-a-"+randomUUID(), userB="ci-user-b-"+randomUUID();
  const orgA="ci-org-a-"+randomUUID(), orgB="ci-org-b-"+randomUUID();
  const now=new Date().toISOString();
  try{
    for(const [account,org] of [[accountA,orgA],[accountB,orgB]]){
      await pool.query(
        "INSERT INTO accounts(id,name,createdAt,status,hub_organization_id) VALUES($1,$2,$3,'active',$4)",
        [account,"Synthetic CI only",now,org]);
    }
    for(const [user,account,org] of [[userA,accountA,orgA],[userB,accountB,orgB]]){
      await pool.query(
        "INSERT INTO users(id,name,email,role,account_id,hub_user_id) VALUES($1,$2,$3,'Admin',$4,$5)",
        [user,"Synthetic CI only",user+"@example.test",account,"ci-scoped-"+org]);
    }
    const issue=(user,account,org)=>jwt.sign({
      id:user,account_id:account,hub_managed:true,hub_organization_id:org
    },process.env.JWT_SECRET,{expiresIn:"30m",jwtid:randomUUID()});
    const tokenA=issue(userA,accountA,orgA),tokenB=issue(userB,accountB,orgB);
    assert.equal((await request("/api/auth/me",tokenA,true)).status,200);
    assert.equal((await request("/api/auth/me",tokenB)).status,200);
    const logout=await request("/api/auth/logout",tokenA,true,{method:"POST"});
    assert.equal(logout.status,200);
    assert.equal((await logout.json()).ok,true);
    assert.match(logout.headers.get("set-cookie")||"",/Max-Age=0/);
    for(const viaCookie of [false,true]){
      const denied=await request("/api/auth/me",tokenA,viaCookie);
      assert.equal(denied.status,401);
      assert.equal((await denied.json()).code,"SESSION_REVOKED");
    }
    const hash=createHash("sha256").update(tokenA).digest("hex");
    const rec=await pool.query(
      "SELECT token_hash,account_id,expires_at FROM revoked_auth_tokens WHERE token_hash=$1",[hash]);
    assert.equal(rec.rowCount,1);
    assert.equal(rec.rows[0].account_id,accountA);
    assert.ok(Number(rec.rows[0].expires_at)>Date.now()/1000);
    assert.equal((await request("/api/auth/me",tokenB)).status,200,"B unaffected");
    const tokenA2=issue(userA,accountA,orgA);
    assert.equal((await request("/api/auth/me",tokenA2)).status,200,"fresh A signed token allowed");
    console.log("PASS: disposable real Tiquet/PostgreSQL logout revokes copied JWT but not unrelated tenants");
  }finally{
    await pool.query("DELETE FROM revoked_auth_tokens WHERE account_id=ANY($1::text[])",[[accountA,accountB]]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::text[])",[[userA,userB]]);
    await pool.query("DELETE FROM accounts WHERE id=ANY($1::text[])",[[accountA,accountB]]);
    await pool.end();
  }
})().catch(e=>{console.error("FAIL: isolated token revocation integration",e.message);process.exitCode=1;});
