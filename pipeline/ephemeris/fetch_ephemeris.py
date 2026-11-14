#!/usr/bin/env python3
"""Ephemeris role: build docs/data/ephemeris.json from JPL Horizons, then sanity-check it.

Data contract (CLAUDE.md, pipeline/ephemeris/README.md -- do not change):
  {"source", "start_utc", "step_minutes",
   "sun_sublat": [], "sun_sublon": [], "earth_sublat": [], "earth_sublon": [], "earth_dist_km": []}
  JPL Horizons, target 301 (Moon), observer 500@399 (geocentre), quantities 14, 15, 20;
  MOON_ME frame, east longitude positive, wrapped to -180..180. Times UTC. Distances km.

Sanity checks run BEFORE anything is written; if any fails the script exits 1 and leaves
docs/data/ephemeris.json untouched:
  - sun_sublat within +-1.6 deg (lunar equator tilt 1.543 deg + physical libration)
  - sun_sublon moves west (decreases) every day, about 12.19 deg/day on average
  - sub-Earth point within about +-8 deg of (0, 0) (optical libration)
  - cross-check: Sun/Earth azimuth and elevation computed from these arrays, for every site in
    docs/data/sites.json, match Horizons quantity 4 with that site as the surface observer.
    Site coordinates are read from sites.json only; never hard-coded here.

Raw Horizons responses go to pipeline/ephemeris/raw/ (git-ignored).

Source: JPL Horizons On-Line Ephemeris System, NASA/JPL Solar System Dynamics Group,
https://ssd.jpl.nasa.gov/horizons/ (in RESOURCES.md). HTTP via requests (in RESOURCES.md).

Usage (from the repo root):
  python pipeline/ephemeris/fetch_ephemeris.py
  python pipeline/tools/validate_data.py
"""
import argparse
import json
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "docs" / "data"
OUT_JSON = DATA_DIR / "ephemeris.json"
SITES_JSON = DATA_DIR / "sites.json"
RAW_DIR = Path(__file__).resolve().parent / "raw"

START_UTC = "2026-12-01T00:00:00Z"
STOP_UTC = "2028-12-31T23:00:00Z"   # inclusive
STEP_MINUTES = 60
CHUNK_DAYS = 92                      # one Horizons request per chunk, well under its output line limit

MOON_RADIUS_KM = 1737.4
AU_KM = 149597870.7
SUN_SUBLAT_LIMIT = 1.6
EARTH_SUBPOINT_LIMIT = 8.5
CROSSCHECK_TOL_DEG = 0.05


def wrap_lon(x):
    return (x + 180.0) % 360.0 - 180.0


def parse_utc(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def hz_time(t):
    return t.strftime("%Y-%m-%d %H:%M")


def horizons(params, raw_name):
    """Run one Horizons observer-table query; return [(utc datetime, [csv fields])]."""
    base = {"format": "text", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'OBSERVER'",
            "CSV_FORMAT": "'YES'", "ANG_FORMAT": "'DEG'", "TIME_DIGITS": "'MINUTES'"}
    base.update(params)
    for attempt in range(1, 4):
        try:
            r = requests.get(API, params=base, timeout=300)
            r.raise_for_status()
            break
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(5 * attempt)
    text = r.text
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / raw_name).write_text(text, encoding="utf-8")
    if "$$SOE" not in text or "$$EOE" not in text:
        raise RuntimeError(f"Horizons returned no ephemeris ({raw_name}):\n{text[:2000]}")
    body = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    rows = []
    for line in body.strip().splitlines():
        f = [x.strip() for x in line.split(",")]
        # "2027-Jan-01 00:00" (TLIST queries add ":00.000"; keep to the minute)
        rows.append((datetime.strptime(f[0][:17], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc), f))
    return rows


# ------------------------------------------------------------------ build
def build(t0, t1):
    arrays = {"sun_sublat": [], "sun_sublon": [], "earth_sublat": [], "earth_sublon": [], "earth_dist_km": []}
    times = []
    step = timedelta(minutes=STEP_MINUTES)
    a = t0
    while a <= t1:
        b = min(a + timedelta(days=CHUNK_DAYS) - step, t1)
        rows = horizons({"COMMAND": "'301'", "CENTER": "'500@399'",
                         "START_TIME": f"'{hz_time(a)}'", "STOP_TIME": f"'{hz_time(b)}'",
                         "STEP_SIZE": f"'{STEP_MINUTES}m'", "QUANTITIES": "'14,15,20'", "RANGE_UNITS": "'KM'"},
                        f"moon_geocentre_{a:%Y%m%d}_{b:%Y%m%d}.txt")
        for t, f in rows:
            # fields: date, solar flag, lunar flag, ObsSub-LON, ObsSub-LAT, SunSub-LON, SunSub-LAT, delta, deldot
            times.append(t)
            arrays["earth_sublon"].append(round(wrap_lon(float(f[3])), 6))
            arrays["earth_sublat"].append(round(float(f[4]), 6))
            arrays["sun_sublon"].append(round(wrap_lon(float(f[5])), 6))
            arrays["sun_sublat"].append(round(float(f[6]), 6))
            arrays["earth_dist_km"].append(round(float(f[7]), 3))
        print(f"  {hz_time(a)} .. {hz_time(b)}: {len(rows)} rows")
        a = b + step

    expected = int((t1 - t0) / step) + 1
    if len(times) != expected or times[0] != t0:
        raise RuntimeError(f"expected {expected} samples from {t0}, got {len(times)} from {times[0]}")
    if any(y - x != step for x, y in zip(times, times[1:])):
        raise RuntimeError("time steps are not uniform")

    return {
        "source": ("JPL Horizons On-Line Ephemeris System (NASA/JPL Solar System Dynamics Group, DE441), "
                   "https://ssd.jpl.nasa.gov/horizons/ ; target 301 (Moon), observer 500@399 (geocentre), "
                   "quantities 14, 15, 20; MOON_ME frame, east longitude positive; "
                   f"retrieved {datetime.now(timezone.utc):%Y-%m-%d}"),
        "start_utc": t0.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "step_minutes": STEP_MINUTES,
        **arrays,
    }


# ------------------------------------------------------------------ checks
def vec(lon, lat, dist):
    lo, la = math.radians(lon), math.radians(lat)
    return (dist * math.cos(la) * math.cos(lo), dist * math.cos(la) * math.sin(lo), dist * math.sin(la))


def altaz(site_lat, site_lon, body_lon, body_lat, body_dist_km):
    """Topocentric azimuth (clockwise from local north) and elevation of a body, sphere R = 1737.4 km."""
    s = vec(site_lon, site_lat, MOON_RADIUS_KM)
    b = vec(body_lon, body_lat, body_dist_km)
    w = [b[i] - s[i] for i in range(3)]
    p, l = math.radians(site_lat), math.radians(site_lon)
    east = (-math.sin(l), math.cos(l), 0.0)
    north = (-math.sin(p) * math.cos(l), -math.sin(p) * math.sin(l), math.cos(p))
    up = (math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p))
    e, n, u = (sum(w[i] * ax[i] for i in range(3)) for ax in (east, north, up))
    return math.degrees(math.atan2(e, n)) % 360.0, math.degrees(math.atan2(u, math.hypot(e, n)))


def check(doc):
    failures = []

    def report(name, ok, detail):
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
        if not ok:
            failures.append(name)

    sl = doc["sun_sublat"]
    report(f"sun_sublat within +-{SUN_SUBLAT_LIMIT} deg", max(map(abs, sl)) <= SUN_SUBLAT_LIMIT,
           f"min {min(sl):.4f}, max {max(sl):.4f}")

    per_day = 24 * 60 // doc["step_minutes"]
    lon = doc["sun_sublon"]
    rates = [wrap_lon(lon[i] - lon[i - per_day]) for i in range(per_day, len(lon), per_day)]
    mean = sum(rates) / len(rates)
    report("sun_sublon decreases ~12.2 deg/day", max(rates) < 0 and abs(mean + 12.19) < 0.1,
           f"mean {mean:.3f}, range {min(rates):.3f} .. {max(rates):.3f} deg/day")

    el, eb = doc["earth_sublon"], doc["earth_sublat"]
    worst = max(max(map(abs, el)), max(map(abs, eb)))
    report(f"sub-Earth point within ~+-8 deg of 0,0", worst <= EARTH_SUBPOINT_LIMIT,
           f"lon {min(el):.3f} .. {max(el):.3f}, lat {min(eb):.3f} .. {max(eb):.3f}")

    # Cross-check against Horizons quantity 4, one sample per site, sites read from sites.json.
    sites = json.loads(SITES_JSON.read_text(encoding="utf-8"))["sites"]
    t0 = parse_utc(doc["start_utc"])
    n = len(sl)
    worst_el = worst_az = 0.0
    for k, site in enumerate(sites):
        i = (k + 1) * n // (len(sites) + 1)  # spread samples over the period
        t = t0 + timedelta(minutes=i * doc["step_minutes"])
        derived = {
            "sun": altaz(site["lat"], site["lon"], doc["sun_sublon"][i], doc["sun_sublat"][i], AU_KM),
            "earth": altaz(site["lat"], site["lon"], doc["earth_sublon"][i], doc["earth_sublat"][i],
                           doc["earth_dist_km"][i]),
        }
        for body, target in (("sun", "10"), ("earth", "399")):
            (_, f), = horizons({"COMMAND": f"'{target}'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
                                "SITE_COORD": f"'{site['lon']},{site['lat']},0'",  # E-lon, lat, alt km
                                "TLIST": f"'{hz_time(t)}'", "TLIST_TYPE": "'CAL'", "QUANTITIES": "'4'"},
                               f"check_{site['id']}_{body}.txt")
            h_az, h_el = float(f[3]), float(f[4])
            d_az, d_el = derived[body]
            dz, de = abs(wrap_lon(d_az - h_az)), abs(d_el - h_el)
            worst_az, worst_el = max(worst_az, dz), max(worst_el, de)
            print(f"    {site['id']:16} {t:%Y-%m-%dT%H:%MZ} {body:5} derived az {d_az:8.3f} el {d_el:7.3f} | "
                  f"Horizons q4 az {h_az:8.3f} el {h_el:7.3f}")
    report("cross-check vs Horizons quantity 4 (sites.json)", worst_el <= CROSSCHECK_TOL_DEG,
           f"worst |d el| {worst_el:.4f} deg, worst |d az| {worst_az:.4f} deg")
    return failures


def main():
    global RAW_DIR
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default=START_UTC, help="first sample, e.g. 2026-12-01T00:00:00Z")
    ap.add_argument("--stop", default=STOP_UTC, help="last sample (inclusive), e.g. 2028-12-31T23:00:00Z")
    ap.add_argument("--raw-dir", default=str(RAW_DIR), help="where to keep raw Horizons responses")
    args = ap.parse_args()
    RAW_DIR = Path(args.raw_dir)

    print("Fetching from JPL Horizons:")
    doc = build(parse_utc(args.start), parse_utc(args.stop))

    # Check first; only write ephemeris.json when every check passes, so a bad run
    # never replaces the last good file.
    print("Sanity checks:")
    failures = check(doc)
    if failures:
        sys.exit(f"{len(failures)} check(s) failed: {failures}. "
                 f"{OUT_JSON.relative_to(REPO_ROOT)} was NOT written.")
    print("All sanity checks passed.")

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_JSON.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(OUT_JSON)  # atomic swap: readers never see a half-written file
    print(f"wrote {OUT_JSON.relative_to(REPO_ROOT)}: {len(doc['sun_sublat'])} samples, "
          f"{OUT_JSON.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
