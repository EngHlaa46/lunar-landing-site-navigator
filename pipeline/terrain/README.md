# pipeline/terrain (Terrain role)

Owner: _TBD_. The owner writes the pipeline code here during the hackathon.

## Produces

All in `docs/data/`:

| File | Content |
|---|---|
| `sites.json` | Region, basemap and the site list (final coordinates and `elevation_m`) |
| `horizon_<id>.json` | Terrain horizon for each site |
| `horizon_grid.json` | Horizons on a grid of points |
| Map images referenced by `sites.json` `basemap` | Basemap and PSR image |

## Formats (data contract, do not change)

- `sites.json`: `{"region", "basemap": {"image", "psr_image", "extent_m": [xmin, xmax, ymin, ymax], "credit"}, "sites": [{"id", "name", "lat", "lon", "elevation_m", "group", "horizon": "horizon_<id>.json"}]}`
- `horizon_<id>.json`: `{"site_id", "horizon_mask": {"az_step_deg": 1, "elevation_deg": [360 values, index = azimuth]}}`
- `horizon_grid.json`: `{"spacing_km", "points": [{"lat", "lon", "horizon_el_deg": [360 values]}]}`
- Map images: south polar stereographic metres, R = 1737.4 km, longitude 0 toward +y.

## Rules

- Site IDs and names are fixed (see CLAUDE.md). Only coordinates and
  `elevation_m` are finalised by this role.
- Azimuth in degrees clockwise from local north; elevation in degrees above the
  flat horizon; heights in m, distances in km.
- Input: LRO LOLA polar DEMs via NASA PGDA (Barker et al. 2023). Keep rasters in
  `pipeline/terrain/raw/` (git-ignored; the DEM is 181 MB and GitHub rejects
  files over 100 MB). Never commit `*.tif` / `*.img`.

## Pipeline (run from the repo root)

Download the DEM once (product page: https://pgda.gsfc.nasa.gov/products/90):

```bash
mkdir -p pipeline/terrain/raw
curl -L -o pipeline/terrain/raw/LDEM_80S_80MPP_ADJ.TIF https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF
curl -L -o pipeline/terrain/raw/LPSR_80S_20MPP_ADJ.TIF https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LPSR_80S_20MPP_ADJ.TIF
```

| Step | Command | Writes |
|---|---|---|
| 1. Inspect the DEM | `python pipeline/terrain/inspect_dem.py` | `figures/dem_quicklook.png` |
| 2. Final site coordinates | `python pipeline/terrain/pick_sites.py --write` | `lat`, `lon`, `elevation_m` in `sites.json` |
| 3–4. Horizons | `python pipeline/terrain/horizon.py --all` | `horizon_<id>.json`, `figures/horizon_<id>.png` |
| Basemap | `python pipeline/terrain/make_basemap.py` | `hillshade.png`, `psr.png`, `basemap` in `sites.json`, `figures/basemap_check.png` |
| Horizon grid | `python pipeline/terrain/make_horizon_grid.py` | `horizon_grid.json` (709 points, 10 km, about 2 min on 4 cores) |
| Check | `python pipeline/tools/validate_data.py` | nothing |

Status: all Terrain outputs are real (from the LOLA DEM and PSR map):
`sites.json` coordinates and basemap, the four `horizon_<id>.json` files,
`hillshade.png`, `psr.png` and `horizon_grid.json`. `pipeline/tools/make_mock_data.py`
is safe to run: it only overwrites files whose `source` contains MOCK and
never an existing `sites.json`. Never use its `--force` flag unless you
really mean to replace the real files with MOCK data.

## Known limitations

- **de_gerlache_rim: horizon may be underestimated beyond the 80°S DEM edge**
  at azimuths 319–336, 338–344 and 346–349 (29 directions). Terrain beyond the
  DEM edge (265.6–281.5 km away in those directions) would only need to be
  4.14 km above the observer (LDEM height 5.96 km; minimum at azimuth 326) to
  raise the horizon there. The other three sites need more than 6 km
  everywhere (shackleton_rim 13.35 km, malapert_massif 6.63 km,
  haworth_rim 22.20 km), so their edge effect is negligible.
- **haworth_rim was re-picked on the rim** using Haworth's corrected IAU centre
  (lat -87.45, lon -5.17, D 51.4 km). The first pick was 32.1 km from that
  centre, about 4.3 km outside the rim. The new search starts at the top of the
  inner wall (27.8 km from the centre) and takes the nearest flat pixel,
  because the highest flat pixel moved at every search radius. See
  `START_POINTS` and `PICK_RULE_OVERRIDES` in `pick_sites.py`.
- **horizon_grid.json: 63 of the 709 grid points may be underestimated beyond
  the 80°S DEM edge.** For them, terrain beyond the edge would need less than
  6 km above the observer to raise the horizon in some direction. Most are
  100–150 km from the pole on high ground looking down; only 4 are within
  100 km. All four named sites are within 122 km of the pole and use their own
  horizon files, not the grid.
- **The 10 km grid is coarse near crater rims.** The grid point nearest each
  site is 4.7–5.5 km away and its horizon differs from the site's own by up to
  31.8° (Shackleton), 21.3° (de Gerlache), 18.4° (Malapert) and 9.8° (Haworth).
  Custom locations in the app use the nearest grid point, so results near
  rims are rough.
- `horizon.py` uses the meridian of longitude 0 as local north at the exact
  pole (the only grid point where north is undefined), as the app does.
- Slopes and heights are at DEM scale (80 m pixels); lander-scale slopes may
  be steeper.
- The DEM's height reference surface is not stated in the file or on the
  PGDA page; horizons only use height differences, so they are unaffected.

Cite every dataset and library you use in RESOURCES.md.
