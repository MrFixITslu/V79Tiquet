export const hubTeamRoles = ["manager", "staff", "viewer"];

const permissionsByRole = {
  manager: ["dashboard", "jobs", "clients", "invoices", "files", "new-request"],
  staff: ["dashboard", "jobs", "clients", "files", "new-request"],
  viewer: ["dashboard"],
};

export function tiquetAccessForHubRole(role) {
  if (role === "owner") return { localRole: "Admin", permissions: null };
  if (!hubTeamRoles.includes(role)) {
    throw new Error("Unsupported Hub role for Tiquet access.");
  }
  return { localRole: "Member", permissions: [...permissionsByRole[role]] };
}
