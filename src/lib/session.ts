export type SessionState =
  | "COLLECTING_LOCATIONS"
  | "ASKING_PREFERENCES"
  | "QUESTION_1"
  | "QUESTION_2"
  | "QUESTION_3"
  | "SEARCHING"
  | "PRESENTING_RESULTS"
  | "FINAL_VOTE"
  | "DONE";

export interface Question {
  text: string;
  options: string[];
}

export interface Place {
  name: string;
  id: string;
  location: { lat: number; lng: number };
  summary: string;
  googleMapsLinks: {
    directionsUrl?: string;
    photosUrl?: string;
    reviewsUrl?: string;
    placeUrl?: string;
  };
}

export interface Session {
  groupId: string;
  request: string;
  members: string[];
  state: SessionState;
  locations: Record<string, { lat: number; lng: number }>;
  midpoint: { lat: number; lng: number } | null;
  votes: Record<number, Record<string, string[]>>;
  questions: Question[];
  places: Place[];
  finalVotes: Record<string, number>;
  lastActivityAt: number;
  reminderSentAt: number | null;
}

function calculateMidpoint(
  locations: Record<string, { lat: number; lng: number }>
): { lat: number; lng: number } | null {
  const entries = Object.values(locations);
  if (entries.length === 0) return null;
  const sum = entries.reduce(
    (acc, loc) => ({ lat: acc.lat + loc.lat, lng: acc.lng + loc.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: sum.lat / entries.length, lng: sum.lng / entries.length };
}

export function addLocation(
  session: Session,
  userId: string,
  lat: number,
  lng: number
): Session {
  const locations = { ...session.locations, [userId]: { lat, lng } };
  return {
    ...session,
    locations,
    midpoint: calculateMidpoint(locations),
    lastActivityAt: Date.now(),
  };
}

export interface ConsensusResult {
  question: number;
  winner: string;
  votes: number;
}

export function addVote(
  session: Session,
  userId: string,
  questionIndex: number,
  options: string[]
): Session {
  const questionVotes = { ...session.votes[questionIndex], [userId]: options };
  return {
    ...session,
    votes: { ...session.votes, [questionIndex]: questionVotes },
    lastActivityAt: Date.now(),
  };
}

export function getConsensus(session: Session): ConsensusResult[] {
  const results: ConsensusResult[] = [];

  for (const [qIdx, userVotes] of Object.entries(session.votes)) {
    const tally: Record<string, number> = {};
    for (const options of Object.values(userVotes)) {
      for (const option of options) {
        tally[option] = (tally[option] || 0) + 1;
      }
    }

    const sorted = Object.entries(tally).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );

    if (sorted.length > 0) {
      results.push({
        question: Number(qIdx),
        winner: sorted[0][0],
        votes: sorted[0][1],
      });
    }
  }

  return results;
}

export function addFinalVote(
  session: Session,
  userId: string,
  placeIndex: number
): Session {
  return {
    ...session,
    finalVotes: { ...session.finalVotes, [userId]: placeIndex },
    lastActivityAt: Date.now(),
  };
}

export function getWinner(session: Session): number {
  const tally: Record<number, number> = {};
  for (const placeIndex of Object.values(session.finalVotes)) {
    tally[placeIndex] = (tally[placeIndex] || 0) + 1;
  }

  const sorted = Object.entries(tally).sort(
    (a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0])
  );

  return sorted.length > 0 ? Number(sorted[0][0]) : 0;
}

export function getMissingParticipants(session: Session): string[] {
  switch (session.state) {
    case "COLLECTING_LOCATIONS":
      return session.members.filter((m) => !session.locations[m]);
    case "QUESTION_1":
      return session.members.filter((m) => !session.votes[0]?.[m]);
    case "QUESTION_2":
      return session.members.filter((m) => !session.votes[1]?.[m]);
    case "QUESTION_3":
      return session.members.filter((m) => !session.votes[2]?.[m]);
    case "FINAL_VOTE":
      return session.members.filter((m) => !(m in session.finalVotes));
    default:
      return [];
  }
}

const STATE_TRANSITIONS: Partial<Record<SessionState, SessionState>> = {
  COLLECTING_LOCATIONS: "ASKING_PREFERENCES",
  ASKING_PREFERENCES: "QUESTION_1",
  QUESTION_1: "QUESTION_2",
  QUESTION_2: "QUESTION_3",
  QUESTION_3: "SEARCHING",
  SEARCHING: "PRESENTING_RESULTS",
  PRESENTING_RESULTS: "FINAL_VOTE",
  FINAL_VOTE: "DONE",
};

export function advanceState(session: Session): Session {
  const missing = getMissingParticipants(session);
  if (missing.length > 0) return session;

  const nextState = STATE_TRANSITIONS[session.state];
  if (!nextState) return session;

  return { ...session, state: nextState, reminderSentAt: null, lastActivityAt: Date.now() };
}

export function markReminderSent(session: Session): Session {
  return { ...session, reminderSentAt: Date.now() };
}

export function forceAdvance(session: Session): Session {
  const nextState = STATE_TRANSITIONS[session.state];
  if (!nextState) return session;
  return { ...session, state: nextState, reminderSentAt: null, lastActivityAt: Date.now() };
}

export function createSession(
  groupId: string,
  request: string,
  members: string[]
): Session {
  return {
    groupId,
    request,
    members,
    state: "COLLECTING_LOCATIONS",
    locations: {},
    midpoint: null,
    votes: {},
    questions: [],
    places: [],
    finalVotes: {},
    lastActivityAt: Date.now(),
    reminderSentAt: null,
  };
}
