import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerWithMachcoll,
  buildMachcollMessages,
  checkMachcollRateLimit,
  machcollFaqAnswer,
  type PublicChatState,
} from "./chat";

const state: PublicChatState = {
  settings: {
    date: "2026-11-20",
    venue: "Setsoto Stadium",
    finalised: false,
    scheme: { points: [8, 7, 6, 5, 4, 3, 2, 1], rest: 1 },
  },
  progress: { done: 37, live: 0, total: 37 },
  houses: [
    { id: 1, name: "Ravens" },
    { id: 3, name: "Eagles" },
  ],
  standings: [
    { house_id: 3, name: "Eagles", points: 293, gold: 5, silver: 7, bronze: 8, rank: 3 },
    { house_id: 1, name: "Ravens", points: 292, gold: 6, silver: 9, bronze: 12, rank: 4 },
  ],
  events: [
    {
      name: "100m",
      level: "Senior",
      gender: "F",
      kind: "individual",
      status: "completed",
      entries: [
        {
          athlete_id: 12,
          name: "Ada Mokoena",
          house_id: 3,
          position: 1,
          status: "ok",
          points: 8,
          performance: "10.20",
        },
        {
          athlete_id: 19,
          name: "Thabo Pita",
          house_id: 1,
          position: 2,
          status: "ok",
          points: 7,
          performance: "10.40",
        },
      ],
    },
  ],
};

describe("Machcoll public-data chat", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("grounds answers in aggregated results without sending athlete identifiers, names, or performances", () => {
    const messages = buildMachcollMessages(
      "Why did Ada Mokoena get eight points?",
      [{ role: "assistant", content: "Thabo Pita finished second." }],
      state,
    );
    const payload = JSON.stringify(messages);
    const dataMarker = "Public results data (JSON):\n";
    const publicData = JSON.parse(messages[0]!.content.split(dataMarker)[1]!);

    expect(publicData.standings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Eagles", points: 293 }),
        expect.objectContaining({ name: "Ravens", points: 292 }),
      ]),
    );
    expect(publicData.events[0].housePoints).toEqual([
      { house: "Ravens", points: 7 },
      { house: "Eagles", points: 8 },
    ]);
    expect(payload).toContain("[athlete]");
    expect(payload).not.toContain("Ada Mokoena");
    expect(payload).not.toContain("Mokoena");
    expect(payload).not.toContain("Ada");
    expect(payload).not.toContain("Thabo Pita");
    expect(payload).not.toContain("10.20");
    expect(payload).not.toContain("10.40");
    expect(payload).not.toContain('"athlete_id"');
  });

  it("redacts full roster names even when the public page only shows initials", () => {
    const anonymizedState: PublicChatState = {
      ...state,
      events: state.events.map((event) => ({
        ...event,
        entries: event.entries.map((entry) => ({ ...entry, name: "A. M." })),
      })),
    };
    const messages = buildMachcollMessages(
      "Was Ada Mokoena's time entered correctly?",
      [],
      anonymizedState,
      ["Ada Mokoena"],
    );

    expect(JSON.stringify(messages)).not.toContain("Ada Mokoena");
    expect(messages[messages.length - 1]!.content).toContain("[athlete]");
  });

  it("answers the Hawks points question from live public standings without Lovable", () => {
    const hawksState: PublicChatState = {
      ...state,
      progress: { done: 37, live: 0, total: 37 },
      standings: [
        { house_id: 2, name: "Hawks", points: 369, gold: 18, silver: 12, bronze: 10, rank: 1 },
        { house_id: 4, name: "Falcons", points: 306, gold: 8, silver: 9, bronze: 8, rank: 2 },
        { house_id: 3, name: "Eagles", points: 293, gold: 5, silver: 7, bronze: 8, rank: 3 },
        { house_id: 1, name: "Ravens", points: 292, gold: 6, silver: 9, bronze: 12, rank: 4 },
      ],
    };

    const answer = machcollFaqAnswer(
      "Why do Hawks have so many points? Were we cheated?",
      hawksState,
    );

    expect(answer).toContain("Hawks 369");
    expect(answer).toContain("18 first places");
    expect(answer).toContain("Eagles 293");
    expect(answer).toContain("Ravens 292");
    expect(answer).toContain("CURRENT STANDINGS");
    expect(answer).toContain("Position record:");
    expect(answer).toContain("VERDICT");
    expect(answer).not.toContain("Lovable");
  });

  it("pre-answers a complete house points comparison without Lovable", () => {
    const comparisonState: PublicChatState = {
      ...state,
      houses: [
        { id: 1, name: "Ravens" },
        { id: 2, name: "Hawks" },
        { id: 3, name: "Eagles" },
        { id: 4, name: "Falcons" },
      ],
      standings: [
        { house_id: 2, name: "Hawks", points: 369, gold: 18, silver: 12, bronze: 10, rank: 1 },
        { house_id: 4, name: "Falcons", points: 306, gold: 8, silver: 9, bronze: 8, rank: 2 },
        { house_id: 3, name: "Eagles", points: 293, gold: 5, silver: 7, bronze: 8, rank: 3 },
        { house_id: 1, name: "Ravens", points: 292, gold: 6, silver: 9, bronze: 12, rank: 4 },
      ],
    };
    const answer = machcollFaqAnswer("Give me the complete comparison of all teams", comparisonState);
    expect(answer).toContain("Hawks: 369 points");
    expect(answer).toContain("Falcons: 306 points");
    expect(answer).toContain("Eagles: 293 points");
    expect(answer).toContain("Ravens: 292 points");
  });

  it("pre-answers why Ravens rank last with medals and calculations", () => {
    const ravensState: PublicChatState = {
      ...state,
      houses: [
        { id: 1, name: "Ravens" },
        { id: 2, name: "Hawks" },
        { id: 3, name: "Eagles" },
        { id: 4, name: "Falcons" },
      ],
      standings: [
        { house_id: 2, name: "Hawks", points: 369, gold: 18, silver: 12, bronze: 10, rank: 1 },
        { house_id: 4, name: "Falcons", points: 306, gold: 8, silver: 9, bronze: 8, rank: 2 },
        { house_id: 3, name: "Eagles", points: 293, gold: 5, silver: 7, bronze: 8, rank: 3 },
        { house_id: 1, name: "Ravens", points: 292, gold: 6, silver: 9, bronze: 12, rank: 4 },
      ],
    };
    const answer = machcollFaqAnswer(
      "Why are Ravens last even though they have many medals?",
      ravensState,
    );
    expect(answer).toContain("Ravens: 292 points");
    expect(answer).toContain("Eagles: 293 points");
    expect(answer).toContain("fourth-eighth places");
  });

  it("redacts athlete names from model responses", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-only");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Ada Mokoena finished first." } }],
          }),
        ),
      ),
    );

    const answer = await answerWithMachcoll("Who won the event?", [], state, ["Ada Mokoena"]);

    expect(answer).toBe("[athlete] finished first.");
  });

  it("allows one question per device per calendar day", () => {
    const now = Date.UTC(2026, 10, 21, 12);
    checkMachcollRateLimit("machcoll-test-ip", "device_abcdefghijklmnop", now);

    expect(() =>
      checkMachcollRateLimit("machcoll-test-ip", "device_abcdefghijklmnop", now + 60_000),
    ).toThrow("You have used your Machcoll question for today");
    expect(() =>
      checkMachcollRateLimit(
        "machcoll-test-ip",
        "device_abcdefghijklmnop",
        Date.UTC(2026, 10, 22, 0),
      ),
    ).not.toThrow();
  });
});
