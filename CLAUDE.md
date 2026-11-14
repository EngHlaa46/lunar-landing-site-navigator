# Team context: NASA Space Apps 2026, "Lunar Landing Site Navigator"

You are helping one member of a 6-person student team. Hackathon: Sat Nov 14 09:00 to Sun Nov 15 23:59 (Riyadh time, UTC+3). We submit by Sun 21:30.

## What we're building
A static web app (GitHub Pages, no server) that shows when the Sun and Earth are above the real terrain horizon at lunar south pole landing sites, so mission planners, educators and the public can compare sites and dates for solar power and direct-to-Earth communication.

## Non-negotiable rules
1. CITE EVERY RESOURCE. Space Apps terms let NASA remove awards from teams that don't cite resources, open source included. Whenever you use or suggest a dataset, library, tool, paper, font, image or code snippet, tell me to add it to RESOURCES.md (name, link, what we used it for).
2. Use the exact site IDs and names in the table below, character for character. Never rename, translate, abbreviate or invent sites. "de Gerlache" has a lowercase d.
3. Never invent data or numbers. Fake data must be labelled MOCK in its `source` field and in the UI.
4. Don't change file formats (the data contract). If a change seems needed, stop and tell me to ask the team lead.
5. Conventions: times in UTC (ISO 8601, ending in Z); latitude negative = south; longitude east-positive, -180 to 180; azimuth in degrees clockwise from LOCAL north (0 = N, 90 = E); elevation in degrees above the flat horizon; distances in km, heights in m.
6. No NASA logos or insignia. AI use is disclosed in the footer and on the project page.

## Sites (fixed IDs and names)
| id | name | lat | lon | group |
|---|---|---|---|---|
| shackleton_rim | Shackleton rim | -89.79 | -140.00 | Team pick |
| de_gerlache_rim | de Gerlache rim | -88.70 | -68.00 | Team pick |
| malapert_massif | Malapert massif | -86.00 | 2.90 | Team pick |
| haworth_rim | Haworth rim | -86.38 | -2.10 | Team pick |

The lat/lon in this table are OLD placeholders: never use them as final coordinates. Final coordinates live only in docs/data/sites.json. IDs and names never change. More sites (group "CLPS target" or "Other mission", e.g. IM-1, IM-2) are added only by the lead after checking official sources. New IDs are the lowercase snake_case of the name. Map crater labels (USGS Gazetteer): Shackleton, de Gerlache, Haworth.

## Data contract (all files in docs/data/)
- sites.json: {"region", "basemap": {"image", "psr_image", "extent_m": [xmin, xmax, ymin, ymax], "credit"}, "sites": [{"id", "name", "lat", "lon", "elevation_m", "group", "horizon": "horizon_<id>.json"}]}
- ephemeris.json: {"source", "start_utc", "step_minutes", "sun_sublat": [], "sun_sublon": [], "earth_sublat": [], "earth_sublon": [], "earth_dist_km": []} from JPL Horizons (target 301, observer 500@399, quantities 14, 15, 20; MOON_ME frame, east longitude positive)
- horizon_<id>.json: {"site_id", "horizon_mask": {"az_step_deg": 1, "elevation_deg": [360 values, index = azimuth]}}
- horizon_grid.json: {"spacing_km", "points": [{"lat", "lon", "horizon_el_deg": [360 values]}]}
- Map images: south polar stereographic metres, R = 1737.4 km, longitude 0 toward +y.

## How the app computes
The page computes Sun/Earth elevation and azimuth itself: altaz(site_lat, sublat, site_lon - sublon), plus an Earth parallax fix using earth_dist_km. Visible = body centre above the terrain horizon at that azimuth. Sun disk % = share of the Sun's disk (radius 0.2665 deg) above the horizon.

## Resources we already use (keep in RESOURCES.md)
JPL Horizons System; LRO LOLA polar DEMs via NASA PGDA (Barker et al. 2023, PSJ 4, 183); USGS Gazetteer of Planetary Nomenclature; Google Fonts Barlow and Barlow Condensed (SIL OFL); Python libraries numpy, scipy, rasterio, pyproj; AI assistance (Claude). Challenge resources: Quickmap, Moon Trek, JPL Horizons.

## How to help me
Keep changes small and testable. Show the commands to run. Flag anything that touches another role's files.
