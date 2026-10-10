// Protected, fail-closed Sentinel NOC reviewer machine credential loader.
// Supports Docker secret-file mount without passing credentials in the
// container's environment (which docker inspect can expose).
import fs from "node:fs";
import path from "node:path";

export function readPrivateMachineSecret({file="",legacySecret=""}={}){
  if(file){
    if(typeof file!=="string" || file.length>500 || !path.isAbsolute(file))
      throw Error("Absolute protected service-secret path required");
    const stat=fs.lstatSync(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size<48 || stat.size>1024 ||
       (stat.mode & 0o077)!==0)
      throw Error("Unsafe Sentinel NOC machine secret file");
    const value=fs.readFileSync(file,"utf8");
    if(!/^[!-~]{48,1024}$/.test(value))
      throw Error("Invalid private NOC service-secret encoding");
    return value;
  }
  if(typeof legacySecret!=="string" || legacySecret.length<48 ||
     !/^[!-~]{48,1024}$/.test(legacySecret))
    throw Error("Missing dedicated Sentinel NOC service-secret credential");
  return legacySecret;
}
