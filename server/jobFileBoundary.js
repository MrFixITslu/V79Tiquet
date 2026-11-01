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
