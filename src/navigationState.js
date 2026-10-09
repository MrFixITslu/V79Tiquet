const tabs = new Set(["dashboard","jobs","clients","payroll","users","files","invoices","settings","new-request"]);

export function readTiquetTab(search) {
  const tab = new URLSearchParams(search).get("tab");
  return tabs.has(tab) ? tab : "dashboard";
}

export function readTiquetJobId(search) {
  const id = new URLSearchParams(search).get("job");
  return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

// Persist only navigation; authentication and permissions are still checked by the app.
export function tiquetNavigationPath(href, tab, jobId = null) {
  const url = new URL(href);
  if (!tabs.has(tab) || tab === "dashboard") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  if (tab === "jobs" && jobId && /^[A-Za-z0-9_-]{1,128}$/.test(jobId)) {
    url.searchParams.set("job", jobId);
  } else {
    url.searchParams.delete("job");
  }
  return url.pathname + url.search + url.hash;
}
