#!/usr/bin/env python3
"""
mission_logic.py  --  Role 3 (Mission Logic)

Reads:
  - Ephemeris CSV (Sara):  site,time_utc,sun_elev,sun_azim,earth_elev,earth_azim
  - Horizon CSV   (Hala):  site,azimuth,horizon_elev
For every site and time it decides:
  power = the Sun's disc is (at least partly) above the terrain horizon
  comms = the Earth's disc is (at least partly) above the terrain horizon
  both  = power AND comms
It also gives: visible disc %, hours until sunset / Earthset, windows,
longest runs, and a ranking of the sites.

Run:
  python mission_logic.py --ephemeris ephemeris.csv --horizon horizon.csv --out mission_output.json

Options:
  --mock                 mark the output as MOCK data (also automatic if a file name
                         contains sample / mini / demo / mock)
  --allow-missing-mask   if a site has no horizon data yet, use a flat 0 deg horizon
  --min-disk F           fraction of the disc (0 to 1) that must be visible.
                         Default 0 = any part of the disc counts.
  --sun-radius DEG       Sun angular radius (default 0.2666)
  --earth-radius DEG     Earth angular radius (default 0.95)

Conventions: UTC times, angles in degrees, azimuth 0 = North, clockwise.
"""
import argparse
import csv
import json
import math
import statistics
import sys
from bisect import bisect_right
from collections import defaultdict
from datetime import datetime, timezone

RANKING_NOTE = "App-derived screening aid, not official mission analysis"


# ---------------------------------------------------------------- helpers
def parse_time(s):
    s = s.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def to_float(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


class HorizonMask:
    """Horizon elevation vs azimuth (circular linear interpolation, negatives allowed)."""

    def __init__(self, points):
        pts = sorted((a % 360.0, e) for a, e in points)
        self.az = [p[0] for p in pts]
        self.el = [p[1] for p in pts]

    def at(self, azimuth):
        az = azimuth % 360.0
        i = bisect_right(self.az, az)
        a0, e0 = self.az[i - 1], self.el[i - 1]
        if i < len(self.az):
            a1, e1 = self.az[i], self.el[i]
        else:
            a1, e1 = self.az[0] + 360.0, self.el[0]
        if i == 0:
            a0 -= 360.0
        span = a1 - a0
        if span == 0:
            return e0
        return e0 + (e1 - e0) * (az - a0) / span


class FlatMask:
    def at(self, azimuth):
        return 0.0


def disk_fraction(elev, horizon, radius):
    """Fraction (0..1) of a circular disc that is above the horizon line."""
    if radius <= 0:
        return 1.0 if elev > horizon else 0.0
    t = (elev - horizon) / radius
    if t >= 1:
        return 1.0
    if t <= -1:
        return 0.0
    return (math.acos(-t) + t * math.sqrt(1 - t * t)) / math.pi


def read_horizon(path):
    pts = defaultdict(list)
    with open(path, newline="") as f:
        r = csv.DictReader(f)
        need = {"site", "azimuth", "horizon_elev"}
        if not need.issubset(r.fieldnames or []):
            sys.exit(f"[ERROR] {path}: needs columns {sorted(need)}, found {r.fieldnames}")
        for n, row in enumerate(r, start=2):
            az, el = to_float(row["azimuth"]), to_float(row["horizon_elev"])
            if az is None or el is None:
                print(f"[WARN] {path} line {n}: bad number, skipped")
                continue
            if not (0 <= az < 360):
                print(f"[WARN] {path} line {n}: azimuth {az} outside 0-359, skipped")
                continue
            pts[row["site"].strip()].append((az, el))
    return {s: HorizonMask(p) for s, p in pts.items() if p}


def read_ephemeris(path):
    rows, skipped = [], 0
    with open(path, newline="") as f:
        r = csv.DictReader(f)
        need = {"site", "time_utc", "sun_elev", "sun_azim", "earth_elev", "earth_azim"}
        if not need.issubset(r.fieldnames or []):
            sys.exit(f"[ERROR] {path}: needs columns {sorted(need)}, found {r.fieldnames}")
        for n, row in enumerate(r, start=2):
            try:
                t = parse_time(row["time_utc"])
            except ValueError:
                print(f"[WARN] {path} line {n}: bad time, skipped")
                skipped += 1
                continue
            vals = [to_float(row[k]) for k in ("sun_elev", "sun_azim", "earth_elev", "earth_azim")]
            if any(v is None for v in vals):
                print(f"[WARN] {path} line {n}: empty/bad number, skipped")
                skipped += 1
                continue
            rows.append((row["site"].strip(), t, *vals))
    rows.sort(key=lambda x: (x[0], x[1]))
    return rows, skipped


def hours(a, b):
    return (b - a).total_seconds() / 3600.0


def longest_run_hours(flags, step_h):
    best = cur = 0
    for f in flags:
        cur = cur + 1 if f else 0
        best = max(best, cur)
    return round(best * step_h, 2)


def remaining_hours(flags, times):
    """For each sample that is 'on': hours until it next turns 'off'.
    Returns list of (hours, open_ended). open_ended=True means the data ended first,
    so the real value is at least this long. None for samples that are 'off'."""
    n = len(flags)
    out = [None] * n
    nxt = None
    for i in range(n - 1, -1, -1):
        if not flags[i]:
            nxt = times[i]
        elif nxt is None:
            out[i] = (round(hours(times[i], times[-1]), 2), True)
        else:
            out[i] = (round(hours(times[i], nxt), 2), False)
    return out


def find_windows(flags, times):
    """List of continuous 'on' windows."""
    out, start = [], None
    n = len(flags)
    for i in range(n):
        if flags[i] and start is None:
            start = i
        if start is not None and (not flags[i] or i == n - 1):
            end_i = i
            open_end = bool(flags[i]) and i == n - 1
            out.append({"start": iso(times[start]), "end": iso(times[end_i]),
                        "hours": round(hours(times[start], times[end_i]), 2),
                        "open_end": open_end})
            start = None
    return out


# ------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ephemeris", required=True)
    ap.add_argument("--horizon", required=True)
    ap.add_argument("--out", default="mission_output.json")
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--allow-missing-mask", action="store_true")
    ap.add_argument("--min-disk", type=float, default=0.0)
    ap.add_argument("--sun-radius", type=float, default=0.2666)
    ap.add_argument("--earth-radius", type=float, default=0.95)
    args = ap.parse_args()

    names = (args.ephemeris + " " + args.horizon).lower()
    is_mock = args.mock or any(w in names for w in ("sample", "mini", "demo", "mock"))
    if is_mock:
        print("[NOTE] Output marked as MOCK data (not real).")

    masks = read_horizon(args.horizon)
    eph, skipped = read_ephemeris(args.ephemeris)
    if not eph:
        sys.exit("[ERROR] no valid ephemeris rows")

    for s in sorted({r[0] for r in eph}):
        if s not in masks:
            if args.allow_missing_mask:
                print(f"[WARN] no horizon data for {s}: using flat 0 deg horizon (NOT accurate)")
                masks[s] = FlatMask()
            else:
                sys.exit(f"[ERROR] site '{s}' is in the ephemeris file but not in the horizon file "
                         f"(horizon sites: {sorted(masks)}). Check the names, or use --allow-missing-mask.")

    def visible(frac):
        return frac > 0 if args.min_disk <= 0 else frac >= args.min_disk

    by_site = defaultdict(list)
    for site, t, sel, saz, eel, eaz in eph:
        sh, eh = masks[site].at(saz), masks[site].at(eaz)
        sf = disk_fraction(sel, sh, args.sun_radius)
        ef = disk_fraction(eel, eh, args.earth_radius)
        power, comms = visible(sf), visible(ef)
        by_site[site].append({
            "t": t,
            "rec": {
                "site": site,
                "time_utc": iso(t),
                "sun": {"elev_deg": sel, "azim_deg": saz, "horizon_deg": round(sh, 3),
                        "disk_pct": round(100 * sf, 1)},
                "earth": {"elev_deg": eel, "azim_deg": eaz, "horizon_deg": round(eh, 3),
                          "disk_pct": round(100 * ef, 1)},
                "power": power, "comms": comms, "both": power and comms,
            },
        })

    results, summary = [], {}
    per_day = defaultdict(lambda: defaultdict(list))
    for site in sorted(by_site):
        items = by_site[site]
        times = [x["t"] for x in items]
        recs = [x["rec"] for x in items]
        pw = [r["power"] for r in recs]
        cm = [r["comms"] for r in recs]
        bt = [r["both"] for r in recs]

        sun_left = remaining_hours(pw, times)
        earth_left = remaining_hours(cm, times)
        for r, s_l, e_l in zip(recs, sun_left, earth_left):
            r["sunset_in_hours"] = s_l[0] if s_l else None
            r["sunset_open_ended"] = s_l[1] if s_l else None
            r["earthset_in_hours"] = e_l[0] if e_l else None
            r["earthset_open_ended"] = e_l[1] if e_l else None
            results.append(r)
            per_day[r["time_utc"][:10]][site].append(r)

        n = len(recs)
        diffs = [hours(a, b) for a, b in zip(times, times[1:]) if b > a]
        step_h = statistics.median(diffs) if diffs else 0.0
        pct = lambda fl: round(100.0 * sum(fl) / n, 1)
        summary[site] = {
            "n_samples": n,
            "step_hours": round(step_h, 4),
            "power_pct": pct(pw), "comms_pct": pct(cm), "both_pct": pct(bt),
            "longest_power_hours": longest_run_hours(pw, step_h),
            "longest_comms_hours": longest_run_hours(cm, step_h),
            "longest_both_hours": longest_run_hours(bt, step_h),
            "windows": {"power": find_windows(pw, times),
                        "comms": find_windows(cm, times),
                        "both": find_windows(bt, times)},
        }

    def score(s):
        v = summary[s]
        return (v["both_pct"], v["longest_both_hours"], v["power_pct"] + v["comms_pct"])

    order = sorted(summary, key=score, reverse=True)
    ranking = [{"rank": i + 1, "site": s, "both_pct": summary[s]["both_pct"],
                "power_pct": summary[s]["power_pct"], "comms_pct": summary[s]["comms_pct"],
                "longest_both_hours": summary[s]["longest_both_hours"]}
               for i, s in enumerate(order)]

    best_by_day = []
    for day in sorted(per_day):
        scored = []
        for site, recs in per_day[day].items():
            m = len(recs)
            b = 100.0 * sum(r["both"] for r in recs) / m
            p = 100.0 * sum(r["power"] for r in recs) / m
            c = 100.0 * sum(r["comms"] for r in recs) / m
            scored.append((b, p + c, site, p, c))
        scored.sort(reverse=True)
        b, _, site, p, c = scored[0]
        best_by_day.append({"date": day, "best_site": site, "both_pct": round(b, 1),
                            "power_pct": round(p, 1), "comms_pct": round(c, 1)})

    out = {
        "meta": {
            "data_status": "MOCK" if is_mock else "REAL",
            "generated_utc": iso(datetime.now(timezone.utc)),
            "ranking_note": RANKING_NOTE,
            "assumptions": {
                "visible_rule": "any part of the disc above the horizon" if args.min_disk <= 0
                                else f"at least {args.min_disk:.0%} of the disc above the horizon",
                "sun_radius_deg": args.sun_radius,
                "earth_radius_deg": args.earth_radius,
            },
        },
        "results": results,
        "summary": summary,
        "ranking": ranking,
        "best_site_by_day": best_by_day,
        "best_site_overall": order[0],
    }
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2)

    print(f"Data status: {out['meta']['data_status']}")
    print(f"Rows: {len(results)}  (skipped bad rows: {skipped})")
    print(f"{'rank':4} {'site':10} {'power%':>7} {'comms%':>7} {'both%':>7} {'longest both (h)':>17}")
    for r in ranking:
        print(f"{r['rank']:4} {r['site']:10} {r['power_pct']:7} {r['comms_pct']:7} "
              f"{r['both_pct']:7} {r['longest_both_hours']:17}")
    print(f"({RANKING_NOTE})")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
