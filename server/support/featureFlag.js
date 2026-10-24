// Phase 1 fail-closed runtime gate. Never enabled on production or remote DB.
export function supportSandboxEnabled(env){
 if(env.NODE_ENV!=="test"||env.CI_SUPPORT_SYNTHETIC!=="1"||
    env.V79_SUPPORT_DESK_ENABLED!=="1") return false;
 try{
  const url=new URL(env.DATABASE_URL);
  return ["127.0.0.1","localhost"].includes(url.hostname)&&
    url.pathname==="/tiquet_support_test";
 }catch{return false;}
}
