import { describe, expect, it } from "vitest";
import { computeState, type RawData } from "./report";
import { DEFAULT_SCHEME } from "./scoring";

describe("computeState age-group awards", () => {
  it("counts an athlete in every division where they have an entry", () => {
    const raw: RawData = {
      settings: {
        title: "Meet",
        date: "2026-11-20",
        start: "08:00",
        venue: "Stadium",
        scheme: DEFAULT_SCHEME,
        nameDisplay: "full",
        finalised: false,
        finalisedAt: null,
      },
      houses: [{ id: 1, name: "Ravens", color: "#7c3aed", sort: 1 }],
      athletes: [
        {
          id: 1,
          bib: "R01",
          full_name: "Sentle Tiheli",
          house_id: 1,
          level: "Lower Junior",
          levels: ["Lower Junior", "Junior"],
          gender: "M",
          created_at: 1,
        },
      ],
      events: ["Lower Junior", "Junior"].map((level, index) => ({
        id: index + 1,
        name: "Race",
        level,
        gender: "M",
        kind: "individual",
        measure: "time",
        relay_legs: 0,
        sched_time: "08:00",
        status: "completed",
        heat_starts: {},
        sort: index + 1,
        created_at: 1,
        updated_at: 1,
      })),
      entries: ["Lower Junior", "Junior"].map((_, index) => ({
        id: index + 1,
        event_id: index + 1,
        athlete_id: 1,
        name: "Sentle Tiheli",
        house_id: 1,
        heat: 1,
        performance: "10.00",
        perf_value: 10,
        status: "ok",
        updated_by: null,
        updated_at: 1,
      })),
    };

    const ageGroups = computeState(raw).awards.ageGroups as { label: string; name: string }[];

    expect(ageGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Lower Junior boys", name: "Sentle Tiheli" }),
        expect.objectContaining({ label: "Junior boys", name: "Sentle Tiheli" }),
      ]),
    );
  });
});
