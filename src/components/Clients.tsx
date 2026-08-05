import React, { useState } from "react";
import { 
  Plus, 
  Search, 
  Mail, 
  Phone, 
  MapPin, 
  Building2, 
  History, 
  Edit2, 
  Trash2, 
  X,
  ExternalLink,
  Contact
} from "lucide-react";
import { Client, Job, COLUMNS, Industry } from "../types";

interface ClientsProps {
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  jobs: Job[];
  industries: Industry[];
}

export function Clients({ clients, setClients, jobs, industries }: ClientsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const filteredClients = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this client?")) {
      setClients(clients.filter((c) => c.id !== id));
    }
  };

  const handleSave = (clientData: Omit<Client, "id" | "createdAt">) => {
    if (editingClient) {
      setClients(
        clients.map((c) =>
          c.id === editingClient.id ? { ...c, ...clientData } : c
        )
      );
    } else {
      const newClient: Client = {
        ...clientData,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      setClients([newClient, ...clients]);
    }
    setIsModalOpen(false);
    setEditingClient(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Client Management</h2>
          <p className="text-slate-500 text-sm mt-1">
            Manage your customer database and view their project history.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingClient(null);
            setIsModalOpen(true);
          }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Client
        </button>
      </div>

      <div className="flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search clients by name, company, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none"
          />
        </div>
        <div className="text-sm text-slate-500 font-medium">
          {filteredClients.length} {filteredClients.length === 1 ? "client" : "clients"}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client / Company</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Contact Info</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Address</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredClients.map((client) => (
                <tr 
                  key={client.id} 
                  className="hover:bg-slate-50 transition-colors cursor-pointer group"
                  onClick={() => setSelectedClient(client)}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center font-bold">
                        {client.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{client.name}</div>
                        <div className="text-sm text-slate-500 flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {client.company}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <div className="text-sm text-slate-600 flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        {client.email}
                      </div>
                      <div className="text-sm text-slate-600 flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {client.phone}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-slate-600 flex items-center gap-2 max-w-xs truncate">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      {client.address}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setEditingClient(client);
                          setIsModalOpen(true);
                        }}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="Edit Client"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(client.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete Client"
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
        {filteredClients.length === 0 && (
          <div className="py-20 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Contact className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">No clients found</h3>
            <p className="text-slate-500">Try adjusting your search or add a new client.</p>
          </div>
        )}
      </div>

      {isModalOpen && (
        <ClientModal
          client={editingClient}
          industries={industries}
          onClose={() => {
            setIsModalOpen(false);
            setEditingClient(null);
          }}
          onSave={handleSave}
        />
      )}

      {selectedClient && (
        <ClientDetailModal
          client={selectedClient}
          industries={industries}
          jobs={jobs.filter(j => j.clientId === selectedClient.id || j.client === selectedClient.company)}
          onClose={() => setSelectedClient(null)}
        />
      )}
    </div>
  );
}

function ClientModal({
  client,
  industries,
  onClose,
  onSave,
}: {
  client: Client | null;
  industries: Industry[];
  onClose: () => void;
  onSave: (data: Omit<Client, "id" | "createdAt">) => void;
}) {
  const [formData, setFormData] = useState({
    name: client?.name || "",
    company: client?.company || "",
    email: client?.email || "",
    phone: client?.phone || "",
    address: client?.address || "",
    industryId: client?.industryId || "",
  });

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-900">
            {client ? "Edit Client" : "Add New Client"}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(formData);
          }}
          className="p-6 space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">Full Name</label>
              <input
                required
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                placeholder="e.g. John Smith"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">Company</label>
              <input
                required
                type="text"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                placeholder="e.g. Acme Corp"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Email Address</label>
            <input
              required
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
              placeholder="john@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Phone Number</label>
            <input
              required
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
              placeholder="+1 (555) 000-0000"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Industry</label>
            <select
              value={formData.industryId}
              onChange={(e) => setFormData({ ...formData, industryId: e.target.value })}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
            >
              <option value="">— None —</option>
              {industries.map((ind) => (
                <option key={ind.id} value={ind.id}>{ind.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Address</label>
            <textarea
              required
              rows={3}
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all resize-none"
              placeholder="Full mailing address..."
            />
          </div>
          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all shadow-md shadow-indigo-200"
            >
              {client ? "Update Client" : "Create Client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ClientDetailModal({
  client,
  industries,
  jobs,
  onClose,
}: {
  client: Client;
  industries: Industry[];
  jobs: Job[];
  onClose: () => void;
}) {
  const industryName = industries.find((i) => i.id === client.industryId)?.name;
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-6 border-b border-slate-100 bg-slate-50/50 flex items-start justify-between">
          <div className="flex gap-4">
            <div className="w-16 h-16 bg-indigo-600 text-white rounded-2xl flex items-center justify-center text-2xl font-bold shadow-lg shadow-indigo-200">
              {client.name.charAt(0)}
            </div>
            <div>
              <h3 className="text-2xl font-bold text-slate-900">{client.name}</h3>
              <p className="text-slate-500 flex items-center gap-1.5 mt-0.5">
                <Building2 className="w-4 h-4" />
                {client.company}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-8">
          <div className="grid grid-cols-3 gap-6">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Mail className="w-3 h-3" />
                Email
              </div>
              <div className="text-sm font-semibold text-slate-700">{client.email}</div>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Phone className="w-3 h-3" />
                Phone
              </div>
              <div className="text-sm font-semibold text-slate-700">{client.phone}</div>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <MapPin className="w-3 h-3" />
                Address
              </div>
              <div className="text-sm font-semibold text-slate-700 line-clamp-2">{client.address}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {industryName && (
              <span className="text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
                {industryName}
              </span>
            )}
            <span className={`text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border ${
              client.newsletterOptIn
                ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                : "bg-slate-50 text-slate-400 border-slate-200"
            }`}>
              {client.newsletterOptIn ? "Newsletter: Subscribed" : "Newsletter: Not subscribed"}
            </span>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" />
                Job History
              </h4>
              <span className="text-sm font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                {jobs.length} total jobs
              </span>
            </div>

            <div className="space-y-3">
              {jobs.length > 0 ? (
                jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((job) => {
                  const statusConfig = COLUMNS.find(c => c.id === job.status);
                  return (
                    <div key={job.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-indigo-200 transition-colors group">
                      <div className="flex items-center gap-4">
                        <div className={`w-2 h-10 rounded-full ${statusConfig?.color.split(' ')[0]}`} />
                        <div>
                          <div className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">{job.title}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            Created on {new Date(job.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className="text-sm font-bold text-slate-900">
                            {job.amount ? `$${job.amount.toLocaleString()}` : '—'}
                          </div>
                          <div className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded mt-1 ${statusConfig?.color}`}>
                            {statusConfig?.label}
                          </div>
                        </div>
                        <ExternalLink className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 transition-colors" />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <p className="text-slate-500 text-sm italic">No past jobs associated with this client.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-white border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
