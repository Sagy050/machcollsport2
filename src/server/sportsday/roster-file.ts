import * as XLSX from "@e965/xlsx";
import { bad } from "@/lib/sportsday/util";

const MAX_ROWS = 2000;
const HEADER_ALIASES = {
  full_name: ["name", "fullname", "athlete", "athletename"],
  house: ["house", "team"],
  level: ["age", "agegroup", "level", "division", "yeargroup", "category"],
  gender: ["gender", "sex"],
  events: ["event", "events", "eventlist", "optionalevents"],
  bib: ["bib", "bibnumber", "athletenumber", "number"],
};

const normalizeHeader = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseRosterFile(filename: string, bytes: Uint8Array) {
  const ext = /\.([^.]+)$/.exec(filename.toLowerCase())?.[1];
  if (!ext || !["csv", "txt", "xls", "xlsx"].includes(ext)) {
    throw bad("Choose an .xlsx, .xls, .csv or .txt roster file");
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook =
      ext === "csv" || ext === "txt"
        ? XLSX.read(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""), { type: "string", raw: false })
        : XLSX.read(bytes, { type: "array", raw: false });
  } catch {
    throw bad("This roster file could not be read. Check the file format and try again");
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw bad("The roster file does not contain a worksheet");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (!matrix.length) throw bad("The roster file does not contain any rows");

  const headers = matrix[0]!.map(normalizeHeader);
  const hasHeader =
    HEADER_ALIASES.full_name.some((key) => headers.includes(key)) &&
    HEADER_ALIASES.house.some((key) => headers.includes(key));
  const columns: Record<keyof typeof HEADER_ALIASES, number> = {
    full_name: 0,
    house: 1,
    level: 2,
    gender: 3,
    events: 4,
    bib: 5,
  };
  if (hasHeader) {
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof typeof HEADER_ALIASES, string[]][]) {
      columns[field] = headers.findIndex((header) => aliases.includes(header));
    }
  }

  const sourceRows = matrix
    .slice(hasHeader ? 1 : 0)
    .filter((row) => row.some((value) => String(value ?? "").trim() !== ""));
  if (sourceRows.length > MAX_ROWS) throw bad(`Roster files can contain at most ${MAX_ROWS} athletes`);
  const rows = sourceRows.map((row) => {
    const valueAt = (key: keyof typeof HEADER_ALIASES) => {
      const index = columns[key];
      return index < 0 ? "" : String(row[index] ?? "").trim();
    };
    return {
      full_name: valueAt("full_name"),
      house: valueAt("house"),
      level: valueAt("level"),
      gender: valueAt("gender"),
      events: valueAt("events"),
      bib: valueAt("bib"),
    };
  });
  if (!rows.length) throw bad("The roster file does not contain any athlete rows");
  return rows;
}

export function sampleWorkbook(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["Name", "House", "Age Group", "Gender", "Events"]]);
  sheet["!cols"] = [{ wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(workbook, sheet, "Roster");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" });
}
