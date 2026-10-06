import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Malaysian date format: DD/MM/YYYY. Handles epoch timestamps (createdAt,
// approvedAt), Date objects, and plain "YYYY-MM-DD" strings (from native
// <input type="date"> values) — the latter is parsed manually rather than
// via `new Date()` to avoid UTC-midnight timezone shifting the displayed day.
export function formatDate(input: number | string | Date): string {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split("-");
    return `${day}/${month}/${year}`;
  }
  const d = new Date(input);
  if (isNaN(d.getTime())) return "-";
  const day = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Same as formatDate but appends HH:mm, for timestamps where time matters
// (e.g. "Confirmed on", approval audit log entries).
export function formatDateTime(input: number | string | Date): string {
  const d = new Date(input);
  if (isNaN(d.getTime())) return "-";
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${formatDate(d)}, ${hours}:${minutes}`;
}