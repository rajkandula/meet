export type MeetingStatus = "upcoming" | "live" | "ended";

export type Meeting = {
  id: string;
  ownerId?: string;
  workspaceId?: string;
  roomName?: string;
  title: string;
  dateLabel: string;
  timeLabel: string;
  dateTime: string;
  duration: string;
  type: "Design review" | "Weekly sync" | "Client call" | "Planning";
  attendees: string[];
  attendeeCount: number;
  status: MeetingStatus;
  createdAt?: string;
  endedAt?: string;
  endedReason?: string;
};

export type CreateMeetingInput = {
  title: string;
  dateTime: string;
  duration?: string;
  type?: Meeting["type"];
};
