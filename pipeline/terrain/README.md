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

- Site IDs and names are fixed (see CLAUDE.md). Only coordinates (currently
  placeholders) and `elevation_m` are finalised by this role.
- Azimuth in degrees clockwise from local north; elevation in degrees above the
  flat horizon; heights in m, distances in km.
- Input: LRO LOLA polar DEMs via NASA PGDA (Barker et al. 2023). Keep rasters in
  `pipeline/terrain/raw/` (git-ignored; the DEM is 181 MB and GitHub rejects
  files over 100 MB). Never commit `*.tif` / `*.img`.

The current files are MOCK, written by `pipeline/tools/make_mock_data.py`.
Run `python pipeline/tools/validate_data.py` after writing real ones.
Cite every dataset and library you use in RESOURCES.md.
