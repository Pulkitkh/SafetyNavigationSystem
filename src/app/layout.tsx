import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BottomNav } from "@/components/Nav";
import { ServiceWorkerRegistration } from "@/components/ServiceWorker";
import { SafetyTimerWatch } from "@/components/SafetyTimer";
import { SosButton, SosProvider } from "@/components/Sos";
import { SessionProvider } from "@/lib/client/hooks";

export const metadata: Metadata = {
  title: { default: "SafeNav — Safety Navigation", template: "%s · SafeNav" },
  description: "Plan the safest walking route, share your journey live, monitor cab and auto rides, and send SOS to trusted contacts.",
  manifest: "/manifest.webmanifest",
  applicationName: "SafeNav",
  appleWebApp: { capable: true, title: "SafeNav", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1d4ed8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        <SessionProvider>
          <SosProvider>
            {children}
            <SosButton />
            <SafetyTimerWatch />
            <BottomNav />
          </SosProvider>
        </SessionProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
