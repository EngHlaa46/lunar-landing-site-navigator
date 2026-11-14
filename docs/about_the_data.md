About the data and methods

Sun and Earth positions. All Sun and Earth positions come from NASA's JPL Horizons System. We pulled hourly values from 2026-12-01 to 2028-12-31 (18,288 samples) for the Moon (body 301) as seen from Earth's centre. That gives three things: the sub-solar point (where the Sun is overhead), the sub-Earth point (where Earth is overhead) and the Earth–Moon distance.

Why sub-points. These two points and the distance give the directions to the Sun and Earth from anywhere on the Moon. So the app computes Sun and Earth azimuth and elevation for any site, including custom coordinates, without a new Horizons query per site. This keeps the dataset small (about 0.9 MB).

Libration and lunar seasons. The sub-Earth point drifts about ±8° in longitude and ±6.9° in latitude. This is lunar libration, and it's why Earth visibility at a polar site changes from month to month. The sub-solar latitude swings about ±1.6° because the Moon's spin axis is slightly tilted, giving it seasons. Near the pole, that small swing decides whether the Sun clears the surrounding terrain. Horizons includes both effects.

Parallax. Earth is close enough that a lander on the surface sees it about 0.26° lower than it would appear from the Moon's centre. The app corrects Earth's elevation using the stored Earth–Moon distance (about 357,000–407,000 km). For the Sun, the correction is negligible.

Terrain. Terrain horizons come from the LRO LOLA south-polar elevation model (LDEM_80S_80MPP_ADJ, 80 m per pixel, NASA PGDA; Barker et al. 2023).
- For each site, we trace 360 directions out to the edge of the model, from a point 2 m above the ground.
- We correct for the Moon's curvature and keep the highest terrain angle in each direction.
- Sites are flat spots (slope under 5° at 80 m resolution) on the named crater rim or massif.

Validation.
- Ephemeris: for the four sites, we queried Horizons directly for azimuth and elevation (quantity 4) and compared them with our computed values. The largest differences were 0.0004° in elevation and 0.0055° in azimuth. The fetch script also checks that the data stays in physical ranges.
- App math: it matches an independent 3-D vector calculation to within 0.005°.
- Data files: a validator checks every file's format on every push.

Limits. This is a screening tool, not a mission-grade model.
- "Earth visible" means Earth's centre is above the skyline. That's a geometric line of sight, not a link budget. Earth's disc is about 0.95° in radius, so its edge can show when the centre is hidden.
- Times are hourly, so window start and end times are accurate to about one hour.
- Slopes are measured at 80 m resolution and don't guarantee a safe landing spot.
- Terrain beyond the elevation model's edge (about 304 km from the pole) isn't included.
- Custom locations use a coarser terrain grid.
