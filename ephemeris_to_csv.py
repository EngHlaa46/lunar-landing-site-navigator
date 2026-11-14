#!/usr/bin/env python3
"""
ephemeris_to_csv.py -- adapter between the repo's ephemeris.json and mission_logic.py

ephemeris.json (Sara's contract) gives, for each hour, the point on the Moon where the
Sun / Earth is straight overhead (sub-solar / sub-Earth lat+lon) and the Earth distance.
This script turns that into what mission_logic.py reads, for each site:
  site,time_utc,sun_elev,sun_azim,earth_elev,earth_azim

Run:
  python ephemeris_to_csv.py --ephemeris docs/data/ephemeris.json --sites sites.csv \
         --start 2027-03-01 --days 30 --out ephemeris.csv

sites.csv columns: site,lat,lon   (lon east-positive, -180..180 or 0..360)
Math: standard spherical trigonometry. Earth parallax is included (Earth distance matters,
the Sun is treated as infinitely far). Azimuth: 0 = North, clockwise.
"""
import argparse, csv, json, math, sys
from datetime import datetime, timedelta, timezone

R_MOON = 1737.4  # km


def look(lat, lon, slat, slon, dist_km=None):
    """Elevation/azimuth (deg) of the body whose sub-point is (slat, slon), seen from (lat, lon)."""
    p, l = math.radians(lat), math.radians(lon)
    ps, ls = math.radians(slat), math.radians(slon)
    dl = ls - l
    cosg = math.sin(p) * math.sin(ps) + math.cos(p) * math.cos(ps) * math.cos(dl)
    cosg = max(-1.0, min(1.0, cosg))
    if dist_km is None:
        elev = math.degrees(math.asin(cosg))
    else:
        d = math.sqrt(dist_km ** 2 + R_MOON ** 2 - 2 * dist_km * R_MOON * cosg)
        elev = math.degrees(math.asin(max(-1.0, min(1.0, (dist_km * cosg - R_MOON) / d))))
    az = math.degrees(math.atan2(math.sin(dl) * math.cos(ps),
                                 math.cos(p) * math.sin(ps) - math.sin(p) * math.cos(ps) * math.cos(dl)))
    return elev, az % 360.0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ephemeris", required=True)
    ap.add_argument("--sites", default="sites.csv")
    ap.add_argument("--start", help="first day to output, YYYY-MM-DD (default: start of data)")
    ap.add_argument("--days", type=float, help="how many days to output (default: all)")
    ap.add_argument("--out", default="ephemeris.csv")
    a = ap.parse_args()

    e = json.load(open(a.ephemeris))
    need = ["start_utc", "step_minutes", "sun_sublat", "sun_sublon", "earth_sublat", "earth_sublon", "earth_dist_km"]
    miss = [k for k in need if k not in e]
    if miss:
        sys.exit(f"[ERROR] ephemeris.json is missing: {miss}. Found keys: {list(e)}")
    n = len(e["sun_sublat"])
    for k in need[2:]:
        if len(e[k]) != n:
            sys.exit(f"[ERROR] {k} has {len(e[k])} values, expected {n}")
    t0 = datetime.fromisoformat(e["start_utc"].replace("Z", "+00:00"))
    step = timedelta(minutes=e["step_minutes"])

    lo, hi = 0, n
    if a.start:
        s = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
        lo = max(0, math.ceil((s - t0) / step))
    if a.days:
        hi = min(n, lo + int(a.days * 1440 / e["step_minutes"]) + 1)
    if lo >= hi:
        sys.exit("[ERROR] the chosen date range is outside the data")

    sites = [(r["site"].strip(), float(r["lat"]), float(r["lon"])) for r in csv.DictReader(open(a.sites))]
    with open(a.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["site", "time_utc", "sun_elev", "sun_azim", "earth_elev", "earth_azim"])
        for name, lat, lon in sites:
            for i in range(lo, hi):
                t = (t0 + i * step).strftime("%Y-%m-%dT%H:%M:%SZ")
                se, sa = look(lat, lon, e["sun_sublat"][i], e["sun_sublon"][i])
                ee, ea = look(lat, lon, e["earth_sublat"][i], e["earth_sublon"][i], e["earth_dist_km"][i])
                w.writerow([name, t, round(se, 4), round(sa, 3), round(ee, 4), round(ea, 3)])
    print(f"Wrote {(hi - lo) * len(sites)} rows ({len(sites)} sites x {hi - lo} samples) to {a.out}")


if __name__ == "__main__":
    main()
