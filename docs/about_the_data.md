# About the data and methods

## What we take from JPL Horizons, and why

The app needs to know where the Sun and the Earth are in the sky at a landing site, hour by hour. We get this from the JPL Horizons On-Line Ephemeris System (NASA/JPL Solar System Dynamics Group, https://ssd.jpl.nasa.gov/horizons/), which uses the DE441 planetary ephemeris.

We don't ask Horizons for the sky at each site separately. We ask for one table with the Moon as the target and the centre of the Earth as the observer (target 301, observer 500@399). That table gives three quantities:

- **Sub-solar point (quantity 15):** the latitude and longitude on the Moon where the Sun is straight overhead.
- **Sub-Earth point (quantity 14):** the latitude and longitude on the Moon where the Earth is straight overhead.
- **Earth–Moon distance (quantity 20):** in kilometres.

Longitudes are east-positive in the Moon's mean-Earth/polar-axis frame (MOON_ME) and stored from −180° to 180°. Times are UTC. The file `docs/data/ephemeris.json` covers 1 December 2026 00:00 UTC to 31 December 2028 23:00 UTC at one-hour steps, which is 18,288 samples.

We chose sub-points because one small file then works for every location. The page combines a sub-point with any site's latitude and longitude to get that body's elevation and azimuth. This covers our named sites and also custom points that a user clicks on the map. Site coordinates are not in the ephemeris file. They live only in `docs/data/sites.json`.

## How the page turns sub-points into Sun and Earth positions

For each hour and each site, the page (`docs/index.html`, function `altaz`) treats the Moon as a sphere. The sub-point's latitude acts as the body's declination, and the longitude difference (site minus sub-point) acts as its hour angle. Standard spherical astronomy then gives elevation above the flat horizon and azimuth measured clockwise from local north.

The page then compares the elevation with the terrain horizon at that azimuth, using the horizon file for that site.

- **The Sun counts as visible** when any part of its disk (radius 0.2665°) is above the terrain, with an optional user margin. The page also shows what percentage of the disk is visible.
- **The Earth counts as visible** when its centre is above the terrain, with an optional user margin.

## Libration: why the Earth moves in the lunar sky

The Moon always keeps roughly the same face toward the Earth, but not exactly. Its slightly elliptical orbit and tilted axis make it appear to rock (libration). Over our period the sub-Earth point wanders between −7.94° and +8.05° in longitude and between −6.86° and +6.85° in latitude.

From the near-side equator that means the Earth stays high in the sky. At the south pole, where the Earth sits near the horizon, a few degrees of libration decide whether the Earth is above or below a crater rim. So direct-to-Earth communication there comes and goes on a roughly monthly cycle.

The Sun's sub-point latitude stays within ±1.58° over the period (−1.5763° to +1.5589°). That's why the Sun skims the horizon at the poles all lunar year.

## Parallax: why the Earth's distance matters

Sub-points are computed from the Moon's centre, but a site sits on the surface 1,737.4 km from that centre. For the Sun this makes almost no difference (at most 0.00067°). For the Earth, which is only 356,648 to 406,603 km away in our period, the shift is 0.245° to 0.279° at the horizon.

The page corrects for it by lowering the Earth's elevation by asin(R / d × cos(elevation)), where R = 1,737.4 km and d is `earth_dist_km` for that hour. Without this correction, the Earth would appear up to about 0.27° too high, which is enough to shift Earthrise and Earthset times at a polar site.

## How we checked the data

1. **Comparison with Horizons quantity 4.** Horizons can also report the azimuth and elevation of the Sun and Earth directly, as seen by an observer standing on the Moon at a given latitude and longitude (quantity 4). We used that as an independent reference. We ran the page's own formula, ported line for line, on our sub-points for all four sites in `sites.json`, at 12 times spread across the period. The worst differences from Horizons were:
   - **Sun:** 0.0007° in elevation and 0.0002° in azimuth. The elevation difference is the solar parallax the page ignores.
   - **Earth:** 0.0006° in elevation and 0.006° in azimuth.

   Without the parallax correction, the Earth's elevation was off by 0.25° to 0.27° in the same test. The ephemeris script runs a similar comparison every time it builds the file: worst 0.0004° in elevation and 0.0055° in azimuth.

2. **Range checks before saving.** The script only writes `ephemeris.json` if all of these pass. Otherwise it stops and leaves the previous file in place.
   - Sun sub-latitude stays within ±1.6°. Measured: −1.5763° to +1.5589°.
   - Sun sub-longitude moves west every day by about 12.2° per day. Measured mean: −12.190° per day, range −12.254 to −12.123.
   - The sub-Earth point stays within about ±8° of 0°, 0°.
   - Time steps are exactly one hour with no gaps.

3. **Format check in continuous integration (CI).** On every push and pull request, GitHub Actions runs `pipeline/tools/validate_data.py`. It checks that every data file matches the agreed format, that all ephemeris arrays have the same length, and that longitudes are within −180° to 180°. It does not repeat the physics checks above, because those need to contact Horizons.

## Limits

- The page models the Moon as a sphere of radius 1,737.4 km and ignores each site's height when computing Sun and Earth positions. Terrain only enters through the horizon files.
- The Earth's own angular size is not used. The Earth counts as visible when its centre clears the terrain.
- Horizons reports future times in UTC assuming no new leap seconds are added after its latest data, so times could be off by about a second if one is added before 2029.
- Visibility percentages and rankings in the app are screening aids, not official mission analysis.

Source: JPL Horizons On-Line Ephemeris System, NASA/JPL Solar System Dynamics Group, https://ssd.jpl.nasa.gov/horizons/
