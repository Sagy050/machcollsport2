export class HttpError extends Error {
  status: number;
  extra: Record<string, unknown> | null;
  constructor(status: number, message: string, extra?: Record<string, unknown> | null) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}
export const bad = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, msg, extra);

/** Trimmed string with length limits; throws a friendly 400 if invalid. */
export function str(
  v: unknown,
  { field = "Value", min = 0, max = 100, required = false }: { field?: string; min?: number; max?: number; required?: boolean } = {},
): string {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") throw bad(`${field} must be text`);
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if ((required || min > 0) && s.length < Math.max(min, 1)) throw bad(`${field} is required`);
  if (s.length > max) throw bad(`${field} is too long (max ${max} characters)`);
  return s;
}

export function int(
  v: unknown,
  { field = "Value", min = -Infinity, max = Infinity }: { field?: string; min?: number; max?: number } = {},
): number {
  if (v === undefined || v === null || v === "") throw bad(`${field} is required`);
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max)
    throw bad(`${field} must be a whole number${isFinite(min) && isFinite(max) ? ` between ${min} and ${max}` : ""}`);
  return n;
}

export function oneOf<T extends string>(v: unknown, list: readonly T[], field: string): T {
  if (!list.includes(v as T)) throw bad(`${field} must be one of: ${list.join(", ")}`);
  return v as T;
}

/** CSV cell: quote, and defuse spreadsheet formula injection (=, +, -, @). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",");
