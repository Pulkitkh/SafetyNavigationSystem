import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/Nav";
import { FACTOR_LABELS, FACTORS } from "@/lib/safety/factors";
import { WEIGHTS } from "@/lib/safety/score";

export const metadata: Metadata = { title: "How it works" };

const FACTOR_TEXT: Record<(typeof FACTORS)[number], string> = {
  lighting: "Street lighting mapped in OpenStreetMap (lit=* on roads and street-lamp points). Unmapped roads use a conservative estimate by road type.",
  activity: "Shops, eateries, pharmacies and fuel stations within 60 m, counted only if they are likely open when you pass, using their published opening hours.",
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
    <main className="mx-auto max-w-2xl pb-nav">
      <PageHeader title="How SafeNav works" subtitle="Open data, transparent rules, no black box." />
      <div className="space-y-6 px-4 text-sm leading-relaxed text-slate-700">
        <section>
          <h2 className="mb-1 text-base font-semibold text-slate-900">Route safety score</h2>
          <p>
            Every walking route is split into 100 m stretches. Each stretch is rated on seven factors drawn from Safetipin&apos;s women&apos;s safety audit
            parameters, which Indian cities use, and from Crime Prevention Through Environmental Design. The route&apos;s score combines the average with
            its weakest 10%, because one dark, empty stretch matters more than an average suggests.
          </p>
        </section>

        <section>
          <ul className="space-y-3">
            {FACTORS.map((f) => (
              <li key={f}>
                <h3 className="font-semibold text-slate-900">{FACTOR_LABELS[f]}</h3>
                <p>{FACTOR_TEXT[f]}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-slate-900">Weights change with daylight</h2>
          <p className="mb-2">Sunrise, sunset and twilight are calculated for your exact location and time.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-1 pr-2">Factor</th>
                  {PERIODS.map(([, label]) => (
                    <th key={label} className="px-1 py-1">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FACTORS.map((f) => (
                  <tr key={f} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{FACTOR_LABELS[f]}</td>
                    {PERIODS.map(([p]) => (
                      <td key={p} className="px-1 py-1 tabular-nums">
                        {Math.round(WEIGHTS[p][f] * 100)}%
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold text-slate-900">Limits you should know</h2>
          <ul className="list-inside list-disc space-y-1">
            <li>OpenStreetMap coverage varies by city. Each route shows a data-confidence level, and missing data is never treated as safe.</li>
            <li>India has no public street-level crime data, so SafeNav relies on mapped surroundings and community reports, not police records.</li>
            <li>A score is guidance, not a guarantee. Trust your instincts and call 112 in an emergency.</li>
            <li>Browsers pause location when the screen locks. Keep SafeNav open during a monitored journey.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold text-slate-900">Data sources</h2>
          <p>
            Map data © OpenStreetMap contributors (ODbL). Routing by OSRM and Valhalla, search by Photon and Nominatim, map tiles by OpenFreeMap, weather by Open-Meteo.
          </p>
        </section>

        <Link href="/" className="inline-block rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white">
          Plan a route
        </Link>
      </div>
    </main>
  );
}
