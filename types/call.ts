export type CallStatus = "ringing" | "accepted" | "declined" | "cancelled";

/** How long an unanswered invite keeps ringing before it counts as missed. */
export const RING_WINDOW_MS = 45_000;

export type CallInvite = {
  id: string;
  meetingId: string;
  fromUserId: string;
  fromName: string;
  fromUsername: string;
  toUserId: string;
  toName: string;
  status: CallStatus;
  createdAt: string;
};
