import React, { useState } from "react";
import { FileItem } from "../types";
import { api, ApiError } from "../api";
import {
  File,
  Upload,
  Trash2,
  Download,
  Search,
  FileText,
  Image as ImageIcon,
  FileArchive,
  Clock,
  User,
  Loader2,
} from "lucide-react";

export function FileRepository({
  files,
  onFilesChanged,
}: {
  files: FileItem[];
  onFilesChanged: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getFileIcon = (type: string) => {
    if (type.includes("image")) return <ImageIcon className="w-5 h-5 text-blue-500" />;
    if (type.includes("pdf")) return <FileText className="w-5 h-5 text-red-500" />;
    if (type.includes("zip") || type.includes("archive")) return <FileArchive className="w-5 h-5 text-yellow-600" />;
    return <File className="w-5 h-5 text-slate-400" />;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(uploadedFiles).forEach((file: File) => formData.append("files", file));
      await api.post("/files", formData);
      onFilesChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this file?")) return;
    try {
      await api.del(`/files/${id}`);
      onFilesChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete file.");
    }
  };

  const handleDownload = async (file: FileItem) => {
    try {
      const token = sessionStorage.getItem("tiquet_token");
      const res = await fetch(`/api/files/${file.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError("Failed to download file.");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">File Repository</h2>
          <p className="text-slate-500 text-sm mt-1">
            Centralized storage for project assets and documents.
          </p>
        </div>
        <label className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors shadow-sm cursor-pointer">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {uploading ? "Uploading..." : "Upload Files"}
          <input type="file" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>
      )}

      <div className="flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search files by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none"
          />
        </div>
        <div className="text-sm text-slate-500 font-medium">
          {filteredFiles.length} {filteredFiles.length === 1 ? "file" : "files"}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredFiles.map((file) => (
          <div
            key={file.id}
            className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-slate-50 rounded-xl group-hover:bg-indigo-50 transition-colors">
                {getFileIcon(file.type)}
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleDownload(file)}
                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(file.id)}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <h4 className="font-semibold text-slate-900 truncate mb-1" title={file.name}>
              {file.name}
            </h4>
            <p className="text-xs text-slate-500 mb-4">{formatSize(file.size)}</p>

            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                <Clock className="w-3 h-3" />
                {new Date(file.uploadedAt).toLocaleDateString()}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                <User className="w-3 h-3" />
                {file.uploadedBy}
              </div>
            </div>
          </div>
        ))}

        {filteredFiles.length === 0 && (
          <div className="col-span-full py-20 text-center">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <File className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">No files found</h3>
            <p className="text-slate-500">Try adjusting your search or upload new assets.</p>
          </div>
        )}
      </div>
    </div>
  );
}
