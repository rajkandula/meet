import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { deleteCurrentSession, SESSION_COOKIE_NAME } from "@/lib/auth";

export const POST = apiHandler("api/auth/logout", async () => {
  await deleteCurrentSession();
  const response = NextResponse.json({ success: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
});
