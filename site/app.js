// TasteCut client — no framework. Talks to /api/* (SSE) and renders the brief.
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 2) => (n == null || isNaN(n)) ? "–" : Number(n).toFixed(d);
const state = { brief: null, deliverable: "30s_ad", running: false, take: 1, fontsLoaded: new Set() };
let LIB = null;

// ---------- deliverables ----------
const DELS = { "15s_reel": ["15 s reel", "9:16"], "30s_ad": ["30 s ad", "16:9"], "60s_film": ["60 s brand film", "16:9"], "yt_preroll": ["YouTube pre-roll", "6+20 s"], "3min_doc": ["3 min mini-doc", "16:9"] };
const delWrap = $("#deliverables");
for (const [k, [label, meta]] of Object.entries(DELS)) {
  const b = el("button", "chip" + (k === state.deliverable ? " on" : ""), `${esc(label)}<span class="mono">${esc(meta)}</span>`); b.type = "button"; b.dataset.k = k;
  b.onclick = () => { state.deliverable = k; delWrap.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c.dataset.k === k)); };
  delWrap.appendChild(b);
}
document.querySelectorAll("[data-sample]").forEach(b => b.onclick = () => { $("#brand").value = b.dataset.sample; $("#brand").focus(); });

// hero timecode ticker
(() => { const t0 = Date.now(); const h = $("#hero-tc"); setInterval(() => { const ms = Date.now() - t0; const s = Math.floor(ms / 1000), f = Math.floor((ms % 1000) / 33.3); h.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(f).padStart(2, "0")}`; }, 100); })();

// ---------- SSE ----------
async function stream(path, body, onEvent) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { let msg = res.statusText; try { msg = (await res.json()).error || msg; } catch {} throw new Error(msg); }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); for (const line of chunk.split("\n")) if (line.startsWith("data: ")) { try { onEvent(JSON.parse(line.slice(6))); } catch (e) { console.warn("bad event", e); } } }
  }
}

// ---------- console ----------
const log = $("#log");
function logLine(cls, tc, html) { const li = el("li", cls, `<span class="tc">${esc(tc || "")}</span><span class="txt">${html}</span>`); log.appendChild(li); log.scrollTop = log.scrollHeight; return li; }
const stepLis = {};
function onEvent(ev) {
  if (ev.t === "step") {
    const li = stepLis[ev.id];
    if (li) { li.className = "step " + ev.status; li.querySelector(".txt").textContent = ev.label; } else stepLis[ev.id] = logLine("step " + ev.status, ev.tc, esc(ev.label));
    $("#console-status").textContent = ev.status === "done" ? ev.label.toLowerCase() : ev.label.toLowerCase() + "…";
    if (ev.id === "write" && ev.status === "done") $("#writing").classList.add("hidden");
  } else if (ev.t === "tool") {
    logLine("tool", ev.tc, `<span class="st${ev.status === 200 ? "" : " bad"}">${ev.status}</span> ${esc(ev.call)} <span class="dim">${ev.cached ? "cached" : ev.ms + " ms"}</span>`);
  } else if (ev.t === "think") { logLine("think", ev.tc, esc(ev.text)); }
  else if (ev.t === "writing") { const w = $("#writing"); w.classList.remove("hidden"); $("#writing-chars").textContent = ev.chars + " chars"; $("#writing-tail").textContent = ev.tail; }
  else if (ev.t === "error") { logLine("error", ev.tc || "", esc(ev.message)); showError(ev.message); }
  else if (ev.t === "brief") { state.brief = ev.data; renderBrief(ev.data); }
}
function showError(msg) { const b = $("#brief"); b.classList.remove("hidden"); b.innerHTML = `<div class="errbox"><b>The agent stopped.</b> ${esc(msg)}<br><span class="dim">Try a better-known brand, or add two or three comparable brands in the notes so the agent can ground through them.</span></div>`; }

// ---------- run ----------
$("#form").onsubmit = async (e) => {
  e.preventDefault(); if (state.running) return;
  const brand = $("#brand").value.trim(); if (!brand) return;
  state.running = true; $("#go").disabled = true; $("#rec").classList.add("live"); $("#rec-label").textContent = "agent live";
  $("#room").classList.remove("hidden"); $("#brief").classList.add("hidden"); log.innerHTML = ""; for (const k in stepLis) delete stepLis[k]; $("#writing").classList.add("hidden");
  $("#take").textContent = state.take++;
  $("#room").scrollIntoView({ behavior: "smooth", block: "start" });
  const body = { brand, notes: $("#notes").value.trim(), deliverable: state.deliverable };
  try { await stream("/api/brief", body, onEvent); } catch (err) { logLine("error", "", esc(err.message)); showError(err.message); }
  state.running = false; $("#go").disabled = false; $("#rec").classList.remove("live"); $("#rec-label").textContent = "agent idle"; $("#console-status").textContent = state.brief ? "brief delivered" : "stopped";
  const reel = $("#reel").value.trim(); if (reel && state.brief && !state.brief.cached_match) runMatch(reel);
};

// ---------- rendering ----------
function loadFonts(...names) {
  const fam = names.filter(n => n && !state.fontsLoaded.has(n)); if (!fam.length) return;
  fam.forEach(n => state.fontsLoaded.add(n));
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?" + fam.map(n => "family=" + encodeURIComponent(n).replace(/%20/g, "+") + ":wght@400;700").join("&") + "&display=swap"; document.head.appendChild(l);
}
function saturation(hex) { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const l = (mx + mn) / 2; const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1)); return { s, l }; }
function pickAccent(palette) { let best = null; for (const h of palette) { const { s, l } = saturation(h); const score = s * (1 - Math.abs(l - 0.55)); if (!best || score > best.score) best = { h, score }; } return best && best.score > 0.15 ? best.h : null; }
function hexA(hex, a) { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return `rgba(${r},${g},${b},${a})`; }
function avatar(name, img, cls) { const d = el("div", cls); if (img) { const i = new Image(); i.alt = name; i.src = img; i.onerror = () => { i.remove(); d.textContent = initials(name); }; d.appendChild(i); } else d.textContent = initials(name); return d; }
const initials = (n) => String(n || "?").split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();

function renderBrief(d) {
  const b = d.brief, ev = d.evidence, inp = d.input, der = d.derived;
  const brief = $("#brief"); brief.classList.remove("hidden");
  // accent tint from the grade
  const acc = pickAccent(b.grade.palette || []); if (acc) { document.documentElement.style.setProperty("--accent", acc); document.documentElement.style.setProperty("--accent-glow", hexA(acc, .35)); }
  // head
  const bc = $("#brand-card"); bc.innerHTML = "";
  const br = d.resolved.brand; bc.appendChild(avatar(inp.brand, br && br.image, "")); bc.querySelector("div").className = "init"; if (br && br.popularity != null) bc.appendChild(el("span", "pop", "pop " + fmt(br.popularity, 2)));
  $("#brief-kicker").textContent = `${inp.brand} · ${inp.deliverable.label} · ${d.resolved.via === "qloo" ? "resolved on qloo" : "grounded via " + d.resolved.proxies.map(p => p.name).join(", ")}${d.cached ? " · from cache" : ""}`;
  $("#headline").textContent = b.headline || "";
  $("#positioning").textContent = b.positioning || "";
  $("#confidence").textContent = `confidence ${fmt(b.confidence.score, 2)} · ${b.confidence.note || ""} · ${d.qloo_calls} qloo calls · ${(d.elapsed_ms / 1000).toFixed(1)} s`;
  renderTimeline(d); renderAudience(ev.demographics); renderTaste(ev.taste); renderStyle(b, der); renderType(b, inp.brand); renderGrade(b); renderMusic(b, inp.deliverable); renderRefs(b); renderDoDont(b); $("#sound").innerHTML = `<p>${esc(b.sound_design || "")}</p>`;
  renderMatchForm(d); renderWhy(d); renderEvidence(d);
  $("#brief-stats").textContent = `brief ${d.id} · models ${[d.models.read, d.models.write].filter(Boolean).map(m => m.split("/").pop()).join(", ")}`;
  history.replaceState(null, "", "?b=" + d.id);
}

function renderTimeline(d) {
  const b = d.brief, sec = d.input.deliverable.seconds, cpm = b.pacing.cuts_per_min, pal = b.grade.palette;
  const tl = $("#timeline"); tl.innerHTML = ""; tl.style.setProperty("--tl-dur", Math.min(24, Math.max(8, sec / 2.5)) + "s");
  const cuts = Math.max(2, Math.round(cpm * sec / 60)); const frames = el("div", "tl-frames");
  const nF = Math.min(cuts, 64); for (let i = 0; i < nF; i++) { const f = el("i"); const c = pal[(i * 7) % pal.length]; f.style.background = `linear-gradient(180deg, ${c}, ${pal[(i * 3 + 1) % pal.length]})`; f.style.opacity = .55 + .45 * ((i * 37) % 10) / 10; frames.appendChild(f); }
  tl.appendChild(frames);
  const cutsEl = el("div", "tl-cuts"); const bpm = (b.music.bpm || [100, 110])[0]; const beat = 60 / bpm;
  for (let i = 0; i <= cuts; i++) { const t = i * sec / cuts; const c = el("i"); c.style.left = (t / sec * 100) + "%"; if (Math.abs((t / beat) - Math.round(t / beat)) < 0.08) c.classList.add("beat"); cutsEl.appendChild(c); }
  tl.appendChild(cutsEl);
  const hook = el("div", "tl-hook", `<span>HOOK 0–3 s</span>`); hook.style.width = (3 / sec * 100) + "%"; tl.appendChild(hook);
  const cues = el("div", "tl-cues"); for (const c of (b.music.cue_map || [])) { const x = Math.min(sec, Math.max(0, Number(c.at_s) || 0)); const m = el("b", "", esc(c.label)); m.style.left = (x / sec * 100) + "%"; if (x / sec > .9) m.style.transform = "translateX(-100%)"; if (x === 0) m.style.transform = "none"; cues.appendChild(m); } tl.appendChild(cues);
  const ruler = el("div", "tl-ruler"); const stepS = sec <= 20 ? 1 : sec <= 60 ? 5 : 15; for (let t = 0; t <= sec; t += stepS) { const s = el("span", "", `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`); s.style.left = (t / sec * 100) + "%"; if (t === 0) s.style.transform = "none"; if (t === sec) s.style.transform = "translateX(-100%)"; ruler.appendChild(s); } tl.appendChild(ruler);
  tl.appendChild(el("div", "playhead"));
  $("#tl-meta").textContent = `${sec} s · ${cuts} cuts · ${cpm} cpm · ${b.music.bpm.join("–")} bpm`;
  $("#tl-note").textContent = b.pacing.rhythm || "";
}
function renderAudience(demo) {
  const w = $("#audience"); if (!demo) { w.innerHTML = `<p class="dim">No demographic read for this signal.</p>`; return; }
  const order = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];
  const bars = el("div", "bars");
  for (const k of order) { if (!(k in demo.age)) continue; const v = demo.age[k]; const row = el("div", "bar", `<span class="lbl">${esc(k.replace(/_/g, " ").replace("and ", "& "))}</span><span class="trk"><i class="${v < 0 ? "neg" : ""}"></i></span><span class="val">${v > 0 ? "+" : ""}${fmt(v, 2)}</span>`); bars.appendChild(row); requestAnimationFrame(() => setTimeout(() => row.querySelector("i").style.width = (Math.min(1, Math.abs(v)) * 50) + "%", 50)); }
  w.innerHTML = ""; w.appendChild(bars);
  const g = demo.gender || {}; w.appendChild(el("div", "gender", Object.entries(g).map(([k, v]) => `<span>${esc(k)} <b>${v > 0 ? "+" : ""}${fmt(v, 2)}</b></span>`).join("")));
  w.appendChild(el("div", "ev", `<b>read</b> /v2/insights filter.type=urn:demographics — positive = over-index vs the average audience; ${esc(demo.summary)}`));
}
function renderTaste(tags) {
  const w = $("#taste"); if (!tags || !tags.length) { w.innerHTML = `<p class="dim">No taste tags returned.</p>`; return; }
  const box = el("div", "tags");
  for (const t of tags.slice(0, 22)) { const a = t.affinity; const s = el("span", "tag", `<i></i><span>${esc(t.name)}</span>${a != null ? `<span class="a">${fmt(a, 2)}</span>` : ""}<span class="t">${esc((t.type || "").split(":").slice(2, 3).join(""))}</span>`); box.appendChild(s); if (a != null) setTimeout(() => s.querySelector("i").style.width = (a * 100) + "%", 80); }
  w.innerHTML = ""; w.appendChild(box); w.appendChild(el("div", "ev", `<b>read</b> /v2/insights filter.type=urn:tag — the vocabulary this audience's taste is built from`));
}
function renderStyle(b, der) {
  const s = b.edit_style, p = b.pacing, t = der.tempo;
  $("#style").innerHTML = `<div class="style"><div>
      <p class="styletag">${esc(s.name)}</p>
      <p>${esc(s.summary || s.library || "")}</p>
      <ul class="techs">${(s.techniques || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="ev"><b>evidence</b>${esc(s.evidence || "")}</div>
    </div><div>
      <div class="bignum"><div><b>${p.cuts_per_min}<small>cpm</small></b><span>cuts per minute</span></div><div><b>${fmt(p.avg_shot_s, 1)}<small>s</small></b><span>avg shot</span></div><div><b>${fmt(t.index, 2)}</b><span>tempo index</span></div></div>
      <div class="tempo"><i style="left:${t.index * 100}%"></i><span>glacial</span><span class="r">frantic</span></div>
      <p><b>First 3 seconds.</b> ${esc(p.hook_0_3s || "")}</p>
      <p>${esc(p.rhythm || "")}</p>
      <div class="ev"><b>derived</b>music-side ${fmt(t.music_index, 2)} (${(t.music_hits || []).slice(0, 4).map(h => esc(h.tag)).join(", ") || "–"}) · screen-side ${fmt(t.media_index, 2)} (${(t.media_hits || []).slice(0, 4).map(h => esc(h.tag)).join(", ") || "–"}) · deliverable ${t.nudge >= 0 ? "+" : ""}${t.nudge} → ${t.cuts_per_min} cpm derived, writer set ${p.cuts_per_min}${p.evidence ? " · " + esc(p.evidence) : ""}</div>
    </div></div>`;
}
function renderType(b, brand) {
  const t = b.typography; loadFonts(t.display, t.body);
  $("#type").innerHTML = `<div class="typeprev"><p class="d" style="font-family:'${esc(t.display)}',serif">${esc(brand)}</p><p class="b" style="font-family:'${esc(t.body)}',sans-serif">${esc(b.headline || "")} — ${esc(t.why || "")}</p><div class="names"><span>display · ${esc(t.display)}</span><span>body · ${esc(t.body)}</span></div></div>
    <p>${esc(t.treatment || "")}</p><div class="ev"><b>evidence</b>${esc(t.evidence || "")}</div>`;
}
function renderGrade(b) {
  const g = b.grade, pal = g.palette || [];
  const sw = pal.map(h => `<i style="background:${h}"><span>${h}</span></i>`).join("");
  const lut = `linear-gradient(90deg, ${pal.join(", ")})`;
  const shadow = pal[0], hi = pal[pal.length - 1]; const sat = /bleach|b&w|black/i.test(g.name) ? 0.15 : /saturated|neon|cross|teal/i.test(g.name) ? 1.35 : 1.05; const con = /bypass|contrast|neon|teal/i.test(g.name) ? 1.3 : 1.05;
  $("#grade").innerHTML = `<p class="gname">${esc(g.name)}</p><div class="swatches">${sw}</div><div class="lut" style="background:${lut}"></div>
    <div class="gradeprev"><div data-l="ungraded"></div><div class="graded" data-l="${esc(g.name)}" style="--g-shadow:${shadow};--g-hi:${hi};--g-sat:${sat};--g-con:${con}"><i></i></div></div>
    <p>${esc(g.treatment || "")}</p><p class="dim" style="font-size:13px">${esc(g.notes || "")}</p><div class="ev"><b>evidence</b>${esc(g.evidence || "")}</div>`;
}
function renderMusic(b, del) {
  const m = b.music;
  const arts = (m.reference_artists || []).map(a => { const d = el("div", "artist"); d.appendChild(avatar(a.name, a.image, "av")); d.appendChild(el("div", "", `<div class="nm">${esc(a.name)}${a.on_graph === false ? ' <span class="dim mono">(not in evidence)</span>' : ""}</div><div class="why">${esc(a.why || "")}</div>`)); d.appendChild(el("div", "af", a.affinity != null ? `${fmt(a.affinity, 2)}<div class="trk"><i style="width:${a.affinity * 100}%"></i></div>` : "")); return d; });
  const w = $("#music"); w.innerHTML = `<div class="music"><div><div class="artists" id="artists"></div><div class="ev"><b>read</b> /v2/insights filter.type=urn:entity:artist — affinity of the brand's audience to each artist</div></div>
    <div><p>${esc(m.direction || "")}</p><div class="genres">${(m.genres || []).map(g => `<span>${esc(g)}</span>`).join("")}</div><div class="bpm">${(m.bpm || []).join("–")}<small>BPM</small></div>
    <ul class="cues">${(m.cue_map || []).map(c => `<li><b>${String(Math.floor((c.at_s || 0) / 60)).padStart(2, "0")}:${String(Math.round((c.at_s || 0) % 60)).padStart(2, "0")}</b>${esc(c.label)}</li>`).join("")}</ul>
    <div class="ev"><b>evidence</b>${esc(m.evidence || "")}</div></div></div>`;
  const ar = $("#artists"); arts.forEach(a => ar.appendChild(a));
}
function renderRefs(b) {
  const w = $("#refs"); w.innerHTML = ""; const grid = el("div", "refs");
  for (const r of (b.references || [])) { const c = el("div", "ref"); c.appendChild(avatar(r.title, r.image, "img")); c.appendChild(el("div", "meta", `<div class="kind">${esc(r.kind)}${r.year ? " · " + esc(r.year) : ""}</div><div class="ttl">${esc(r.title)}</div><div class="why">${esc(r.why || "")}</div>${r.affinity != null ? `<div class="af">affinity ${fmt(r.affinity, 2)}</div>` : ""}`)); grid.appendChild(c); }
  w.appendChild(grid); w.appendChild(el("div", "ev", `<b>read</b> films, TV, brands and podcasts the audience over-indexes on; images from Qloo entity data`));
}
function renderDoDont(b) { $("#dodont").innerHTML = `<div class="dd"><div class="do"><h4>Do</h4><ul>${(b.do || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div><div class="dont"><h4>Don't</h4><ul>${(b.dont || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div></div>`; }

// ---------- match ----------
function renderMatchForm(d) {
  const w = $("#match"); const reel = $("#reel").value.trim();
  w.innerHTML = `<div class="matchform"><input type="text" id="reel2" maxlength="300" placeholder="2–6 films, artists or brands that define your cutting style" value="${esc(reel)}"><button class="btn" id="match-go">Score my reel</button></div><div id="match-out"><p class="dim">Paste a few references and the agent resolves them on the graph, pulls the same four affinity sets for your taste, and overlaps them with the brand's.</p></div>`;
  $("#match-go").onclick = () => runMatch($("#reel2").value.trim());
}
async function runMatch(reel) {
  if (!state.brief || !reel) return; const out = $("#match-out"); out.innerHTML = `<p class="dim mono">resolving your reel…</p>`; $("#reel2").value = reel;
  const lines = [];
  try {
    await stream("/api/match", { signal: state.brief.resolved.signal, reel }, (ev) => {
      if (ev.t === "tool") { lines.push(`${ev.status} ${ev.call}`); out.innerHTML = `<p class="dim mono">${esc(lines[lines.length - 1])}</p>`; logLine("tool", ev.tc, `<span class="st${ev.status === 200 ? "" : " bad"}">${ev.status}</span> ${esc(ev.call)} <span class="dim">${ev.ms} ms</span>`); }
      else if (ev.t === "think") logLine("think", ev.tc, esc(ev.text));
      else if (ev.t === "error") out.innerHTML = `<div class="errbox">${esc(ev.message)}</div>`;
      else if (ev.t === "match") renderMatch(ev.data);
    });
  } catch (e) { out.innerHTML = `<div class="errbox">${esc(e.message)}</div>`; }
}
function renderMatch(m) {
  const r = 78, c = 2 * Math.PI * r; const col = m.score >= 70 ? "var(--ok)" : m.score >= 45 ? "var(--accent)" : "var(--bad)";
  $("#match-out").innerHTML = `<div class="matchres"><div class="dial"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--raised)" stroke-width="10"/><circle cx="90" cy="90" r="${r}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" id="dial-arc" style="transition:stroke-dashoffset 1.2s var(--ease)"/></svg><div class="n"><b>${m.score}</b><span>match</span></div></div>
    <div><p class="verdict">${esc(m.verdict)}</p><p>${esc(m.note || "")}</p>
      <div class="domains">${m.domains.map(d => `<div class="dom"><span class="k">${esc(d.type)}</span><span class="s">overlap <b>${fmt(d.score, 3)}</b>${d.shared.length ? " · shared: " + d.shared.map(s => `<b>${esc(s.name)}</b>`).join(", ") : " · nothing shared in the top 20"}${d.editor_only.length ? ` · yours: ${d.editor_only.map(esc).join(", ")}` : ""}</span></div>`).join("")}
      <div class="dom"><span class="k">taste tags</span><span class="s">overlap <b>${fmt(m.tag_score, 3)}</b>${m.shared_tags.length ? " · " + m.shared_tags.map(esc).join(", ") : ""}</span></div></div>
      <div class="ev"><b>method</b>your reel: ${m.editor.map(e => e.id ? esc(e.name) : `<s>${esc(e.query)}</s>`).join(", ")} · weighted Jaccard over the top-20 affinity sets in four domains (75%) + taste-tag Jaccard (25%), soft-curved to 0–100${m.compare && m.compare.ok ? " · Qloo /v2/analysis/compare also answered" : ""}</div></div></div>`;
  requestAnimationFrame(() => setTimeout(() => { $("#dial-arc").style.strokeDashoffset = c * (1 - m.score / 100); }, 60));
}

// ---------- why qloo ----------
function renderWhy(d) {
  const w = $("#why"); w.innerHTML = `<p class="dim">Same brand, same deliverable, model only — no taste graph. One click, one model call.</p><button class="btn" id="why-go">Show the model-only guess</button><div id="why-out"></div>`;
  $("#why-go").onclick = async () => {
    const out = $("#why-out"); out.innerHTML = `<p class="dim mono">asking the model alone…</p>`; $("#why-go").disabled = true;
    try {
      const r = await fetch("/api/baseline", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brand: d.input.brand, deliverable: d.input.deliverable.key }) }); const j = await r.json(); const g = j.baseline || {}; const b = d.brief;
      const row = (k, a, q) => `<div class="k">${k}</div><div>${a}</div><div class="q">${q}</div>`;
      out.innerHTML = `<div class="cmp"><div class="h"></div><div class="h">model only</div><div class="h">with qloo</div>
        ${row("audience", esc(g.audience || "–"), esc(d.evidence.demographics ? d.evidence.demographics.summary : "–"))}
        ${row("edit style", esc(g.edit_style || "–"), esc(b.edit_style.name))}
        ${row("cuts / min", esc(g.cuts_per_min ?? "–"), `${b.pacing.cuts_per_min} <span class="dim">(tempo index ${fmt(b.pacing.tempo_index, 2)} from ${(d.derived.tempo.music_hits || []).length + (d.derived.tempo.media_hits || []).length} genre tags)</span>`)}
        ${row("grade", esc(g.grade || "–"), esc(b.grade.name))}
        ${row("type", esc(g.type || "–"), esc(b.typography.display + " + " + b.typography.body))}
        ${row("music", esc((g.music_genres || []).join(", ") || "–"), esc((b.music.genres || []).join(", ")))}
        ${row("artists", esc((g.reference_artists || []).join(", ") || "–"), (b.music.reference_artists || []).map(a => `${esc(a.name)} <span class="dim mono">${fmt(a.affinity, 2)}</span>`).join(", "))}
        ${row("references", esc((g.references || []).join(", ") || "–"), (b.references || []).map(r => `${esc(r.title)} <span class="dim mono">${fmt(r.affinity, 2)}</span>`).join(", "))}
      </div><div class="ev"><b>note</b>the left column is a plausible guess with no numbers behind it; the right column cites an affinity for every name. Where they agree, the graph confirmed the instinct; where they differ, the graph knows something the model didn't.</div>`;
    } catch (e) { out.innerHTML = `<div class="errbox">${esc(e.message)}</div>`; }
    $("#why-go").disabled = false;
  };
}
function renderEvidence(d) {
  const w = $("#evidence"); const t = d.trace || [];
  w.innerHTML = `<div class="evid">${t.map(r => `<div><span class="${r.status === 200 ? "ok" : "bad"}">${r.status}</span><span class="ms">${r.ms} ms</span><span>${esc(r.call)}</span></div>`).join("")}</div><div class="ev"><b>agent</b>${t.length} Qloo calls · planner ${esc((d.models.read || "–").split("/").pop())} · writers ${esc((d.models.write || "–").split("/").pop())} · ${(d.elapsed_ms / 1000).toFixed(1)} s end to end</div>`;
}

// ---------- export ----------
function toMarkdown(d) {
  const b = d.brief, i = d.input;
  const L = [`# ${i.brand} — edit brief (${i.deliverable.label})`, "", `**${b.headline}**`, "", b.positioning, "", `## Audience`, d.evidence.demographics ? d.evidence.demographics.summary : "n/a", "", `## Edit style — ${b.edit_style.name}`, b.edit_style.summary || "", ...(b.edit_style.techniques || []).map(t => `- ${t}`), "", `## Pacing`, `- ${b.pacing.cuts_per_min} cuts/min · avg shot ${b.pacing.avg_shot_s} s · tempo index ${b.pacing.tempo_index}`, `- First 3 s: ${b.pacing.hook_0_3s}`, `- ${b.pacing.rhythm}`, "", `## Typography — ${b.typography.display} + ${b.typography.body}`, b.typography.treatment || "", "", `## Colour grade — ${b.grade.name}`, `Palette: ${(b.grade.palette || []).join(" ")}`, b.grade.treatment || "", "", `## Music`, b.music.direction || "", `- Genres: ${(b.music.genres || []).join(", ")} · ${(b.music.bpm || []).join("–")} BPM`, ...(b.music.reference_artists || []).map(a => `- ${a.name} (affinity ${fmt(a.affinity, 2)}) — ${a.why}`), `- Cues: ${(b.music.cue_map || []).map(c => `${c.at_s}s ${c.label}`).join(" · ")}`, "", `## References`, ...(b.references || []).map(r => `- ${r.title} (${r.kind}, affinity ${fmt(r.affinity, 2)}) — ${r.why}`), "", `## Do`, ...(b.do || []).map(x => `- ${x}`), `## Don't`, ...(b.dont || []).map(x => `- ${x}`), "", `## Sound design`, b.sound_design || "", "", `---`, `Generated by TasteCut from Qloo Taste AI affinities (${d.qloo_calls} calls) · ${location.origin}/?b=${d.id}`];
  return L.join("\n");
}
function toast(msg) { let t = $(".toast"); if (!t) { t = el("div", "toast"); document.body.appendChild(t); } t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 1800); }
$("#copy-md").onclick = async () => { if (!state.brief) return; await navigator.clipboard.writeText(toMarkdown(state.brief)); toast("Brief copied as Markdown"); };
$("#print").onclick = () => window.print();
$("#share").onclick = async () => { if (!state.brief) return; await navigator.clipboard.writeText(location.origin + "/?b=" + state.brief.id); toast("Share link copied"); };

// ---------- shared brief on load ----------
(async () => {
  const id = new URLSearchParams(location.search).get("b"); if (!id) return;
  try { const r = await fetch("/api/share/" + id); if (!r.ok) return; const d = await r.json(); $("#room").classList.remove("hidden"); logLine("step done", "00:00:00", "Brief loaded from a share link"); for (const t of (d.trace || [])) logLine("tool", "", `<span class="st">${t.status}</span> ${esc(t.call)}`); state.brief = d; $("#brand").value = d.input.brand; $("#notes").value = d.input.notes || ""; renderBrief(d); $("#room").scrollIntoView(); } catch {}
})();
