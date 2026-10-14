/**
 * Seeded content for demo mode — what the app shows when MongoDB is not
 * configured. Kept in one place so the meetings list, the room titles, and
 * the contacts page all tell the same story.
 */

import type { Meeting } from "@/types/meeting";
import type { Workspace } from "@/types/workspace";
import type { Contact } from "@/app/api/contacts/route";

export const fallbackMeetings: Meeting[] = [
  {
    id: "design-review",
    title: "Product design review",
    dateLabel: "Today",
    timeLabel: "10:30 AM",
    dateTime: "2026-07-28T10:30:00-04:00",
    duration: "45 min",
    type: "Design review",
    attendees: ["JD", "MK", "AL"],
    attendeeCount: 6,
    status: "upcoming",
  },
  {
    id: "weekly-sync",
    title: "Weekly team sync",
    dateLabel: "Today",
    timeLabel: "2:00 PM",
    dateTime: "2026-07-28T14:00:00-04:00",
    duration: "30 min",
    type: "Weekly sync",
    attendees: ["SM", "ER", "JT"],
    attendeeCount: 8,
    status: "upcoming",
  },
  {
    id: "client-call",
    title: "Northstar client call",
    dateLabel: "Tomorrow",
    timeLabel: "9:00 AM",
    dateTime: "2026-07-29T09:00:00-04:00",
    duration: "60 min",
    type: "Client call",
    attendees: ["NB", "KL"],
    attendeeCount: 4,
    status: "upcoming",
  },
];

/** Room titles for demo meeting ids, derived so they can never drift. */
export const fallbackMeetingTitles: Record<string, string> = Object.fromEntries(
  fallbackMeetings.map((meeting) => [meeting.id, meeting.title]),
);

export const fallbackContacts: Contact[] = [
  { id: "demo-jamie", name: "Jamie Morales", username: "jamie.morales", lastMetAt: "2026-07-27T15:00:00.000Z", meetingsShared: 4 },
  { id: "demo-maya", name: "Maya Kim", username: "maya.kim", lastMetAt: "2026-07-24T10:30:00.000Z", meetingsShared: 2 },
];

export const fallbackWorkspaces: Workspace[] = [
  { id: "personal", name: "Personal", isDefault: true, createdAt: "2026-01-01T00:00:00.000Z" },
];
