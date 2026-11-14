#!/usr/bin/env python3
"""
prepare_inputs.py -- turns the repo's data files into the two CSVs that mission_logic.py reads.

Reads (in --data-dir, default docs/data):
  sites.json                    -> sites.csv    (site,lat,lon)
  horizon_<site>.json (one per site, listed in sites.json) -> horizon.csv (site,azimuth,horizon_elev)

Run:
  python prepare_inputs.py --data-dir docs/data --sites-out sites.csv --horizon-out horizon.csv

Assumption to confirm with the terrain teammate: elevation_deg[i] is the horizon elevation at
azimuth i * az_step_deg, azimuth 0 = North, increasing clockwise.
"""
import argparse, csv, json, os, sys


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default="docs/data")
    ap.add_argument("--sites-out", default="sites.csv")
    ap.add_argument("--horizon-out", default="horizon.csv")
    a = ap.parse_args()

    sj = os.path.join(a.data_dir, "sites.json")
    if not os.path.exists(sj):
        sys.exit(f"[ERROR] {sj} not found. Check --data-dir.")
    sites = json.load(open(sj))["sites"]

    mock = False
    problems = 0
    with open(a.sites_out, "w", newline="") as fs, open(a.horizon_out, "w", newline="") as fh:
        ws, wh = csv.writer(fs), csv.writer(fh)
        ws.writerow(["site", "lat", "lon"])
        wh.writerow(["site", "azimuth", "horizon_elev"])
        for s in sites:
            sid = s["id"]
            ws.writerow([sid, s["lat"], s["lon"]])
            hp = os.path.join(a.data_dir, s.get("horizon") or "")
            if not s.get("horizon") or not os.path.exists(hp):
                print(f"[ERROR] {sid}: horizon file missing ({hp})")
                problems += 1
                continue
            h = json.load(open(hp))
            src = str(h.get("source", ""))
            if "mock" in src.lower():
                mock = True
            m = h.get("horizon_mask", {})
            el, step = m.get("elevation_deg"), m.get("az_step_deg", 1)
            if not el:
                print(f"[ERROR] {sid}: no horizon_mask.elevation_deg")
                problems += 1
                continue
            expect = int(round(360 / step))
            if len(el) != expect:
                print(f"[WARN] {sid}: {len(el)} values, expected {expect} for step {step}")
            if any(v is None for v in el):
                print(f"[ERROR] {sid}: horizon has null values")
                problems += 1
                continue
            for i, v in enumerate(el):
                wh.writerow([sid, round(i * step, 3), v])
            print(f"{sid}: {len(el)} azimuths, horizon {min(el):.2f}..{max(el):.2f} deg | source: {src}")
    print(f"Wrote {a.sites_out} and {a.horizon_out}")
    if mock:
        print("[WARNING] at least one horizon file says MOCK. Run mission_logic.py with --mock.")
    if problems:
        sys.exit(f"{problems} problem(s) above, fix them first.")


if __name__ == "__main__":
    main()
