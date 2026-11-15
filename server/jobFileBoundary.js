import path from "node:path";

// The delete route accepts one filename, never a relative path. Checking
// string startsWith(folder) is unsafe: /jobs/abc-other starts with /jobs/abc.
export function resolveOwnedJobFile(folder, filename) {
  if(typeof folder !== "string" || !path.isAbsolute(folder) ||
     typeof filename !== "string" || filename.length===0 ||
     Buffer.byteLength(filename,"utf8")>255 ||
     filename==="." || filename===".." ||
     filename.includes("/") || filename.includes("\\") ||
     filename.includes("\0")) return null;
  const root=path.resolve(folder);
  const target=path.resolve(root,filename);
  // Equality of the resolved parent is a path-segment boundary.
  if(path.dirname(target)!==root) return null;
  return target;
}

// Every job folder must remain under its exact account/client parent. Client
// display names and imported job IDs are untrusted filesystem segments.
export function resolveJobFolder(uploadsRoot,accountId,clientName,jobId) {
  if(typeof uploadsRoot!=="string" || !path.isAbsolute(uploadsRoot)) {
    throw new Error("Invalid uploads root");
  }
  const segment=value=>{
    const clean=String(value || "unknown")
      .replace(/[^a-zA-Z0-9_. -]/g,"_").trim().slice(0,60);
    if(!clean || clean==="." || clean==="..")throw new Error("Unsafe job folder segment");
    return clean;
  };
  const root=path.resolve(uploadsRoot);
  const account=path.resolve(root,segment(accountId));
  const client=path.resolve(account,segment(clientName));
  const job=path.resolve(client,segment(jobId));
  if(path.dirname(account)!==root ||
     path.dirname(client)!==account || path.dirname(job)!==client) {
    throw new Error("Job folder path escape");
  }
  return job;
}
