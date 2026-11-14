#!/usr/bin/env python3
"""Generate MOCK data files in docs/data/ that follow the data contract.

Everything written here is FAKE. It exists only so the UI can be built and
tested before the real pipeline (Ephemeris and Terrain roles) produces data.
Every file with a "source" field says MOCK. Do not cite these numbers.

Site IDs, names and placeholder coordinates come from the fixed table in
CLAUDE.md. Never rename or add sites here.

Usage (from the repo root):
    python pipeline/tools/make_mock_data.py
"""

import json
import math
import random
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "docs" / "data"

# Fixed table from CLAUDE.md. Coordinates are placeholders until the Terrain
# owner finalises them. IDs and names never change.
SITES = [
    {"id": "shackleton_rim", "name": "Shackleton rim", "lat": -89.79, "lon": -140.00},
    {"id": "de_gerlache_rim", "name": "de Gerlache rim", "lat": -88.70, "lon": -68.00},
    {"id": "malapert_massif", "name": "Malapert massif", "lat": -86.00, "lon": 2.90},
    {"id": "haworth_rim", "name": "Haworth rim", "lat": -86.38, "lon": -2.10},
]

MOON_RADIUS_KM = 1737.4

EPHEMERIS_START = datetime(2026, 12, 1, 0, 0, 0, tzinfo=timezone.utc)
EPHEMERIS_DAYS = 60
EPHEMERIS_STEP_MINUTES = 60


def wrap_lon(lon_deg):
    """Wrap a longitude to the range -180..180 (east positive)."""
    return (lon_deg + 180.0) % 360.0 - 180.0


def write_json(path, obj):
    path.write_text(json.dumps(obj, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(REPO_ROOT)}")


def mock_horizon(seed):
    """360 smooth synthetic horizon elevations (deg), index = azimuth.

    A few low-order sinusoids with seeded random amplitudes and phases.
    Purely synthetic: NOT derived from any DEM.
    """
    rng = random.Random(seed)
    terms = [(k, rng.uniform(0.2, 1.5) / k, rng.uniform(0, 2 * math.pi)) for k in range(1, 7)]
    offset = rng.uniform(0.0, 1.0)
    return [
        round(offset + sum(a * math.sin(k * math.radians(az) + p) for k, a, p in terms), 3)
        for az in range(360)
    ]


def make_sites():
    return {
        "region": "Lunar south pole",
        # No basemap yet: the Terrain owner adds image, psr_image, extent_m
        # and credit once the real map images exist.
        "basemap": None,
        "sites": [
            {
                "id": s["id"],
                "name": s["name"],
                "lat": s["lat"],
                "lon": s["lon"],
                # Unknown until the Terrain owner samples the DEM. Left null
                # rather than inventing a number.
                "elevation_m": None,
                "group": "Team pick",
                "horizon": f"horizon_{s['id']}.json",
            }
            for s in SITES
        ],
    }


def make_ephemeris():
    """60 days, hourly, of smooth synthetic sub-solar / sub-Earth values.

    Shapes are rough sinusoids so the UI has something that moves. They are
    NOT from JPL Horizons and must not be used for any real analysis.
    """
    n = EPHEMERIS_DAYS * 24 * 60 // EPHEMERIS_STEP_MINUTES
    out = {
        "source": "MOCK synthetic ephemeris (smooth sinusoids, NOT from JPL Horizons)",
        "start_utc": EPHEMERIS_START.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "step_minutes": EPHEMERIS_STEP_MINUTES,
        "sun_sublat": [],
        "sun_sublon": [],
        "earth_sublat": [],
        "earth_sublon": [],
        "earth_dist_km": [],
    }
    for i in range(n):
        t = i * EPHEMERIS_STEP_MINUTES / 1440.0  # days since start
        out["sun_sublat"].append(round(1.5 * math.sin(2 * math.pi * t / 30.0), 4))
        out["sun_sublon"].append(round(wrap_lon(100.0 - 360.0 * t / 29.5), 4))
        out["earth_sublat"].append(round(6.5 * math.sin(2 * math.pi * t / 27.2 + 1.0), 4))
        out["earth_sublon"].append(round(7.5 * math.sin(2 * math.pi * t / 27.5), 4))
        out["earth_dist_km"].append(round(384400.0 + 20000.0 * math.cos(2 * math.pi * t / 27.5), 1))
    return out


def make_site_horizon(site_id):
    return {
        "site_id": site_id,
        "source": "MOCK synthetic horizon",
        "horizon_mask": {"az_step_deg": 1, "elevation_deg": mock_horizon(site_id)},
    }


def make_horizon_grid():
    """A 3x3 MOCK grid around the pole, laid out in polar stereographic km.

    x, y in {-10, 0, 10} km, converted to lat/lon (south polar stereographic,
    R = 1737.4 km, longitude 0 toward +y). Horizons are synthetic.
    """
    spacing_km = 10.0
    points = []
    for y in (-1, 0, 1):
        for x in (-1, 0, 1):
            xk, yk = x * spacing_km, y * spacing_km
            rho = math.hypot(xk, yk)
            colat = math.degrees(2 * math.atan(rho / (2 * MOON_RADIUS_KM)))
            lat = round(-90.0 + colat, 4)
            lon = round(math.degrees(math.atan2(xk, yk)), 4) if rho else 0.0
            points.append({
                "lat": lat,
                "lon": lon,
                "horizon_el_deg": mock_horizon(f"grid_{x}_{y}"),
            })
    return {"source": "MOCK synthetic horizon grid", "spacing_km": spacing_km, "points": points}


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_json(DATA_DIR / "sites.json", make_sites())
    write_json(DATA_DIR / "ephemeris.json", make_ephemeris())
    for s in SITES:
        write_json(DATA_DIR / f"horizon_{s['id']}.json", make_site_horizon(s["id"]))
    write_json(DATA_DIR / "horizon_grid.json", make_horizon_grid())
    print("Done. All files above are MOCK data.")


if __name__ == "__main__":
    main()
