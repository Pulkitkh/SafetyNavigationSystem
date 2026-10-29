/** Runs once when the server starts: the watchdog alerts contacts when a phone goes quiet. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.SAFENAV_WATCHDOG === "off") return;
  const { startWatchdog } = await import("@/lib/server/watchdog");
  startWatchdog();
}
