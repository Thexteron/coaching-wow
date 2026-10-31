// Coaching WoW — extraction Warcraft Logs pour les vues Pulls, Morts et kicks, Courbe face aux tops et Tank.
// À exécuter dans un onglet www.warcraftlogs.com (javascript_tool). Ne fait que des lectures (fetch GET).
// Utilisation : CWX.run(spec) ; puis CWX.status() jusqu'à state "done" ; puis CWX.part('pulls') etc.
window.CWX = (() => {
  'use strict';
  const VERSION = '2.0';
  const LOW = 35, HIGH = 45; // passage sous 35 % de vie, sorti au-dessus de 45 %

  // Défensifs majeurs par spé (spec Warcraft Logs) : guid -> [nom français, recharge en s, durée en s].
  // Recharges de base (sans talent de réduction) : « prêt » veut dire « relancé depuis plus longtemps que sa recharge ».
  const DEF = {
    'Rogue-Assassination': {1966: ['Feinte', 15, 6], 31224: ["Cape d'ombre", 120, 5], 5277: ['Évasion', 120, 10], 185311: ['Fiole cramoisie', 30, 4]},
    'Warrior-Arms': {118038: ["Par le fil de l'épée", 120, 8], 23920: ['Renvoi de sort', 25, 5], 97462: ['Cri de ralliement', 180, 10], 202168: ['Victoire imminente', 25, 0]},
    'Paladin-Retribution': {642: ['Bouclier divin', 300, 8], 184662: ['Bouclier du vengeur', 90, 10], 403876: ['Protection divine', 60, 8], 633: ['Imposition des mains', 600, 0]},
    'Druid-Guardian': {22812: ['Écorce', 60, 8], 61336: ['Instincts de survie', 180, 6], 22842: ['Régénération frénétique', 36, 3], 200851: ['Rage du dormeur', 90, 8]},
    'Shaman-Restoration': {108271: ['Transfert astral', 120, 12], 198103: ['Élémentaire de terre', 300, 0]},
  };
  // Gros CD suivis pull par pull : guid -> [nom, type] ; type 'h' = CD de soin, 'd' = défensif (posé sur un sort ennemi),
  // 'o' = CD offensif (posé sur une cible).
  const CDS = {
    'Shaman-Restoration': {108280: ['Totem de marée de soins', 'h'], 98008: ["Totem de lien d'esprit", 'h'], 114052: ['Ascendance', 'h'], 378081: ['Rapidité de la nature', 'h'], 108271: ['Transfert astral', 'd']},
    'Rogue-Assassination': {360194: ['Marque létale', 'o'], 31224: ["Cape d'ombre", 'd'], 5277: ['Évasion', 'd']},
    'Paladin-Retribution': {31884: ['Courroux vengeur', 'o'], 375576: ['Glas divin', 'o'], 343527: ['Condamnation à mort', 'o'], 642: ['Bouclier divin', 'd'], 403876: ['Protection divine', 'd'], 184662: ['Bouclier du vengeur', 'd']},
    'Warrior-Arms': {107574: ['Avatar', 'o'], 227847: ['Tempête de lames', 'o'], 118038: ["Par le fil de l'épée", 'd'], 97462: ['Cri de ralliement', 'd'], 23920: ['Renvoi de sort', 'd']},
    'Druid-Guardian': {102558: ["Incarnation : Gardien d'Ursoc", 'o'], 204066: ['Rayon lunaire', 'o'], 61336: ['Instincts de survie', 'd'], 22812: ['Écorce', 'd'], 200851: ['Rage du dormeur', 'd']},
  };
  // Mitigation active des tanks (buff sur le tank).
  const AM = {'Druid-Guardian': 192081, 'Warrior-Protection': 132404, 'Paladin-Protection': 132403, 'DemonHunter-Vengeance': 203819, 'DeathKnight-Blood': 195181, 'Monk-Brewmaster': 215479};

  // ---------- réseau ----------
  const cache = new Map();
  let active = 0; const queue = [];
  const pump = () => { while (active < 4 && queue.length) { const job = queue.shift(); active++; job().finally(() => { active--; pump(); }); } };
  const limited = (fn) => new Promise((res, rej) => { queue.push(() => fn().then(res, rej)); pump(); });
  const text = (u) => {
    if (!cache.has(u)) {
      const p = limited(async () => {
        for (let a = 0; a < 3; a++) {
          const r = await fetch(u, {credentials: 'same-origin'});
          if (r.ok) return r.text();
          if (r.status === 429 || r.status >= 500) { await new Promise((z) => setTimeout(z, 1500 * (a + 1))); continue; }
          throw new Error('HTTP ' + r.status + ' ' + u);
        }
        throw new Error('HTTP répété ' + u);
      });
      cache.set(u, p);
      p.catch(() => cache.delete(u));
    }
    return cache.get(u);
  };
  const json = async (u) => { const t = await text(u); if (/Human Verification/i.test(t.slice(0, 2000))) throw new Error('VERIFICATION_HUMAINE'); return JSON.parse(t); };
  const W = (code, f, s, e) => `${code}/${f}/${s}/${e}`;
  const U = {
    fp: (code) => `/reports/fights-and-participants/${code}/0?lang=fr&`,
    graph: (kind, code, f, s, e) => `/reports/graph/${kind}/${W(code, f, s, e)}/source/0/0/0/0/0/0/-1.0.-1.-1/0/Any/Any/0/0?lang=fr&`,
    ints: (code, f, s, e) => `/reports/interrupts/${W(code, f, s, e)}/0/0/Any/0/0/Any/0/0/-1.0.-1.-1/0?lang=fr&`,
    auras: (code, f, s, e, id) => `/reports/auras/${W(code, f, s, e)}/buffs/0/${id}/0/0/0/source/0/-1.0.-1.-1/0/Any/Any/0?lang=fr&`,
    hp: (code, f, s, e, id) => `/reports/resources-graph/${W(code, f, s, e)}/1000/0/${id}/0/-1.0.-1.-1/0/Any?lang=fr&`,
    deaths: (code, f, s, e) => `/reports/deaths/${W(code, f, s, e)}/0/0/0/-1.0.-1.-1/0/Any/0/${s}?lang=fr&`,
    death: (code, f, s, e, i) => `/reports/deaths-events/${W(code, f, s, e)}/0/0/0/-1.0.-1.-1/0/Any/0/${i}?lang=fr&`,
    gab: (code, f, s, e) => `/reports/graph/damage-taken/${W(code, f, s, e)}/ability/0/0/0/0/0/0/-1.0.-1.-1/0/Any/Any/0/0?lang=fr&`,
    gcasts: (code, f, s, e, id) => `/reports/graph/casts/${W(code, f, s, e)}/ability/0/${id}/0/0/0/0/-1.0.-1.-1/0/Any/Any/${id}/0?lang=fr&`,
    gtg: (code, f, s, e, id) => `/reports/graph/damage-done/${W(code, f, s, e)}/target/0/${id}/0/0/0/0/-1.0.-1.-1/0/Any/Any/0/0?lang=fr&`,
  };

  // ---------- outils ----------
  const q = (arr, p) => { const v = arr.filter((x) => x !== null && x !== undefined && isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  const med = (a) => q(a, 0.5);
  const r0 = (v) => (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v);
  const r1 = (v) => (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v * 10) / 10;
  const kilo = (v) => (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v / 1000);
  const fmtK = (v) => v >= 1e6 ? (Math.round(v / 1e5) / 10).toString().replace('.', ',') + ' M' : Math.round(v / 1000) + ' k';
  const mmss = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const sOf = (txt) => { const m = String(txt).trim().match(/^(\d+):(\d{2})(?:\.(\d+))?$/); return m ? +m[1] * 60 + +m[2] : null; };
  const icoName = (src) => src ? String(src).split('/').pop().split('?')[0] : null;
  const baseName = (n) => String(n || '').replace(/\s+/g, ' ').trim().replace(/\s+\d+$/, '');

  // ---------- combat ----------
  const fight = async (code, fid) => {
    const fp = await json(U.fp(code));
    const f = (fp.fights || []).find((x) => x.id === +fid);
    if (!f) throw new Error('combat ' + fid + ' introuvable dans ' + code);
    const byGuid = new Map((fp.enemies || []).map((e) => [e.guid, e]));
    const byId = new Map((fp.enemies || []).map((e) => [e.id, e]));
    const counts = f.npcCountMap || {};
    const req = f.countRequired || 0;
    const pulls = (f.dungeonPulls || []).map((p, i) => {
      const mobs = {}; let forces = 0, n = 0;
      for (const e of p.enemies || []) {
        const g = e[0], c = Math.max(1, (e[3] || 1) - (e[2] || 1) + 1), info = byGuid.get(g);
        if (info && info.type === 'Boss') continue;
        mobs[g] = (mobs[g] || 0) + c; n += c; forces += (+counts[g] || 0) * c;
      }
      const cx = (p.minX !== undefined && p.maxX !== undefined) ? (p.minX + p.maxX) / 2 : p.x;
      const cy = (p.minY !== undefined && p.maxY !== undefined) ? (p.minY + p.maxY) / 2 : p.y;
      return {n: i + 1, boss: p.boss || 0, kill: !!p.kill, name: p.name, s: p.start_time, e: p.end_time, cx, cy, map: (p.maps || [])[0] || null, mobs, mobN: n, forces: req ? forces / req * 100 : null};
    });
    let last = 0;
    for (const p of pulls) { p.seg = p.boss ? 'B' + p.boss : 'T' + last; if (p.boss && p.kill) last = p.boss; }
    const maps = ((f.dungeonReplay && f.dungeonReplay.maps) || []).map((m) => ({id: m.mapID, name: m.name, x0: m.mapMinX, x1: m.mapMaxX, y0: m.mapMinY, y1: m.mapMaxY}));
    return {code, fid: +fid, fp, f, byGuid, byId, pulls, start: f.start_time, end: f.end_time, maps};
  };
  const graph = (kind, F) => json(U.graph(kind, F.code, F.fid, F.start, F.end));
  const seriesOf = (g, id) => ((g && g.series) || []).find((s) => s.id === +id) || null;
  const integ = (s, a, b) => {
    if (!s || !s.data || b <= a) return 0;
    const ps = s.pointStart, iv = s.pointInterval;
    let sum = 0;
    const k0 = Math.max(0, Math.floor((a - ps) / iv)), k1 = Math.min(s.data.length - 1, Math.floor((b - ps) / iv));
    for (let k = k0; k <= k1; k++) { const lo = ps + k * iv, hi = lo + iv, ov = Math.min(b, hi) - Math.max(a, lo); if (ov > 0) sum += (+s.data[k] || 0) * ov / 1000; }
    return sum;
  };
  const bandsOf = (html, F, guid) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const a = doc.querySelector('a#ability-' + guid + '-0') || doc.querySelector('a[id^="ability-' + guid + '-"]');
    if (!a) return [];
    const tr = a.closest('tr');
    const D = F.end - F.start;
    return [...tr.querySelectorAll('.bar-piece')].map((p) => { const l = parseFloat(p.style.left) || 0, w = parseFloat(p.style.width) || 0; return [F.start + l / 100 * D, F.start + (l + w) / 100 * D]; });
  };
  const covered = (bands, a, b) => { let c = 0; for (const [x, y] of bands) { const ov = Math.min(b, y) - Math.max(a, x); if (ov > 0) c += ov; } return c; };
  // Lancers des gros CD d'un joueur (graphe des casts : horodatages exacts).
  const castsOf = (gc, table) => {
    const out = [];
    for (const sr of ((gc && gc.series) || [])) {
      const def = table[sr.guid];
      if (!def) continue;
      for (const pt of sr.data || []) out.push({id: sr.guid, name: def[0], kind: def[1], t: Array.isArray(pt) ? pt[0] : pt});
    }
    return out.sort((a, b) => a.t - b.t);
  };
  const realSeries = (g) => ((g && g.series) || []).filter((sr) => sr.name !== 'Total' && sr.guid !== null && sr.guid !== undefined && sr.data && sr.data.length);
  // Sort ennemi qui fait le plus de dégâts au groupe de 2 s avant à 8 s après t ; cible la plus tapée dans les 10 s qui suivent t.
  const dominant = (g, a, b) => { let best = null, bv = 0; for (const sr of realSeries(g)) { const v = integ(sr, a, b); if (v > bv) { bv = v; best = sr.name; } } return best; };
  const onOf = (c, gab, gtg) => c.kind === 'o' ? dominant(gtg, c.t, c.t + 10000) : dominant(gab, c.t - 2000, c.t + 8000);
  const mode = (arr) => { const m = {}; let best = null; for (const x of arr) { if (!x) continue; m[x] = (m[x] || 0) + 1; if (!best || m[x] > m[best]) best = x; } return best; };
  const dips = (pts) => {
    const out = []; let cur = null;
    for (const [ts, hp] of pts) {
      if (cur === null && hp < LOW) cur = {s: ts, min: hp};
      else if (cur) { cur.min = Math.min(cur.min, hp); if (hp >= HIGH) { cur.e = ts; out.push(cur); cur = null; } }
    }
    if (cur) { cur.e = pts.length ? pts[pts.length - 1][0] : cur.s; out.push(cur); }
    return out;
  };

  // ---------- interruptions ----------
  const parseInts = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    for (const b of doc.querySelectorAll('.dialog-block')) {
      const a = b.querySelector('a[onclick^="return setAbilityFilter"]');
      if (!a) continue;
      const id = +((a.getAttribute('onclick').match(/setAbilityFilter\((\d+)/) || [])[1]);
      const img = b.querySelector('.dialog-title img');
      const txt = b.textContent.replace(/\s+/g, ' ');
      const st = txt.match(/Stopped:\s*[\d.]+%\s*\((\d+)\)/), mi = txt.match(/Missed:\s*[\d.]+%\s*\((\d+)\)/);
      const by = {}; let bySum = 0;
      const main = b.querySelector('table[id^="main-table-0-' + id + '"]');
      if (main) for (const tr of main.querySelectorAll(':scope > tbody > tr')) {
        const tds = tr.querySelectorAll(':scope > td');
        if (tds.length < 2) continue;
        const nm = tds[0].textContent.trim().replace(/\s+/g, ' '), c = parseInt(tds[1].textContent.replace(/\D/g, ''), 10) || 0;
        if (nm && c) { by[nm] = (by[nm] || 0) + c; bySum += c; }
      }
      const missed = [];
      const mt = b.querySelector('table.missed-casts-table');
      if (mt) for (const tr of mt.querySelectorAll(':scope > tbody > tr')) {
        const tds = tr.querySelectorAll(':scope > td');
        if (tds.length >= 3) missed.push({caster: baseName(tds[0].textContent), t: sOf(tds[2].textContent)});
      }
      const casters = {};
      for (const m of missed) casters[m.caster] = (casters[m.caster] || 0) + 1;
      for (const tr of b.querySelectorAll('table[id^="popup-table-actor-"] tbody tr')) { const td = tr.querySelector('td'); const nm = td && baseName(td.textContent); if (nm) casters[nm] = (casters[nm] || 0) + 1; }
      const caster = Object.entries(casters).sort((x, y) => y[1] - x[1])[0];
      const stopped = st ? +st[1] : bySum, nMissed = mi ? +mi[1] : missed.length;
      out.push({id, spell: a.textContent.trim(), icon_name: icoName(img && img.getAttribute('src')), caster: caster ? caster[0] : null, stopped, missed: nMissed, casts: stopped + nMissed, by, missedAt: missed.map((m) => m.t).filter((t) => t !== null)});
    }
    return out;
  };

  // ---------- morts ----------
  const parseDeathsTable = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('tr[onclick*="setFilterDeath"]')].map((tr) => {
      const i = +((tr.getAttribute('onclick').match(/setFilterDeath\((\d+)/) || [])[1]);
      const tds = tr.querySelectorAll(':scope > td');
      const who = (tr.querySelector('.main-table-link') || {}).textContent;
      return {i, t: sOf(tds[0] && tds[0].textContent), who: who ? who.trim() : null, over: tds[3] ? tds[3].textContent.trim().replace(/\s+/g, ' ') : null};
    });
  };
  const deathDetail = async (F, d, specKey, pid) => {
    const j = await json(U.death(F.code, F.fid, F.start, F.end, d.i));
    const evs = j.events || [];
    const de = evs.find((x) => x.type === 'death') || evs[0];
    if (!de) return null;
    const T = de.timestamp;
    const mine = evs.filter((x) => x.type !== 'death' && x.targetID === +pid);
    const hp = mine.filter((x) => x.maxHitPoints && x.hitPoints !== undefined && (T - x.timestamp) <= 10000)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((x) => [Math.round((x.timestamp - T) / 10) / 100, Math.round(x.hitPoints / x.maxHitPoints * 100)]);
    if (hp.length && hp[hp.length - 1][0] < 0) hp.push([0, 0]);
    const maxHp = (mine.find((x) => x.maxHitPoints) || {}).maxHitPoints || null;
    const recent = mine.filter((x) => (T - x.timestamp) <= 5000);
    const hitsAll = recent.filter((x) => x.type === 'damage' && x.amount > 0);
    const src = (x) => { const e = F.byId.get(x.sourceID); return e ? e.name : null; };
    const hits = hitsAll.slice().sort((a, b) => b.amount - a.amount).slice(0, 4).sort((a, b) => b.timestamp - a.timestamp)
      .map((x) => ({spell: x.ability ? x.ability.name : '?', id: x.ability ? x.ability.guid : null, icon_name: x.ability ? x.ability.abilityIcon : null, amount: x.amount + (x.absorbed || 0), t: Math.round((x.timestamp - T) / 100) / 10, src: src(x)}));
    const heals = recent.filter((x) => x.type === 'heal').reduce((s, x) => s + (x.amount || 0), 0);
    const kb = de.killingAbility || (hitsAll[0] && hitsAll[0].ability) || null;
    const table = DEF[specKey] || {};
    const seen = new Set();
    const cds = (j.cooldowns || []).filter((c) => table[c.guid]).map((c) => {
      seen.add(c.guid);
      const ago = (c.total || 0) / 1000, cd = table[c.guid][1], dur = table[c.guid][2];
      const status = (dur && ago <= dur) ? 'actif' : (ago > cd ? 'pret' : 'recharge');
      return {name: table[c.guid][0], id: c.guid, icon_name: c.abilityIcon || null, status, ago: Math.round(ago)};
    });
    for (const [g, v] of Object.entries(table)) if (!seen.has(+g)) cds.push({name: v[0], id: +g, icon_name: null, status: 'jamais', ago: null});
    // durée depuis le dernier moment à 90 % ou plus
    let since = null;
    for (let k = hp.length - 1; k >= 0; k--) { if (hp[k][1] >= 90) { since = -hp[k][0]; break; } }
    const killHit = hitsAll.slice().sort((a, b) => b.timestamp - a.timestamp)[0];
    const oneShot = since !== null && since <= 1.5 && killHit && maxHp && (killHit.amount + (killHit.absorbed || 0)) >= 0.5 * maxHp;
    const ready = cds.filter((c) => c.status === 'pret').map((c) => c.name);
    const used = cds.filter((c) => c.status === 'actif').map((c) => c.name);
    const kbName = kb ? kb.name : 'cause inconnue';
    const cool = cds.filter((c) => c.status === 'recharge').map((c) => c.name);
    const pl = (a, one, many) => a.length > 1 ? many : one;
    let verdict;
    if (oneShot) {
      const amt = killHit.amount + (killHit.absorbed || 0), pct = Math.round(amt / maxHp * 100);
      verdict = `Mort en un seul coup : ${kbName} (${fmtK(amt)}, ${pct} % de ta vie).`;
      if (ready.length) verdict += ` ${ready.join(' et ')} ${pl(ready, 'était prêt', 'étaient prêts')}, pas ${pl(ready, 'utilisé', 'utilisés')}.`;
      else if (used.length) verdict += ` ${used.join(' et ')} ${pl(used, 'était actif', 'étaient actifs')}.`;
      else if (cool.length) verdict += ` ${cool.join(' et ')} ${pl(cool, 'était en recharge', 'étaient en recharge')}.`;
      verdict += pct >= 100 ? ' Ce coup tue sans défensif : il faut l’éviter ou le prendre sous défensif.' : ' Un défensif ou un soin juste avant suffisait.';
    } else {
      const span = since !== null ? since : (hp[0] ? -hp[0][0] : null);
      verdict = `De ${since !== null ? '90 %' : (hp[0] ? hp[0][1] + ' %' : '?')} à 0 en ${span !== null ? String(Math.round(span * 10) / 10).replace('.', ',') : '?'} s, surtout ${hits[0] ? hits[0].spell : kbName}. Soins reçus sur les 5 dernières secondes : ${heals ? fmtK(heals) : 'aucun'}.`;
      if (ready.length) verdict += ` ${ready.join(' et ')} ${pl(ready, 'était prêt', 'étaient prêts')}, pas ${pl(ready, 'utilisé', 'utilisés')}.`;
      else if (used.length) verdict += ` ${used.join(' et ')} ${pl(used, 'était actif', 'étaient actifs')}.`;
    }
    return {t: Math.round((T - F.start) / 1000), killer: kbName, killer_id: kb ? kb.guid : null, icon_name: kb ? kb.abilityIcon : null, one_shot: !!oneShot, since: since === null ? null : Math.round(since * 10) / 10, max_hp: maxHp, hp, hits, heals: Math.round(heals), cds, verdict};
  };

  // ---------- appariement des pulls d'un top avec les nôtres ----------
  const contain = (a, b) => { let mn = 0, tot = 0; for (const k of Object.keys(a)) { const x = Math.min(10, a[k]); tot += x; mn += Math.min(x, Math.min(10, b[k] || 0)); } return tot ? mn / tot : 0; };
  const dist = (p, o) => (p.map && o.map && p.map !== o.map) ? 1e9 : Math.hypot(p.cx - o.cx, p.cy - o.cy);
  // Chaque pull d'un top est réparti entre nos pulls au prorata des monstres en commun (proches dans l'espace) :
  // renvoie pour chaque pull du top une liste [[indexDeNotrePull, poids], …] (vide = pack que nous n'avons pas fait).
  const overlap = (a, b) => { let mn = 0; for (const k of Object.keys(a)) mn += Math.min(Math.min(10, a[k]), Math.min(10, b[k] || 0)); return mn; };
  const assign = (us, top) => top.pulls.map((tp) => {
    if (tp.boss) { const c = us.pulls.filter((p) => p.boss === tp.boss); if (!c.length) return []; const k = c.filter((p) => p.kill); const pick = (k.length ? k : c); return [[us.pulls.indexOf(pick[pick.length - 1]), 1]]; }
    const trash = us.pulls.filter((p) => !p.boss);
    const sc = (pool) => pool.map((p) => [p, overlap(tp.mobs, p.mobs) / (1 + Math.pow(dist(tp, p) / 6000, 2))]).filter((x) => x[1] > 0);
    let cand = sc(trash.filter((p) => p.seg === tp.seg));
    if (!cand.length) cand = sc(trash);
    if (cand.length) {
      const mx = Math.max(...cand.map((x) => x[1]));
      cand = cand.filter((x) => x[1] >= 0.15 * mx);
      const tot = cand.reduce((s, x) => s + x[1], 0);
      return cand.map(([p, v]) => [us.pulls.indexOf(p), v / tot]);
    }
    let bd = 3500, best = null;
    for (const p of trash) { const d = dist(tp, p); if (d < bd) { bd = d; best = p; } }
    return best ? [[us.pulls.indexOf(best), 1]] : [];
  });
  const share = (asg, k, i) => { const a = asg[k].find((x) => x[0] === i); return a ? a[1] : 0; };

  // ---------- analyse d'une clé ----------
  // spec = {key_id, code, fight, players: [{character, run_id, group_id, source_id, spec ("Druid-Guardian"), metric ("dps"|"hps"), tops: [{name, code, fight, source_id}]}]}
  const analyse = async (spec, st) => {
    const log = (m) => st.log.push(Math.round((Date.now() - st.t0) / 1000) + ' s · ' + m);
    const us = await fight(spec.code, spec.fight);
    log('clé chargée : ' + us.pulls.length + ' pulls');
    for (const P of spec.players) {
      if (!P.source_id) { const f = (us.fp.friendlies || []).find((x) => x.name === P.character && String(x.fights || '').includes('.' + us.fid + '.')); P.source_id = f ? f.id : null; }
      if (!P.source_id) throw new Error(P.character + ' absent du combat ' + us.fid);
    }
    const isTank = (p) => !!AM[p.spec];
    const needHeal = spec.players.some((p) => p.metric === 'hps' || isTank(p));
    const [gdd, gheal, gtaken, intsHtml, dHtml] = await Promise.all([
      graph('damage-done', us), needHeal ? graph('healing', us) : null, graph('damage-taken', us),
      text(U.ints(us.code, us.fid, us.start, us.end)), text(U.deaths(us.code, us.fid, us.start, us.end))]);
    const usGab = await json(U.gab(us.code, us.fid, us.start, us.end));
    const S = us.start;
    const rel = (ts) => (ts - S) / 1000;
    const pullAt = (sec) => { const ts = S + sec * 1000; const p = us.pulls.find((x) => ts >= x.s - 2000 && ts <= x.e + 2000); return p ? p.n : null; };
    const mapOf = new Map(us.maps.map((m) => [m.id, m]));
    const norm = (cx, cy, mid) => { const m = mapOf.get(mid) || us.maps[0]; if (!m) return [null, null]; return [Math.round((cx - m.x0) / (m.x1 - m.x0) * 1000), Math.round((m.y1 - cy) / (m.y1 - m.y0) * 1000)]; };

    // morts et kicks du groupe
    const ints = parseInts(intsHtml);
    const dtab = parseDeathsTable(dHtml);
    log('kicks et morts lus : ' + ints.length + ' sorts, ' + dtab.length + ' morts');

    // données par joueur suivi
    const out = {pulls: [], maps: [], absent: [], traces: [], deaths: [], kicks: [], timeline: [], vie: [], summary: {}};
    const charData = {}; // character -> {perPull: [...], tops}
    const allTopPulls = []; // pour les packs absents : {top, pull}
    const traceTops = [];
    for (const P of spec.players) {
      const kind = P.metric === 'hps' ? 'healing' : 'damage-done';
      const gYou = kind === 'healing' ? gheal : gdd;
      const sYou = seriesOf(gYou, P.source_id);
      const tank = isTank(P);
      let tk = null;
      if (tank) {
        const [aur, hpj] = await Promise.all([text(U.auras(us.code, us.fid, us.start, us.end, P.source_id)), json(U.hp(us.code, us.fid, us.start, us.end, P.source_id))]);
        const hpS = ((hpj.series || [])[0] || {}).data || [];
        tk = {taken: seriesOf(gtaken, P.source_id), heal: seriesOf(gheal, P.source_id), bands: bandsOf(aur, us, AM[P.spec]), hp: hpS, dips: dips(hpS)};
      }
      const cdTable = CDS[P.spec] || {};
      const [gcYou, gtgYou] = await Promise.all([json(U.gcasts(us.code, us.fid, us.start, us.end, P.source_id)), P.metric !== 'hps' ? json(U.gtg(us.code, us.fid, us.start, us.end, P.source_id)) : null]);
      const castsYou = castsOf(gcYou, cdTable);
      castsYou.forEach((cst) => { cst.on = onOf(cst, usGab, gtgYou); });
      // tops
      const tops = [];
      await Promise.all((P.tops || []).map(async (T, ti) => {
        try {
          const F = await fight(T.code, T.fight);
          const [g, ih] = await Promise.all([graph(kind, F), text(U.ints(F.code, F.fid, F.start, F.end))]);
          const o = {name: T.name, ti, F, s: seriesOf(g, T.source_id), ints: parseInts(ih), asg: assign(us, F)};
          const [gc, gtg, gab] = await Promise.all([json(U.gcasts(F.code, F.fid, F.start, F.end, T.source_id)), P.metric !== 'hps' ? json(U.gtg(F.code, F.fid, F.start, F.end, T.source_id)) : null, json(U.gab(F.code, F.fid, F.start, F.end))]);
          o.gab = gab; o.gtg = gtg;
          o.casts = castsOf(gc, cdTable);
          o.casts.forEach((cst) => { cst.on = onOf(cst, gab, gtg); });
          if (tank) {
            const [gt, gh, aur, hpj] = await Promise.all([graph('damage-taken', F), graph('healing', F), text(U.auras(F.code, F.fid, F.start, F.end, T.source_id)), json(U.hp(F.code, F.fid, F.start, F.end, T.source_id))]);
            const hpS = ((hpj.series || [])[0] || {}).data || [];
            o.tk = {taken: seriesOf(gt, T.source_id), heal: seriesOf(gh, T.source_id), bands: bandsOf(aur, F, AM[P.spec]), dips: dips(hpS)};
          }
          tops.push(o);
        } catch (e) { log('top ignoré (' + T.name + ') : ' + e.message); }
      }));
      tops.sort((a, b) => a.ti - b.ti);
      log(P.character + ' : ' + tops.length + ' tops chargés');
      charData[P.character] = {P, tops, tk, sYou, castsYou, gtgYou, cdTable};
      for (const o of tops) {
        o.F.pulls.forEach((tp, k) => { if (!o.asg[k].length && !tp.boss) allTopPulls.push({key: o.F.code + '-' + o.F.fid, tp}); });
        if (!traceTops.some((x) => x.F.code === o.F.code && x.F.fid === o.F.fid)) traceTops.push(o);
      }
    }

    const uniqTops = [];
    for (const D of Object.values(charData)) for (const o of D.tops) if (!uniqTops.some((x) => x.F.code === o.F.code && x.F.fid === o.F.fid)) uniqTops.push(o);
    // lignes pull (une par pull de la clé, avec les chiffres de chaque perso)
    const kicksMissedAt = ints.flatMap((s) => s.missedAt);
    for (let i = 0; i < us.pulls.length; i++) {
      const p = us.pulls[i];
      const [x, y] = norm(p.cx, p.cy, p.map);
      const dur = (p.e - p.s) / 1000;
      const mobs = Object.entries(p.mobs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g, c]) => { const e = us.byGuid.get(+g); return (e ? e.name : '?') + ' ×' + c; }).join(' · ');
      const deaths = dtab.filter((d) => d.t !== null && pullAt(d.t) === p.n).map((d) => d.who);
      const row = {item_id: spec.key_id + '-pull-' + p.n, key_id: spec.key_id, kind: 'pull', n: p.n, boss: !!p.boss, kill: p.kill, label: p.name, t: Math.round(rel(p.s)), e: Math.round(rel(p.e)), x, y, map: p.map,
        forces: r1(p.forces), mobs_n: p.mobN, mobs, deaths: deaths.join(', ') || null, kicks_missed: kicksMissedAt.filter((t) => pullAt(t) === p.n).length, chars: {}, tank: null};
      // ce qui fait mal au groupe sur ce pull, face aux tops (tous les tops des persos suivis, sans doublon)
      {
        const youAb = realSeries(usGab).map((sr) => [sr.guid, sr.name, dur > 0 ? integ(sr, p.s, p.e) / dur : 0]);
        const perTop = [], names = {};
        for (const o of uniqTops) {
          const mine = o.F.pulls.map((tp, k) => [tp, share(o.asg, k, i)]).filter((x) => x[1] > 0);
          const w = mine.reduce((sm, [, v]) => sm + v, 0);
          if (w < 0.25 || !o.gab) continue;
          const td = mine.reduce((sm, [tp, v]) => sm + v * (tp.e - tp.s) / 1000, 0);
          if (td <= 0) continue;
          const m = {};
          for (const sr of realSeries(o.gab)) { m[sr.guid] = mine.reduce((sm, [tp, v]) => sm + v * integ(sr, tp.s, tp.e), 0) / td; names[sr.guid] = sr.name; }
          perTop.push(m);
        }
        const nT = perTop.length;
        const medT = (g) => nT ? med(perTop.map((m) => m[g] || 0)) : null;
        const cand = new Map();
        for (const [g, nm, v] of youAb) cand.set(g, {nm, you: v, tops: medT(g)});
        for (const g of Object.keys(names)) if (!cand.has(+g)) cand.set(+g, {nm: names[g], you: 0, tops: medT(g)});
        row.hurt = [...cand.values()].filter((x) => Math.max(x.you, x.tops || 0) > 0).sort((a, b) => Math.max(b.you, b.tops || 0) - Math.max(a.you, a.tops || 0)).slice(0, 4)
          .map((x) => [x.nm, kilo(x.you), kilo(x.tops)]);
        row.hurt_n = nT;
      }
      for (const [c, D] of Object.entries(charData)) {
        const you = dur > 0 ? integ(D.sYou, p.s, p.e) / dur : null;
        const per = [], durs = [], forc = [], mobn = [];
        const tkv = {taken: [], sh: [], am: [], low: []};
        for (const o of D.tops) {
          const mine = o.F.pulls.map((tp, k) => [tp, share(o.asg, k, i)]).filter((x) => x[1] > 0);
          const w = mine.reduce((s, [, v]) => s + v, 0);
          if (w < 0.25) continue;
          const td = mine.reduce((s, [tp, v]) => s + v * (tp.e - tp.s) / 1000, 0);
          const dmg = mine.reduce((s, [tp, v]) => s + v * integ(o.s, tp.s, tp.e), 0);
          durs.push(td); if (td > 0) per.push(dmg / td);
          forc.push(mine.reduce((s, [tp, v]) => s + v * (tp.forces || 0), 0)); mobn.push(mine.reduce((s, [tp, v]) => s + v * tp.mobN, 0));
          if (o.tk) {
            const tt = mine.reduce((s, [tp, v]) => s + v * integ(o.tk.taken, tp.s, tp.e), 0), th = mine.reduce((s, [tp, v]) => s + v * integ(o.tk.heal, tp.s, tp.e), 0);
            const cov = mine.reduce((s, [tp, v]) => s + v * covered(o.tk.bands, tp.s, tp.e), 0);
            tkv.taken.push(td > 0 ? tt / td : null); tkv.sh.push(tt > 0 ? th / tt * 100 : null); tkv.am.push(td > 0 ? cov / (td * 1000) * 100 : null);
            tkv.low.push(mine.reduce((s, [tp, v]) => s + v * o.tk.dips.filter((dp) => dp.s >= tp.s && dp.s <= tp.e).length, 0));
          }
        }
        row.chars[c] = {p: kilo(you), m: kilo(med(per)), lo: kilo(q(per, 0.25)), hi: kilo(q(per, 0.75)), d: r0(med(durs)), f: r1(med(forc)), mn: r0(med(mobn)), k: durs.length, nt: D.tops.length};
        // gros CD sur ce pull : les tiens (et sur quoi), la part des tops qui les posent ici (et sur quoi, le plus souvent)
        {
          const inP = (cst, a, b) => cst.t >= a - 3000 && cst.t <= b;
          const mineC = D.castsYou.filter((cst) => inP(cst, p.s, p.e));
          const tUse = {}, tOn = {}; let kk = 0;
          for (const o of D.tops) {
            const mine = o.F.pulls.map((tp, k) => [tp, share(o.asg, k, i)]).filter((x) => x[1] > 0);
            if (mine.reduce((sm, [, v]) => sm + v, 0) < 0.25) continue;
            kk++;
            const used = new Set();
            for (const cst of o.casts || []) if (mine.some(([tp]) => inP(cst, tp.s, tp.e))) { used.add(cst.id); (tOn[cst.id] = tOn[cst.id] || []).push(cst.on); }
            for (const id of used) tUse[id] = (tUse[id] || 0) + 1;
          }
          const cd = [];
          for (const [id, def] of Object.entries(D.cdTable)) {
            const yc = mineC.filter((cst) => cst.id === +id);
            const sh = kk ? (tUse[id] || 0) / kk : 0;
            if (!yc.length && sh < 0.3) continue;
            cd.push([def[0], yc.length ? [...new Set(yc.map((cst) => cst.on || '?'))].join(' · ') : null, Math.round(sh * 100), mode(tOn[id] || [])]);
          }
          if (cd.length) row.chars[c].cd = cd;
        }
        // cibles (DPS et tank) : part de tes dégâts sur chaque monstre, face aux tops
        if (D.gtgYou) {
          const shares = (g, wins) => { const by = {}; let tot = 0; for (const sr of realSeries(g)) { const v = wins.reduce((sm, [a, b, w]) => sm + w * integ(sr, a, b), 0); if (v <= 0) continue; by[sr.name] = (by[sr.name] || 0) + v; tot += v; } if (tot > 0) for (const k of Object.keys(by)) by[k] = by[k] / tot * 100; return by; };
          const ys = shares(D.gtgYou, [[p.s, p.e, 1]]);
          const ts = [];
          for (const o of D.tops) {
            const mine = o.F.pulls.map((tp, k) => [tp, share(o.asg, k, i)]).filter((x) => x[1] > 0);
            if (!o.gtg || mine.reduce((sm, [, v]) => sm + v, 0) < 0.25) continue;
            ts.push(shares(o.gtg, mine.map(([tp, v]) => [tp.s, tp.e, v])));
          }
          const names = new Set([...Object.keys(ys), ...ts.flatMap((x) => Object.keys(x))]);
          const tg = [...names].map((nm) => [nm, ys[nm] || 0, ts.length ? med(ts.map((x) => x[nm] || 0)) : null])
            .sort((a, b) => Math.max(b[1], b[2] || 0) - Math.max(a[1], a[2] || 0)).slice(0, 3).map(([nm, y, t]) => [nm, r0(y), r0(t)]);
          if (tg.length && tg.some((x) => x[1] > 0 || x[2] > 0)) row.chars[c].tg = tg;
        }
        if (D.tk) {
          const tt = integ(D.tk.taken, p.s, p.e), th = integ(D.tk.heal, p.s, p.e);
          row.tank = {who: c, tk: kilo(dur > 0 ? tt / dur : null), ttk: kilo(med(tkv.taken)), sh: r0(tt > 0 ? th / tt * 100 : null), tsh: r0(med(tkv.sh)), am: r0(dur > 0 ? covered(D.tk.bands, p.s, p.e) / (dur * 1000) * 100 : null), tam: r0(med(tkv.am)),
            low: D.tk.dips.filter((dp) => dp.s >= p.s && dp.s <= p.e).length, tlow: r1(med(tkv.low))};
        }
      }
      out.pulls.push(row);
    }
    // cartes
    const used = new Set(us.pulls.map((p) => p.map));
    us.maps.forEach((m, k) => { if (used.has(m.id)) out.maps.push({item_id: spec.key_id + '-map-' + m.id, key_id: spec.key_id, kind: 'map', map: m.id, label: m.name, aspect: r1((m.x1 - m.x0) / (m.y1 - m.y0) * 10) / 10, order: k}); });
    // traces des tops (10 au plus, dans l'ordre reçu)
    traceTops.slice(0, 10).forEach((o, j) => {
      const pts = o.F.pulls.map((tp) => { const [x, y] = norm(tp.cx, tp.cy, tp.map); return x === null ? null : x + ',' + y + ',' + (tp.map || 0) + ',' + (tp.boss ? 1 : 0); }).filter(Boolean).join(';');
      out.traces.push({item_id: spec.key_id + '-trace-' + (j + 1), key_id: spec.key_id, kind: 'trace', n: j + 1, who: o.name, pts});
    });
    // packs faits par beaucoup de tops et pas par vous
    const nTopsAll = new Set(allTopPulls.map((a) => a.key)).size + 0;
    const distinctTops = new Set(Object.values(charData).flatMap((D) => D.tops.map((o) => o.F.code + '-' + o.F.fid))).size;
    const clusters = [];
    for (const a of allTopPulls) {
      let c = clusters.find((k) => k.map === a.tp.map && Math.hypot(k.cx - a.tp.cx, k.cy - a.tp.cy) < 4000);
      if (!c) { c = {map: a.tp.map, cx: a.tp.cx, cy: a.tp.cy, items: []}; clusters.push(c); }
      c.items.push(a);
    }
    let ai = 0;
    for (const c of clusters) {
      const tops = new Set(c.items.map((a) => a.key));
      if (!distinctTops || tops.size < Math.max(2, 0.4 * distinctTops)) continue;
      const cx = med(c.items.map((a) => a.tp.cx)), cy = med(c.items.map((a) => a.tp.cy));
      const [x, y] = norm(cx, cy, c.map);
      const names = {}; for (const a of c.items) names[a.tp.name] = (names[a.tp.name] || 0) + 1;
      out.absent.push({item_id: spec.key_id + '-absent-' + (++ai), key_id: spec.key_id, kind: 'absent', x, y, map: c.map, label: Object.entries(names).sort((u, v) => v[1] - u[1])[0][0], share: Math.round(tops.size / distinctTops * 100), forces: r1(med(c.items.map((a) => a.tp.forces)))});
    }
    void nTopsAll;

    // kicks
    ints.sort((a, b) => b.missed - a.missed || b.casts - a.casts).forEach((s) => {
      const tops = {};
      for (const [c, D] of Object.entries(charData)) {
        const rates = D.tops.map((o) => o.ints.find((x) => x.id === s.id)).filter((x) => x && x.casts > 0).map((x) => x.stopped / x.casts * 100);
        tops[c] = {r: r0(med(rates)), n: rates.length};
      }
      const killed = dtab.filter((d) => false).length; void killed;
      out.kicks.push({item_id: spec.key_id + '-kick-' + s.id, key_id: spec.key_id, spell: s.spell, spell_id: s.id, icon_name: s.icon_name, caster: s.caster, casts: s.casts, stopped: s.stopped, missed: s.missed, by: s.by, tops});
    });

    // morts des persos suivis, courbes et passages sous 35 %
    const dCount = {};
    let rank = 0;
    for (const d of dtab) {
      rank++;
      const D = Object.values(charData).find((x) => x.P.character === d.who);
      if (!D) continue;
      try {
        const det = await deathDetail(us, d, D.P.spec, D.P.source_id);
        if (!det) continue;
        dCount[d.who] = (dCount[d.who] || 0) + 1;
        out.deaths.push(Object.assign({item_id: D.P.run_id + '-death-' + dCount[d.who], key_id: spec.key_id, character: d.who, group_id: D.P.group_id, run_id: D.P.run_id, n: dCount[d.who], rank, pull_n: pullAt(det.t)}, det));
      } catch (e) { log('mort ' + d.i + ' ignorée : ' + e.message); }
    }
    for (const [c, D] of Object.entries(charData)) {
      // séries compactes : une valeur par tranche de 10 s depuis le début de la clé (t = 10 × index)
      const ser = {perf: []};
      if (D.tk) Object.assign(ser, {self_k: [], heal_k: [], am: [], hp_min: []});
      const N = Math.ceil((us.end - us.start) / 10000);
      for (let k = 0; k < N; k++) {
        const a = S + k * 10000, b = Math.min(us.end, a + 10000), len = (b - a) / 1000;
        if (len <= 0) break;
        ser.perf.push(kilo(integ(D.sYou, a, b) / len));
        if (D.tk) {
          const hpw = D.tk.hp.filter(([ts]) => ts >= a && ts < b).map(([, v]) => v);
          ser.self_k.push(kilo(integ(D.tk.taken, a, b) / len)); ser.heal_k.push(kilo(integ(D.tk.heal, a, b) / len));
          ser.am.push(r0(covered(D.tk.bands, a, b) / (len * 10))); ser.hp_min.push(hpw.length ? Math.min(...hpw) : '');
        }
      }
      const tl = {character: c, run_id: D.P.run_id, step: 10};
      for (const [k, v] of Object.entries(ser)) tl[k] = v.map((x) => x === null ? '' : x).join(',');
      out.timeline.push(tl);
      if (D.tk) D.tk.dips.forEach((dp, k) => out.vie.push({row_id: D.P.run_id + '-toi-vie-' + (k + 1), character: c, group_id: D.P.group_id, run_id: D.P.run_id, who: 'Toi', t: Math.round(rel(dp.s)), spell: 'Sous ' + LOW + ' % de vie (' + Math.round(dp.min) + ' %)', spell_en: 'Low health', icon: null, kind: 'vie', p: Math.round(dp.min), in_spike: null}));
    }

    // résumé pour les textes du rapport
    for (const [c, D] of Object.entries(charData)) {
      const rows = out.pulls.map((r) => ({n: r.n, label: r.label, boss: r.boss, dur: r.e - r.t, ...r.chars[c]}));
      const cmp = rows.filter((r) => r.k >= Math.max(3, Math.ceil(r.nt / 2)) && r.d);
      const lost = cmp.map((r) => ({n: r.n, label: r.label, boss: r.boss, delta: r.dur - r.d})).sort((a, b) => b.delta - a.delta);
      const perfRatio = cmp.filter((r) => r.p && r.m).map((r) => r.p / r.m);
      const extra = rows.filter((r) => !r.boss && r.k <= Math.floor(r.nt * 0.2));
      const kicks = out.kicks.filter((s) => s.casts >= 3 && s.tops[c] && s.tops[c].n >= 3 && s.tops[c].r >= 70 && s.stopped / s.casts * 100 < s.tops[c].r - 15)
        .map((s) => ({spell: s.spell, caster: s.caster, rate: Math.round(s.stopped / s.casts * 100), tops: s.tops[c].r, you: s.by[c] || 0}));
      out.summary[c] = {
        tops: D.tops.length,
        pulls_compares: cmp.length,
        temps_perdu_trash: r0(lost.filter((x) => !x.boss).reduce((s, x) => s + x.delta, 0)),
        pires_pulls: lost.slice(0, 3).map((x) => ({n: x.n, label: x.label, delta: r0(x.delta)})),
        meilleurs_pulls: lost.slice(-2).reverse().map((x) => ({n: x.n, label: x.label, delta: r0(x.delta)})),
        perf_vs_tops_median: r1(med(perfRatio) * 100),
        pulls_sous_p25: cmp.filter((r) => r.p !== null && r.lo !== null && r.p < r.lo).map((r) => r.n),
        packs_en_plus: extra.map((r) => ({n: r.n, label: r.label})),
        kicks_a_travailler: kicks,
        morts: out.deaths.filter((d) => d.character === c).map((d) => ({t: d.t, killer: d.killer, one_shot: d.one_shot, verdict: d.verdict})),
        gros_cd: Object.entries(D.cdTable).map(([id, def]) => {
          const yc = D.castsYou.filter((cst) => cst.id === +id);
          const tc = D.tops.map((o) => (o.casts || []).filter((cst) => cst.id === +id));
          return {cd: def[0], toi: yc.length, tops: r1(med(tc.map((x) => x.length))), toi_sur: mode(yc.map((x) => x.on)), tops_sur: mode(tc.flat().map((x) => x.on))};
        }).filter((x) => x.toi || x.tops),
      };
      if (D.tk) {
        const tr = out.pulls.filter((r) => r.tank && r.chars[c].k >= 3);
        out.summary[c].tank = {
          degats_subis_vs_tops: r1(med(tr.filter((r) => r.tank.tk && r.tank.ttk).map((r) => r.tank.tk / r.tank.ttk * 100))),
          auto_soin: r0(med(tr.map((r) => r.tank.sh))), auto_soin_tops: r0(med(tr.map((r) => r.tank.tsh))),
          mitigation: r0(med(tr.map((r) => r.tank.am))), mitigation_tops: r0(med(tr.map((r) => r.tank.tam))),
          sous_35: D.tk.dips.length, sous_35_tops_par_pull: r1(med(tr.map((r) => r.tank.tlow))),
          taille_pulls_vs_tops: r1(med(tr.filter((r) => r.chars[c].mn).map((r) => r.mobs_n / r.chars[c].mn * 100))),
        };
      }
    }
    log('terminé');
    return out;
  };


  // Icônes : une seule image JPEG (bande de 32 px de haut, une icône de 32 × 32 par nom, dans l'ordre), en base64,
  // depuis wow.zamimg.com. Le tableau de bord la découpe grâce aux lignes icon_map {icon_name, icon, i, n}.
  const sprite = async (names, px = 32, q = 0.82) => {
    const list = [...new Set(names.filter(Boolean))];
    const ok = [], bmps = [];
    for (const n of list) {
      try {
        const r = await fetch('https://wow.zamimg.com/images/wow/icons/medium/' + String(n).replace(/\.jpg$/, '') + '.jpg');
        if (!r.ok) continue;
        bmps.push(await createImageBitmap(await r.blob())); ok.push(n);
      } catch (e) { /* icône introuvable : ignorée */ }
    }
    if (!ok.length) return {names: [], b64: null};
    const c = document.createElement('canvas'); c.width = px * ok.length; c.height = px;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    bmps.forEach((bm, k) => g.drawImage(bm, k * px, 0, px, px));
    const bin = atob(c.toDataURL('image/jpeg', q).split(',')[1]);
    const by = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const keep = [by[0], by[1]]; let i = 2;
    while (i + 4 <= by.length && by[i] === 0xFF && by[i + 1] !== 0xDA) { const len = (by[i + 2] << 8) | by[i + 3]; if (by[i + 1] !== 0xE2) for (let k = i; k < i + 2 + len; k++) keep.push(by[k]); i += 2 + len; }
    for (let k = i; k < by.length; k++) keep.push(by[k]);
    let out = ''; for (let k = 0; k < keep.length; k++) out += String.fromCharCode(keep[k]);
    return {names: ok, b64: btoa(out)};
  };
  // Noms d'icônes utilisés par la dernière analyse (morts : coup fatal et défensifs ; kicks), sauf ceux déjà connus.
  const iconNames = (known) => {
    const o = window.__CWX && window.__CWX.out; if (!o) return [];
    const s = new Set();
    for (const d of o.deaths) { s.add(d.icon_name); d.hits.forEach((h) => s.add(h.icon_name)); d.cds.forEach((c) => s.add(c.icon_name)); }
    for (const k of o.kicks) s.add(k.icon_name);
    for (const k of known || []) s.delete(k);
    s.delete(null); s.delete(undefined);
    return [...s];
  };

  const run = (spec) => {
    const st = {state: 'running', t0: Date.now(), log: [], out: null, err: null, key: spec.key_id};
    window.__CWX = st;
    analyse(spec, st).then((o) => { st.out = o; st.state = 'done'; }, (e) => { st.state = 'error'; st.err = String(e && e.message || e); });
    return 'lancé : ' + spec.key_id;
  };
  const status = () => { const s = window.__CWX; return s ? {key: s.key, state: s.state, secs: Math.round((Date.now() - s.t0) / 1000), log: s.log.slice(-6), err: s.err} : null; };
  const part = (name) => { const s = window.__CWX; if (!s || !s.out) return null; return name ? s.out[name] : Object.fromEntries(Object.entries(s.out).map(([k, v]) => [k, Array.isArray(v) ? v.length : Object.keys(v).length])); };
  return {VERSION, run, status, part, sprite, iconNames, _: {fight, parseInts, parseDeathsTable, assign, DEF, AM}};
})();
'CWX ' + window.CWX.VERSION + ' prêt';
