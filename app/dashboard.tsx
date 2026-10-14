"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  Copy,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Mic2,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Play,
  Plus,
  Radio,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  UsersRound,
  Video,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/client-api";
import { formatBytes, initialsOf } from "@/lib/format";
import type { Meeting } from "@/types/meeting";
import type { Workspace } from "@/types/workspace";
import type { CallInvite } from "@/types/call";
// Response shapes are imported (type-only) from the routes that produce them,
// so this screen can never drift from what the API actually returns.
import type { Contact } from "@/app/api/contacts/route";
import type { RecentMeeting } from "@/app/api/meetings/recent/route";
import type { Notification } from "@/app/api/notifications/route";

type Recording = { id: string; filename: string; size: number; createdAt: string; publicUrl?: string; provider?: string; workspaceId?: string };
type SearchResult = { id: string; kind: "Meeting" | "Recording" | "Contact"; label: string; detail: string; go: () => void };


export type DashboardView = "Overview" | "My meetings" | "Recordings" | "Contacts" | "Profile";

type ProfileData = { id: string; name: string; username: string; joinedAt: string; avatarUrl?: string };
type ProfileStats = { meetings: number; recordings: number; contacts: number; storageBytes: number };

const navItems: { label: DashboardView; icon: typeof LayoutDashboard; path: string }[] = [
  { label: "Overview", icon: LayoutDashboard, path: "/" },
  { label: "My meetings", icon: CalendarDays, path: "/meetings" },
  { label: "Recordings", icon: Play, path: "/recordings" },
  { label: "Contacts", icon: UsersRound, path: "/contacts" },
];

const avatarColors = ["avatar-sky", "avatar-coral", "avatar-green", "avatar-lilac"];

const ACTIVE_WORKSPACE_KEY = "converge_active_workspace";

export default function Dashboard({ view }: { view: DashboardView }) {
  const router = useRouter();
  const activeNav = view;
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [incomingCalls, setIncomingCalls] = useState<CallInvite[]>([]);
  const [recentMeetings, setRecentMeetings] = useState<RecentMeeting[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [profileStats, setProfileStats] = useState<ProfileStats | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [user, setUser] = useState<{ id?: string; name: string; username: string; avatarUrl?: string } | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([{ id: "personal", name: "Personal", isDefault: true }]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("personal");
  const [workspaceModal, setWorkspaceModal] = useState<{ mode: "create" } | { mode: "rename"; workspace: Workspace } | { mode: "delete"; workspace: Workspace } | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("Team catch-up");
  const [meetingDate, setMeetingDate] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const [isWorkspaceReady, setIsWorkspaceReady] = useState(false);
  const [workspaceDataVersion, setWorkspaceDataVersion] = useState(0);
  const [playingRecording, setPlayingRecording] = useState<Recording | null>(null);
  const toastTimerRef = useRef(0);

  useEffect(() => {
    const current = new Date();
    setNow(current);
    // Keep the greeting and relative timestamps honest during long sessions.
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    const nextHour = new Date(current.getTime() + 60 * 60 * 1000);
    nextHour.setMinutes(0, 0, 0);
    const pad = (value: number) => String(value).padStart(2, "0");
    setMeetingDate(`${nextHour.getFullYear()}-${pad(nextHour.getMonth() + 1)}-${pad(nextHour.getDate())}T${pad(nextHour.getHours())}:${pad(nextHour.getMinutes())}`);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    async function pollCalls() {
      try {
        const data = await requestJson<{ incoming?: CallInvite[] }>("/api/calls");
        if (active) setIncomingCalls(data.incoming || []);
      } catch {
        // Polling recovers on the next tick; a missed poll is not worth surfacing.
      }
    }
    pollCalls();
    const timer = window.setInterval(pollCalls, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    async function loadRecent() {
      try {
        const data = await requestJson<{ meetings?: RecentMeeting[] }>(`/api/meetings/recent?limit=${activeNav === "My meetings" ? 20 : 3}${activeWorkspaceId ? `&workspaceId=${encodeURIComponent(activeWorkspaceId)}` : ""}`);
        if (active) setRecentMeetings(data.meetings || []);
      } catch {
        // Polling recovers on the next tick.
      }
    }
    loadRecent();
    // Live badges go stale fast, so refresh presence while the dashboard is open.
    const timer = window.setInterval(loadRecent, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user, activeNav, meetings.length, activeWorkspaceId]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    async function loadNotifications() {
      try {
        const data = await requestJson<{ notifications?: Notification[] }>("/api/notifications");
        if (active) setNotifications(data.notifications || []);
      } catch {
        // Polling recovers on the next tick.
      }
    }
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 20000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user]);

  useEffect(() => {
    if (activeNav !== "Profile") return;
    let active = true;
    async function loadProfile() {
      try {
        const data = await requestJson<{ profile: ProfileData; stats: ProfileStats }>("/api/profile");
        if (!active) return;
        setProfile(data.profile);
        setProfileStats(data.stats);
        setProfileName(data.profile?.name || "");
        setProfileUsername(data.profile?.username || "");
      } catch {
        // The profile view simply stays empty; saving still reports its own errors.
      }
    }
    loadProfile();
    return () => { active = false; };
  }, [activeNav]);

  async function applyAvatar(avatarUrl: string | null) {
    const data = await requestJson<{ profile: { avatarUrl?: string } }>("/api/profile", { method: "PATCH", body: { avatarUrl }, fallbackError: "We could not update your picture" });
    setProfile((current) => current ? { ...current, avatarUrl: data.profile.avatarUrl } : current);
    setUser((current) => current ? { ...current, avatarUrl: data.profile.avatarUrl } : current);
  }

  async function uploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { notify("Please choose an image file"); return; }

    setIsUploadingAvatar(true);
    try {
      const square = await cropToSquare(file);
      let stored = false;

      // Object storage is best-effort: it needs bucket CORS, so never let it block the upload.
      try {
        const signed = await requestJson<{ uploadUrl?: string; publicUrl?: string }>("/api/uploads/sign", {
          method: "POST",
          body: { filename: "avatar.jpg", contentType: "image/jpeg", kind: "avatar" },
        });
        if (signed.uploadUrl && signed.publicUrl) {
          const put = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: square.blob });
          if (put.ok) { await applyAvatar(signed.publicUrl); stored = true; }
        }
      } catch {}

      // No object storage available (or the upload failed) — keep the resized image inline.
      if (!stored) await applyAvatar(square.dataUrl);
      notify("Profile picture updated");
    } catch (avatarError) {
      notify(avatarError instanceof Error ? avatarError.message : "We could not update your picture");
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function removeAvatar() {
    setIsUploadingAvatar(true);
    try {
      await applyAvatar(null);
      notify("Profile picture removed");
    } catch (avatarError) {
      notify(avatarError instanceof Error ? avatarError.message : "We could not remove your picture");
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingProfile(true);
    try {
      const payload: Record<string, string> = { name: profileName, username: profileUsername };
      if (newPassword) { payload.currentPassword = currentPassword; payload.newPassword = newPassword; }
      const data = await requestJson<{ profile: { name: string; username: string } }>("/api/profile", { method: "PATCH", body: payload, fallbackError: "We could not save your profile" });
      setProfile((current) => current ? { ...current, name: data.profile.name, username: data.profile.username } : current);
      setUser((current) => current ? { ...current, name: data.profile.name, username: data.profile.username } : current);
      setCurrentPassword("");
      setNewPassword("");
      notify("Profile updated");
    } catch (profileError) {
      notify(profileError instanceof Error ? profileError.message : "We could not save your profile");
    } finally {
      setIsSavingProfile(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        setIsSearchOpen(true);
      }
      if (event.key === "Escape") { setIsSearchOpen(false); setIsNotificationsOpen(false); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Who you are and which workspaces exist — loaded once.
  useEffect(() => {
    async function loadAccount() {
      const [userData, workspacesData] = await Promise.all([
        requestJson<{ user: typeof user }>("/api/auth/me").catch(() => null),
        requestJson<{ workspaces?: Workspace[] }>("/api/workspaces").catch(() => null),
      ]);
      // An expired session passes the cookie check in middleware but 401s here;
      // without this redirect the dashboard sits in an empty, signed-out limbo.
      if (!userData?.user) {
        router.push("/login");
        return;
      }
      setUser(userData.user);
      const list = workspacesData?.workspaces || [];
      if (list.length > 0) {
        setWorkspaces(list);
        const saved = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
        setActiveWorkspaceId(list.some((workspace) => workspace.id === saved) ? (saved as string) : list[0].id);
      }
      setIsWorkspaceReady(true);
    }
    loadAccount().catch(() => { setIsWorkspaceReady(true); notify("We could not load your account"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; router is stable
  }, []);

  // Meetings, recordings and contacts belong to a workspace, so reload them whenever it changes.
  useEffect(() => {
    if (!isWorkspaceReady) return;
    let active = true;
    async function loadWorkspaceData() {
      const scope = activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : "";
      const [meetingsData, recordingsData, contactsData] = await Promise.all([
        requestJson<{ meetings?: Meeting[] }>(`/api/meetings${scope}`).catch(() => null),
        requestJson<{ recordings?: Recording[] }>(`/api/recordings${scope}`).catch(() => null),
        requestJson<{ contacts?: Contact[] }>(`/api/contacts${scope}`).catch(() => null),
      ]);
      if (!active) return;
      if (meetingsData) setMeetings(meetingsData.meetings || []);
      if (recordingsData) setRecordings(recordingsData.recordings || []);
      if (contactsData) setContacts(contactsData.contacts || []);
      // Each request already degrades to null, so a total failure has to be
      // detected here — the promise itself never rejects.
      if (!meetingsData && !recordingsData && !contactsData) notify("We could not load your workspace data");
    }
    void loadWorkspaceData();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- workspaceDataVersion forces refreshes
  }, [activeWorkspaceId, isWorkspaceReady, workspaceDataVersion]);

  const filteredMeetings = useMemo(
    () => meetings.filter((meeting) => meeting.title.toLowerCase().includes(search.toLowerCase())),
    [meetings, search],
  );

  // Bucketing depends on `now` (which ticks every minute) so an open dashboard
  // moves meetings from Upcoming to Past in step with the stat chips.
  const upcomingMeetings = useMemo(() => {
    const reference = (now ?? new Date()).getTime();
    return filteredMeetings.filter((meeting) => new Date(meeting.dateTime).getTime() >= reference - 60 * 60 * 1000).sort((a, b) => +new Date(a.dateTime) - +new Date(b.dateTime));
  }, [filteredMeetings, now]);

  const pastMeetings = useMemo(() => {
    const reference = (now ?? new Date()).getTime();
    return filteredMeetings.filter((meeting) => new Date(meeting.dateTime).getTime() < reference - 60 * 60 * 1000).sort((a, b) => +new Date(b.dateTime) - +new Date(a.dateTime));
  }, [filteredMeetings, now]);

  const filteredRecordings = useMemo(
    () => recordings.filter((recording) => recording.filename.toLowerCase().includes(search.toLowerCase())),
    [recordings, search],
  );

  const filteredContacts = useMemo(
    () => contacts.filter((contact) => `${contact.name} ${contact.username}`.toLowerCase().includes(search.toLowerCase())),
    [contacts, search],
  );

  const searchPlaceholder = "Search meetings, recordings, people";

  const searchResults = useMemo<SearchResult[]>(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    const results: SearchResult[] = [];
    for (const meeting of meetings) {
      if (meeting.title.toLowerCase().includes(term)) {
        results.push({ id: `m-${meeting.id}`, kind: "Meeting", label: meeting.title, detail: `${shortDateLabel(meeting)} · ${localTimeLabel(meeting)}`, go: () => router.push(`/room/${meeting.id}`) });
      }
    }
    for (const recording of recordings) {
      if (recording.filename.toLowerCase().includes(term)) {
        results.push({ id: `r-${recording.id}`, kind: "Recording", label: recording.filename, detail: formatBytes(recording.size), go: () => setPlayingRecording(recording) });
      }
    }
    for (const contact of contacts) {
      if (`${contact.name} ${contact.username}`.toLowerCase().includes(term)) {
        results.push({ id: `c-${contact.id}`, kind: "Contact", label: contact.name, detail: `@${contact.username}`, go: () => router.push("/contacts") });
      }
    }
    return results.slice(0, 8);
  }, [search, meetings, recordings, contacts, router]);

  const stats = useMemo(() => {
    const reference = now || new Date();
    const upcoming = meetings.filter((meeting) => new Date(meeting.dateTime).getTime() >= reference.getTime() - 60 * 60 * 1000).length;
    const monthMinutes = meetings
      .filter((meeting) => { const date = new Date(meeting.dateTime); return date.getMonth() === reference.getMonth() && date.getFullYear() === reference.getFullYear(); })
      .reduce((total, meeting) => total + (parseInt(meeting.duration) || 0), 0);
    const recordingBytes = recordings.reduce((total, recording) => total + (recording.size || 0), 0);
    const storagePercent = Math.min(100, Math.round((recordingBytes / (10 * 1024 ** 3)) * 100));
    return { upcoming, monthMinutes, recordingBytes, storagePercent };
  }, [meetings, recordings, now]);

  const greeting = !now ? "Good morning" : now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const todayLabel = now ? now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Today";

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0] || { id: "personal", name: "Personal" };

  function switchWorkspace(workspace: Workspace) {
    if (workspace.id !== activeWorkspaceId) {
      setActiveWorkspaceId(workspace.id);
      window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspace.id);
      notify(`Switched to ${workspace.name}`);
    }
    setIsWorkspaceMenuOpen(false);
  }

  function openWorkspaceModal(modal: { mode: "create" } | { mode: "rename"; workspace: Workspace } | { mode: "delete"; workspace: Workspace }) {
    setWorkspaceName(modal.mode === "rename" ? modal.workspace.name : "");
    setWorkspaceModal(modal);
    setIsWorkspaceMenuOpen(false);
  }

  async function submitWorkspaceModal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceModal || workspaceModal.mode === "delete") return;
    setIsSavingWorkspace(true);
    try {
      const isCreate = workspaceModal.mode === "create";
      const data = await requestJson<{ workspace: Workspace }>(isCreate ? "/api/workspaces" : `/api/workspaces/${workspaceModal.workspace.id}`, {
        method: isCreate ? "POST" : "PATCH",
        body: { name: workspaceName },
        fallbackError: "We could not save this workspace",
      });
      if (isCreate) {
        setWorkspaces((current) => [...current, data.workspace]);
        setActiveWorkspaceId(data.workspace.id);
        window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, data.workspace.id);
        notify(`Workspace "${data.workspace.name}" created`);
      } else {
        setWorkspaces((current) => current.map((workspace) => workspace.id === data.workspace.id ? { ...workspace, name: data.workspace.name } : workspace));
        notify("Workspace renamed");
      }
      setWorkspaceModal(null);
    } catch (workspaceError) {
      notify(workspaceError instanceof Error ? workspaceError.message : "We could not save this workspace");
    } finally {
      setIsSavingWorkspace(false);
    }
  }

  async function confirmDeleteWorkspace() {
    if (!workspaceModal || workspaceModal.mode !== "delete") return;
    const target = workspaceModal.workspace;
    setIsSavingWorkspace(true);
    try {
      await requestJson(`/api/workspaces/${target.id}`, { method: "DELETE", fallbackError: "We could not delete this workspace" });
      const remaining = workspaces.filter((workspace) => workspace.id !== target.id);
      setWorkspaces(remaining);
      if (activeWorkspaceId === target.id && remaining.length > 0) {
        setActiveWorkspaceId(remaining[0].id);
        window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, remaining[0].id);
      }
      // The server hands the deleted workspace's meetings/recordings to the
      // default workspace — reload so they appear without a page refresh.
      setWorkspaceDataVersion((current) => current + 1);
      notify(`Workspace "${target.name}" deleted`);
      setWorkspaceModal(null);
    } catch (workspaceError) {
      notify(workspaceError instanceof Error ? workspaceError.message : "We could not delete this workspace");
    } finally {
      setIsSavingWorkspace(false);
    }
  }

  function notify(message: string) {
    setToast(message);
    // Replace any pending dismissal so an older toast cannot hide a newer one early.
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }

  async function startInstantMeeting() {
    setIsStarting(true);
    try {
      const data = await requestJson<{ meeting?: Meeting }>("/api/meetings", {
        method: "POST",
        body: { title: "Instant team meeting", dateTime: new Date().toISOString(), type: "Planning", workspaceId: activeWorkspaceId },
        fallbackError: "Could not create the meeting room",
      });
      const meeting = data.meeting;
      if (meeting) {
        setMeetings((current) => [meeting, ...current]);
        router.push(`/room/${meeting.id}`);
      }
    } catch (meetingError) {
      notify(meetingError instanceof Error ? meetingError.message : "Could not create the meeting room");
    } finally {
      setIsStarting(false);
    }
  }

  async function scheduleMeeting(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // datetime-local carries no zone; convert here so the server (often UTC)
    // stores the instant the user actually picked.
    const scheduledAt = new Date(meetingDate);
    if (Number.isNaN(scheduledAt.getTime())) { notify("Please pick a valid date and time"); return; }
    const payload = { title: meetingTitle, dateTime: scheduledAt.toISOString(), type: "Planning" as const, duration: "30 min", workspaceId: activeWorkspaceId };

    try {
      const data = await requestJson<{ meeting?: Meeting }>("/api/meetings", { method: "POST", body: payload, fallbackError: "Could not schedule this meeting" });
      const meeting = data.meeting;
      if (meeting) setMeetings((current) => [...current, meeting]);
      setIsScheduleOpen(false);
      notify("Meeting scheduled successfully");
    } catch (meetingError) {
      notify(meetingError instanceof Error ? meetingError.message : "Could not schedule this meeting");
    }
  }

  async function startDirectCall(contact: Contact) {
    setIsStarting(true);
    try {
      const data = await requestJson<{ meetingId: string }>("/api/calls", {
        method: "POST",
        body: { toUserId: contact.id, workspaceId: activeWorkspaceId },
        fallbackError: `We could not call ${contact.name}`,
      });
      notify(`Calling ${contact.name}...`);
      router.push(`/room/${data.meetingId}`);
    } catch (callError) {
      notify(callError instanceof Error ? callError.message : `We could not call ${contact.name}`);
    } finally {
      setIsStarting(false);
    }
  }

  async function respondToCall(call: CallInvite, action: "accept" | "decline") {
    try {
      await requestJson(`/api/calls/${call.id}`, { method: "PATCH", body: { action }, fallbackError: "We could not update this call" });
      setIncomingCalls((current) => current.filter((item) => item.id !== call.id));
      if (action === "accept") router.push(`/room/${call.meetingId}`);
      else notify(`Declined the call from ${call.fromName}`);
    } catch (callError) {
      notify(callError instanceof Error ? callError.message : "We could not update this call");
    }
  }

  async function copyMeetingLink(meetingId: string) {
    const link = `${window.location.origin}/room/${meetingId}`;
    try {
      await navigator.clipboard.writeText(link);
      notify("Room link copied to clipboard");
    } catch {
      notify(`Copy this link to invite: ${link}`);
    }
  }

  async function copyRoomLink() {
    const meeting = meetings[0];
    if (!meeting) {
      notify("Start a meeting first to create a room link");
      return;
    }
    await copyMeetingLink(meeting.id);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  // While the account is still loading, show nothing rather than a fake persona.
  const firstName = user?.name.split(" ")[0] || "";
  const initials = user ? initialsOf(user.name) : "";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${isSidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span /><span /><span /></div>
          <span>meet</span>
          <button className="sidebar-close" onClick={() => setIsSidebarOpen(false)} aria-label="Close navigation"><PanelLeftClose size={17} /></button>
        </div>

        <div className="workspace-wrap">
          <button className={`workspace-select ${isWorkspaceMenuOpen ? "is-open" : ""}`} onClick={() => setIsWorkspaceMenuOpen((current) => !current)} aria-expanded={isWorkspaceMenuOpen} aria-haspopup="menu">
            <div className="workspace-avatar">{workspaceInitial(activeWorkspace.name)}</div>
            <div><span className="workspace-label">Workspace</span><strong>{activeWorkspace.name}</strong></div>
            <ChevronDown size={15} className={`muted-icon workspace-chevron ${isWorkspaceMenuOpen ? "is-open" : ""}`} />
          </button>
          {isWorkspaceMenuOpen && <div className="workspace-menu" role="menu">
            <p className="workspace-menu-kicker">Your workspaces</p>
            {workspaces.map((workspace) => (
              <div className={`workspace-menu-row ${workspace.id === activeWorkspace.id ? "is-current" : ""}`} key={workspace.id}>
                <button className="workspace-menu-item" role="menuitem" onClick={() => switchWorkspace(workspace)}>
                  <span className="workspace-avatar">{workspaceInitial(workspace.name)}</span>
                  <span className="workspace-menu-copy"><strong>{workspace.name}</strong><small>{workspace.id === activeWorkspace.id ? "Current workspace" : "Switch to this workspace"}</small></span>
                  {workspace.id === activeWorkspace.id && <Check size={14} />}
                </button>
                <span className="workspace-row-actions">
                  <button onClick={() => openWorkspaceModal({ mode: "rename", workspace })} aria-label={`Rename ${workspace.name}`}><Pencil size={12} /></button>
                  <button className="is-danger" onClick={() => openWorkspaceModal({ mode: "delete", workspace })} disabled={workspaces.length <= 1} aria-label={`Delete ${workspace.name}`}><Trash2 size={12} /></button>
                </span>
              </div>
            ))}
            <div className="workspace-menu-divider" />
            <button className="workspace-menu-item" role="menuitem" onClick={() => { setIsWorkspaceMenuOpen(false); setIsSidebarOpen(false); router.push("/contacts"); }}>
              <span className="workspace-menu-icon"><UsersRound size={14} /></span>
              <span className="workspace-menu-copy"><strong>Invite teammates</strong><small>See who&apos;s in your workspace</small></span>
            </button>
            <button className="workspace-menu-item" role="menuitem" onClick={() => openWorkspaceModal({ mode: "create" })}>
              <span className="workspace-menu-icon"><Plus size={14} /></span>
              <span className="workspace-menu-copy"><strong>Create a workspace</strong><small>Start a space for another team</small></span>
            </button>
          </div>}
        </div>
        {isWorkspaceMenuOpen && <button className="workspace-menu-backdrop" onClick={() => setIsWorkspaceMenuOpen(false)} aria-label="Close workspace menu" />}

        <nav className="main-nav" aria-label="Main navigation">
          <p className="nav-kicker">Workspace</p>
          {navItems.map(({ label, icon: Icon, path }) => (
            <button key={label} className={`nav-item ${activeNav === label ? "active" : ""}`} onClick={() => { setIsSidebarOpen(false); router.push(path); }}>
              <Icon size={18} strokeWidth={activeNav === label ? 2.3 : 1.8} />
              <span>{label}</span>
              {label === "My meetings" && meetings.length > 0 && <em>{meetings.length}</em>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="storage-card">
            <div className="storage-heading"><span className="storage-icon"><Cloud size={15} /></span><span>Cloud storage</span><span className="storage-percent">{stats.storagePercent}%</span></div>
            <div className="storage-track"><div style={{ width: `${Math.max(stats.storagePercent, 2)}%` }} /></div>
            <p>{formatBytes(stats.recordingBytes)} of 10 GB used</p>
            <button onClick={() => router.push("/recordings")}>Manage storage <ArrowUpRight size={13} /></button>
          </div>
          <button className="nav-item secondary" onClick={() => notify("Settings are coming soon")}><Settings2 size={18} /><span>Settings</span></button>
          <button className="nav-item secondary" onClick={() => notify("The help center is coming soon")}><CircleHelp size={18} /><span>Help center</span></button>
          <div className="profile-row">
            <Avatar src={user?.avatarUrl} initials={initials} className="profile-avatar" />
            <div><strong>{user?.name || "—"}</strong><span>{user ? `@${user.username}` : ""}</span></div>
            <button className="logout-button" onClick={logout} aria-label="Sign out"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      {isSidebarOpen && <button className="sidebar-backdrop" onClick={() => setIsSidebarOpen(false)} aria-label="Close navigation" />}

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setIsSidebarOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{activeNav}</strong></div>
          <div className="topbar-actions">
            <div className="search-wrap">
              <label className="search-box">
                <Search size={17} />
                <input ref={searchInputRef} value={search} onChange={(event) => { setSearch(event.target.value); setIsSearchOpen(true); }} onFocus={() => setIsSearchOpen(true)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
                <kbd>⌘ K</kbd>
              </label>
              {isSearchOpen && search.trim() && <>
                <button className="overlay-backdrop" onClick={() => setIsSearchOpen(false)} aria-label="Close search results" />
                <div className="search-results" role="listbox">
                  {searchResults.length === 0 ? <p className="search-empty">Nothing matches &ldquo;{search}&rdquo;</p> : searchResults.map((result) => (
                    <button className="search-result" key={result.id} onClick={() => { result.go(); setIsSearchOpen(false); }}>
                      <span className="search-result-copy"><strong>{result.label}</strong><small>{result.detail}</small></span>
                      <span className="search-kind">{result.kind}</span>
                    </button>
                  ))}
                </div>
              </>}
            </div>
            <div className="notification-wrap">
              <button className="icon-button notification-button" onClick={() => setIsNotificationsOpen((current) => !current)} aria-label={notifications.length > 0 ? `Notifications, ${notifications.length} new` : "Notifications"} aria-expanded={isNotificationsOpen}><Bell size={18} />{notifications.length > 0 && <i />}</button>
              {isNotificationsOpen && <>
                <button className="overlay-backdrop" onClick={() => setIsNotificationsOpen(false)} aria-label="Close notifications" />
                <div className="notification-panel">
                  <div className="notification-head"><strong>Notifications</strong>{notifications.length > 0 && <span>{notifications.length}</span>}</div>
                  {notifications.length === 0 ? <p className="notification-empty">You&apos;re all caught up.</p> : <div className="notification-list">
                    {notifications.map((item) => (
                      <button className={`notification-item kind-${item.kind}`} key={item.id} onClick={() => { setIsNotificationsOpen(false); if (item.href) router.push(item.href); }}>
                        <span className="notification-dot" />
                        <span className="notification-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
                        <span className="notification-time">{item.kind === "live-meeting" ? "now" : formatRelativeTime(item.at, now)}</span>
                      </button>
                    ))}
                  </div>}
                </div>
              </>}
            </div>
            <button className="top-avatar-button" onClick={() => router.push("/profile")} aria-label="Your profile"><Avatar src={user?.avatarUrl} initials={initials} className="top-avatar" /></button>
          </div>
        </header>

        <div className="page-wrap">
          {activeNav === "Overview" && <>
          <section className="welcome-row">
            <div>
              <p className="eyebrow"><span className="status-dot" /> {todayLabel}</p>
              <h1>{greeting}{firstName ? `, ${firstName}` : ""} <span>✦</span></h1>
              <p className="subheading">Make room for the conversations that move work forward.</p>
            </div>
            <button className="button button-primary compact-button" onClick={() => setIsScheduleOpen(true)}><Plus size={17} /> Schedule meeting</button>
          </section>

          <section className="hero-card">
            <div className="hero-copy">
              <div className="hero-tag"><Sparkles size={14} /> Your team&apos;s huddle is ready</div>
              <h2>Meetings that feel<br /><em>more human.</em></h2>
              <p>Start a room in seconds, bring your best people together, and keep the momentum going.</p>
              <div className="hero-actions">
                <button className="button light-button" onClick={startInstantMeeting} disabled={isStarting}><Video size={16} /> {isStarting ? "Opening room..." : "Start a meeting"}</button>
                <button className="text-button" onClick={copyRoomLink}>Copy room link <Copy size={14} /></button>
              </div>
            </div>
            <div className="hero-visual" aria-label="Preview of a live meeting">
              <div className="visual-orbit orbit-one" />
              <div className="visual-orbit orbit-two" />
              <div className="meeting-window">
                <div className="meeting-window-top"><span><i className="window-dot red" /><i className="window-dot yellow" /><i className="window-dot green" /></span><span className="window-title"><Radio size={11} /> willow-huddle</span><MoreHorizontal size={14} /></div>
                <div className="video-grid">
                  <div className="video-tile tile-lilac"><span className="tile-initials">OC</span><span className="tile-name">Olivia</span><span className="tile-mic"><Mic2 size={11} /></span></div>
                  <div className="video-tile tile-peach"><span className="tile-face">JM</span><span className="tile-name">Jamie</span><span className="tile-mic"><Mic2 size={11} /></span></div>
                  <div className="video-tile tile-blue"><span className="tile-face">MK</span><span className="tile-name">Maya</span><span className="tile-mic"><Mic2 size={11} /></span></div>
                  <div className="video-tile tile-cream"><span className="tile-face">AL</span><span className="tile-name">Alex</span><span className="tile-mic"><Mic2 size={11} /></span></div>
                </div>
                <div className="meeting-window-bottom"><span className="live-pill"><i /> Live now</span><span className="call-duration">00:24:18</span><span className="mini-controls"><i /><i /><i /></span></div>
              </div>
            </div>
          </section>

          <section className="stats-grid" aria-label="Meeting statistics">
            <div className="stat-card"><div className="stat-icon blue-icon"><Clock3 size={18} /></div><div><span>Total meetings</span><strong>{meetings.length}</strong></div><span className="stat-change positive">{stats.upcoming} upcoming</span></div>
            <div className="stat-card"><div className="stat-icon lilac-icon"><Zap size={18} /></div><div><span>Time in meetings</span><strong>{formatMinutes(stats.monthMinutes)}</strong></div><span className="stat-change neutral">This month</span></div>
            <div className="stat-card"><div className="stat-icon green-icon"><Play size={17} /></div><div><span>Recordings stored</span><strong>{recordings.length}</strong></div><span className="stat-change neutral">{formatBytes(stats.recordingBytes)}</span></div>
          </section>

          <div className="content-grid">
            <section className="panel upcoming-panel">
              <div className="panel-heading"><div><h3>Upcoming meetings</h3><p>Your next conversations, all in one place.</p></div><button className="view-all" onClick={() => router.push("/meetings")}>View calendar <ArrowUpRight size={14} /></button></div>
              <div className="meeting-list">
                {upcomingMeetings.length === 0 ? <div className="empty-state"><Search size={20} /><p>{search ? `No meetings match "${search}"` : "No upcoming meetings yet"}</p></div> : upcomingMeetings.map((meeting, index) => <MeetingRow key={meeting.id} meeting={meeting} index={index} onJoin={() => router.push(`/room/${meeting.id}`)} onCopyLink={() => copyMeetingLink(meeting.id)} />)}
              </div>
              <button className="add-meeting-row" onClick={() => setIsScheduleOpen(true)}><span><Plus size={16} /></span> Add a new meeting <ChevronRight size={15} /></button>
            </section>

            <aside className="right-column">
              <section className="panel quick-panel">
                <div className="panel-heading"><div><h3>Quick actions</h3><p>Jump right in.</p></div><span className="sparkle-badge">✦</span></div>
                <div className="quick-actions"><button onClick={startInstantMeeting}><span className="quick-icon blue-icon"><Video size={17} /></span><span><strong>Start instant meeting</strong><small>Open a room right now</small></span><ChevronRight size={15} /></button><button onClick={() => setIsScheduleOpen(true)}><span className="quick-icon lilac-icon"><CalendarDays size={17} /></span><span><strong>Schedule for later</strong><small>Find a time that works</small></span><ChevronRight size={15} /></button><button onClick={() => router.push("/recordings")}><span className="quick-icon green-icon"><Play size={17} /></span><span><strong>View recordings</strong><small>Saved from your meetings</small></span><ChevronRight size={15} /></button></div>
              </section>

              <section className="panel recent-panel">
                <div className="panel-heading"><div><h3>Recent meetings</h3><p>Rooms you were just in.</p></div><Radio size={17} className="heading-icon" /></div>
                {recentMeetings.length === 0 ? (
                  <div className="recording-empty"><CalendarDays size={17} /><span>No meetings joined yet</span></div>
                ) : (
                  <div className="recent-list">
                    {recentMeetings.slice(0, 3).map((meeting) => (
                      <RecentMeetingRow key={meeting.id} meeting={meeting} now={now} onCopyLink={() => copyMeetingLink(meeting.id)} onJoin={() => router.push(`/room/${meeting.id}`)} />
                    ))}
                  </div>
                )}
                <button className="recordings-link" onClick={() => router.push("/meetings")}>View all meetings <ArrowUpRight size={14} /></button>
              </section>

              <section className="panel recording-panel">
                <div className="panel-heading"><div><h3>Recent recordings</h3><p>Stored securely in your cloud.</p></div><FileText size={18} className="heading-icon" /></div>
                {recordings.length === 0 ? <div className="recording-empty"><Play size={17} /><span>No recordings yet</span></div> : recordings.slice(0, 2).map((recording, index) => <RecordingRow key={recording.id} recording={recording} index={index} onPlay={() => setPlayingRecording(recording)} />)}
                <button className="recordings-link" onClick={() => router.push("/recordings")}>View all recordings <ArrowUpRight size={14} /></button>
              </section>
            </aside>
          </div>
          </>}

          {activeNav === "My meetings" && (
            <section className="panel section-panel">
              <div className="panel-heading">
                <div><h3>My meetings</h3><p>Everything on your calendar, upcoming and past.</p></div>
                <button className="button button-primary compact-button" onClick={() => setIsScheduleOpen(true)}><Plus size={16} /> Schedule meeting</button>
              </div>
              {recentMeetings.some((meeting) => meeting.isLive) && <>
                <p className="list-kicker">Live now</p>
                <div className="recent-list in-panel">
                  {recentMeetings.filter((meeting) => meeting.isLive).map((meeting) => (
                    <RecentMeetingRow key={meeting.id} meeting={meeting} now={now} onCopyLink={() => copyMeetingLink(meeting.id)} onJoin={() => router.push(`/room/${meeting.id}`)} />
                  ))}
                </div>
              </>}
              {upcomingMeetings.length === 0 && pastMeetings.length === 0 ? (
                <div className="empty-state"><CalendarDays size={20} /><p>{search ? `No meetings match "${search}"` : "No meetings yet — schedule your first one."}</p></div>
              ) : (
                <>
                  <p className="list-kicker">Upcoming · {upcomingMeetings.length}</p>
                  {upcomingMeetings.length === 0 ? (
                    <div className="empty-state slim"><CalendarDays size={17} /><p>Nothing upcoming — schedule your next meeting.</p></div>
                  ) : (
                    <div className="meeting-list">{upcomingMeetings.map((meeting, index) => <MeetingRow key={meeting.id} meeting={meeting} index={index} onJoin={() => router.push(`/room/${meeting.id}`)} onCopyLink={() => copyMeetingLink(meeting.id)} />)}</div>
                  )}
                  {pastMeetings.length > 0 && <>
                    <p className="list-kicker">Past · {pastMeetings.length}</p>
                    <div className="meeting-list past-list">{pastMeetings.map((meeting, index) => <MeetingRow key={meeting.id} meeting={meeting} index={index} onJoin={() => router.push(`/room/${meeting.id}`)} onCopyLink={() => copyMeetingLink(meeting.id)} />)}</div>
                  </>}
                </>
              )}
              <button className="add-meeting-row" onClick={() => setIsScheduleOpen(true)}><span><Plus size={16} /></span> Add a new meeting <ChevronRight size={15} /></button>
            </section>
          )}

          {activeNav === "Recordings" && (
            <section className="panel section-panel">
              <div className="panel-heading">
                <div><h3>Recordings</h3><p>Stored securely in your cloud.</p></div>
                <span className="contact-count">{filteredRecordings.length} saved</span>
              </div>
              {filteredRecordings.length === 0 ? (
                <div className="empty-state"><Play size={20} /><p>{search ? `No recordings match "${search}"` : "No recordings yet — start recording inside a meeting and it saves here."}</p></div>
              ) : (
                <div className="recordings-list">
                  {filteredRecordings.map((recording, index) => (
                    <RecordingRow key={recording.id} recording={recording} index={index} onPlay={() => setPlayingRecording(recording)} showProvider />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeNav === "Profile" && (
            <div className="profile-layout">
              <section className="panel section-panel">
                <div className="panel-heading"><div><h3>Your profile</h3><p>Manage how you appear across Meet.</p></div></div>
                <div className="profile-identity">
                  <div className="profile-avatar-block">
                    <Avatar src={profile?.avatarUrl} initials={initials} className="profile-big-avatar" />
                    <button type="button" className="avatar-edit" onClick={() => avatarInputRef.current?.click()} disabled={isUploadingAvatar} aria-label="Change profile picture"><Camera size={13} /></button>
                  </div>
                  <div>
                    <strong>{profile?.name || user?.name || "—"}</strong>
                    <span>@{profile?.username || user?.username || "—"}</span>
                    {profile?.joinedAt && <small>Member since {new Date(profile.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</small>}
                    <div className="avatar-actions">
                      <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={isUploadingAvatar}>{isUploadingAvatar ? "Uploading..." : profile?.avatarUrl ? "Change picture" : "Upload picture"}</button>
                      {profile?.avatarUrl && <button type="button" className="is-danger" onClick={() => void removeAvatar()} disabled={isUploadingAvatar}>Remove</button>}
                    </div>
                  </div>
                </div>
                <form className="profile-form" onSubmit={saveProfile}>
                  <label>Full name<input value={profileName} onChange={(event) => setProfileName(event.target.value)} required minLength={2} /></label>
                  <label>Username<input value={profileUsername} onChange={(event) => setProfileUsername(event.target.value)} required pattern="[A-Za-z0-9._-]{3,24}" /></label>
                  <p className="profile-form-kicker">Change password</p>
                  <label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Leave blank to keep it" autoComplete="current-password" /></label>
                  <label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters" autoComplete="new-password" /></label>
                  <div className="profile-actions"><button type="submit" className="button button-primary" disabled={isSavingProfile}>{isSavingProfile ? "Saving..." : "Save changes"}</button></div>
                </form>
              </section>

              <aside className="right-column">
                <section className="panel section-panel">
                  <div className="panel-heading"><div><h3>Your data</h3><p>What Meet stores for you.</p></div></div>
                  <div className="profile-stat-list">
                    <div className="profile-stat"><span className="stat-icon blue-icon"><CalendarDays size={16} /></span><div><strong>{profileStats?.meetings ?? 0}</strong><small>Meetings</small></div></div>
                    <div className="profile-stat"><span className="stat-icon lilac-icon"><Play size={16} /></span><div><strong>{profileStats?.recordings ?? 0}</strong><small>Recordings · {formatBytes(profileStats?.storageBytes ?? 0)}</small></div></div>
                    <div className="profile-stat"><span className="stat-icon green-icon"><UsersRound size={16} /></span><div><strong>{profileStats?.contacts ?? 0}</strong><small>Contacts</small></div></div>
                  </div>
                  <button className="recordings-link" onClick={() => router.push("/recordings")}>Manage recordings <ArrowUpRight size={14} /></button>
                </section>

                <section className="panel section-panel">
                  <div className="panel-heading"><div><h3>Session</h3><p>Signed in on this device.</p></div></div>
                  <div className="profile-session"><button className="button ghost-button" onClick={logout}><LogOut size={15} /> Sign out</button></div>
                </section>
              </aside>
            </div>
          )}

          {activeNav === "Contacts" && (
            <section className="panel section-panel">
              <div className="panel-heading">
                <div><h3>Contacts</h3><p>People you&apos;ve joined meetings with.</p></div>
                <span className="contact-count">{filteredContacts.length} {filteredContacts.length === 1 ? "person" : "people"}</span>
              </div>
              {filteredContacts.length === 0 ? (
                <div className="empty-state"><UsersRound size={20} /><p>{search ? `No contacts match "${search}"` : "You haven't met anyone yet — contacts appear after you join a meeting together."}</p></div>
              ) : (
                <div className="contact-grid">
                  {filteredContacts.map((contact, index) => (
                    <div className="contact-card" key={contact.id}>
                      <Avatar src={contact.avatarUrl} initials={initialsOf(contact.name)} className={`contact-avatar ${avatarColors[index % avatarColors.length]}`} />
                      <strong>{contact.name}</strong>
                      <span className="contact-handle">@{contact.username}</span>
                      <span className="contact-joined">{contact.meetingsShared} {contact.meetingsShared === 1 ? "meeting" : "meetings"} together · last met {new Date(contact.lastMetAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      <button className="button button-primary compact-button" onClick={() => startDirectCall(contact)} disabled={isStarting}><Video size={14} /> {isStarting ? "Calling..." : "Start a call"}</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {isScheduleOpen && <div className="modal-backdrop" onClick={() => setIsScheduleOpen(false)}><div className="schedule-modal" onClick={(event) => event.stopPropagation()}><div className="modal-top"><div><span className="modal-kicker"><CalendarDays size={14} /> Add to your calendar</span><h2>Schedule a meeting</h2></div><button className="icon-button" onClick={() => setIsScheduleOpen(false)} aria-label="Close dialog"><X size={18} /></button></div><form onSubmit={scheduleMeeting}><label>Meeting title<input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} maxLength={200} required /></label><label>Date and time<input type="datetime-local" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} required /></label><div className="modal-note"><Sparkles size={15} /><span>Everyone invited will receive a Meet room link.</span></div><div className="modal-actions"><button type="button" className="button ghost-button" onClick={() => setIsScheduleOpen(false)}>Cancel</button><button type="submit" className="button button-primary">Schedule meeting <ArrowUpRight size={15} /></button></div></form></div></div>}

      {workspaceModal && <div className="modal-backdrop" onClick={() => setWorkspaceModal(null)}><div className="schedule-modal" onClick={(event) => event.stopPropagation()}>
        {workspaceModal.mode === "delete" ? (
          <>
            <div className="modal-top"><div><span className="modal-kicker danger-kicker"><Trash2 size={14} /> This cannot be undone</span><h2>Delete workspace</h2></div><button className="icon-button" onClick={() => setWorkspaceModal(null)} aria-label="Close dialog"><X size={18} /></button></div>
            <p className="modal-body-text">You are about to delete <strong>{workspaceModal.workspace.name}</strong>. Your meetings and recordings stay in your account, but this workspace will be removed for good.</p>
            <div className="modal-actions"><button type="button" className="button ghost-button" onClick={() => setWorkspaceModal(null)}>Cancel</button><button type="button" className="button button-danger" onClick={confirmDeleteWorkspace} disabled={isSavingWorkspace}><Trash2 size={15} /> {isSavingWorkspace ? "Deleting..." : "Delete workspace"}</button></div>
          </>
        ) : (
          <>
            <div className="modal-top"><div><span className="modal-kicker"><Sparkles size={14} /> {workspaceModal.mode === "create" ? "A fresh start" : "Give it a better name"}</span><h2>{workspaceModal.mode === "create" ? "Create a workspace" : "Rename workspace"}</h2></div><button className="icon-button" onClick={() => setWorkspaceModal(null)} aria-label="Close dialog"><X size={18} /></button></div>
            <form onSubmit={submitWorkspaceModal}>
              <label>Workspace name<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="e.g. Design team" maxLength={60} autoFocus required /></label>
              <div className="modal-actions"><button type="button" className="button ghost-button" onClick={() => setWorkspaceModal(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={isSavingWorkspace}>{isSavingWorkspace ? "Saving..." : workspaceModal.mode === "create" ? "Create workspace" : "Save changes"}</button></div>
            </form>
          </>
        )}
      </div></div>}

      {incomingCalls.length > 0 && <div className="call-banners">
        {incomingCalls.map((call) => (
          <div className="call-banner" key={call.id} role="alert">
            <span className="call-banner-pulse"><Video size={16} /></span>
            <div className="call-banner-copy"><strong>{call.fromName}</strong><span>is inviting you to a live call</span></div>
            <button className="button button-primary call-banner-join" onClick={() => respondToCall(call, "accept")}>Join</button>
            <button className="call-banner-decline" onClick={() => respondToCall(call, "decline")}>Decline</button>
          </div>
        ))}
      </div>}

      {playingRecording && <div className="modal-backdrop" onClick={() => setPlayingRecording(null)}><div className="player-modal" onClick={(event) => event.stopPropagation()}>
        <div className="player-head"><div><strong>{playingRecording.filename}</strong><span>{new Date(playingRecording.createdAt).toLocaleString()} · {formatBytes(playingRecording.size)}</span></div><button className="icon-button" onClick={() => setPlayingRecording(null)} aria-label="Close player"><X size={18} /></button></div>
        <div className="player-frame">
          {playingRecording.publicUrl
            ? <video src={playingRecording.publicUrl} controls autoPlay playsInline />
            : <p className="player-missing">This recording has no playable URL saved.</p>}
        </div>
        {playingRecording.publicUrl && <div className="player-actions"><a className="button ghost-button" href={playingRecording.publicUrl} target="_blank" rel="noreferrer">Open in new tab <ArrowUpRight size={14} /></a></div>}
      </div></div>}

      <input ref={avatarInputRef} type="file" accept="image/*" className="sr-only" onChange={uploadAvatar} />

      {toast && <div className="toast"><span><Check size={15} /></span>{toast}</div>}
    </div>
  );
}

/** One saved recording, as listed on the Overview and Recordings screens. */
function RecordingRow({ recording, index, onPlay, showProvider = false }: { recording: Recording; index: number; onPlay: () => void; showProvider?: boolean }) {
  return <div className="recording-item">
    <button className={`recording-thumb is-play ${index % 2 === 0 ? "thumb-purple" : "thumb-blue"}`} onClick={onPlay} aria-label={`Play ${recording.filename}`}><Play size={14} fill="currentColor" /></button>
    <button className="recording-title" onClick={onPlay}><strong>{recording.filename}</strong><span>{new Date(recording.createdAt).toLocaleDateString()} · {formatBytes(recording.size)}</span></button>
    {showProvider && <span className="provider-pill">Cloud</span>}
    {recording.publicUrl ? <a href={recording.publicUrl} target="_blank" rel="noreferrer" className="recording-open" aria-label={`Open ${recording.filename} in a new tab`}><ArrowUpRight size={14} /></a> : <MoreHorizontal size={16} className="muted-icon" />}
  </div>;
}

/** A room you were recently in, with its live/ended state and join control. */
function RecentMeetingRow({ meeting, now, onCopyLink, onJoin }: { meeting: RecentMeeting; now: Date | null; onCopyLink: () => void; onJoin: () => void }) {
  return <div className={`recent-item ${meeting.isLive ? "is-live" : ""}`}>
    <div className="recent-item-copy">
      <strong>{meeting.title}</strong>
      <span>{meeting.isLive ? <em className="live-tag"><i />Live · {meeting.participantCount} in room</em> : meeting.isEnded ? "Ended" : `Last joined ${formatRelativeTime(meeting.lastActivityAt, now)}`}</span>
    </div>
    <button className="recent-copy" onClick={onCopyLink} aria-label={`Copy link for ${meeting.title}`}><Copy size={12} /></button>
    {meeting.isEnded
      ? <span className="recent-ended">Ended</span>
      : <button className="recent-join" onClick={onJoin}>{meeting.isLive ? "Join" : "Reopen"}</button>}
  </div>;
}

function MeetingRow({ meeting, index, onJoin, onCopyLink }: { meeting: Meeting; index: number; onJoin: () => void; onCopyLink?: () => void }) {
  const timeLabel = localTimeLabel(meeting);
  return <div className="meeting-row"><div className="date-block"><em>{shortDateLabel(meeting)}</em><strong>{timeLabel.split(" ")[0]}</strong><span>{timeLabel.split(" ")[1]}</span></div><div className="meeting-line" /><div className="meeting-detail"><div className="meeting-title-line"><h4>{meeting.title}</h4><span className={`meeting-type type-${index % 3}`}>{meeting.type}</span></div><div className="meeting-meta"><span><Clock3 size={13} /> {meeting.duration}</span><span className="avatar-stack">{meeting.attendees.map((attendee, attendeeIndex) => <i className={avatarColors[attendeeIndex % avatarColors.length]} key={attendee}>{attendee}</i>)}{meeting.attendeeCount > meeting.attendees.length && <b>+{meeting.attendeeCount - meeting.attendees.length}</b>}</span><span>{meeting.attendeeCount} people</span></div></div>{onCopyLink && <button className="copy-link-button" onClick={onCopyLink} aria-label={`Copy link for ${meeting.title}`}><Copy size={13} /></button>}<button className="join-button" onClick={onJoin}>Join <ArrowUpRight size={13} /></button></div>;
}

/**
 * The stored timeLabel is a server-side snapshot (often UTC in production),
 * so meeting times are re-derived from the ISO date in the viewer's timezone.
 */
function localTimeLabel(meeting: Meeting) {
  const date = new Date(meeting.dateTime);
  if (Number.isNaN(date.getTime())) return meeting.timeLabel;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Today" / "Tomorrow" / "Mon, Jul 28" — so a row is never just a bare time. */
function shortDateLabel(meeting: Meeting) {
  const date = new Date(meeting.dateTime);
  if (Number.isNaN(date.getTime())) return meeting.dateLabel || "";
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function workspaceInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "W";
}

const AVATAR_SIZE = 256;

/** Centre-crop to a square and shrink, so avatars stay small wherever they are stored. */
async function cropToSquare(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("We could not read that image");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("We could not process that image");
  return { blob, dataUrl: canvas.toDataURL("image/jpeg", 0.85) };
}

function Avatar({ src, initials, className }: { src?: string; initials: string; className: string }) {
  if (src) return <span className={className} style={{ backgroundImage: `url(${src})` }} data-has-image="true" />;
  return <span className={className}>{initials}</span>;
}

function formatRelativeTime(isoDate: string, reference: Date | null) {
  const then = new Date(isoDate).getTime();
  if (!Number.isFinite(then)) return "recently";
  const minutes = Math.round(((reference || new Date()).getTime() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function formatMinutes(totalMinutes: number) {
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}
