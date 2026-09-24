import React, { useEffect, useState } from "react";
import { AppUser, PagePermission } from "../types";
import { UserPlus, Shield, Mail, User, Trash2, CheckSquare, Square } from "lucide-react";

const ALL_PERMISSIONS: { id: PagePermission; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "jobs", label: "Job Board" },
  { id: "new-request", label: "New Requests" },
  { id: "payroll", label: "Payroll" },
  { id: "invoices", label: "Invoices" },
  { id: "files", label: "File Repository" },
  { id: "users", label: "User Management" },
];

export function UserManagement({
  users,
  setUsers,
}: {
  users: AppUser[];
  setUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [hubManagement, setHubManagement] = useState<{managedByHub:boolean;hubUrl:string}|null>(null);

  useEffect(() => {
    fetch("/api/team-management-mode", { credentials:"same-origin" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => { if (body) setHubManagement(body); })
      .catch(() => {});
  }, []);

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this user?")) {
      setUsers(users.filter((u) => u.id !== id));
    }
  };

  if (hubManagement?.managedByHub) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Team Access</h2>
          <p className="text-slate-500 text-sm mt-1">
            This Tiquet workspace uses V79 Hub for team seats, roles and app access.
          </p>
        </div>
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-indigo-600 p-3 text-white"><Shield className="w-5 h-5" /></div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-900">Managed in V79 Hub</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Add or remove team members, assign Tiquet access and manage plan seats in Hub. Tiquet will provision those users automatically the next time they open the app.
              </p>
              <a href={hubManagement.hubUrl} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
                Open V79 Hub <UserPlus className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="font-semibold text-slate-900">Current Tiquet users</h3>
            <p className="mt-1 text-xs text-slate-500">Shown for operational visibility. Changes are made in Hub.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {users.map(user => (
              <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div><div className="font-semibold text-slate-900">{user.name}</div><div className="text-xs text-slate-500">{user.email}</div></div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-sm text-slate-600">{user.role}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">User Management</h2>
          <p className="text-slate-500 text-sm mt-1">
            Manage system users and their access permissions.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingUser(null);
            setIsModalOpen(true);
          }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors shadow-sm"
        >
          <UserPlus className="w-4 h-4" />
          Add User
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">User</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Role</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Permissions</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
                      {user.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{user.name}</p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
                    {user.role}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {user.permissions.map((p) => (
                      <span key={p} className="text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                        {p.replace("-", " ")}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setEditingUser(user);
                        setIsModalOpen(true);
                      }}
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    >
                      <Shield className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <UserModal
          user={editingUser}
          onClose={() => setIsModalOpen(false)}
          onSave={(userData) => {
            if (editingUser) {
              setUsers(users.map((u) => (u.id === editingUser.id ? { ...userData, id: u.id } : u)));
            } else {
              setUsers([...users, { ...userData, id: crypto.randomUUID() }]);
            }
            setIsModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

function UserModal({
  user,
  onClose,
  onSave,
}: {
  user: AppUser | null;
  onClose: () => void;
  onSave: (user: Omit<AppUser, "id">) => void;
}) {
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [role, setRole] = useState(user?.role || "Member");
  const [permissions, setPermissions] = useState<PagePermission[]>(user?.permissions || ["dashboard", "jobs"]);

  const togglePermission = (perm: PagePermission) => {
    if (permissions.includes(perm)) {
      setPermissions(permissions.filter((p) => p !== perm));
    } else {
      setPermissions([...permissions, perm]);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <h3 className="text-lg font-bold text-slate-900">
            {user ? "Edit User Permissions" : "Add New User"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <Trash2 className="w-5 h-5 rotate-45" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ name, email, role, permissions });
          }}
          className="p-6 space-y-6 overflow-y-auto"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  required
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none"
                  placeholder="John Doe"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none"
                  placeholder="john@example.com"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none bg-white"
              >
                <option value="Admin">Admin</option>
                <option value="Manager">Manager</option>
                <option value="Member">Member</option>
                <option value="Viewer">Viewer</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-3">Page Access Permissions</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ALL_PERMISSIONS.map((perm) => (
                <button
                  key={perm.id}
                  type="button"
                  onClick={() => togglePermission(perm.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                    permissions.includes(perm.id)
                      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                      : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {permissions.includes(perm.id) ? (
                    <CheckSquare className="w-5 h-5 shrink-0" />
                  ) : (
                    <Square className="w-5 h-5 shrink-0" />
                  )}
                  <span className="text-sm font-medium">{perm.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95"
            >
              {user ? "Update User" : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
