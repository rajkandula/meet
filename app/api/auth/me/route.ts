import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";

export const GET = apiHandler("api/auth/me", async () => {
  const user = await getCurrentUser();
  // Deliberately not requireUser(): the client probes this to learn whether a
  // session exists, so "signed out" is a normal answer, not an error to log.
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  return NextResponse.json({
    user: {
      id: user._id?.toString(),
      name: user.name,
      username: user.username,
      avatarUrl: user.avatarUrl,
    },
  });
});
