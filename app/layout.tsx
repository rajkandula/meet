import type { Metadata, Viewport } from "next";
import "./globals.css";
import { InstallPrompt } from "./components/install-prompt";

export const metadata: Metadata = {
  title: "Meet — Meetings, made human",
  description: "A focused meeting workspace for modern teams.",
  appleWebApp: {
    capable: true,
    title: "Meet",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the app paint under iPhone notches; safe-area insets keep controls clear.
  viewportFit: "cover",
  themeColor: "#171f38",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <InstallPrompt />
      </body>
    </html>
  );
}
