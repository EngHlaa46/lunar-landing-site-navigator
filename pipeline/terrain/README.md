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
```

| Step | Command | Writes |
|---|---|---|
| 1. Inspect the DEM | `python pipeline/terrain/inspect_dem.py` | `figures/dem_quicklook.png` |
| 2. Final site coordinates | `python pipeline/terrain/pick_sites.py --write` | `lat`, `lon`, `elevation_m` in `sites.json` |
| 3–4. Horizons | `python pipeline/terrain/horizon.py --all` | `horizon_<id>.json`, `figures/horizon_<id>.png` |
| Check | `python pipeline/tools/validate_data.py` | nothing |

Status: `sites.json` coordinates and all four `horizon_<id>.json` files are
real (from the LOLA DEM). `horizon_grid.json` and the `basemap` are not done
yet (`horizon_grid.json` is still MOCK). `pipeline/tools/make_mock_data.py`
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
- Slopes and heights are at DEM scale (80 m pixels); lander-scale slopes may
  be steeper.
- The DEM's height reference surface is not stated in the file or on the
  PGDA page; horizons only use height differences, so they are unaffected.

Cite every dataset and library you use in RESOURCES.md.
