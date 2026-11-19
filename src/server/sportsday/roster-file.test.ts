import { describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";
import { parseRosterFile } from "./roster-file";

describe("parseRosterFile", () => {
  it("maps recognized CSV columns and skips blank rows", () => {
    const csv = "Gender,Name,House,Age Group\nF,Ada Athlete,Ravens,Senior\n\n";
    const rows = parseRosterFile("roster.csv", new TextEncoder().encode(csv));

    expect(rows).toEqual([
      {
        full_name: "Ada Athlete",
        house: "Ravens",
        level: "Senior",
        gender: "F",
        events: "",
        relay_teams: "",
        bib: "",
      },
    ]);
  });

  it("reads relay leg assignments from the same roster file", () => {
    const csv = "Relay Teams,Name,House,Age Groups,Gender\nJunior | F | 4 x 100m Relay | 1,Ada Athlete,Ravens,Junior,F\n";
    const rows = parseRosterFile("roster.csv", new TextEncoder().encode(csv));

    expect(rows[0]).toMatchObject({
      full_name: "Ada Athlete",
      house: "Ravens",
      level: "Junior",
      gender: "F",
      relay_teams: "Junior | F | 4 x 100m Relay | 1",
    });
  });

  it("reads the first worksheet in an Excel workbook", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Name", "House", "Age Group", "Gender", "Events"],
      ["Ari Runner", "Hawks", "Junior", "M", "100m"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Roster");
    const file = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

    expect(parseRosterFile("roster.xlsx", new Uint8Array(file))[0]).toMatchObject({
      full_name: "Ari Runner",
      house: "Hawks",
      level: "Junior",
      gender: "M",
      events: "100m",
    });
  });

  it("rejects unsupported file extensions", () => {
    expect(() => parseRosterFile("roster.pdf", new Uint8Array())).toThrow(
      "Choose an .xlsx, .xls, .csv or .txt roster file",
    );
  });
});
