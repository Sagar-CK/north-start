import { describe, it, expect } from "vitest";
import {
  createSession,
  addLocation,
  addVote,
  getConsensus,
  addFinalVote,
  getWinner,
  getMissingParticipants,
  advanceState,
  forceAdvance,
  markReminderSent,
} from "../lib/session";

describe("Planning Session Manager", () => {
  const members = ["alice", "bob"];

  it("creates a session in COLLECTING_LOCATIONS state", () => {
    const session = createSession("group1", "dinner tomorrow", members);

    expect(session.state).toBe("COLLECTING_LOCATIONS");
    expect(session.groupId).toBe("group1");
    expect(session.request).toBe("dinner tomorrow");
    expect(session.members).toEqual(["alice", "bob"]);
  });

  it("adds locations and calculates geographic midpoint", () => {
    let session = createSession("group1", "dinner", members);
    session = addLocation(session, "alice", 40.7128, -74.006);
    session = addLocation(session, "bob", 40.7580, -73.9855);

    expect(session.locations["alice"]).toEqual({ lat: 40.7128, lng: -74.006 });
    expect(session.locations["bob"]).toEqual({ lat: 40.7580, lng: -73.9855 });
    expect(session.midpoint).not.toBeNull();
    expect(session.midpoint!.lat).toBeCloseTo(40.7354, 3);
    expect(session.midpoint!.lng).toBeCloseTo(-73.9958, 3);
  });

  it("tracks multi-select votes and calculates consensus", () => {
    let session = createSession("group1", "dinner", members);
    // Alice picks Indian and Italian, Bob picks Italian and Thai
    session = addVote(session, "alice", 0, ["Indian", "Italian"]);
    session = addVote(session, "bob", 0, ["Italian", "Thai"]);

    const consensus = getConsensus(session);
    // Italian has 2 votes (most overlap), should be top pick
    expect(consensus[0]).toEqual({ question: 0, winner: "Italian", votes: 2 });
  });

  it("handles ties in consensus by returning first alphabetically", () => {
    let session = createSession("group1", "dinner", ["alice", "bob", "carol"]);
    session = addVote(session, "alice", 0, ["Indian"]);
    session = addVote(session, "bob", 0, ["Italian"]);
    session = addVote(session, "carol", 0, ["Japanese"]);

    const consensus = getConsensus(session);
    // All tied at 1 vote — first alphabetically wins
    expect(consensus[0].votes).toBe(1);
  });

  it("tracks final votes and determines winner", () => {
    let session = createSession("group1", "dinner", ["alice", "bob", "carol"]);
    session = addFinalVote(session, "alice", 0);
    session = addFinalVote(session, "bob", 2);
    session = addFinalVote(session, "carol", 2);

    expect(getWinner(session)).toBe(2);
  });

  it("returns 0 as winner when final votes are tied", () => {
    let session = createSession("group1", "dinner", ["alice", "bob"]);
    session = addFinalVote(session, "alice", 0);
    session = addFinalVote(session, "bob", 1);

    // Tie — lowest index wins
    expect(getWinner(session)).toBe(0);
  });

  it("identifies missing participants during location collection", () => {
    let session = createSession("group1", "dinner", ["alice", "bob", "carol"]);
    session = addLocation(session, "alice", 40.7128, -74.006);

    expect(getMissingParticipants(session)).toEqual(["bob", "carol"]);
  });

  it("advances from COLLECTING_LOCATIONS to ASKING_PREFERENCES when all locations received", () => {
    let session = createSession("group1", "dinner", members);
    session = addLocation(session, "alice", 40.7128, -74.006);
    session = addLocation(session, "bob", 40.758, -73.9855);
    session = advanceState(session);

    expect(session.state).toBe("ASKING_PREFERENCES");
  });

  it("does not advance from COLLECTING_LOCATIONS if locations are missing", () => {
    let session = createSession("group1", "dinner", members);
    session = addLocation(session, "alice", 40.7128, -74.006);
    session = advanceState(session);

    expect(session.state).toBe("COLLECTING_LOCATIONS");
  });

  it("advances through question states", () => {
    let session = createSession("group1", "dinner", members);
    session = { ...session, state: "QUESTION_1" };
    // Both members vote on question 0
    session = addVote(session, "alice", 0, ["Indian"]);
    session = addVote(session, "bob", 0, ["Italian"]);
    session = advanceState(session);
    expect(session.state).toBe("QUESTION_2");

    session = addVote(session, "alice", 1, ["7pm"]);
    session = addVote(session, "bob", 1, ["8pm"]);
    session = advanceState(session);
    expect(session.state).toBe("QUESTION_3");

    session = addVote(session, "alice", 2, ["Casual"]);
    session = addVote(session, "bob", 2, ["Fancy"]);
    session = advanceState(session);
    expect(session.state).toBe("SEARCHING");
  });

  it("advances from FINAL_VOTE to DONE when all members voted", () => {
    let session = createSession("group1", "dinner", members);
    session = { ...session, state: "FINAL_VOTE" };
    session = addFinalVote(session, "alice", 0);
    session = addFinalVote(session, "bob", 1);
    session = advanceState(session);

    expect(session.state).toBe("DONE");
  });

  it("marks reminder as sent", () => {
    let session = createSession("group1", "dinner", members);
    session = markReminderSent(session);

    expect(session.reminderSentAt).not.toBeNull();
  });

  it("force advances even with missing participants", () => {
    let session = createSession("group1", "dinner", members);
    session = addLocation(session, "alice", 40.7128, -74.006);
    // bob hasn't shared location, but we force advance (timeout)
    session = forceAdvance(session);

    expect(session.state).toBe("ASKING_PREFERENCES");
  });
});
