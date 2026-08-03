export type JobStatus =
  | "request"
  | "estimation"
  | "in-progress"
  | "review"
  | "invoiced"
  | "completed"
  | "paid";

export const COLUMNS: { id: JobStatus; label: string; color: string }[] = [
  {
    id: "request",
    label: "Incoming Request",
    color: "bg-blue-100 text-blue-700",
  },
  {
    id: "estimation",
    label: "Estimation",
    color: "bg-yellow-100 text-yellow-700",
  },
  {
    id: "in-progress",
    label: "In Progress",
    color: "bg-purple-100 text-purple-700",
  },
  { id: "review", label: "Review", color: "bg-orange-100 text-orange-700" },
  { id: "invoiced", label: "Invoiced", color: "bg-indigo-100 text-indigo-700" },
  { id: "completed", label: "Completed", color: "bg-green-100 text-green-700" },
  { id: "paid", label: "Paid", color: "bg-emerald-100 text-emerald-700" },
];

export interface ActivityLogEntry {
  id: string;
  action: string;
  timestamp: string;
  user: string;
}

export interface JobNote {
  id: string;
  text: string;
  timestamp: string;
  user: string;
}

export type WorkerType = "salary" | "hourly" | "bi-weekly";

export interface TimeCard {
  id: string;
  date: string;
  clockIn: string;
  clockOut: string;
  hoursWorked: number;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  salary: number;
  hourlyRate?: number;
  hoursWorked?: number;
  workerType: WorkerType;
  paymentMethod: "Bank Transfer" | "Check" | "PayPal";
  status: "active" | "inactive";
  isCheckedIn?: boolean;
  lastCheckIn?: string;
  timeCards?: TimeCard[];
}

export interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  date: string;
  status: "pending" | "paid";
}

export interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  createdAt: string;
}

export interface Job {
  id: string;
  title: string;
  client: string; // Keeping for backward compatibility or display name
  clientId?: string; // Link to Client entity
  description: string;
  status: JobStatus;
  createdAt: string;
  dueDate?: string;
  amount?: number;
  priority: "low" | "medium" | "high";
  invoiceNotes?: string;
  assignedTo?: string;
  tags?: string[];
  activityLog?: ActivityLogEntry[];
  notes?: JobNote[];
}

export type PagePermission =
  | "dashboard"
  | "jobs"
  | "payroll"
  | "invoices"
  | "users"
  | "files"
  | "new-request"
  | "clients";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: PagePermission[];
}

export interface BusinessSettings {
  name: string;
  address: string;
  email: string;
  phone: string;
  logoUrl: string;
  paymentTerms: string;
  currency: string;
  taxRate: number;
}

export interface Business {
  id: string;
  name: string;
  ownerEmail: string;
  invitedUsers?: string[];
  settings: BusinessSettings;
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  photoUrl?: string;
  provider: "google" | "apple";
}

export interface FileItem {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  uploadedBy: string;
  jobId?: string;
}
