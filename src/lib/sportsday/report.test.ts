import { describe, expect, it } from "vitest";
import { computeState, type RawData } from "./report";
import { DEFAULT_SCHEME } from "./scoring";

describe("computeState age-group awards", () => {
  it("uses the linked house and hides timed performance from public state", () => {
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
      houses: [
        { id: 1, name: "Ravens", color: "#7c3aed", sort: 1 },
        { id: 2, name: "Falcons", color: "#0ea5e9", sort: 2 },
      ],
      athletes: [
        {
          id: 1,
          bib: "R01",
          full_name: "Sentle Tiheli",
          house_id: 1,
          level: "Junior",
          levels: ["Junior"],
          gender: "M",
          created_at: 1,
        },
      ],
      events: [
        {
          id: 1,
          name: "100m",
          level: "Junior",
          gender: "M",
          kind: "individual",
          measure: "time",
          relay_legs: 0,
          sched_time: "08:00",
          status: "completed",
          heat_starts: {},
          sort: 1,
          created_at: 1,
          updated_at: 1,
        },
      ],
      entries: [
        {
          id: 1,
          event_id: 1,
          athlete_id: 1,
          name: "Sentle Tiheli",
          house_id: 2,
          heat: 1,
          performance: "10.00",
          perf_value: 10,
          status: "ok",
          updated_by: null,
          updated_at: 1,
        },
      ],
    };

    const state = computeState(raw);
    const staffState = computeState(raw, { staff: true });

    expect(state.events[0]?.entries[0]?.house_id).toBe(1);
    expect(state.events[0]?.entries[0]?.performance).toBe("");
    expect(state.events[0]?.time).toBe("");
    expect(staffState.events[0]?.entries[0]?.recordOrder).toBe(10);
    expect(state.standings.find((house) => house.house_id === 1)?.points).toBeGreaterThan(0);
    expect(state.standings.find((house) => house.house_id === 2)?.points).toBe(0);
  });

  it("uses the common runner house for a complete relay lineup", () => {
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
      houses: [
        { id: 1, name: "Ravens", color: "#7c3aed", sort: 1 },
        { id: 2, name: "Falcons", color: "#0ea5e9", sort: 2 },
      ],
      athletes: [1, 2, 3, 4].map((id) => ({
        id,
        bib: "R" + id,
        full_name: "Runner " + id,
        house_id: 1,
        level: "Junior",
        levels: ["Junior"],
        gender: "M",
        created_at: 1,
      })),
      events: [
        {
          id: 1,
          name: "4 x 100m",
          level: "Junior",
          gender: "M",
          kind: "relay",
          measure: "time",
          relay_legs: 4,
          sched_time: "08:00",
          status: "completed",
          heat_starts: {},
          sort: 1,
          created_at: 1,
          updated_at: 1,
        },
      ],
      entries: [
        {
          id: 1,
          event_id: 1,
          athlete_id: null,
          name: "Falcons team",
          house_id: 2,
          heat: 1,
          performance: "40.00",
          perf_value: 40,
          status: "ok",
          updated_by: null,
          updated_at: 1,
        },
      ],
      relayMembers: [1, 2, 3, 4].map((id) => ({
        entry_id: 1,
        leg: id,
        athlete_id: id,
        bib: "R" + id,
        full_name: "Runner " + id,
        house_id: 1,
      })),
    };

    expect(computeState(raw).events[0]?.entries[0]?.house_id).toBe(1);
  });

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

  it("includes signed athlete photos on public winner and award data only when supplied", () => {
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
      athletes: [{
        id: 1,
        bib: "R01",
        full_name: "Sentle Tiheli",
        house_id: 1,
        level: "Junior",
        levels: ["Junior"],
        gender: "M",
        created_at: 1,
      }],
      events: [{
        id: 1,
        name: "100m",
        level: "Junior",
        gender: "M",
        kind: "individual",
        measure: "time",
        relay_legs: 0,
        sched_time: "08:00",
        status: "completed",
        heat_starts: {},
        sort: 1,
        created_at: 1,
        updated_at: 1,
      }],
      entries: [{
        id: 1,
        event_id: 1,
        athlete_id: 1,
        name: "Sentle Tiheli",
        house_id: 1,
        heat: 1,
        performance: "10.00",
        perf_value: 10,
        status: "ok",
        updated_by: null,
        updated_at: 1,
      }],
    };

    const privateState = computeState(raw);
    expect(privateState.events[0]?.entries[0]?.photoUrl).toBeUndefined();
    expect(privateState.awards.topAthletes[0]?.photoUrl).toBeNull();

    const publicState = computeState({
      ...raw,
      athletes: raw.athletes.map((athlete) => ({ ...athlete, photo_url: "https://images.example/signed-photo" })),
    });
    expect(publicState.events[0]?.entries[0]?.photoUrl).toBe("https://images.example/signed-photo");
    expect(publicState.awards.topAthletes[0]?.photoUrl).toBe("https://images.example/signed-photo");
    expect(publicState.awards.bestPerHouse[0]?.athlete?.photoUrl).toBe("https://images.example/signed-photo");
  });
});
