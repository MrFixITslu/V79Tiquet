import React, { useState } from "react";
import { formatMoney } from "../currency";
import { Employee, PayrollRecord } from "../types";
import {
  Users,
  DollarSign,
  Plus,
  CreditCard,
  CheckCircle2,
  Clock,
  Search,
  MoreVertical,
  LogIn,
  LogOut,
} from "lucide-react";

export function Payroll({
  employees,
  setEmployees,
  payrollRecords,
  setPayrollRecords,
  currency,
}: {
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  payrollRecords: PayrollRecord[];
  setPayrollRecords: React.Dispatch<React.SetStateAction<PayrollRecord[]>>;
  currency: string;
}) {
  const [activeSubTab, setActiveSubTab] = useState<"employees" | "history">(
    "employees"
  );
  const [isAddEmployeeModalOpen, setIsAddEmployeeModalOpen] = useState(false);

  const processPayroll = () => {
    const activeEmployees = employees.filter((e) => e.status === "active");
    if (activeEmployees.length === 0) {
      alert("No active employees found to process payroll.");
      return;
    }

    const newRecords: PayrollRecord[] = activeEmployees.map((e) => {
      let amount = e.salary;
      if (e.workerType === "hourly") {
        amount = (e.hourlyRate || 0) * (e.hoursWorked || 0);
      }
      return {
        id: crypto.randomUUID(),
        employeeId: e.id,
        employeeName: e.name,
        amount: amount,
        date: new Date().toISOString(),
        status: "pending",
      };
    });
    
    setPayrollRecords([...newRecords, ...payrollRecords]);
    setActiveSubTab("history");
    alert(`Generated ${newRecords.length} payroll tracking records. No funds were transferred.`);
  };

  const markAsPaid = (id: string) => {
    setPayrollRecords(
      payrollRecords.map((r) => (r.id === id ? { ...r, status: "paid" } : r))
    );
  };

  const handleCheckInOut = (employeeId: string) => {
    setEmployees(employees.map(e => {
      if (e.id === employeeId) {
        const now = new Date();
        if (e.isCheckedIn) {
          // Check out
          const checkInTime = new Date(e.lastCheckIn!);
          const hours = (now.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);
          return {
            ...e,
            isCheckedIn: false,
            lastCheckIn: undefined,
            hoursWorked: (e.hoursWorked || 0) + parseFloat(hours.toFixed(2))
          };
        } else {
          // Check in
          return {
            ...e,
            isCheckedIn: true,
            lastCheckIn: now.toISOString()
          };
        }
      }
      return e;
    }));
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Payroll Tracker</h2>
          <p className="text-slate-500 text-sm mt-1">
            Track employee compensation and internal payment status. Tiquet does not transfer payroll funds or calculate statutory deductions.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={processPayroll}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors shadow-sm"
          >
            <CreditCard className="w-4 h-4" />
            Generate Payroll Records
          </button>
          <button
            onClick={() => setIsAddEmployeeModalOpen(true)}
            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Employee
          </button>
        </div>
      </div>

      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveSubTab("employees")}
          className={`px-6 py-3 text-sm font-medium transition-colors relative ${
            activeSubTab === "employees"
              ? "text-indigo-600"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Employees
          {activeSubTab === "employees" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
          )}
        </button>
        <button
          onClick={() => setActiveSubTab("history")}
          className={`px-6 py-3 text-sm font-medium transition-colors relative ${
            activeSubTab === "history"
              ? "text-indigo-600"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Payroll Records
          {activeSubTab === "history" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
          )}
        </button>
      </div>

      {activeSubTab === "employees" ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Employee
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Role
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Type
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Rate/Salary
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Payment Method
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((employee) => (
                <tr key={employee.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs">
                        {employee.name.charAt(0)}
                      </div>
                      <span className="font-medium text-slate-900">
                        {employee.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {employee.role}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 capitalize">
                    {employee.workerType}
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-slate-900">
                    {employee.workerType === "hourly" 
                      ? `${formatMoney(employee.hourlyRate || 0, currency)}/hr (${employee.hoursWorked || 0}h)`
                      : `${formatMoney(employee.salary || 0, currency)}${employee.workerType === "bi-weekly" ? "/bi-wk" : "/mo"}`}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {employee.paymentMethod}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${
                        employee.status === "active"
                          ? "bg-green-100 text-green-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {employee.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {employee.workerType === "hourly" && (
                        <button
                          onClick={() => handleCheckInOut(employee.id)}
                          className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest ${
                            employee.isCheckedIn
                              ? "bg-red-50 text-red-600 hover:bg-red-100"
                              : "bg-green-50 text-green-600 hover:bg-green-100"
                          }`}
                          title={employee.isCheckedIn ? "Check Out" : "Check In"}
                        >
                          {employee.isCheckedIn ? (
                            <>
                              <LogOut className="w-3.5 h-3.5" />
                              Check Out
                            </>
                          ) : (
                            <>
                              <LogIn className="w-3.5 h-3.5" />
                              Check In
                            </>
                          )}
                        </button>
                      )}
                      <button className="text-slate-400 hover:text-slate-600">
                        <MoreVertical className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Employee
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Amount
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Date
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payrollRecords.map((record) => (
                <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900">
                    {record.employeeName}
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-slate-900">
                    {formatMoney(record.amount, currency)}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {new Date(record.date).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {record.status === "paid" ? (
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-green-600 bg-green-50 px-2 py-1 rounded-full">
                          <CheckCircle2 className="w-3 h-3" />
                          Paid
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-yellow-600 bg-yellow-50 px-2 py-1 rounded-full">
                          <Clock className="w-3 h-3" />
                          Pending
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {record.status === "pending" && (
                      <button
                        onClick={() => markAsPaid(record.id)}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-700 uppercase tracking-widest"
                      >
                        Record as Paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {payrollRecords.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-slate-400"
                  >
                    No payroll history found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {isAddEmployeeModalOpen && (
        <AddEmployeeModal
          onClose={() => setIsAddEmployeeModalOpen(false)}
          onSave={(emp) => {
            setEmployees([...employees, { ...emp, id: crypto.randomUUID() }]);
            setIsAddEmployeeModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AddEmployeeModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (emp: Omit<Employee, "id">) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [salary, setSalary] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [hoursWorked, setHoursWorked] = useState("");
  const [workerType, setWorkerType] = useState<Employee["workerType"]>("salary");
  const [paymentMethod, setPaymentMethod] = useState<Employee["paymentMethod"]>(
    "Bank Transfer"
  );

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Add New Employee</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            <Plus className="w-5 h-5 rotate-45" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              name,
              role,
              salary: workerType === "hourly" ? 0 : parseFloat(salary || "0"),
              hourlyRate: workerType === "hourly" ? parseFloat(hourlyRate || "0") : undefined,
              hoursWorked: workerType === "hourly" ? parseFloat(hoursWorked || "0") : undefined,
              workerType,
              paymentMethod,
              status: "active",
            });
          }}
          className="p-6 space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Full Name
              </label>
              <input
                required
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Role
              </label>
              <input
                required
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Worker Type
              </label>
              <select
                value={workerType}
                onChange={(e) => setWorkerType(e.target.value as Employee["workerType"])}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-white"
              >
                <option value="salary">Salary (Monthly)</option>
                <option value="bi-weekly">Bi-Weekly (Fixed)</option>
                <option value="hourly">Hourly</option>
              </select>
            </div>
            
            {workerType === "hourly" ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Hourly Rate ($)
                  </label>
                  <input
                    required
                    type="number"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Hours Worked
                  </label>
                  <input
                    required
                    type="number"
                    value={hoursWorked}
                    onChange={(e) => setHoursWorked(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </>
            ) : (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {workerType === "salary" ? "Monthly Salary ($)" : "Bi-Weekly Amount ($)"}
                </label>
                <input
                  required
                  type="number"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            )}

            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Payment Method
              </label>
              <select
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(e.target.value as Employee["paymentMethod"])
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-white"
              >
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Check">Check</option>
                <option value="PayPal">PayPal</option>
              </select>
            </div>
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              Add Employee
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
