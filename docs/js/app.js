"use strict";
/* UI: state, rendering and interaction. Depends on js/model.js. */
/* ---------- state ---------- */
const S = { periodH:708.73, p0:0, eph:null, grid:null, demo:false, custom:0, frame:0, basemap:null, sites:[], sel:0, i:0, days:7, mSun:0, mEarth:0, mode:"sites", slots:[0,0,0], playing:null, stepH:1, times:[], top:10, bot:-1.5, maskMax:3 };
const $ = id => document.getElementById(id);
const fmtT = ms => new Date(ms).toISOString().slice(0,16).replace("T"," ") + " UTC";
const sgn = x => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(1) + "°";
const short = n => n.replace(/\s*\(demo\)$/g, "");
const isMock = src => /mock/i.test(src || "");  // one MOCK test for the data chip, ephemeris notes and custom locations
function rng(seed){ return () => (seed = (seed*16807) % 2147483647) / 2147483647; }

async function getJSON(f){ const r = await fetch("data/" + f, {cache:"no-store"}); if (!r.ok) throw new Error(f + " " + r.status); return r.json(); }
// sites.json may be: a list of file names (precomputed per-site files), {sites:[file names]},
// a plain list of site objects, or {region, basemap, ephemeris, horizon_grid, sites:[site objects]}
async function loadData(){
  let idx;
  idx = await getJSON("sites.json");
  const meta = Array.isArray(idx) ? {} : idx, list = Array.isArray(idx) ? idx : idx.sites;
  if (typeof list[0] === "string"){
    const sites = await Promise.all(list.map(getJSON));
    return {sites:sites.map(normalizeSite), from:"files", region:meta.region, basemap:meta.basemap, eph:null};
  }
  const eph = normalizeEphemeris(await getJSON(meta.ephemeris || "ephemeris.json"));
  let grid = null; try{ grid = await getJSON(meta.horizon_grid || "horizon_grid.json"); }catch(e){}
  const sites = await Promise.all(list.map(async d => {
    const def = {site_id:d.id || d.site_id, name:d.name, lat:d.lat, lon:d.lon, elevation_m:d.elevation_m, group:d.group};
    const hz = typeof d.horizon === "string" ? normalizeHorizon(await getJSON(d.horizon), d.horizon)
             : normalizeHorizon(d.horizon || d.horizon_el_deg || d.horizon_mask, "inline horizon");
    return computeSite(def, hz, eph);
  }));
  return {sites, from:"files", region:meta.region, basemap:meta.basemap, eph, grid};
}
function normalizeSite(st){
  if (!st.horizon_mask && Array.isArray(st.horizon_el_deg)) st.horizon_mask = {az_step_deg:360/st.horizon_el_deg.length, elevation_deg:st.horizon_el_deg};
  if (st.horizon_mask && !st.horizon_mask.az_step_deg) st.horizon_mask.az_step_deg = 360/st.horizon_mask.elevation_deg.length;
  st.group = st.group || "Team pick";
  return st;
}
const site = () => S.sites[S.sel];
const N = () => site().samples.length;
function windowStart(n = N()){ return Math.max(0, Math.min(S.i, n - winLen())); }
function windowRange(){ const n = N(), a = windowStart(n); return [a, Math.min(n, a + winLen())]; }

/* ---------- animated space background (drawn in code, no images) ----------
   Layers: soft nebula clouds, three parallax star layers with twinkle, occasional shooting stars,
   and on the home view a slowly turning ring of light behind the title. Pauses when the tab is hidden;
   with "reduce motion" it draws one still frame. Purely decorative: it shows no data. */
const SKY = { cv:null, c:null, w:0, h:0, dpr:1, nebula:null, layers:[], ring:[], meteors:[], mx:0, my:0, tx:0, ty:0, ringA:1, t0:0, raf:0, still:false };
function skyBuild(){
  // a background tab can report a 0-size window; never build 0-size canvases
  const cv = SKY.cv = $("sky"), dpr = SKY.dpr = Math.min(2, window.devicePixelRatio || 1), w = SKY.w = Math.max(320, innerWidth), h = SKY.h = Math.max(320, innerHeight);
  cv.width = w*dpr; cv.height = h*dpr; SKY.c = cv.getContext("2d");
  const r = rng(7);
  // nebula: large blurred colour clouds painted once to an offscreen canvas
  const nb = document.createElement("canvas"); nb.width = Math.ceil(w*1.2); nb.height = Math.ceil(h*1.2);
  const g = nb.getContext("2d");
  const blob = (x, y, rad, col, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, col.replace("A", a)); gr.addColorStop(1, col.replace("A", 0)); g.fillStyle = gr; g.fillRect(0, 0, nb.width, nb.height); };
  blob(nb.width*.78, nb.height*.12, Math.max(w, h)*.55, "rgba(40,80,190,A)", .42);
  blob(nb.width*.12, nb.height*.95, Math.max(w, h)*.5, "rgba(90,50,160,A)", .30);
  blob(nb.width*.55, nb.height*.55, Math.max(w, h)*.35, "rgba(20,110,170,A)", .16);
  blob(nb.width*.3, nb.height*.25, Math.max(w, h)*.25, "rgba(255,170,70,A)", .06);
  SKY.nebula = nb;
  // three star layers: far (many, faint), mid, near (few, bright); each painted once
  SKY.layers = [[w*h/1500, .5, .9, .15], [w*h/6000, .8, 1.3, .35], [w*h/26000, 1.1, 2, .7]].map(([n, s0, s1, depth]) => {
    const lc = document.createElement("canvas"); lc.width = Math.ceil(w + 80); lc.height = Math.ceil(h + 80); const x = lc.getContext("2d"), tw = [];
    for (let k = 0; k < n; k++){
      const px = r()*lc.width, py = r()*lc.height, m = r(), size = s0 + (s1 - s0)*m*m;
      const col = m > .93 ? "#ffe2b0" : m > .82 ? "#cfe3ff" : "#ffffff", a = .25 + r()*.7;
      x.globalAlpha = a; x.fillStyle = col; x.beginPath(); x.arc(px, py, size, 0, 6.283); x.fill();
      if (depth > .3 && m > .7) tw.push({px, py, size:size*1.6, col, ph:r()*6.28, sp:.6 + r()*1.6});
    }
    return {cv:lc, depth, tw};
  });
  // decorative solar system: orbit sizes, speeds and planet sizes are stylised for looks, not to scale and not data
  SKY.planets = [
    {n:"Mercury", o:.16, s:2.2, c:["#d8cfc4", "#7d746b"], p:.24},
    {n:"Venus",   o:.23, s:3.6, c:["#ffe2b0", "#b48a4a"], p:.62},
    {n:"Earth",   o:.31, s:3.9, c:["#9fd8ff", "#2a6fd0"], p:1, moon:true},
    {n:"Mars",    o:.39, s:3.0, c:["#ff9d72", "#a8442a"], p:1.88},
    {n:"Jupiter", o:.56, s:9.5, c:["#f3d6b0", "#a87a52"], p:11.9, bands:true},
    {n:"Saturn",  o:.70, s:8.0, c:["#f6e3b4", "#b8955a"], p:29.5, ring:true},
    {n:"Uranus",  o:.83, s:5.4, c:["#c9f6ff", "#4fb0c6"], p:84},
    {n:"Neptune", o:.95, s:5.2, c:["#8fb4ff", "#2f4fc8"], p:165}
  ].map(pl => ({...pl, th:r()*6.283}));
  SKY.belt = Array.from({length:Math.round(Math.min(420, w*.35))}, () => ({o:.45 + r()*.06, th:r()*6.283, a:.15 + r()*.45, s:.4 + r()*.8}));
}
function skyGeom(){
  const {w, h} = SKY, A = Math.min(w*.47, h*1.05), B = A*.30, rot = -.13;
  return {cx:w/2 + SKY.mx*12, cy:h*.5 + SKY.my*8, A, B, cs:Math.cos(rot), sn:Math.sin(rot)};
}
function skyOrbitPt(G, o, th){ const ex = Math.cos(th)*G.A*o, ey = Math.sin(th)*G.B*o; return [G.cx + ex*G.cs - ey*G.sn, G.cy + ex*G.sn + ey*G.cs]; }
function skyPlanet(c, x, y, rad, pl, sx, sy, alpha){
  // shaded sphere lit from the Sun's side
  const lx = sx - x, ly = sy - y, L = Math.hypot(lx, ly) || 1, hx = x + lx/L*rad*.45, hy = y + ly/L*rad*.45;
  if (pl.ring){ c.save(); c.globalAlpha = alpha*.75; c.strokeStyle = "rgba(240,220,170,.85)"; c.lineWidth = Math.max(1, rad*.28);
    c.beginPath(); c.ellipse(x, y, rad*2.1, rad*.62, -.35, Math.PI, 2*Math.PI); c.stroke(); c.restore(); }
  const g = c.createRadialGradient(hx, hy, rad*.1, x, y, rad*1.05); g.addColorStop(0, pl.c[0]); g.addColorStop(.7, pl.c[1]); g.addColorStop(1, "rgba(5,8,16,1)");
  c.globalAlpha = alpha; c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, 6.283); c.fill();
  if (pl.bands){ c.save(); c.beginPath(); c.arc(x, y, rad, 0, 6.283); c.clip(); c.globalAlpha = alpha*.35; c.fillStyle = "#7a4e2c";
    [-.45, -.1, .3].forEach(b => c.fillRect(x - rad, y + b*rad, rad*2, rad*.16)); c.restore(); }
  if (pl.ring){ c.save(); c.globalAlpha = alpha*.85; c.strokeStyle = "rgba(240,220,170,.9)"; c.lineWidth = Math.max(1, rad*.28);
    c.beginPath(); c.ellipse(x, y, rad*2.1, rad*.62, -.35, 0, Math.PI); c.stroke(); c.restore(); }
  // soft halo so small planets read on dark sky
  c.globalAlpha = alpha*.35; const hg = c.createRadialGradient(x, y, rad, x, y, rad*3.2); hg.addColorStop(0, pl.c[0] + "55"); hg.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = hg; c.beginPath(); c.arc(x, y, rad*3.2, 0, 6.283); c.fill(); c.globalAlpha = 1;
}
function skyFrame(now){
  const {c, w, h, dpr} = SKY; if (!c) return;
  const t = (now - SKY.t0)/1000;
  SKY.mx += (SKY.tx - SKY.mx)*.04; SKY.my += (SKY.ty - SKY.my)*.04;
  const ringTarget = document.body.dataset.view === "home" ? 1 : .22; SKY.ringA += (ringTarget - SKY.ringA)*.05;  // solar system: full on home, faint elsewhere
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalCompositeOperation = "source-over"; c.globalAlpha = 1;
  c.fillStyle = "#02040a"; c.fillRect(0, 0, w, h);
  const dx = Math.sin(t*.03)*w*.04, dy = Math.cos(t*.025)*h*.03;
  c.drawImage(SKY.nebula, -w*.1 + dx - SKY.mx*12, -h*.1 + dy - SKY.my*12);
  SKY.layers.forEach(L => {
    const ox = -40 - SKY.mx*40*L.depth, oy = -40 - SKY.my*40*L.depth;
    c.globalAlpha = 1; c.drawImage(L.cv, ox, oy);
    L.tw.forEach(s => { const a = .5 + .5*Math.sin(t*s.sp + s.ph); c.globalAlpha = a*.9; c.fillStyle = s.col;
      c.beginPath(); c.arc(s.px + ox, s.py + oy, s.size*(.6 + a*.6), 0, 6.283); c.fill(); });
  });
  // shooting stars
  if (!SKY.still && Math.random() < .006 && SKY.meteors.length < 2){
    const ang = .45 + Math.random()*.35; SKY.meteors.push({x:Math.random()*w*.9, y:Math.random()*h*.4, vx:Math.cos(ang)*9, vy:Math.sin(ang)*9, life:1});
  }
  c.globalCompositeOperation = "lighter";
  SKY.meteors = SKY.meteors.filter(m => { m.x += m.vx; m.y += m.vy; m.life -= .018; if (m.life <= 0) return false;
    const gr = c.createLinearGradient(m.x, m.y, m.x - m.vx*14, m.y - m.vy*14); gr.addColorStop(0, `rgba(255,236,200,${m.life})`); gr.addColorStop(1, "rgba(120,180,255,0)");
    c.globalAlpha = 1; c.strokeStyle = gr; c.lineWidth = 1.6; c.beginPath(); c.moveTo(m.x, m.y); c.lineTo(m.x - m.vx*14, m.y - m.vy*14); c.stroke(); return true; });
  // decorative solar system around the home title (stylised, not to scale, shows no data)
  if (SKY.ringA > .01){
    const G = skyGeom(), A1 = SKY.ringA, spd = SKY.still ? 0 : .016;
    c.globalCompositeOperation = "lighter";
    // the Sun: a bright point with layered glow
    const sg = c.createRadialGradient(G.cx, G.cy, 0, G.cx, G.cy, G.A*.5);
    sg.addColorStop(0, `rgba(255,236,190,${.55*A1})`); sg.addColorStop(.04, `rgba(255,190,90,${.35*A1})`); sg.addColorStop(.25, `rgba(90,140,255,${.10*A1})`); sg.addColorStop(1, "rgba(0,0,0,0)");
    c.globalAlpha = 1; c.fillStyle = sg; c.fillRect(G.cx - G.A*.5, G.cy - G.A*.5, G.A, G.A);
    const pulse = 1 + .08*Math.sin(t*1.3);
    c.globalAlpha = .95*A1; c.fillStyle = "#fff6dc"; c.beginPath(); c.arc(G.cx, G.cy, 3.2*pulse, 0, 6.283); c.fill();
    c.globalAlpha = .35*A1; c.strokeStyle = "#ffe8b0"; c.lineWidth = 1; c.beginPath(); c.moveTo(G.cx - 34*pulse, G.cy); c.lineTo(G.cx + 34*pulse, G.cy); c.moveTo(G.cx, G.cy - 18*pulse); c.lineTo(G.cx, G.cy + 18*pulse); c.stroke();
    c.globalCompositeOperation = "source-over";
    // orbits
    c.lineWidth = 1;
    SKY.planets.forEach(pl => { c.globalAlpha = .16*A1; c.strokeStyle = "#9cc4ff";
      c.beginPath(); c.ellipse(G.cx, G.cy, G.A*pl.o, G.B*pl.o, Math.atan2(G.sn, G.cs), 0, 6.283); c.stroke(); });
    // asteroid belt
    c.fillStyle = "#cdbfa8";
    SKY.belt.forEach(b => { b.th += spd*.18/Math.pow(b.o, 1.5); const [bx, by] = skyOrbitPt(G, b.o, b.th); c.globalAlpha = b.a*A1; c.fillRect(bx, by, b.s, b.s); });
    // planets: those behind the Sun are drawn first and a little dimmer
    const pts = SKY.planets.map(pl => { pl.th += spd*.55/Math.pow(pl.p, .5); const [px, py] = skyOrbitPt(G, pl.o, pl.th); return {pl, px, py, front:Math.sin(pl.th) > 0}; });
    pts.sort((a, b) => a.py - b.py).forEach(({pl, px, py, front}) => {
      // short comet-like trail along the orbit
      c.globalAlpha = .28*A1; c.strokeStyle = pl.c[0]; c.lineWidth = Math.max(1, pl.s*.45); c.lineCap = "round"; c.beginPath();
      for (let k = 0; k <= 10; k++){ const [tx, ty] = skyOrbitPt(G, pl.o, pl.th - k*.012/Math.pow(pl.o, .5)); k ? c.lineTo(tx, ty) : c.moveTo(tx, ty); }
      c.stroke();
      const sc = .85 + .3*(py - G.cy + G.B)/(2*G.B);
      skyPlanet(c, px, py, pl.s*sc*Math.min(1.25, Math.max(.8, G.A/560)), pl, G.cx, G.cy, A1*(front ? 1 : .7));
      if (pl.moon){ const ma = t*1.6, mx = px + Math.cos(ma)*pl.s*3.2, my = py + Math.sin(ma)*pl.s*1.3;
        c.globalAlpha = .9*A1; c.fillStyle = "#e8eaee"; c.beginPath(); c.arc(mx, my, 1.4, 0, 6.283); c.fill(); }
    });
    c.globalAlpha = 1;
  }
  c.globalCompositeOperation = "source-over"; c.globalAlpha = 1;
  if (!SKY.still) SKY.raf = requestAnimationFrame(skyFrame);
}
function skyStart(){
  SKY.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  skyBuild(); SKY.t0 = performance.now(); cancelAnimationFrame(SKY.raf); SKY.raf = requestAnimationFrame(skyFrame);
  if (skyStart.bound) return; skyStart.bound = true;
  addEventListener("pointermove", e => { SKY.tx = e.clientX/innerWidth - .5; SKY.ty = e.clientY/innerHeight - .5; }, {passive:true});
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { skyBuild(); if (SKY.still) requestAnimationFrame(skyFrame); }, 150); });
  document.addEventListener("visibilitychange", () => { cancelAnimationFrame(SKY.raf); if (!document.hidden && !SKY.still) SKY.raf = requestAnimationFrame(skyFrame); });
}
function drawStars(){ /* replaced by the animated sky; kept so older calls stay harmless */ }

/* ---------- hero scene ---------- */
function smoothPath(p){
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++){
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0])/6, p1[1] + (p2[1] - p0[1])/6], c2 = [p2[0] - (p3[0] - p1[0])/6, p2[1] - (p3[1] - p1[1])/6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
const W = 1000, H = 430, TAPE = 44, TOP = 18, ER = 24;
const SX = az => (((az + 180) % 360 + 360) % 360)/360*W;
const SY = el => TOP + (S.top - Math.max(S.bot - 1, Math.min(S.top + 1, el)))/(S.top - S.bot)*(H - TAPE - TOP);
// static layers are rebuilt only when the site, margins or scale change; bodies and labels update every frame
function buildScene(){
  const s = site(), ground = H - TAPE, top = S.top, bot = S.bot, X = SX, Y = SY;
  let back = "", terr = "", tape = "";
  const r = rng(11);
  back += `<rect width="${W}" height="${ground}" fill="url(#sky)"/><g class="sky-g">`;
  for (let k = 0; k < 170; k++){ const sx = r()*W, sy = TOP + r()*(ground - TOP - 30), m = r();
    back += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${m > .96 ? 1.4 : m > .8 ? .9 : .5}" fill="#fff" opacity="${(.25 + r()*.6).toFixed(2)}"/>`; }
  back += `</g>`;
  for (let e = Math.ceil(bot); e <= top; e++){
    if (e === 0) continue;
    back += `<line x1="0" x2="${W}" y1="${Y(e)}" y2="${Y(e)}" stroke="#7da5e6" stroke-opacity=".07"/>`;
    if (e % (top - bot > 12 ? 2 : 1) === 0 && Y(e) > 92) back += `<text x="${W-8}" y="${Y(e)-4}" text-anchor="end" fill="#5B6782" font-size="12" font-family="Inter,sans-serif">${e}°</text>`;
  }
  if (s.horizon_mask){
    const m = s.horizon_mask, n = m.elevation_deg.length, pts = [];
    for (let j = 0; j <= n; j++){ const az = 180 + j*m.az_step_deg, e = m.elevation_deg[Math.round((az % 360)/m.az_step_deg) % n];
      pts.push([+(j*m.az_step_deg/360*W).toFixed(1), +Y(e).toFixed(1)]); }
    const sky = smoothPath(pts), d = `M0,${H} L${pts[0][0]},${pts[0][1]} ${sky.slice(sky.indexOf("C"))} L${W},${H} Z`;
    terr += `<g class="terrain-g"><path d="${d}" fill="url(#rock)"/><path d="${d}" fill="url(#litSide)"/>
      <path d="${d}" filter="url(#grain)" opacity=".35"/>
      <path d="${sky}" fill="none" stroke="#eef2f8" stroke-opacity=".85" stroke-width="1.6" stroke-linejoin="round"/></g>`;
    const lift = (mg, col, lbl) => { if (!mg) return ""; const dy = Y(0) - Y(mg), lp = pts.map(([qx, qy]) => [qx, qy - dy]);
      return `<path d="${smoothPath(lp)}" fill="none" stroke="${col}" stroke-width="1.3" stroke-dasharray="5 5" opacity=".8"/>
        <text x="${W - 14}" y="${lp[lp.length - 1][1] - 6}" text-anchor="end" fill="${col}" font-size="12" font-family="Inter,sans-serif">${lbl} +${mg.toFixed(2)}°</text>`; };
    terr += lift(S.mSun, "#FFC24A", "Sun margin") + lift(S.mEarth, "#4FB3FF", "Earth margin");
  } else {
    terr += `<rect y="${Y(0)}" width="${W}" height="${H - Y(0)}" fill="url(#rock)"/>
      <text x="${W/2}" y="${Y(0)+40}" text-anchor="middle" fill="#FF5A4E" font-size="16" font-family="Inter,sans-serif">Terrain horizon profile missing in data</text>`;
  }
  const exag = ((ground - TOP)/(top - bot))/(W/360);
  terr += `<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="#cfe0ff" stroke-opacity=".35" stroke-dasharray="2 6"/>
    <text x="10" y="${Y(0) - 6}" fill="#cfd6e2" fill-opacity=".8" font-size="12" font-family="Inter,sans-serif">Flat horizon 0°</text>
    <text x="${W - 10}" y="${ground - 8}" text-anchor="end" fill="#cfd6e2" fill-opacity=".7" font-size="12" font-family="Inter,sans-serif">Vertical scale exaggerated about ${Math.round(exag)}×</text>`;
  tape += `<rect y="${ground}" width="${W}" height="${TAPE}" fill="#050a16" fill-opacity=".92"/>
    <line x1="0" x2="${W}" y1="${ground}" y2="${ground}" stroke="#7da5e6" stroke-opacity=".35"/>`;
  const dirs = {0:"N",45:"NE",90:"E",135:"SE",180:"S",225:"SW",270:"W",315:"NW"};
  for (let j = 0; j <= 360; j += 5){
    const az = (180 + j) % 360, xx = j/360*W, big = az % 45 === 0, mid = az % 15 === 0;
    tape += `<line x1="${xx}" x2="${xx}" y1="${ground}" y2="${ground + (big ? 12 : mid ? 8 : 4)}" stroke="#8F9CB5" stroke-opacity="${big ? .9 : .5}"/>`;
    if (big && j > 0 && j < 360) tape += `<text x="${xx}" y="${ground + 30}" text-anchor="middle" fill="${az % 90 === 0 ? "#E8EEF7" : "#8F9CB5"}" font-size="${az % 90 === 0 ? 16 : 13}" font-weight="600" font-family="Inter,sans-serif">${dirs[az]}</text>`;
    else if (mid && az % 45 !== 0 && j > 0 && j < 360) tape += `<text x="${xx}" y="${ground + 28}" text-anchor="middle" fill="#5B6782" font-size="11" font-family="Inter,sans-serif">${az}</text>`;
  }
  const br = (x0, y0, dx, dy) => `<path d="M${x0},${y0 + dy*18} L${x0},${y0} L${x0 + dx*18},${y0}" fill="none" stroke="#7da5e6" stroke-opacity=".45" stroke-width="1.5"/>`;
  tape += br(8, 8, 1, 1) + br(W-8, 8, -1, 1);
  $("scene").innerHTML = `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#02040a"/><stop offset=".75" stop-color="#060b18"/><stop offset="1" stop-color="#0b1426"/></linearGradient>
    <radialGradient id="sunGlow"><stop offset="0" stop-color="#FFE7A8" stop-opacity=".95"/><stop offset=".12" stop-color="#FFC24A" stop-opacity=".55"/><stop offset=".45" stop-color="#FF9E2C" stop-opacity=".12"/><stop offset="1" stop-color="#FF9E2C" stop-opacity="0"/></radialGradient>
    <radialGradient id="sunCore" cx="45%" cy="40%"><stop offset="0" stop-color="#fffdf4"/><stop offset=".6" stop-color="#FFE29A"/><stop offset="1" stop-color="#FFB733"/></radialGradient>
    <radialGradient id="earthGlow"><stop offset="0" stop-color="#4FB3FF" stop-opacity=".35"/><stop offset="1" stop-color="#4FB3FF" stop-opacity="0"/></radialGradient>
    <linearGradient id="rock" gradientUnits="userSpaceOnUse" x1="0" y1="${Y(S.maskMax)}" x2="0" y2="${H}"><stop offset="0" stop-color="#b4bac4"/><stop offset=".25" stop-color="#7a808b"/><stop offset=".65" stop-color="#3b414c"/><stop offset="1" stop-color="#1a1e26"/></linearGradient>
    <linearGradient id="litSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop id="ls1" offset="0" stop-color="#fff" stop-opacity="0"/><stop id="ls2" offset="0" stop-color="#FFE2A0" stop-opacity="0"/><stop id="ls3" offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .55 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
  </defs>
  <g id="scBack">${back}</g><g id="scBodies"></g><g id="scTerrain">${terr}</g><g id="scFront"></g><g id="scTape">${tape}</g><g id="scMarks"></g>`;
}
function renderScene(){
  const s = site(), key = [s.site_id, S.mSun, S.mEarth, S.top, S.bot].join("|");
  if (S.sceneKey !== key){ buildScene(); S.sceneKey = key; }
  const x = s.samples[S.i], [a, b] = windowRange(), ground = H - TAPE, X = SX, Y = SY;
  const sunF = X(x.sun_az)/W;
  $("ls1").setAttribute("offset", Math.max(0, sunF - .12)); $("ls2").setAttribute("offset", sunF); $("ls3").setAttribute("offset", Math.min(1, sunF + .12));
  $("ls2").setAttribute("stop-opacity", x.sun_el > x.horizon_sun_el ? .22 : 0);
  const path = (kEl, kAz, color) => { let d = "", prev = null;
    for (let k = a; k < b; k++){ const az = s.samples[k][kAz], el = s.samples[k][kEl], xx = X(az);
      d += (prev === null || Math.abs(xx - prev) > W/2 ? "M" : "L") + xx.toFixed(1) + "," + Y(el).toFixed(1) + " "; prev = xx; }
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.4" stroke-dasharray="2 5" stroke-linecap="round" opacity=".7"/>`; };
  const sx = X(x.sun_az), sy = Y(x.sun_el), ex = X(x.earth_az), ey = Y(x.earth_el);
  const SR = Math.max(2.5, Y(0) - Y(SUN_R));  // true angular radius at this scale, so a 40% disk looks 40% hidden
  const side = (x.sun_az - x.earth_az + 540) % 360 - 180 > 0 ? 1 : -1;
  $("scBodies").innerHTML = path("earth_el","earth_az","#4FB3FF") + path("sun_el","sun_az","#FFC24A") +
    `<circle cx="${sx}" cy="${sy}" r="150" fill="url(#sunGlow)"/>
     <line x1="${sx-60}" x2="${sx+60}" y1="${sy}" y2="${sy}" stroke="#FFE7A8" stroke-opacity=".35"/>
     <circle cx="${sx}" cy="${sy}" r="${SR}" fill="url(#sunCore)"/>
     <circle cx="${ex}" cy="${ey}" r="${ER*2.4}" fill="url(#earthGlow)"/>
     <use href="#earthGlobe" x="${ex - ER}" y="${ey - ER}" width="${ER*2}" height="${ER*2}"/>
     <circle cx="${ex}" cy="${ey}" r="${ER}" fill="url(#${side > 0 ? "gNightL" : "gNightR"})"/>`;
  const callout = (cx, cy, vis, color, name, el, az, rad0, clr, extra) => {
    const right = cx < W - 190, tx = right ? cx + rad0 + 12 : cx - rad0 - 12, anchor = right ? "start" : "end";
    const ty = Math.max(TOP + 26, Math.min(ground - 70, cy - 22));
    let o = vis ? "" : `<circle cx="${cx}" cy="${cy}" r="${rad0}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    const status = vis ? "In view" : clr > 0 ? "Above terrain, below margin" : "Behind terrain";
    o += `<line x1="${cx + (right ? rad0 + 1 : -rad0 - 1)}" y1="${cy - 6}" x2="${tx + (right ? -4 : 4)}" y2="${ty + 4}" stroke="${color}" stroke-opacity=".6"/>
      <text x="${tx}" y="${ty}" text-anchor="${anchor}" font-family="Inter,sans-serif">
        <tspan fill="${color}" font-size="17" font-weight="600" letter-spacing="1">${name}</tspan>
        <tspan x="${tx}" dy="18" fill="#E8EEF7" font-size="14">${el.toFixed(2)}° up, ${az.toFixed(0)}° az</tspan>
        <tspan x="${tx}" dy="16" fill="${vis ? "#3DDC97" : clr > 0 ? "#FFB347" : "#FF5A4E"}" font-size="13">${status}${extra}</tspan></text>`;
    return o; };
  const sd = x._sd, extra = sd > 0 && sd < 100 ? `, ${sd.toFixed(0)}% of disk` : "";
  $("scFront").innerHTML = callout(ex, ey, x._ev, "#4FB3FF", "EARTH", x.earth_el, x.earth_az, ER, x.earth_el - x.horizon_earth_el, "") +
    callout(sx, sy, x._sv, "#FFC24A", "SUN", x.sun_el, x.sun_az, SR + 4, x.sun_el - x.horizon_sun_el, extra);
  const mk = (xx, color) => `<path d="M${xx-6},${ground} L${xx+6},${ground} L${xx},${ground+8}z" fill="${color}"/>`;
  $("scMarks").innerHTML = mk(sx, "#FFC24A") + mk(ex, "#4FB3FF");
}

/* ---------- polar map ---------- */
const KM_PER_DEG = 30.3233;
const M = { pick:false, home:{x:-3.4, y:-4.6, w:6.8, h:5.15}, view:null, built:false, layers:{dirs:true, psr:true, grid:true}, anim:null, moved:false };
M.view = {...M.home};
// south polar stereographic, in "degree units" (1 unit = R*pi/180 = 30.3233 km); screen y points away from 0° longitude
const KM_PER_UNIT = 1737.4*Math.PI/180;
const P = (lat, lon) => { const rho = deg(2*Math.tan(rad(90 + lat)/2)); return [rho*Math.sin(rad(lon)), -rho*Math.cos(rad(lon))]; };
// named craters drawn on the map (USGS Gazetteer centres and diameters)
const FEATURES = [
  {name:"Shackleton",  lat:-89.67, lon:129.78, d_km:21.0},
  {name:"de Gerlache", lat:-88.50, lon:-87.10, d_km:32.4},
  {name:"Haworth",     lat:-87.45, lon:-5.17,  d_km:51.4}
];
function dirAt(s, az){ // screen direction for a local azimuth at a site
  const N = [Math.sin(rad(s.lon)), -Math.cos(rad(s.lon))], E = [Math.cos(rad(s.lon)), Math.sin(rad(s.lon))];
  return [Math.cos(rad(az))*N[0] + Math.sin(rad(az))*E[0], Math.cos(rad(az))*N[1] + Math.sin(rad(az))*E[1]];
}
// frame every site plus the pole, matched to the map's aspect ratio
function homeView(){
  const pts = S.sites.map(st => P(st.lat, st.lon)).concat([[0, 0]]), st = $("mapStage");
  let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
  const pad = Math.max(.9, .25*Math.max(x1 - x0, y1 - y0)); x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  // a page loaded in a background tab can report a 0-size stage; fall back to the CSS aspect ratio
  const asp = st.clientWidth > 0 && st.clientHeight > 0 ? st.clientWidth/st.clientHeight : 4/3; let w = x1 - x0, h = y1 - y0;
  if (w/h < asp){ const nw = h*asp; x0 -= (nw - w)/2; w = nw; } else { const nh = w/asp; y0 -= (nh - h)/2; h = nh; }
  return {x:x0, y:y0, w, h};
}
function buildMap(){
  const bm = S.basemap, U = m => m/1000/KM_PER_UNIT;
  let g = `<defs>
    <filter id="relief" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="-9" y="-11" width="18" height="18">
      <feTurbulence type="fractalNoise" baseFrequency="3.2" numOctaves="4" seed="9" result="n"/>
      <feDiffuseLighting in="n" surfaceScale="0.12" diffuseConstant="1" lighting-color="#ffffff" result="l">
        <feDistantLight id="mLight" azimuth="225" elevation="35"/></feDiffuseLighting>
      <feColorMatrix in="l" type="matrix" values=".30 0 0 0 .02  0 .36 0 0 .05  0 0 .50 0 .12  0 0 0 0 1"/>
    </filter>
    <radialGradient id="mBase" cx="50%" cy="60%" r="60%"><stop offset="0" stop-color="#1d2b4c"/><stop offset=".6" stop-color="#121c34"/><stop offset="1" stop-color="#0a1020"/></radialGradient>
    <linearGradient id="crShade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b111f"/><stop offset=".55" stop-color="#2f3a52"/><stop offset="1" stop-color="#9aa6bd"/></linearGradient>
    <linearGradient id="crRim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe6ad"/><stop offset=".5" stop-color="#7d8aa6"/><stop offset="1" stop-color="#2a3550"/></linearGradient>
    <radialGradient id="psrG"><stop offset="0" stop-color="#9df2ff" stop-opacity=".95"/><stop offset=".5" stop-color="#36c7ff" stop-opacity=".55"/><stop offset="1" stop-color="#1b6dff" stop-opacity="0"/></radialGradient>
    <filter id="mGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation=".03"/></filter>
  </defs>
  <rect x="-12" y="-12" width="24" height="24" fill="url(#mBase)"/>`;
  if (bm && bm.image && bm.extent_m){ const [a0, a1, b0, b1] = bm.extent_m;
    g += `<image href="data/${bm.image}" x="${U(a0)}" y="${-U(b1)}" width="${U(a1 - a0)}" height="${U(b1 - b0)}" preserveAspectRatio="none" opacity=".95"/>`;
  } else g += `<rect x="-12" y="-12" width="24" height="24" filter="url(#relief)" opacity=".38"/>`;
  g += `<g id="mGrid">`;
  for (let co = 1; co <= 8; co++) g += `<circle r="${P(-90 + co, 0)[1]*-1}" fill="none" stroke="#5FD3FF" stroke-opacity="${co % 2 ? .45 : .28}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  for (let lon = 0; lon < 360; lon += 15){ const [x2, y2] = P(-81, lon);
    g += `<line x1="0" y1="0" x2="${x2}" y2="${y2}" stroke="#5FD3FF" stroke-opacity="${lon % 90 ? .14 : .4}" stroke-width="1" vector-effect="non-scaling-stroke"/>`; }
  g += `</g>
  <g id="mCrater">${FEATURES.map(f => { const [cx, cy] = P(f.lat, f.lon), r = f.d_km/2/KM_PER_UNIT;
    return `<circle cx="${cx}" cy="${cy}" r="${r*1.18}" fill="#000" opacity=".22" filter="url(#mGlow)"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#crShade)" opacity="${bm && bm.image ? .0 : 1}"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#crRim)" stroke-width="${r*.08}"/>`; }).join("")}</g>
  <g id="mPsr">${bm && bm.psr_image && bm.extent_m
    ? `<image href="data/${bm.psr_image}" x="${U(bm.extent_m[0])}" y="${-U(bm.extent_m[3])}" width="${U(bm.extent_m[1] - bm.extent_m[0])}" height="${U(bm.extent_m[3] - bm.extent_m[2])}" preserveAspectRatio="none"/>`
    : ""}</g>
  <g id="mDyn"></g>`;
  $("polar").innerHTML = g; M.built = true;
  M.home = homeView(); M.view = {...M.home}; $("polar").setAttribute("viewBox", `${M.view.x} ${M.view.y} ${M.view.w} ${M.view.h}`);
}
function setView(v){ M.view = v; $("polar").setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`); renderMapDyn(); }
function flyTo(target, ms = 600){
  cancelAnimationFrame(M.anim); const from = {...M.view}, t0 = performance.now();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) ms = 0;
  const step = now => { const k = ms ? Math.min(1, (now - t0)/ms) : 1, e = 1 - Math.pow(1 - k, 3);
    setView({x:from.x + (target.x - from.x)*e, y:from.y + (target.y - from.y)*e, w:from.w + (target.w - from.w)*e, h:from.h + (target.h - from.h)*e});
    if (k < 1) M.anim = requestAnimationFrame(step); };
  M.anim = requestAnimationFrame(step);
}
function zoomAt(cx, cy, f, animate){
  const v = M.view, w = Math.max(.6, Math.min(12, v.w*f)), k = w/v.w;
  const t = {x:cx - (cx - v.x)*k, y:cy - (cy - v.y)*k, w, h:v.h*k};
  animate ? flyTo(t, 300) : setView(t);
}
function centerOn(x, y){ const v = M.view; flyTo({x:x - v.w/2, y:y - v.h/2, w:v.w, h:v.h}); }
function renderMap(){
  if (!M.built) buildMap();
  const s = site(), x = s.samples[S.i], d = dirAt(s, x.sun_az);
  // light the relief and crater from the Sun's direction at the selected site
  $("mLight").setAttribute("azimuth", (deg(Math.atan2(d[1], d[0])) + 360) % 360);
  const sh = $("crShade"), rm = $("crRim");
  // gradients start on the Sun side: the bowl wall facing the Sun is in shadow, the outer rim there is lit
  [sh, rm].forEach(gr => { gr.setAttribute("x1", .5 + d[0]*.5); gr.setAttribute("y1", .5 + d[1]*.5);
    gr.setAttribute("x2", .5 - d[0]*.5); gr.setAttribute("y2", .5 - d[1]*.5); });
  $("mGrid").style.display = M.layers.grid ? "" : "none";
  $("mPsr").style.display = M.layers.psr ? "" : "none";
  renderMapDyn();
  renderMapSide();
}
function nowColor(x){ return x._sv && x._ev ? "#3DDC97" : x._sv ? "#FFC24A" : x._ev ? "#4FB3FF" : "#FF5A4E"; }
function renderMapDyn(){
  if (!M.built || !S.sites.length) return;
  const sk = Math.min(1.9, Math.max(1, 720/Math.max(1, $("mapStage").clientWidth))), v = M.view, fs = v.w*0.021*sk, r = v.w*0.0085*sk, F = `font-family="Inter,sans-serif"`;
  const s = site(), now = s.samples[S.i];
  let g = "";
  if (M.layers.grid){
    for (let co = 1; co <= 6; co++){ const [lx, ly] = P(-90 + co, 32); g += `<text x="${lx}" y="${ly}" fill="#8fe3ff" fill-opacity=".85" font-size="${fs*.8}" ${F}>${90 - co}° S</text>`; }
    [[0,"0°"],[90,"90° E"],[270,"90° W"],[180,"180°"]].forEach(([lon, t]) => { const [lx, ly] = P(-85.2, lon);
      g += `<text x="${lx}" y="${ly}" text-anchor="middle" fill="#cfe0ff" fill-opacity=".8" font-size="${fs*.9}" ${F}>${t}</text>`; });
  }
  g += `<circle r="${r*.9}" fill="#fff"/><circle r="${r*2.2}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1" vector-effect="non-scaling-stroke"/>
        <text x="${r*2.6}" y="${-r*2.6}" text-anchor="start" fill="#fff" font-size="${fs}" font-weight="600" ${F}>South Pole</text>`;
  FEATURES.forEach(f => { const [cx, cy] = P(f.lat, f.lon), rr = f.d_km/2/KM_PER_UNIT;
    g += `<text x="${cx}" y="${cy + rr + fs*1.15}" text-anchor="middle" fill="#dfe7f5" fill-opacity=".9" font-size="${fs*.95}" font-style="italic" ${F}>${f.name}</text>`; });
  // Sun and Earth direction rays from the selected site
  const [sx0, sy0] = P(s.lat, s.lon);
  if (M.layers.dirs){
    const L = v.w*.12;
    const vis0 = {x0:v.x + v.w*.06, x1:v.x + v.w*.9, y0:v.y + v.h*.1, y1:v.y + v.h*.9};
    const ray = (az, vis, col, label) => { const dd = dirAt(s, az); let len = L;
      // keep the icon inside the visible map
      if (dd[0] > 0) len = Math.min(len, (vis0.x1 - sx0)/dd[0]); if (dd[0] < 0) len = Math.min(len, (vis0.x0 - sx0)/dd[0]);
      if (dd[1] > 0) len = Math.min(len, (vis0.y1 - sy0)/dd[1]); if (dd[1] < 0) len = Math.min(len, (vis0.y0 - sy0)/dd[1]);
      len = Math.max(len, L*.45);
      const ex = sx0 + dd[0]*len, ey = sy0 + dd[1]*len;
      return `<line x1="${sx0}" y1="${sy0}" x2="${ex}" y2="${ey}" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-dasharray="${vis ? "0" : "6 6"}" opacity="${vis ? .9 : .55}"/>
        <circle cx="${ex}" cy="${ey}" r="${r*2.6}" fill="${col}" opacity="${vis ? .22 : .08}"/>
        ${label === "Earth"
          ? `<use href="#earthGlobe" x="${ex - r*1.9}" y="${ey - r*1.9}" width="${r*3.8}" height="${r*3.8}" opacity="${vis ? 1 : .45}"/>`
          : `<circle cx="${ex}" cy="${ey}" r="${r*1.35}" fill="${vis ? col : "#0b1222"}" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/>`}
        <text x="${ex + dd[0]*r*4.2}" y="${ey + dd[1]*r*4.2 + fs*.35}" text-anchor="${dd[0] > .35 ? "start" : dd[0] < -.35 ? "end" : "middle"}" fill="${col}" font-size="${fs*.95}" font-weight="600" ${F}>${label}${vis ? "" : " hidden"}</text>`; };
    g += ray(now.earth_az, now._ev, "#4FB3FF", "Earth") + ray(now.sun_az, now._sv, "#FFC24A", "Sun");
  }

  // sites
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  S.sites.forEach((st, k) => {
    const [x, y] = P(st.lat, st.lon), on = k === S.sel, o = stats(st), xn = o.now;
    const R1 = r*2.2, C1 = 2*Math.PI*R1, col = nowColor(xn), name = short(st.name);
    const right = x >= 0, lx = right ? x + R1 + r*1.6 : x - R1 - r*1.6, tw = name.length*fs*.5 + fs*.9;
    g += `<g class="msite" data-k="${k}" style="cursor:pointer">
      ${on && !reduce ? `<circle class="pulse" cx="${x}" cy="${y}" r="${R1}" fill="none" stroke="#FFC24A" stroke-width="2" vector-effect="non-scaling-stroke"><animate attributeName="r" values="${R1};${R1*2.4}" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".9;0" dur="1.8s" repeatCount="indefinite"/></circle>` : ""}
      <circle cx="${x}" cy="${y}" r="${R1*1.6}" fill="transparent"/>
      <circle cx="${x}" cy="${y}" r="${R1}" fill="rgba(6,11,24,.75)" stroke="#1f2b47" stroke-width="${r*.7}"/>
      <circle cx="${x}" cy="${y}" r="${R1}" fill="none" stroke="#FFC24A" stroke-width="${r*.7}" stroke-linecap="round" stroke-dasharray="${(C1*o.sun/100).toFixed(4)} ${C1.toFixed(4)}" transform="rotate(-90 ${x} ${y})"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/>
      <rect x="${right ? lx - fs*.35 : lx - tw + fs*.35}" y="${y - fs*.78}" width="${tw}" height="${fs*1.5}" rx="${fs*.35}" fill="rgba(6,11,24,.78)" stroke="${on ? "#FFC24A" : "rgba(125,165,230,.35)"}" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <text x="${right ? lx + fs*.1 : lx - fs*.1}" y="${y + fs*.3}" text-anchor="${right ? "start" : "end"}" fill="${on ? "#FFC24A" : "#E8EEF7"}" font-size="${fs}" font-weight="600" ${F}>${name}</text></g>`;
  });
  $("mDyn").innerHTML = g;

  // scale bar
  const stage = $("mapStage"), pxPerUnit = Math.max(stage.clientWidth/v.w, stage.clientHeight/v.h);
  const nice = [5, 10, 20, 25, 50, 100].find(km => km/KM_PER_DEG*pxPerUnit >= 70) || 100;
  const bar = $("scaleBar"); bar.querySelector("i").style.width = (nice/KM_PER_DEG*pxPerUnit).toFixed(0) + "px"; bar.querySelector("span").textContent = nice + " km";
}
const GROUP_ORDER = ["Team pick", "CLPS target", "Other mission", "Custom"];
function renderMapSide(){
  const groups = [...new Set(S.sites.map(st => st.group))].sort((a, b) => (GROUP_ORDER.indexOf(a) + 99) % 99 - (GROUP_ORDER.indexOf(b) + 99) % 99);
  const multi = groups.length > 1;
  $("mapSide").innerHTML = groups.map(gname => (multi || gname !== "Team pick" ? `<div class="grp">${gname}</div>` : "") +
    S.sites.map((st, k) => { if (st.group !== gname) return ""; const o = stats(st);
      return `<div class="scard-wrap"><button class="scard" data-k="${k}" aria-pressed="${k === S.sel}">
        <span class="sdot" style="background:${nowColor(o.now)};box-shadow:0 0 10px ${nowColor(o.now)}"></span>
        <span class="nm">${short(st.name)}${st.terrain === "coarse" ? `<span class="tag">coarse terrain${isMock(st.data_source) ? ", MOCK" : ""}</span>` : ""}</span>
        <span class="co">${Math.abs(st.lat).toFixed(2)}° S, ${Math.abs(st.lon).toFixed(2)}° ${st.lon < 0 ? "W" : "E"}</span>
        <span class="bars"><span>Sun</span><i><b style="width:${o.sun.toFixed(0)}%;background:var(--sun)"></b></i><span>${o.sun.toFixed(0)}%</span>
          <span>Earth</span><i><b style="width:${o.dte.toFixed(0)}%;background:var(--earth)"></b></i><span>${o.dte.toFixed(0)}%</span></span>
      </button>${st.group === "Custom" ? `<button class="rm" data-rm="${k}" aria-label="Remove ${st.name}">×</button>` : ""}</div>`; }).join("")).join("");
}
// inverse of P(): screen map units back to latitude/longitude
function unP(x, y){ const ys = -y, rho = Math.hypot(x, ys), co = deg(2*Math.atan(rad(rho)/2)); return [-90 + co, deg(Math.atan2(x, ys))]; }
function addCustom(lat, lon){
  if (!isFinite(lat) || !isFinite(lon) || lat > -80 || lat < -90 || lon < -180 || lon > 180){ toast("Enter a latitude between -90 and -80 and a longitude between -180 and 180"); return; }
  if (!S.eph){ toast("Custom locations need ephemeris.json in the data folder"); return; }
  let hz, note;
  if (S.grid && S.grid.points && S.grid.points.length){
    const [x0, y0] = P(lat, lon); let best = null, bd = 1e9;
    S.grid.points.forEach(g => { const [x1, y1] = P(g.lat, g.lon), d = Math.hypot(x1 - x0, y1 - y0); if (d < bd){ bd = d; best = g; } });
    hz = normalizeHorizon(best.horizon_el_deg || best.elevation_deg || best.horizon, S.grid.source ? `coarse grid: ${S.grid.source}` : "coarse grid");
    note = `nearest grid point ${(bd*KM_PER_UNIT).toFixed(1)} km away${isMock(S.grid.source) ? ", MOCK grid" : ""}`;
  } else { hz = {az_step_deg:2, elevation_deg:new Array(180).fill(0), source:"flat horizon"}; note = "no terrain grid loaded, flat horizon assumed"; }
  S.custom++;
  const def = {site_id:"custom_" + S.custom, name:`Custom ${Math.abs(lat).toFixed(2)}° S, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`,
    lat, lon, group:"Custom", terrain:"coarse", terrain_note:note};
  S.sites.push(computeSite(def, hz, S.eph)); applyMargins(); computeScale();
  setSite(S.sites.length - 1); const [x, y] = P(lat, lon); centerOn(x, y);
  toast("Custom location added (coarse terrain)");
}
function removeSite(k){ S.sites.splice(k, 1); if (S.sel >= S.sites.length) S.sel = 0; else if (S.sel > k) S.sel--; else if (S.sel === k) S.sel = 0; computeScale(); renderAll(); }

function showTip(k, ev){
  const st = S.sites[k], o = stats(st), xn = o.now, tip = $("mapTip"), r = $("mapStage").getBoundingClientRect();
  tip.innerHTML = `<b>${st.name}</b>
    <div class="r"><span>Now</span><span style="color:${nowColor(xn)}">${xn._sv ? "Sun" : "No sun"}, ${xn._ev ? "Earth link" : "no link"}</span></div>
    <div class="r"><span>Sunlit in window</span><span>${o.sun.toFixed(0)}%</span></div>
    <div class="r"><span>Earth link in window</span><span>${o.dte.toFixed(0)}%</span></div>
    <div class="r"><span>Both together</span><span>${o.both.toFixed(0)}%</span></div>`;
  tip.style.left = (ev.clientX - r.left) + "px"; tip.style.top = (ev.clientY - r.top) + "px"; tip.hidden = false;
}
function bindMap(){
  const svg = $("polar"), stage = $("mapStage"), pts = new Map(); let start = null, pinch = null;
  const toSvg = (cx, cy) => { const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
  svg.addEventListener("wheel", e => { e.preventDefault(); const p = toSvg(e.clientX, e.clientY); zoomAt(p.x, p.y, e.deltaY > 0 ? 1.15 : 1/1.15); }, {passive:false});
  svg.addEventListener("pointerdown", e => {
    svg.setPointerCapture(e.pointerId); pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
    cancelAnimationFrame(M.anim); M.moved = false;
    if (pts.size === 1){ start = {x:e.clientX, y:e.clientY, v:{...M.view}, a:svg.getScreenCTM().a}; }
    if (pts.size === 2){ const [p1, p2] = [...pts.values()]; pinch = {d:Math.hypot(p1.x - p2.x, p1.y - p2.y), v:{...M.view}, c:toSvg((p1.x + p2.x)/2, (p1.y + p2.y)/2)}; }
  });
  svg.addEventListener("pointermove", e => {
    const t = e.target.closest(".msite");
    if (t && !pts.size) showTip(+t.dataset.k, e); else if (!pts.size) $("mapTip").hidden = true;
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if (pts.size === 2 && pinch){ const [p1, p2] = [...pts.values()], d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      M.view = {...pinch.v}; zoomAt(pinch.c.x, pinch.c.y, pinch.d/Math.max(1, d)); M.moved = true; return; }
    if (start){ const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 4){ M.moved = true; svg.classList.add("dragging"); $("mapTip").hidden = true; }
      if (M.moved) setView({...start.v, x:start.v.x - dx/start.a, y:start.v.y - dy/start.a}); }
  });
  const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size){ start = null; svg.classList.remove("dragging"); } };
  svg.addEventListener("pointerup", e => {
    const wasMoved = M.moved; end(e);
    if (!wasMoved){ const t = e.target.closest(".msite");
      if (M.pick){ const pt = toSvg(e.clientX, e.clientY), [la, lo] = unP(pt.x, pt.y);
        M.pick = false; $("cPick").setAttribute("aria-pressed", "false"); svg.classList.remove("picking");
        $("cLat").value = la.toFixed(2); $("cLon").value = lo.toFixed(2); addCustom(+la.toFixed(2), +lo.toFixed(2)); }
      else if (t) setSite(+t.dataset.k); }
  });
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointerleave", () => { if (!pts.size) $("mapTip").hidden = true; });
  svg.addEventListener("dblclick", e => { const p = toSvg(e.clientX, e.clientY); zoomAt(p.x, p.y, 1/1.8, true); });
  svg.addEventListener("keydown", e => { const v = M.view;
    if (e.key === "+" || e.key === "=") zoomAt(v.x + v.w/2, v.y + v.h/2, 1/1.3, true);
    if (e.key === "-") zoomAt(v.x + v.w/2, v.y + v.h/2, 1.3, true); });
  $("zIn").addEventListener("click", () => { const v = M.view; zoomAt(v.x + v.w/2, v.y + v.h/2, 1/1.4, true); });
  $("zOut").addEventListener("click", () => { const v = M.view; zoomAt(v.x + v.w/2, v.y + v.h/2, 1.4, true); });
  $("zHome").addEventListener("click", () => { M.home = homeView(); flyTo({...M.home}); });
  $("mapSide").addEventListener("click", e => { const rm = e.target.closest("[data-rm]"); if (rm){ removeSite(+rm.dataset.rm); return; }
    const b = e.target.closest("[data-k]"); if (!b) return; const k = +b.dataset.k;
    setSite(k); const [x, y] = P(S.sites[k].lat, S.sites[k].lon); centerOn(x, y); });
  document.querySelectorAll(".chipbtn").forEach(b => b.addEventListener("click", () => {
    const L = b.dataset.layer; M.layers[L] = !M.layers[L]; b.setAttribute("aria-pressed", M.layers[L]); renderMap(); }));
  window.addEventListener("resize", renderMapDyn);
}

/* ---------- telemetry tiles ---------- */
function renderTiles(){
  const x = site().samples[S.i];
  const sd = x._sd, pcol = sd >= 100 ? "var(--sun)" : sd > 0 ? "#e0a84a" : "var(--nogo)";
  const flag = ok => `<span class="go-flag ${ok ? "go" : "nogo"}">${ok ? "GO" : "NO-GO"}</span>`;
  $("tiles").innerHTML = `
    <div class="tile sun"><h3>Sun elevation</h3><div class="val">${x.sun_el.toFixed(2)}<small>°</small></div>${flag(x._sv)}
      <div class="meta">Azimuth ${x.sun_az.toFixed(1)}°, terrain ${x.horizon_sun_el.toFixed(1)}°, clearance ${sgn(x.sun_el - x.horizon_sun_el)}</div></div>
    <div class="tile sun"><h3>Sun disk visible</h3><div class="val" style="color:${pcol}">${sd.toFixed(0)}<small>%</small></div>${flag(sd > 0)}
      <div class="meta">Share of the Sun's disk (radius ${SUN_R.toFixed(2)}°) above the skyline${S.mSun ? ` raised by a ${S.mSun.toFixed(2)}° margin` : ""}. Above 100% visible, extra height adds no power.</div></div>
    <div class="tile earth"><h3>Earth elevation</h3><div class="val">${x.earth_el.toFixed(2)}<small>°</small></div>${flag(x._ev)}
      <div class="meta">Azimuth ${x.earth_az.toFixed(1)}°, terrain ${x.horizon_earth_el.toFixed(1)}°, clearance ${sgn(x.earth_el - x.horizon_earth_el)}</div></div>
    <div class="tile earth"><h3>Direct-to-Earth link</h3><div class="pclass" style="color:${x._ev ? "var(--earth)" : "var(--nogo)"}">${x._ev ? "Available" : "Blocked"}</div>${flag(x._ev)}
      <div class="meta">Needs Earth above the local skyline${S.mEarth ? ` by ${S.mEarth.toFixed(2)}°` : ""}</div></div>`;
  const nextChange = key => { const smp = site().samples, now = smp[S.i][key];
    for (let j = S.i + 1; j < smp.length; j++) if (smp[j][key] !== now) return {h:(j - S.i)*S.stepH, now};
    return null; };
  const sunN = nextChange("_sv"), earN = nextChange("_ev");
  const dur = h => h < 48 ? `${h} h` : `${Math.floor(h/24)} d ${h % 24} h`;
  const at = (o) => o ? fmtT(Date.parse(S.times[S.i]) + o.h*3600e3) : "";
  const card = (o, cls, upLbl, downLbl, what) => o
    ? `<div class="${cls}">${o.now ? downLbl : upLbl} in<b>${dur(o.h)}</b><small>${at(o)}</small></div>`
    : `<div class="${cls}">${what}<b>No change</b><small>within the loaded data</small></div>`;
  $("next").innerHTML = card(sunN, "sunc", "Sunrise above the skyline", "Sunset behind the terrain", "Sunlight") +
    card(earN, "earc", "Earthrise, link opens", "Earthset, link closes", "Earth link");
  const lamp = (id, ok, label) => { $(id).innerHTML = `<i class="lamp ${ok ? "go" : ""}"></i>${ok ? "GO" : "NO-GO"}`; $(id).parentElement.title = label; };
  lamp("pwrChip", x._sv, "Direct sunlight at the selected site");
  lamp("comChip", x._ev, "Earth above the skyline at the selected site");
}

/* ---------- timeline ---------- */
const diskCol = p => p <= 0 ? "#141C30" : p >= 100 ? "#FFC24A" : `rgb(${Math.round(80 + p*1.75)},${Math.round(62 + p*1.32)},${Math.round(40 + p*.34)})`;
function periodLen(){ return S.periodH === "all" ? N() : Math.max(2, Math.min(N(), Math.round(S.periodH/S.stepH))); }
function ensurePeriod(){
  const L = periodLen(), n = N();
  if (S.i < S.p0) S.p0 = Math.max(0, S.i - Math.floor(L*.1));
  if (S.i >= S.p0 + L) S.p0 = S.i - Math.floor(L*.1);
  S.p0 = Math.max(0, Math.min(n - L, S.p0));
  const sl = $("slider"); sl.min = S.p0; sl.max = S.p0 + L - 1;
  $("pRange").textContent = `${fmtT(S.times[S.p0]).slice(0,10)} to ${fmtT(S.times[S.p0 + L - 1]).slice(0,10)}`;
  $("pPrev").disabled = S.p0 <= 0; $("pNext").disabled = S.p0 + L >= n;
}
function renderTimeline(){
  ensurePeriod();
  const cv = $("tl"), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w*dpr; cv.height = h*dpr; const c = cv.getContext("2d"); c.scale(dpr, dpr); c.clearRect(0, 0, w, h);
  const s = site(), L = periodLen(), p0 = S.p0, gut = 70, cw = w - gut, X = k => gut + ((k - p0)/L)*cw;
  c.font = "600 13px 'Inter', sans-serif"; c.textBaseline = "middle";
  c.fillStyle = "#FFC24A"; c.fillText("POWER", 0, 16); c.fillStyle = "#4FB3FF"; c.fillText("COMM", 0, 46);
  // one bar per pixel column: average Sun disk and share of time with an Earth link, so long periods never squeeze to nothing
  const cols = Math.max(1, Math.floor(cw));
  for (let px = 0; px < cols; px++){
    const k0 = p0 + Math.floor(px/cols*L), k1 = Math.max(k0 + 1, p0 + Math.floor((px + 1)/cols*L));
    let sd = 0, ev = 0; for (let k = k0; k < k1; k++){ sd += s.samples[k]._sd; ev += s.samples[k]._ev ? 1 : 0; }
    const m = k1 - k0; c.fillStyle = diskCol(sd/m); c.fillRect(gut + px, 6, 1.2, 20);
    c.fillStyle = ev ? `rgba(79,179,255,${(.25 + .75*ev/m).toFixed(2)})` : "#141C30"; c.fillRect(gut + px, 36, 1.2, 20);
  }
  const [a0, b0] = windowRange(), a = Math.max(a0, p0), b = Math.min(b0, p0 + L);
  if (b > a){ c.fillStyle = "rgba(232,238,247,.09)"; c.fillRect(X(a), 2, X(b) - X(a), 58);
    c.strokeStyle = "rgba(232,238,247,.45)"; c.lineWidth = 1; c.strokeRect(X(a) + .5, 2.5, X(b) - X(a) - 1, 57); }
  // ticks scaled to the period length
  c.fillStyle = "#8F9CB5"; c.font = "12px 'Inter', sans-serif"; c.textBaseline = "alphabetic";
  const days = L*S.stepH/24, t0 = Date.parse(S.times[p0]), tEnd = Date.parse(S.times[p0 + L - 1]);
  const stepD = days <= 10 ? 1 : days <= 40 ? (cw < 520 ? 7 : 3) : days <= 120 ? 14 : 0;
  const ticks = []; const d0 = new Date(t0); d0.setUTCHours(0, 0, 0, 0);
  if (stepD){ for (let t = d0.getTime() + 864e5; t <= tEnd; t += stepD*864e5) ticks.push([t, new Date(t).toISOString().slice(5,10)]); }
  else { const m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); const every = days > 600 ? 3 : 1;
    for (let k = 0; m.getTime() <= tEnd; k++, m.setUTCMonth(m.getUTCMonth() + 1)) if (k % every === 0) ticks.push([m.getTime(), m.toISOString().slice(0,7)]); }
  ticks.forEach(([t, lbl]) => { const xx = gut + (t - t0)/(tEnd - t0 || 1)*cw; c.fillRect(xx, 62, 1, 5); c.fillText(lbl, xx + 3, 80); });
  if (S.i >= p0 && S.i < p0 + L){ const cx = X(S.i); c.shadowColor = "#fff"; c.shadowBlur = 8; c.fillStyle = "#fff"; c.fillRect(cx - 1, 0, 2, 62); c.shadowBlur = 0; }
  $("slider").style.setProperty("--pct", (100*(S.i - p0)/Math.max(1, L - 1)).toFixed(2) + "%");
}

/* ---------- compare cards ---------- */
function ring(pct, color, label){
  const r = 26, C = 2*Math.PI*r, off = C*(1 - pct/100);
  return `<div class="ring"><svg viewBox="0 0 66 66"><circle cx="33" cy="33" r="${r}" fill="none" stroke="#1d2944" stroke-width="6"/>
    <circle cx="33" cy="33" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 33 33)"/>
    <text x="33" y="38" text-anchor="middle" fill="#E8EEF7" font-size="15" font-family="Inter,sans-serif" font-weight="600">${pct.toFixed(0)}%</text></svg>${label}</div>`;
}
function fmtDay(ms){ return new Date(ms).toISOString().slice(0,10); }
function slotIndex(dateStr){ const ms = Date.parse(dateStr + "T00:00:00Z"); if (isNaN(ms)) return 0;
  return Math.max(0, Math.min(N() - winLen(), Math.round((ms - Date.parse(S.times[0]))/(S.stepH*3600e3)))); }
function cardHTML(o, title, sub, attrs, best, bestLabel){
  return `<button class="card" ${attrs}>
    ${best ? `<span class="best">${bestLabel}</span>` : ""}
    <h3>${title}</h3>${sub ? `<div class="when">${sub}</div>` : ""}
    <div class="rings">${ring(o.sun, "#FFC24A", "Sunlit")}${ring(o.dte, "#4FB3FF", "Earth link")}${ring(o.both, "#3DDC97", "Both")}</div>
    <div class="facts"><span>Longest sunlit <b>${o.runSun} h</b></span><span>Longest link <b>${o.runDte} h</b></span></div>
    <div class="facts"><span>Longest with both <b>${o.runBoth} h</b></span></div>
  </button>`;
}
const better = (p, q) => p.both !== q.both ? p.both > q.both : p.runBoth > q.runBoth;
const marginNote = () => (S.mSun || S.mEarth) ? ` Margins: Sun ${S.mSun.toFixed(2)}°, Earth ${S.mEarth.toFixed(2)}°.` : "";
function renderCompare(){
  const dates = S.mode === "dates";
  $("dateTools").hidden = !dates;
  if (!dates){
    const all = S.sites.map(st => stats(st)), top = all.reduce((bi, o, k) => better(o, all[bi]) ? k : bi, 0), [a, b] = windowRange();
    $("cmpRange").textContent = `From ${fmtT(S.times[a])} to ${fmtT(S.times[Math.max(a, b - 1)])}. Best pick has the most time with sunlight and an Earth link together (app-derived).` + marginNote();
    $("cards").innerHTML = S.sites.map((st, k) => cardHTML(all[k], short(st.name), "", `data-k="${k}" aria-pressed="${k === S.sel}"`, k === top && all[k].both > 0, "Best pick")).join("");
    return;
  }
  const st = site(), all = S.slots.map(i => stats(st, i)), top = all.reduce((bi, o, k) => better(o, all[bi]) ? k : bi, 0);
  $("dtSite").textContent = short(st.name);
  document.querySelectorAll(".slot").forEach((inp, k) => { inp.value = fmtDay(S.times[S.slots[k]]);
    inp.min = fmtDay(S.times[0]); inp.max = fmtDay(S.times[Math.max(0, N() - winLen())]); });
  $("cmpRange").textContent = `Same site, different landing dates. Each card covers ${S.days === 1 ? "24 hours" : S.days + " days"} from its start date. Click a card to jump there.` + marginNote();
  $("cards").innerHTML = all.map((o, k) => cardHTML(o, `Date ${"ABC"[k]}`, `${fmtT(S.times[o.a])} to ${fmtT(S.times[Math.max(o.a, o.b - 1)])}`,
    `data-slot="${k}"`, k === top && o.both > 0, "Best date")).join("");
}
function suggestDates(){
  const st = site(), w = winLen(), step = Math.max(1, Math.round(6/S.stepH)), cands = [];
  for (let i = 0; i + w <= N(); i += step) cands.push(stats(st, i));
  cands.sort((p, q) => better(p, q) ? -1 : better(q, p) ? 1 : 0);
  const picks = [];
  for (const c of cands){ if (picks.every(p => Math.abs(p.a - c.a) >= w)) picks.push(c); if (picks.length === 3) break; }
  while (picks.length < 3) picks.push(cands[picks.length] || cands[0]);
  S.slots = picks.map(p => p.a).sort((x, y) => x - y);
  renderCompare();
}

function renderAll(){
  const s = site(), x = s.samples[S.i];
  $("siteName").textContent = s.name;
  $("siteMeta").innerHTML = `${Math.abs(s.lat).toFixed(2)}° S, ${Math.abs(s.lon).toFixed(2)}° ${s.lon < 0 ? "W" : "E"}${s.elevation_m != null ? `, elevation ${s.elevation_m} m` : ""}` +
    (s.terrain === "coarse" ? `<span class="coarse">Coarse terrain${s.terrain_note ? ": " + s.terrain_note : ""}</span>` : "");
  $("clock").textContent = fmtT(x.time_utc); $("statusTime").textContent = fmtT(x.time_utc);
  $("dt").value = x.time_utc.slice(0,16);
  renderScene(); renderMap(); renderTiles(); renderTimeline();
  $("slider").value = S.i;
  // during playback the comparison cards refresh a few times per second instead of every frame
  if (!S.playing || S.frame++ % 4 === 0) renderCompare();
}

/* ---------- interaction ---------- */
function setI(i){ S.i = Math.max(0, Math.min(N() - 1, i)); renderAll(); }  // renderTimeline() moves the period to follow S.i
function setSite(k){ S.sel = k; S.i = Math.min(S.i, N() - 1); renderAll(); }
function togglePlay(){
  const icon = $("playIcon");
  if (S.playing){ cancelAnimationFrame(S.playing); S.playing = null; icon.setAttribute("d","M5 3l12 7-12 7z"); $("play").setAttribute("aria-label","Play"); renderCompare(); return; }
  if (S.i >= N() - 1) S.i = 0;
  icon.setAttribute("d","M4 3h4v14H4zM12 3h4v14h-4z"); $("play").setAttribute("aria-label","Pause");
  let last = 0; S.frame = 0;
  const tick = now => { if (!S.playing) return;
    if (now - last >= 130){ last = now; if (S.i >= N() - 1){ togglePlay(); return; } setI(S.i + 1); }
    S.playing = requestAnimationFrame(tick); };
  S.playing = requestAnimationFrame(tick);
}
function bind(){
  $("slider").addEventListener("input", e => setI(+e.target.value));
  $("back").addEventListener("click", () => setI(S.i - 1));
  $("fwd").addEventListener("click", () => setI(S.i + 1));
  $("play").addEventListener("click", togglePlay);
  $("dt").addEventListener("change", e => { const ms = Date.parse(e.target.value + ":00Z"); if (isNaN(ms)) return;
    setI(Math.round((ms - Date.parse(S.times[0]))/(S.stepH*3600e3))); });
  const pickSite = e => { const t = e.target.closest("[data-k]"); if (t) setSite(+t.dataset.k); };
  $("cards").addEventListener("click", e => {
    const sl = e.target.closest("[data-slot]"); if (sl){ setI(S.slots[+sl.dataset.slot]); return; }
    pickSite(e); });
  document.querySelectorAll(".modes button").forEach(b => b.addEventListener("click", () => {
    S.mode = b.dataset.mode; document.querySelectorAll(".modes button").forEach(o => o.setAttribute("aria-selected", o === b)); renderCompare(); }));
  document.querySelectorAll(".slot").forEach(inp => inp.addEventListener("change", () => { S.slots[+inp.dataset.s] = slotIndex(inp.value); renderCompare(); }));
  $("suggest").addEventListener("click", suggestDates);
  $("period").addEventListener("change", e => { S.periodH = e.target.value === "all" ? "all" : +e.target.value; S.p0 = S.i; renderAll(); });
  $("pPrev").addEventListener("click", () => { const L = periodLen(); S.p0 = Math.max(0, S.p0 - L); S.i = S.p0; renderAll(); });
  $("pNext").addEventListener("click", () => { const L = periodLen(); S.p0 = Math.min(N() - L, S.p0 + L); S.i = S.p0; renderAll(); });
  $("cGo").addEventListener("click", () => addCustom(+$("cLat").value, +$("cLon").value));
  $("cPick").addEventListener("click", () => { M.pick = !M.pick; $("cPick").setAttribute("aria-pressed", M.pick); $("polar").classList.toggle("picking", M.pick);
    if (M.pick) toast("Click the map to choose a location"); });
  const setMargin = () => {
    S.mSun = +$("mSun").value; S.mEarth = +$("mEarth").value;
    $("mSunV").textContent = S.mSun.toFixed(2) + "°"; $("mEarthV").textContent = S.mEarth.toFixed(2) + "°";
    $("mSun").style.setProperty("--pct", (S.mSun/3*100) + "%"); $("mEarth").style.setProperty("--pct", (S.mEarth/3*100) + "%");
    applyMargins(); renderAll(); };
  $("mSun").addEventListener("input", setMargin); $("mEarth").addEventListener("input", setMargin);
  $("mReset").addEventListener("click", () => { $("mSun").value = 0; $("mEarth").value = 0; setMargin(); });
  bindMap();
  document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
    S.days = +b.dataset.days; document.querySelectorAll(".seg button").forEach(o => o.setAttribute("aria-pressed", o === b));
    S.slots = S.slots.map(i => Math.min(i, Math.max(0, N() - winLen()))); renderAll(); }));
  const cv = $("tl"); let drag = false;
  const pick = e => { const r = cv.getBoundingClientRect(), gut = 70, xx = e.clientX - r.left - gut; if (xx < 0) return; setI(S.p0 + Math.floor(xx/(r.width - gut)*periodLen())); };
  cv.addEventListener("pointerdown", e => { drag = true; cv.setPointerCapture(e.pointerId); pick(e); });
  cv.addEventListener("pointermove", e => { if (drag) pick(e); });
  cv.addEventListener("pointerup", () => drag = false);
  window.addEventListener("resize", () => { drawStars(); renderTimeline(); });
  document.addEventListener("keydown", e => { if (e.target.matches("input")) return;
    if (e.key === "ArrowRight") setI(S.i + 1); if (e.key === "ArrowLeft") setI(S.i - 1); if (e.key === " "){ e.preventDefault(); togglePlay(); } });
}


/* ---------- export, share, image ---------- */
function toast(msg){ const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 2400); }
function download(name, text, type){
  const blob = text instanceof Blob ? text : new Blob([text], {type}); const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const csvCell = v => { const t = String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const csvRows = rows => rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
function sampleRows(st){
  return st.samples.map(x => [x.time_utc, st.site_id, st.name, x.sun_el, x.sun_az, x.horizon_sun_el, r2(x.sun_el - x.horizon_sun_el), x._sv ? 1 : 0, x._sd.toFixed(1),
    x.earth_el, x.earth_az, x.horizon_earth_el, r2(x.earth_el - x.horizon_earth_el), x._ev ? 1 : 0, x._bo ? 1 : 0, S.mSun, S.mEarth, st.data_source || ""]);
}
const SAMPLE_HEAD = ["time_utc","site_id","site_name","sun_el_deg","sun_az_deg","terrain_at_sun_deg","sun_clearance_deg","sun_usable","sun_disk_visible_pct",
  "earth_el_deg","earth_az_deg","terrain_at_earth_deg","earth_clearance_deg","earth_link_usable","both_usable","sun_margin_deg","earth_margin_deg","data_source"];
function exportCSV(kind){
  const stamp = S.times[S.i].slice(0,10);
  if (kind === "site"){ download(`lsn_${site().site_id}_${stamp}.csv`, csvRows([SAMPLE_HEAD, ...sampleRows(site())]), "text/csv"); }
  else if (kind === "all"){ download(`lsn_all_sites_${stamp}.csv`, csvRows([SAMPLE_HEAD, ...S.sites.flatMap(sampleRows)]), "text/csv"); }
  else {
    const head = ["mode","label","site_id","window_start_utc","window_end_utc","avg_sun_disk_visible_pct","sunlit_pct","earth_link_pct","both_pct","longest_sunlit_h","longest_link_h","longest_both_h","sun_margin_deg","earth_margin_deg"];
    const row = (mode, label, st, o) => [mode, label, st.site_id, S.times[o.a], S.times[Math.max(o.a, o.b - 1)], o.disk.toFixed(1), o.sun.toFixed(1), o.dte.toFixed(1), o.both.toFixed(1), o.runSun, o.runDte, o.runBoth, S.mSun, S.mEarth];
    const rows = [head, ...S.sites.map(st => row("sites", short(st.name), st, stats(st))),
      ...S.slots.map((i, k) => row("dates", "Date " + "ABC"[k], site(), stats(site(), i)))];
    download(`lsn_comparison_${stamp}.csv`, csvRows(rows), "text/csv");
  }
  toast("CSV downloaded");
}
/* ---------- views: one section at a time, chosen from the bottom dock ----------
   Plain links use "#map"; shared links carry the view plus state, e.g. "#v=map&site=...". */
const VIEWS = ["home", "horizon", "map", "status", "compare", "about"];
const hashParams = () => location.hash.includes("=") ? new URLSearchParams(location.hash.slice(1)) : null;
function viewFromHash(){
  const q = hashParams(); if (q) return VIEWS.includes(q.get("v")) ? q.get("v") : "horizon";
  const v = location.hash.slice(1); return VIEWS.includes(v) ? v : "home";
}
const seenView = {};
function showView(v, focus){
  if (!VIEWS.includes(v)) v = "home";
  const prev = document.body.dataset.view; document.body.dataset.view = v; S.view = v;
  document.querySelectorAll("[data-views]").forEach(el => { el.hidden = !el.dataset.views.split(" ").includes(v); });
  document.querySelectorAll(".dock a").forEach(a => { const on = a.dataset.sec === v; a.classList.toggle("on", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
  if (prev !== v) scrollTo({top:0, behavior:"instant" in document.documentElement.style ? "instant" : "auto"});
  if (SKY.still) requestAnimationFrame(skyFrame);
  if (!S.sites.length) return;
  // sections that were hidden measure 0 px; size them now that they are visible
  requestAnimationFrame(() => {
    if (v === "map" && !seenView.map){ seenView.map = true; M.home = homeView(); M.view = {...M.home}; setView(M.view); }
    renderAll();
    if (focus){ const h = document.querySelector(`[data-views~="${v}"] h2, [data-views~="${v}"] h1`); if (h){ h.setAttribute("tabindex", "-1"); h.focus({preventScroll:true}); } }
  });
}
function viewHash(){
  const q = new URLSearchParams({v:S.view || "horizon", site:site().site_id, t:S.times[S.i], w:S.days, ms:S.mSun, me:S.mEarth, mode:S.mode, d:S.slots.join("-")});
  return "#" + q.toString();
}
async function shareView(){
  const url = location.href.split("#")[0] + viewHash();
  history.replaceState(null, "", viewHash());
  try{ await navigator.clipboard.writeText(url); toast("Link to this view copied"); }
  catch(e){ window.prompt("Copy this link:", url); }
}
function readHash(){
  const q = hashParams(); if (!q) return;
  const k = S.sites.findIndex(st => st.site_id === q.get("site")); if (k >= 0) S.sel = k;
  if (q.get("t")){ const i = S.times.indexOf(q.get("t")); if (i >= 0) S.i = i; }
  if ([1,7,30].includes(+q.get("w"))) S.days = +q.get("w");
  const ms = +q.get("ms"), me = +q.get("me");
  if (ms >= 0 && ms <= 3) S.mSun = ms; if (me >= 0 && me <= 3) S.mEarth = me;
  if (q.get("mode") === "dates") S.mode = "dates";
  if (q.get("d")){ const d = q.get("d").split("-").map(Number); if (d.length === 3 && d.every(v => v >= 0 && v < S.times.length)) S.slots = d; }
  $("mSun").value = S.mSun; $("mEarth").value = S.mEarth;
  document.querySelectorAll(".seg button").forEach(o => o.setAttribute("aria-pressed", +o.dataset.days === S.days));
  document.querySelectorAll(".modes button").forEach(o => o.setAttribute("aria-selected", o.dataset.mode === S.mode));
}
function saveImage(){
  const src = $("scene"), clone = src.cloneNode(true), W2 = 2000, H2 = 860;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); clone.setAttribute("width", W2); clone.setAttribute("height", H2);
  const globeDefs = document.querySelector('svg[aria-hidden="true"] > defs');
  const defs = clone.querySelector("defs"); if (globeDefs && defs) defs.insertAdjacentHTML("beforeend", globeDefs.innerHTML);
  const s0 = site(), x0 = s0.samples[S.i];
  clone.insertAdjacentHTML("beforeend", `<text x="16" y="34" fill="#E8EEF7" font-size="24" font-weight="600" font-family="Inter,sans-serif">${s0.name}</text>
    <text x="16" y="56" fill="#8F9CB5" font-size="14" font-family="Inter,sans-serif">${fmtT(x0.time_utc)}${(S.mSun || S.mEarth) ? `, margins Sun ${S.mSun}° Earth ${S.mEarth}°` : ""}${/mock/i.test(s0.data_source || "") ? ", DEMO DATA, NOT NASA DATA" : ""}</text>`);
  const xml = new XMLSerializer().serializeToString(clone), img = new Image();
  img.onload = () => { const c = document.createElement("canvas"); c.width = W2; c.height = H2; const g = c.getContext("2d");
    g.fillStyle = "#03050B"; g.fillRect(0, 0, W2, H2); g.drawImage(img, 0, 0, W2, H2);
    c.toBlob(b => { download(`lsn_horizon_${s0.site_id}_${x0.time_utc.slice(0,13)}.png`, b); toast("Image saved"); }, "image/png"); };
  img.onerror = () => toast("Could not create the image in this browser");
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
}

/* ---------- guided tour ---------- */
const TOUR = [
  {t:"Welcome to the navigator", x:"This tool helps mission planners, teachers and anyone curious decide where and when to land near the lunar south pole. It answers two questions: will a lander get sunlight for power, and can it talk directly to Earth?"},
  {v:"horizon", el:"#horizon", t:"The 360° horizon view", x:"You are standing at the landing site looking all the way around. Grey shapes are crater walls and ridges. The Sun and Earth sit only a few degrees above the horizon here, so terrain can hide them. A dashed outline means hidden."},
  {v:"horizon", el:"#timebar", t:"Move through time", x:"Press play or drag the slider. Pick a period such as one lunar day. The coloured bars show that stretch: gold means sunlight for power, blue means a direct Earth link. Click the bars to jump, and use the arrows to move to the next period."},
  {v:"horizon", el:".margins", t:"Planning margins", x:"Real hardware needs the Sun or Earth a little higher than the skyline. Raise a margin and every result updates, including dashed limit lines in the horizon view."},
  {v:"map", el:"#mapStage", t:"Where the sites are", x:"A south polar map of the candidate sites. Rings show how much sunlight each site gets, dot colours show what is available right now, and lines point toward the Sun and Earth. Drag and zoom to explore, or type any coordinates under Custom location to analyse your own spot."},
  {v:"status", el:"#status", t:"GO or NO-GO", x:"Mission-control style status for the selected moment: Sun and Earth elevation, power potential, link status and when each will change next."},
  {v:"compare", el:"#compare", t:"Compare sites and dates", x:"Compare all sites over 24 hours, 7 days or 30 days, or switch to Compare dates and let Suggest best dates find the strongest landing windows."},
  {el:"#dock", t:"Move between sections", x:"This bar stays at the bottom of the screen. Tap Horizon, Map, Status, Compare or About the data to open each part on its own, or the house icon to go back to the start."},
  {el:"#tools", t:"Take it with you", x:"Share view copies a link to exactly what you see, Save image downloads the horizon view, and Export CSV gives the numbers for your own analysis. Press Guide any time to see this tour again."}
];
const T = {i:0, on:false};
const TOUR_KEY = "lsn_tour_seen";
function tourOpen(){ T.on = true; T.i = 0; $("tour").hidden = false; tourShow(); $("tourNext").focus(); }
function tourClose(){ T.on = false; $("tour").hidden = true; try{ localStorage.setItem(TOUR_KEY, "1"); }catch(e){} $("tourBtn").focus(); }
function tourPlace(){
  if (!T.on) return;
  const st = TOUR[T.i], spot = $("tourSpot"), card = $("tourCard"), vw = innerWidth, vh = innerHeight;
  if (!st.el){ spot.classList.add("center"); card.style.left = Math.max(12, (vw - card.offsetWidth)/2) + "px"; card.style.top = Math.max(12, vh*.32) + "px"; return; }
  spot.classList.remove("center");
  const r = document.querySelector(st.el).getBoundingClientRect(), pad = 8;
  const top = Math.max(6, r.top - pad), bottom = Math.min(vh - 6, r.bottom + pad);
  Object.assign(spot.style, {left:(r.left - pad) + "px", top:top + "px", width:(r.width + pad*2) + "px", height:Math.max(40, bottom - top) + "px"});
  const ch = card.offsetHeight, cw = card.offsetWidth;
  let y = bottom + 14; if (y + ch > vh - 10) y = top - ch - 14; if (y < 10) y = Math.max(10, vh - ch - 12);
  const xx = Math.min(vw - cw - 12, Math.max(12, r.left + r.width/2 - cw/2));
  card.style.left = xx + "px"; card.style.top = y + "px";
}
function tourShow(){
  const st = TOUR[T.i];
  // each step opens the section it talks about
  if (st.v && S.view !== st.v){ history.replaceState(null, "", "#" + st.v); showView(st.v); return setTimeout(tourShow, 90); }
  $("tourStep").textContent = `Step ${T.i + 1} of ${TOUR.length}`; $("tourTitle").textContent = st.t; $("tourText").textContent = st.x;
  $("tourDots").innerHTML = TOUR.map((_, k) => `<i class="${k === T.i ? "on" : ""}"></i>`).join("");
  $("tourBack").disabled = T.i === 0; $("tourNext").textContent = T.i === TOUR.length - 1 ? "Finish" : "Next";
  if (st.el){ const el = document.querySelector(st.el), r = el.getBoundingClientRect();
    const fits = r.top >= 70 && r.bottom <= innerHeight - 10;
    if (!fits) el.scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: r.height > innerHeight*.7 ? "start" : "center"});
    setTimeout(tourPlace, fits ? 0 : 420);
  } else tourPlace();
}
function bindExtras(){
  $("tourBtn").addEventListener("click", tourOpen);
  $("heroTour").addEventListener("click", tourOpen);
  $("tourSkip").addEventListener("click", tourClose);
  $("tourNext").addEventListener("click", () => { if (T.i >= TOUR.length - 1) return tourClose(); T.i++; tourShow(); });
  $("tourBack").addEventListener("click", () => { if (T.i > 0){ T.i--; tourShow(); } });
  document.addEventListener("keydown", e => {
    if (T.on){ if (e.key === "Escape") tourClose(); if (e.key === "ArrowRight" && T.i < TOUR.length - 1){ T.i++; tourShow(); } if (e.key === "ArrowLeft" && T.i > 0){ T.i--; tourShow(); }
      e.stopImmediatePropagation(); return; }
    if (e.key === "?" && !e.target.matches("input")) tourOpen();
  }, true);
  addEventListener("resize", tourPlace); addEventListener("scroll", () => { if (T.on) tourPlace(); }, {passive:true});
  $("shareBtn").addEventListener("click", shareView);
  $("imgBtn").addEventListener("click", saveImage);
  const menu = $("csvMenu"), btn = $("csvBtn");
  const closeMenu = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); if (!menu.hidden) menu.querySelector("button").focus(); });
  menu.addEventListener("click", e => { const b = e.target.closest("[data-csv]"); if (b){ exportCSV(b.dataset.csv); closeMenu(); } });
  document.addEventListener("click", e => { if (!e.target.closest(".menu-wrap")) closeMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  addEventListener("hashchange", () => showView(viewFromHash(), true));
  if (new URLSearchParams(location.search).get("tour") === "1") setTimeout(tourOpen, 600);
}

function computeScale(){
  let top = 8, mm = 0, mn = 0;
  S.sites.forEach(st => { for (const x of st.samples){ if (x.sun_el + 1.5 > top) top = x.sun_el + 1.5; if (x.earth_el + 1.5 > top) top = x.earth_el + 1.5; }
    if (st.horizon_mask){ mm = Math.max(mm, ...st.horizon_mask.elevation_deg); mn = Math.min(mn, ...st.horizon_mask.elevation_deg); } });
  // the bottom of the view follows the lowest horizon so negative rim horizons are never clipped
  S.top = Math.ceil(Math.max(top, mm + 2)); S.bot = Math.min(-1.5, Math.floor(mn - 0.5)); S.maskMax = mm;
}
(async function init(){
  skyStart();
  showView(viewFromHash());
  let data;
  try{ data = await loadData(); }
  catch(e){
    // no built-in fallback data: show the problem instead of inventing numbers
    console.error(e);
    $("srcText").textContent = "Not loaded";
    $("srcNote").textContent = "Could not load the data files in docs/data/ (" + e.message + "). Open the page through a web server or GitHub Pages, not as a local file.";
    $("aboutStatus").textContent = $("srcNote").textContent; showView("about");
    return;
  }
  const {sites, region, basemap} = data;
  S.eph = data.eph; S.grid = data.grid || null; S.demo = /mock/i.test((data.eph && data.eph.source) || "");
  if (!S.eph){ $("cNote").textContent = "Custom locations need ephemeris.json in the data folder."; $("cGo").disabled = true; $("cPick").disabled = true; }
  else if (!S.grid && !S.demo) $("cNote").textContent = "No horizon_grid.json loaded, so custom points assume a flat horizon.";
  if (region) $("regionLabel").textContent = region + " candidate landing sites";
  if (basemap && basemap.image){ S.basemap = basemap;
    $("mapNote").textContent = "Basemap: " + (basemap.credit || "LOLA shaded relief (NASA PGDA)") + ". Site positions come from the team's Terrain data.";
    $("basemapCredit").textContent = "Map imagery: " + (basemap.credit || "LOLA shaded relief and permanent-shadow outlines, NASA PGDA") + "."; }
  S.sites = sites; S.times = sites[0].samples.map(x => x.time_utc);
  if (S.times.length > 1) S.stepH = (Date.parse(S.times[1]) - Date.parse(S.times[0]))/3600e3;
  $("back").textContent = `−${S.stepH} h`; $("fwd").textContent = `+${S.stepH} h`;
  const mock = sites.some(s => isMock(s.data_source));
  $("srcText").textContent = mock ? "DEMO, not NASA" : "Team pipeline";
  $("srcChip").classList.toggle("demo", mock); $("srcChip").classList.toggle("real", !mock);
  $("srcNote").textContent = mock
    ? "MOCK DATA: the files in docs/data/ are synthetic placeholders, not NASA data. They imitate south-pole behaviour and will be replaced with JPL Horizons and LOLA results."
    : `Data source: ${sites.map(s => s.data_source).filter((v, i, a) => a.indexOf(v) === i).join("; ")}.`;
  const ephMock = S.eph ? isMock(S.eph.source) : mock;
  $("mapEph").textContent = ephMock ? "The ephemeris is still MOCK until the real file lands." : "Sun and Earth positions: JPL Horizons ephemeris.";
  $("ephFoot").textContent = ephMock ? "Ephemeris: still MOCK until the real JPL Horizons file lands." : "Ephemeris: JPL Horizons (NASA/JPL Solar System Dynamics Group).";
  $("aboutStatus").textContent = $("srcNote").textContent;
  $("aboutStatus").classList.toggle("mock", mock);
  // the shadowed-area layer needs psr_image from the Terrain data; hide the toggle until it exists
  if (!(basemap && basemap.psr_image)) document.querySelector('[data-layer="psr"]').hidden = true;
  $("dt").min = S.times[0].slice(0,16); $("dt").max = S.times[S.times.length - 1].slice(0,16);
  computeScale();
  document.querySelector(".scene").classList.add("intro");
  setTimeout(() => document.querySelector(".scene").classList.remove("intro"), 1800);
  const perDay = 24/S.stepH; S.slots = [0, Math.round(14*perDay), Math.round(28*perDay)].map(i => Math.min(i, Math.max(0, S.times.length - winLen())));
  readHash(); applyMargins();
  if (!hashParams()){ const firstBoth = S.sites[0].samples.findIndex(x => x._bo); S.i = firstBoth > 0 ? firstBoth : 0; }
  S.p0 = Math.max(0, S.i - Math.round(periodLen()*.1));
  $("mSunV").textContent = S.mSun.toFixed(2) + "°"; $("mEarthV").textContent = S.mEarth.toFixed(2) + "°";
  $("mSun").style.setProperty("--pct", (S.mSun/3*100) + "%"); $("mEarth").style.setProperty("--pct", (S.mEarth/3*100) + "%");
  bind(); bindExtras(); renderAll();
  showView(viewFromHash());
  const sc = document.querySelector(".scene-scroll"); sc.scrollLeft = (sc.scrollWidth - sc.clientWidth)/2;
})();
