"use strict";
/* Mission Logic: ephemeris + terrain horizon model and per-site statistics.
   Loaded before app.js; app.js owns the UI state object S used by applyMargins() and stats(). */
/* ---------- ephemeris + horizon model ----------
   One function, computeSite(), turns an ephemeris (Sun and Earth sub-points on the Moon) plus a terrain
   horizon into per-time-step positions. Named sites, the built-in demo and custom coordinates all use it. */
const SUN_R = 0.2665, MOON_R_KM = 1737.4;
const rad = d => d*Math.PI/180, deg = r => r*180/Math.PI, r2 = x => Math.round(x*100)/100;
function altaz(lat, dec, ha){  // topocentric elevation/azimuth for a body at sub-point latitude dec, hour angle ha (rad)
  const la = rad(lat), de = rad(dec);
  const el = Math.asin(Math.max(-1, Math.min(1, Math.sin(la)*Math.sin(de) + Math.cos(la)*Math.cos(de)*Math.cos(ha))));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha)*Math.sin(la) - Math.tan(de)*Math.cos(la));
  return [deg(el), (deg(az)+180)%360];
}
// percent of the solar disk above a locally straight skyline (clearance in degrees)
function diskPct(c, r = SUN_R){
  if (c >= r) return 100; if (c <= -r) return 0;
  const a = Math.abs(c), f = (r*r*Math.acos(a/r) - a*Math.sqrt(r*r - a*a))/(Math.PI*r*r);
  return 100*(c >= 0 ? 1 - f : f);
}
// horizon = {az_step_deg, elevation_deg[]} starting at azimuth 0; linear interpolation, negative values allowed
function horizonLookup(h, az){
  const n = h.elevation_deg.length, p = ((az % 360) + 360) % 360/h.az_step_deg, i0 = Math.floor(p) % n, f = p - Math.floor(p);
  return h.elevation_deg[i0]*(1 - f) + h.elevation_deg[(i0 + 1) % n]*f;
}
function computeSite(def, horizon, eph){
  const pre = eph.sites && eph.sites[def.site_id];   // optional per-site topocentric values from the Ephemeris role
  const samples = new Array(eph.n);
  for (let i = 0; i < eph.n; i++){
    let se, sa, ee, ea;
    if (pre){ se = pre.sun_el[i]; sa = pre.sun_az[i]; ee = pre.earth_el[i]; ea = pre.earth_az[i]; }
    else {
      [se, sa] = altaz(def.lat, eph.sun_sublat[i], rad(def.lon - eph.sun_sublon[i]));
      [ee, ea] = altaz(def.lat, eph.earth_sublat[i], rad(def.lon - eph.earth_sublon[i]));
      if (eph.earth_dist_km) ee -= deg(Math.asin(MOON_R_KM/eph.earth_dist_km[i]*Math.cos(rad(ee))));  // topocentric parallax
    }
    samples[i] = {time_utc:eph.times[i], sun_el:r2(se), sun_az:r2(sa), earth_el:r2(ee), earth_az:r2(ea),
      horizon_sun_el:r2(horizonLookup(horizon, sa)), horizon_earth_el:r2(horizonLookup(horizon, ea))};
  }
  return {site_id:def.site_id, name:def.name, lat:def.lat, lon:def.lon, elevation_m:def.elevation_m ?? null,
    group:def.group || "Team pick", terrain:def.terrain || "site", terrain_note:def.terrain_note || "",
    data_source:eph.source + "; terrain: " + (horizon.source || "team horizon"), horizon_mask:horizon, samples};
}
// normalise an ephemeris file: arrays or records, explicit times or start + step
function normalizeEphemeris(e){
  if (Array.isArray(e.records)){ const R = e.records; e.time_utc = R.map(r => r.time_utc);
    ["sun_sublat","sun_sublon","earth_sublat","earth_sublon","earth_dist_km"].forEach(k => { if (R[0][k] !== undefined) e[k] = R.map(r => r[k]); }); }
  const n = (e.time_utc || e.sun_sublat || Object.values(e.sites || {})[0].sun_el).length;
  const times = e.time_utc || Array.from({length:n}, (_, i) => new Date(Date.parse(e.start_utc) + i*e.step_minutes*60e3).toISOString().replace(".000Z","Z"));
  return Object.assign(e, {n, times, source:e.source || "ephemeris.json"});
}
function normalizeHorizon(h, source){
  // data contract: horizon_<id>.json is {site_id, source, horizon_mask:{az_step_deg, elevation_deg}}
  if (h && h.horizon_mask) h = {...h.horizon_mask, source: h.source};
  if (Array.isArray(h)) h = {elevation_deg:h};
  let el = h.elevation_deg || h.horizon_el_deg;
  if (!el && h.az_deg && h.el_deg){ el = []; for (let a = 0; a < 360; a++){ // resample az/el pairs to 1°
    let k = h.az_deg.findIndex(v => v >= a); if (k < 0) k = 0; el.push(h.el_deg[k]); } }
  return {az_step_deg:h.az_step_deg || 360/el.length, elevation_deg:el, source:h.source || source};
}

/* ---------- statistics ---------- */
function longestRun(arr, a, b, key){ let best = 0, cur = 0; for (let k = a; k < b; k++){ if (arr[k][key]){ cur++; if (cur > best) best = cur; } else cur = 0; } return best; }
function applyMargins(){
  // the UI derives visibility from elevations so every site is judged the same way
  S.sites.forEach(st => st.samples.forEach(x => {
    x._sd = diskPct(x.sun_el - x.horizon_sun_el - S.mSun);
    x._sv = x._sd > 0; x._ev = x.earth_el - x.horizon_earth_el - S.mEarth > 0; x._bo = x._sv && x._ev;
  }));
}
const winLen = () => Math.round(S.days*24/S.stepH);
function stats(s, a0){
  const a = a0 === undefined ? windowStart(s.samples.length) : a0, b = Math.min(s.samples.length, a + winLen()), n = Math.max(1, b - a); let sun = 0, dte = 0, both = 0, disk = 0;
  for (let k = a; k < b; k++){ const x = s.samples[k]; disk += x._sd; if (x._sv) sun++; if (x._ev) dte++; if (x._sv && x._ev) both++; }
  return { sun:100*sun/n, dte:100*dte/n, both:100*both/n, disk:disk/n,
    runSun:longestRun(s.samples, a, b, "_sv")*S.stepH, runDte:longestRun(s.samples, a, b, "_ev")*S.stepH,
    runBoth:longestRun(s.samples, a, b, "_bo")*S.stepH, a, b,
    now:s.samples[Math.min(S.i, s.samples.length-1)] };
}
