import { Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/Nav";
import { FACTOR_LABELS, FACTORS } from "@/lib/safety/factors";
import { WEIGHTS } from "@/lib/safety/score";

export const metadata: Metadata = { title: "How it works" };

const FACTOR_TEXT: Record<(typeof FACTORS)[number], string> = {
  lighting: "Street lighting mapped in OpenStreetMap (lit=* on roads and street-lamp points). Unmapped roads use a conservative estimate by road type.",
  activity: "Shops, eateries, pharmacies and fuel stations within 60 m, counted only if they are likely open when you pass, using their published opening hours.",
  frontage: "Buildings mapped within 25 m of the street. Homes and shops facing the road mean windows, doors and people who can see and help; blank walls and empty plots don't.",
  walkpath: "Whether there is a footpath. Busy roads without a footpath, unpaved tracks and pedestrian underpasses at night score low.",
  isolation: "Passing industrial estates, cemeteries, vacant land, construction sites, railway corridors, woods or parks, which are deserted after dark.",
  help: "Distance to the nearest police station, plus open hospitals, fuel stations and 24-hour pharmacies where you could seek help. Mapped CCTV adds a little.",
  transit: "Bus stops and stations within 250 m, which offer a way out and usually have people around.",
  community: "Recent reports from SafeNav users (harassment, snatching, poor lighting and more). Reports fade over weeks and count more once others confirm them.",
};

const PERIODS = [
  ["day", "Day"],
  ["twilight", "Dusk / dawn"],
  ["night", "Night"],
  ["late_night", "Late night (11 pm–5 am)"],
] as const;

export default function AboutPage() {
  return (
    <main id="main" className="mx-auto max-w-2xl pb-nav">
      <PageHeader title="How SafeNav works" subtitle="Open data, transparent rules, no black box." icon={<Info />} />
      <div className="space-y-6 px-4 text-[15px] leading-relaxed text-ink-2">
        <section className="card p-4">
          <h2 className="mb-1 text-lg font-extrabold text-ink">Route safety score</h2>
          <p>
            Every walking route is split into 100 m stretches. Each stretch is rated on eight factors drawn from Safetipin&apos;s women&apos;s safety audit
            parameters, which Indian cities use, and from Crime Prevention Through Environmental Design. The route&apos;s score combines the average with
            its weakest 10%, because one dark, empty stretch matters more than an average suggests.
          </p>
        </section>

        <section>
          <ul className="card divide-y divide-line overflow-hidden">
            {FACTORS.map((f) => (
              <li key={f} className="p-4">
                <h3 className="font-bold text-ink">{FACTOR_LABELS[f]}</h3>
                <p>{FACTOR_TEXT[f]}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-extrabold text-ink">Weights change with daylight</h2>
          <p className="mb-2">Sunrise, sunset and twilight are calculated for your exact location and time.</p>
          <div className="card overflow-x-auto p-2">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink">
                  <th className="px-2 py-2">Factor</th>
                  {PERIODS.map(([, label]) => (
                    <th key={label} className="px-1 py-2">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FACTORS.map((f) => (
                  <tr key={f} className="border-b border-line last:border-0">
                    <td className="px-2 py-2">{FACTOR_LABELS[f]}</td>
                    {PERIODS.map(([p]) => (
                      <td key={p} className="px-1 py-2 font-semibold tabular-nums text-ink">
                        {Math.round(WEIGHTS[p][f] * 100)}%
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="mb-2 text-lg font-extrabold text-ink">Limits you should know</h2>
          <ul className="list-outside list-disc space-y-1.5 pl-5">
            <li>OpenStreetMap coverage varies by city. Each route shows a data-confidence level, and missing data is never treated as safe.</li>
            <li>India has no public street-level crime data, so SafeNav relies on mapped surroundings and community reports, not police records.</li>
            <li>A score is guidance, not a guarantee. Trust your instincts and call 112 in an emergency.</li>
            <li>Browsers pause location when the screen locks. Keep SafeNav open during a monitored journey, or use the Android app, which keeps tracking.</li>
          </ul>
        </section>

        <section className="card p-4">
          <h2 className="mb-1 text-lg font-extrabold text-ink">Data sources</h2>
          <p>
            Map data © OpenStreetMap contributors (ODbL). Routing by OSRM and Valhalla, search by Photon, Nominatim and Ola Maps, map tiles by OpenFreeMap, weather by Open-Meteo and MET Norway.
          </p>
        </section>

        <Link href="/" className="btn btn-primary">
          Plan a route
        </Link>
      </div>
    </main>
  );
}
