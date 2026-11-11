import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveOwnedJobFile } from "./jobFileBoundary.js";

const MAX_BYTES = 20 * 1024 * 1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;

export function validScopeUploadName(value) {
  return typeof value === "string" && value.length > 4 &&
    Buffer.byteLength(value,"utf8") <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]*\.pdf$/i.test(value) &&
    !value.includes("..");
}

export function validateScopeAgreement(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    value.agree === true && Number.isSafeInteger(value.version) &&
    value.version >= 1 && value.version <= 1_000_000 &&
    typeof value.sha256 === "string" && HASH.test(value.sha256);
}

function evidenceFolder(jobFolder) {
  if (typeof jobFolder !== "string" || !path.isAbsolute(jobFolder))
    throw new Error("Invalid job folder");
  return path.join(path.resolve(jobFolder), ".scope-evidence");
}

export function storedScopePath(jobFolder, versionId) {
  if(!UUID.test(String(versionId||""))) throw new Error("Invalid scope version");
  const dir=evidenceFolder(jobFolder);
  const target=resolveOwnedJobFile(dir,versionId+".pdf");
  if(!target)throw new Error("Invalid snapshot location");
  return target;
}

export async function readScopeBuffer(jobFolder,versionId,expectedDigest) {
  if(!HASH.test(String(expectedDigest||"")))throw new Error("Invalid scope digest");
  const target=storedScopePath(jobFolder,versionId);
  const handle=await fs.open(target,constants.O_RDONLY | (constants.O_NOFOLLOW||0));
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size<1||stat.size>MAX_BYTES)throw new Error("Invalid scope file");
    const buffer=await handle.readFile();
    if(createHash("sha256").update(buffer).digest("hex")!==expectedDigest)
      throw new Error("Scope evidence integrity mismatch");
    return buffer;
  }finally{await handle.close();}
}

export async function snapshotExistingJobScope(jobFolder,filename,versionId) {
  if(!validScopeUploadName(filename))throw new Error("Invalid uploaded PDF name");
  const source=resolveOwnedJobFile(jobFolder,filename);
  if(!source)throw new Error("Scope upload escapes job folder");
  const handle=await fs.open(source,constants.O_RDONLY | (constants.O_NOFOLLOW||0));
  let content;
  try {
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size<1||stat.size>MAX_BYTES)
      throw new Error("Scope PDF size invalid");
    content=await handle.readFile();
    if(content.subarray(0,5).toString("ascii")!=="%PDF-")
      throw new Error("Scope document is not a PDF");
  }finally{await handle.close();}
  const digest=createHash("sha256").update(content).digest("hex");
  const dir=evidenceFolder(jobFolder);
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  const dirStat=await fs.lstat(dir);
  if(!dirStat.isDirectory()||dirStat.isSymbolicLink())
    throw new Error("Evidence folder cannot be a symlink");
  const target=storedScopePath(jobFolder,versionId);
  await fs.writeFile(target,content,{flag:"wx",mode:0o600});
  // Verify archive content once more, not the mutable source file.
  try{await readScopeBuffer(jobFolder,versionId,digest);}
  catch(error){await fs.unlink(target).catch(()=>{});throw error;}
  return Object.freeze({sha256:digest,bytes:content.length,storedPath:target});
}
