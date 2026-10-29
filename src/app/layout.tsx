import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { GuardianWatch } from "@/components/GuardianWatch";
import { LiveShare } from "@/components/LiveShare";
import { BottomNav, JourneyPill } from "@/components/Nav";
import { NativeBridge } from "@/components/NativeBridge";
import { ServiceWorkerRegistration } from "@/components/ServiceWorker";
import { SafetyTimerWatch } from "@/components/SafetyTimer";
import { SosProvider } from "@/components/Sos";
import { SessionProvider } from "@/lib/client/hooks";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-jakarta", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SafeNav: safer routes and instant SOS", template: "%s · SafeNav" },
  description: "Plan the safest walking route, share your journey live, monitor cab and auto rides, and alert trusted contacts instantly with SOS.",
  manifest: "/manifest.webmanifest",
  applicationName: "SafeNav",
  appleWebApp: { capable: true, title: "SafeNav", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0b14" },
  ],
};

// Applies the saved theme before first paint, so dark mode never flashes white at night.
const THEME_SCRIPT = `try{var t=localStorage.getItem("safenav.theme");t=t?JSON.parse(t):"system";var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans text-[15px] antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold">
          Skip to content
        </a>
        <SessionProvider>
          <SosProvider>
            {children}
            <JourneyPill />
            <SafetyTimerWatch />
            <BottomNav />
            <NativeBridge />
            <LiveShare />
            <GuardianWatch />
          </SosProvider>
        </SessionProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
