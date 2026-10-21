// TasteCut — Cloudflare Pages advanced-mode worker (_worker.js)
// Agent pipeline over the Qloo Taste AI API + Workers AI. No framework, no bundler.
// Routes: POST /api/brief (SSE stream)  · POST /api/match · POST /api/baseline · GET /api/health · GET /api/share/:id

const QLOO_BASE = "https://hackathon.api.qloo.com";
const MODEL_MAIN = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODEL_SMALL = "@cf/meta/llama-3.1-8b-instruct-fast";
const VERSION = "0.9.21";

// ---------- craft knowledge (deterministic, explainable) ----------
// tempo weights: 0 = glacial, 1 = frantic. Keys are matched as substrings of Qloo tag ids/names (lowercase).
const TEMPO_MUSIC = [
  ["ambient",0.12],["classical",0.18],["jazz",0.3],["lo-fi",0.3],["lofi",0.3],["folk",0.32],["singer-songwriter",0.33],["soul",0.38],["r&b",0.42],["rnb",0.42],["country",0.4],["indie",0.5],["alternative",0.52],["pop",0.6],["rock",0.65],["afrobeat",0.68],["afro",0.68],["reggaeton",0.72],["latin",0.7],["hip hop",0.72],["hip-hop",0.72],["hip_hop",0.72],["rap",0.74],["trap",0.84],["punk",0.86],["metal",0.88],["electronic",0.8],["house",0.84],["techno",0.9],["edm",0.9],["dance",0.85],["drum and bass",0.95],["drill",0.85],["k-pop",0.7],["kpop",0.7],["disco",0.7],["funk",0.6],["gospel",0.4],["blues",0.35],["reggae",0.45],["experimental",0.5]
];
const TEMPO_MEDIA = [
  ["action",0.88],["sports",0.85],["music",0.8],["thriller",0.7],["superhero",0.78],["adventure",0.7],["comedy",0.6],["animation",0.62],["horror",0.6],["sci-fi",0.6],["science fiction",0.6],["crime",0.55],["fantasy",0.5],["reality",0.58],["mystery",0.45],["drama",0.3],["documentary",0.28],["romance",0.3],["biography",0.3],["history",0.25],["war",0.5],["family",0.5],["western",0.35],["musical",0.55],["talk",0.4],["news",0.35],["anime",0.7],["stand-up",0.5]
];

// colour grades: id, name, palette (5 hex), notes, moods (matched against tags/words for pre-scoring)
const GRADES = [
  {id:"teal_orange", name:"Teal & Orange", palette:["#0E2A33","#1F6F7A","#F2B35B","#E8773C","#F6E7D0"], notes:"Blockbuster contrast: cool shadows, warm skin. Reads instantly on phones.", moods:["action","adventure","superhero","sports","thriller","hip hop","trap","edm","blockbuster"]},
  {id:"kodak_2383", name:"Kodak 2383 film print", palette:["#141210","#5A3F2E","#B98A5B","#E4C9A4","#F5EFE4"], notes:"Print-stock emulation: soft highlight roll-off, warm mids, gentle halation. Premium without shouting.", moods:["drama","indie","folk","singer-songwriter","soul","jazz","luxury","biography","romance","history"]},
  {id:"bleach_bypass", name:"Bleach bypass", palette:["#0A0A0A","#3A3C3B","#8C8F8A","#C9C6BA","#EFEEE8"], notes:"Silver retained, desaturated, crushed blacks, grit in the mids. Serious, physical, masculine.", moods:["war","crime","thriller","metal","punk","rock","sports","documentary","drill"]},
  {id:"clean_daylight", name:"Clean commercial daylight", palette:["#F7F7F5","#DDE4EA","#9FB6C8","#3E6C8E","#1E2E3C"], notes:"Neutral whites, open shadows, accurate product colour. The 'trust me' grade for retail and tech.", moods:["tech","retail","family","news","talk","pop","clean","software","finance"]},
  {id:"scandi_matte", name:"Scandi matte", palette:["#1C1E1F","#4E5A5B","#8FA3A0","#D3D8D2","#F1F2EE"], notes:"Lifted blacks, low saturation, cool-neutral. Calm, editorial, designed.", moods:["indie","ambient","minimal","design","architecture","documentary","drama","wellness","furniture"]},
  {id:"high_key_pastel", name:"High-key pastel", palette:["#FFF4F0","#FFD6E0","#CDE7F0","#FFE9B8","#C9E4CA"], notes:"Bright exposure, soft pastel saturation, no deep blacks. Playful, feminine, youthful.", moods:["pop","k-pop","comedy","beauty","romance","animation","fashion","candy","gen z"]},
  {id:"neon_noir", name:"Neon noir", palette:["#07060B","#2A0F3D","#8A1E8F","#F0407B","#38D7FF"], notes:"Deep shadow with saturated magenta/cyan practicals. Night, nightlife, gaming, electronic.", moods:["electronic","techno","house","sci-fi","gaming","video game","nightlife","drum and bass","cyber"]},
  {id:"kodachrome_70s", name:"Warm 70s Kodachrome", palette:["#2B1A12","#8A3B1E","#D98A2B","#E9C072","#F3E3C3"], notes:"Saturated reds and yellows, soft cyan skies, grain. Nostalgic, human, sun-drenched.", moods:["funk","disco","soul","classic rock","folk","retro","summer","travel","food","beer","western"]},
  {id:"bw_contrast", name:"Black & white, hard contrast", palette:["#000000","#2B2B2B","#6E6E6E","#BDBDBD","#FFFFFF"], notes:"No colour, strong blacks, specular whites. Timeless, fashion, music portraiture.", moods:["fashion","luxury","jazz","hip hop","portrait","classical","perfume","editorial"]},
  {id:"cross_process", name:"Cross-process acid", palette:["#0F1A0A","#3F7A1A","#C6E22E","#F2F56A","#FF6EC7"], notes:"Shifted greens/yellows, blown highlights, chaotic. Skate, street, youth culture.", moods:["punk","skate","streetwear","alternative","experimental","energy drink","gaming","drill","rap"]},
  {id:"soft_editorial", name:"Soft matte editorial", palette:["#1A1816","#6B5E55","#B9A89A","#E8DCCF","#F8F3EC"], notes:"Warm greys, milky blacks, muted skin. Magazine stillness. Beauty, home, slow fashion.", moods:["beauty","skincare","wellness","home","coffee","fashion","romance","r&b","acoustic"]},
  {id:"afro_saturated", name:"Afro-pop saturated", palette:["#120B04","#C4330F","#F59E0B","#FDE68A","#0EA5A4"], notes:"Full saturation, golden skin, hard sun. Celebration, movement, colour as rhythm.", moods:["afrobeat","afro","amapiano","reggaeton","latin","dance","summer","festival","celebration"]},
  {id:"tungsten_night", name:"Tungsten night", palette:["#0B0B0C","#3A2416","#A8652B","#FFB454","#F3F1EC"], notes:"Warm practicals against near-black. Intimate, premium, late. Spirits, audio gear, cars.", moods:["jazz","soul","whisky","spirits","luxury","audio","automotive","r&b","crime","noir"]}
];

// typography pairings (Google Fonts). display + body, mood keys for pre-scoring.
const TYPE_PAIRS = [
  {id:"instrument_inter", display:"Instrument Serif", body:"Inter Tight", why:"Editorial serif with a tight grotesk: premium, modern, quiet confidence.", moods:["luxury","editorial","drama","indie","design","coffee","fashion","wellness"]},
  {id:"bebas_inter", display:"Bebas Neue", body:"Inter", why:"Condensed caps for impact frames; neutral body for legibility at 15 frames.", moods:["sports","action","energy","hip hop","trap","fitness","gaming","hype"]},
  {id:"space_ibm", display:"Space Grotesk", body:"IBM Plex Sans", why:"Technical grotesk with character; reads 'product' and 'engineering' without coldness.", moods:["tech","software","finance","sci-fi","electronic","startup","crypto"]},
  {id:"playfair_lato", display:"Playfair Display", body:"Lato", why:"High-contrast romantic serif; classic beauty and hospitality language.", moods:["beauty","romance","hospitality","food","wine","wedding","classical"]},
  {id:"anton_worksans", display:"Anton", body:"Work Sans", why:"Poster-weight condensed display; shouts without serif baggage.", moods:["metal","punk","streetwear","drill","rap","sports","festival"]},
  {id:"dmserif_dmsans", display:"DM Serif Display", body:"DM Sans", why:"Soft, friendly serif + geometric body; warm consumer brands.", moods:["home","family","skincare","baby","pop","comedy","retail","bakery"]},
  {id:"syne_manrope", display:"Syne", body:"Manrope", why:"Quirky extended display with a clean body: creative, youthful, art-adjacent.", moods:["alternative","experimental","art","indie","k-pop","animation","design","gen z"]},
  {id:"fraunces_nunito", display:"Fraunces", body:"Nunito", why:"Wonky old-style serif; craft, food and nostalgia with a wink.", moods:["food","coffee","beer","retro","folk","country","craft","bakery","travel"]},
  {id:"oswald_opensans", display:"Oswald", body:"Open Sans", why:"Industrial condensed + utilitarian body: broadcast and automotive energy.", moods:["automotive","news","documentary","war","industrial","tools","sports"]},
  {id:"cormorant_jost", display:"Cormorant Garamond", body:"Jost", why:"Delicate display serif on a geometric sans: perfume, jewellery, slow luxury.", moods:["luxury","perfume","jewellery","fashion","jazz","classical","spirits"]},
  {id:"archivo_black", display:"Archivo Black", body:"Archivo", why:"Heavy grotesk family: loud, direct, street-retail. Reads at any size.", moods:["streetwear","skate","energy drink","hip hop","gaming","fast food","sneakers"]},
  {id:"unbounded_rubik", display:"Unbounded", body:"Rubik", why:"Wide rounded display: playful tech, music apps, nightlife.", moods:["electronic","house","techno","gaming","music","nightlife","app","dance"]},
  {id:"lora_source", display:"Lora", body:"Source Sans 3", why:"Calm transitional serif + humanist sans: trust, health, education.", moods:["health","education","finance","insurance","documentary","biography","wellness","news"]},
  {id:"clash_satoshi", display:"Montserrat", body:"Karla", why:"Geometric display with a friendly body: lifestyle, fitness, travel.", moods:["fitness","travel","lifestyle","pop","afrobeat","summer","retail"]}
];

const EDIT_STYLES = [
  {id:"kinetic_hype", name:"Kinetic hype cut", tempo:[0.72,1], desc:"Cuts on every downbeat and half-beat, whip transitions, speed ramps, impact frames, text slams."},
  {id:"rhythmic_jump", name:"Rhythmic jump-cut", tempo:[0.58,0.8], desc:"Single-subject jump cuts timed to the track, punch-ins, snap zooms, captions as rhythm."},
  {id:"montage_match", name:"Match-cut montage", tempo:[0.5,0.75], desc:"Visual rhymes between shots (shape, motion, colour), steady beat, builds to one reveal."},
  {id:"docu_verite", name:"Docu-vérité", tempo:[0.25,0.5], desc:"Observational, long takes, natural sound, cut on behaviour not beat; interviews as spine."},
  {id:"editorial_lookbook", name:"Editorial lookbook", tempo:[0.3,0.55], desc:"Static frames held like magazine pages, hard cuts on the bar, negative space, type as a character."},
  {id:"luxury_dwell", name:"Luxury dwell", tempo:[0.1,0.35], desc:"Slow push-ins, macro textures, dissolves, silence before the reveal; the cut earns every second."},
  {id:"speed_ramp_sport", name:"Speed-ramp sport", tempo:[0.7,1], desc:"Ramps into impact, slow-mo peaks, cut on contact, crowd cutaways, scoreboard type."},
  {id:"lofi_vlog", name:"Lo-fi vlog cut", tempo:[0.4,0.65], desc:"Handheld, jump cuts, on-screen chat captions, visible imperfection as trust."},
  {id:"split_collage", name:"Split-screen collage", tempo:[0.5,0.8], desc:"Multi-panel compositions, UI-like frames, sticker type, playful chaos with a grid."},
  {id:"anime_impact", name:"Anime impact frames", tempo:[0.65,1], desc:"Smear/impact frames, hold-then-burst timing, bold outlines, sound-design hits."},
  {id:"slow_cinema", name:"Slow cinema breath", tempo:[0,0.25], desc:"Very long takes, ambient sound, minimal type, a single cut that means something."},
  {id:"social_whip", name:"Social whip-pan", tempo:[0.6,0.85], desc:"Phone-native 9:16, whip pans as transitions, POV, 1.5-second scene changes, big captions."}
];

// ---------- small utils ----------
const enc = new TextEncoder();
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
const lc = (s) => String(s || "").toLowerCase();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const tc = (ms) => { const s = Math.floor(ms / 1000); const f = Math.floor((ms % 1000) / (1000 / 30)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(f).padStart(2, "0")}`; };
async function sha(s) { const d = await crypto.subtle.digest("SHA-256", enc.encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16); }

function safeJsonParse(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) t = fence[1].trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) t = t.slice(a, b + 1);
  const tries = [t, t.replace(/,\s*([}\]])/g, "$1"), repairJson(t)];
  for (const s of tries) { try { const j = JSON.parse(s); if (j && typeof j === "object") return j; } catch {} }
  return null;
}
function repairJson(t) {
  // best-effort: fix ":," glitches, then close any open string/brackets of a truncated answer
  let s = t.replace(/:\s*,/g, ": null,").replace(/,\s*([}\]])/g, "$1");
  // dropped quotes the model sometimes emits: `rhythms}], cue_map": [` -> `rhythms"}], "cue_map": [`
  s = s.replace(/([{,]\s*)([a-z_]+)"\s*:/g, '$1"$2":').replace(/([A-Za-z0-9.!?)'’%-])\}(?=\s*[\],}])/g, '$1"}');
  let inStr = false, esc = false; const stack = [];
  for (const ch of s) { if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; } if (ch === '"') inStr = true; else if (ch === "{" || ch === "[") stack.push(ch); else if (ch === "}" || ch === "]") stack.pop(); }
  if (inStr) s += '"';
  s = s.replace(/,\s*$/, "").replace(/:\s*$/, ": null");
  while (stack.length) s += stack.pop() === "{" ? "}" : "]";
  return s.replace(/,\s*([}\]])/g, "$1");
}


// ---------- Qloo client ----------
// The hackathon key allows 10 requests/second. One brief fans out ~7 parallel calls, so concurrent users
// can trip the limit: cap in-flight calls per isolate, retry 429s with jittered backoff, and edge-cache
// successful GETs for a day (taste graphs don't move minute to minute).
const QLOO_MAX_INFLIGHT = 4;
let qlooInflight = 0; const qlooWaiters = [];
async function qlooSlot() { if (qlooInflight < QLOO_MAX_INFLIGHT) { qlooInflight++; return; } await new Promise(r => qlooWaiters.push(r)); qlooInflight++; }
function qlooRelease() { qlooInflight--; const w = qlooWaiters.shift(); if (w) w(); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function qlooFetch(url, key, onRetry) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const ck = new Request("https://qloo-cache.tastecut/" + encodeURIComponent(url));
  if (cache) { try { const hit = await cache.match(ck); if (hit) return { res: { status: 200, cached: true }, body: await hit.json() }; } catch {} }
  let res, body;
  for (let attempt = 0; attempt < 5; attempt++) {
    await qlooSlot();
    try { res = await fetch(url, { headers: { "X-Api-Key": key, accept: "application/json" } }); body = await res.json().catch(() => ({})); }
    finally { qlooRelease(); }
    if (res.status !== 429 && res.status < 500) break;
    if (attempt < 4) { onRetry && onRetry(attempt); await sleep(350 * 2 ** attempt + Math.random() * 400); }
  }
  if (res.status === 200 && cache) { try { await cache.put(ck, new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" } })); } catch {} }
  return { res, body };
}
class Qloo {
  constructor(key, trace) { this.key = key; this.trace = trace; this.calls = 0; }
  async get(path, params, label) {
    const url = new URL(QLOO_BASE + path);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    const t0 = Date.now(); this.calls++;
    const shown = path + "?" + decodeURIComponent(url.searchParams.toString()).replace(/urn:entity:/g, "urn:entity:");
    let res, body;
    try {
      ({ res, body } = await qlooFetch(url.toString(), this.key, () => { this.retries = (this.retries || 0) + 1; }));
    } catch (e) { body = { error: String(e) }; res = { status: 0 }; }
    const ms = Date.now() - t0;
    const rec = { call: "GET " + shown, status: res.status, ms, label };
    if (res.cached) rec.cached = true;
    if (res.status !== 200) rec.error = (body && (body.error_msg || body.message || body.error || JSON.stringify(body).slice(0, 200))) || "error";
    this.trace && this.trace(rec);
    if (res.status !== 200) throw Object.assign(new Error(`Qloo ${res.status} on ${path}: ${rec.error}`), { status: res.status, body });
    return body;
  }
  async search(query, types, take = 6) {
    const p = { query, take }; if (types) p.types = types;
    const b = await this.get("/search", p, `search "${query}"`);
    return (b.results || []).map(slimEntity);
  }
  async insights(filterType, signalEntities, extra = {}, take = 10, label) {
    const p = { "filter.type": filterType, take, ...extra };
    if (signalEntities && signalEntities.length) p["signal.interests.entities"] = signalEntities;
    const b = await this.get("/v2/insights", p, label || filterType.replace("urn:entity:", ""));
    const r = b.results || {};
    return { entities: (r.entities || []).map(slimEntity), tags: (r.tags || []).map(slimTag), demographics: r.demographics || [], explainability: (b.query && b.query.explainability) || null, raw_count: (r.entities || r.tags || []).length };
  }
  async compare(a, b, filterType, take = 12) {
    const body = await this.get("/v2/analysis/compare", { "a.signal.interests.entities": a, "b.signal.interests.entities": b, "filter.type": filterType, take }, "compare " + filterType.replace("urn:entity:", ""));
    return body;
  }
}
function slimEntity(e) {
  if (!e) return null;
  const props = e.properties || {};
  const tags = (e.tags || []).map(slimTag).filter(t => t && !/streaming_service|website|wikipedia|akas/.test(t.type || ""));
  return {
    id: e.entity_id || e.id, name: e.name, subtype: e.subtype || (Array.isArray(e.types) && e.types[0]) || e.type, popularity: e.popularity != null ? round(e.popularity, 3) : null,
    affinity: e.query && e.query.affinity != null ? round(e.query.affinity, 3) : null,
    image: props.image && props.image.url ? props.image.url : null,
    description: props.description || props.short_description || null,
    year: props.release_year || props.date_of_birth || null,
    tags: tags.slice(0, 12),
    disambiguation: e.disambiguation || null,
    explain: e.query && e.query.explainability ? e.query.explainability : null
  };
}
const tidyName = (n) => typeof n === "string" ? n.replace(/\s+/g, " ").replace(/\s*-\s*/g, "-").trim() : n;
function mergeHits(hits) { const m = new Map(); for (const h of hits || []) { const k = lc(h.tag || ""); const o = m.get(k); if (o) o.weight = round(o.weight + h.weight, 2); else m.set(k, { ...h }); } return [...m.values()].sort((a, b) => b.weight - a.weight); }
function slimTag(t) { if (!t) return null; return { id: t.id || t.tag_id, name: tidyName(t.name), type: t.type || t.subtype || null, affinity: t.query && t.query.affinity != null ? round(t.query.affinity, 3) : null }; }

// ---------- Workers AI ----------
async function llmStream(env, messages, { model = MODEL_MAIN, max_tokens = 900, temperature = 0.4, onText = null } = {}) {
  // streams tokens; returns {text, model}. Falls back to the small model, then to non-streaming.
  const run = async (m) => {
    const stream = await env.AI.run(m, { messages, max_tokens, temperature, stream: true });
    const reader = stream.getReader(); const dec = new TextDecoder(); let buf = "", text = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue; const payload = line.slice(5).trim(); if (payload === "[DONE]") continue;
        try { const j = JSON.parse(payload); const d0 = j.choices && j.choices[0] && j.choices[0].delta; const piece = (d0 && typeof d0.content === "string") ? d0.content : (typeof j.response === "string" ? j.response : ""); /* the `response` field drops quotes in some chunks (measured 2026-10-20); delta.content is exact */ if (piece) { text += piece; onText && onText(text, piece); } } catch {}
      }
    }
    return text;
  };
  try { return { text: await run(model), model }; }
  catch (e) { try { return { text: await run(MODEL_SMALL), model: MODEL_SMALL, fallback: String(e.message).slice(0, 120) }; } catch (e2) { const r = await llm(env, messages, { model, max_tokens, temperature }); return r; } }
}
async function llm(env, messages, { model = MODEL_MAIN, max_tokens = 1200, temperature = 0.4, json_schema = null } = {}) {
  const opts = { messages, max_tokens, temperature };
  if (json_schema) opts.response_format = { type: "json_schema", json_schema };
  const run = async (m) => { const r = await env.AI.run(m, opts); if (typeof r === "string") return r; const v = r.response ?? (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) ?? r; return typeof v === "string" ? v : JSON.stringify(v); };
  try { return { text: await run(model), model }; }
  catch (e) {
    const msg = String(e && e.message || e);
    if (model !== MODEL_SMALL) { try { return { text: await run(MODEL_SMALL), model: MODEL_SMALL, fallback: msg.slice(0, 120) }; } catch (e2) { throw e2; } }
    throw e;
  }
}

// ---------- deterministic derivations from Qloo evidence ----------
function tempoFromTags(tagLists, table) {
  // tagLists: array of {name,id,affinity|weight}; returns {index, hits:[{tag,tempo,weight}]}
  let num = 0, den = 0; const hits = [];
  for (const t of tagLists) {
    const key = lc((t.name || "") + " " + (t.id || ""));
    for (const [k, v] of table) { if (key.includes(k)) { const w = t.affinity != null ? Math.max(0.05, t.affinity) : (t.weight || 0.5); num += v * w; den += w; hits.push({ tag: t.name || t.id, tempo: v, weight: round(w, 2) }); break; } }
  }
  return { index: den ? num / den : null, hits };
}
function collectTags(entities) {
  const m = new Map();
  for (const e of entities || []) for (const t of (e.tags || [])) { if (!t || !t.id) continue; const w = (e.affinity != null ? e.affinity : 0.5); const cur = m.get(t.id) || { id: t.id, name: t.name, type: t.type, weight: 0, n: 0 }; cur.weight += w; cur.n++; m.set(t.id, cur); }
  return [...m.values()].sort((a, b) => b.weight - a.weight);
}
function derive(ev, deliverable) {
  // ev: {taste(tags), music(entities), movies, tv, brands, brand}
  const musicTags = collectTags(ev.music).filter(t => /genre|style/.test(lc(t.type)) || /genre/.test(lc(t.id)));
  const mediaTags = collectTags([...(ev.movies || []), ...(ev.tv || [])]).filter(t => /genre/.test(lc(t.id)) || /genre/.test(lc(t.type)));
  const tasteTags = (ev.taste || []).map(t => ({ ...t, weight: t.affinity != null ? t.affinity : 0.5 }));
  const tm = tempoFromTags(musicTags.length ? musicTags : tasteTags, TEMPO_MUSIC);
  const tv = tempoFromTags(mediaTags.length ? mediaTags : tasteTags, TEMPO_MEDIA);
  const parts = [tm.index, tv.index].filter(x => x != null);
  let index = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0.5;
  // deliverable nudges: short social = faster
  const d = lc(deliverable); let nudge = 0;
  if (/15|reel|tiktok|short/.test(d)) nudge += 0.12; else if (/30/.test(d)) nudge += 0.05; else if (/brand film|60|90|doc|documentary|3 ?min|long/.test(d)) nudge -= 0.1;
  index = clamp(index + nudge, 0.05, 0.98);
  const cpm = Math.round(18 + 102 * index); // 18..120 cuts per minute
  const avgShot = round(60 / cpm, 1);
  const styles = EDIT_STYLES.filter(s => index >= s.tempo[0] - 0.05 && index <= s.tempo[1] + 0.05).map(s => s.id);
  // keyword bag for mood scoring
  const bag = [...musicTags, ...mediaTags, ...tasteTags, ...collectTags(ev.brands)].map(t => lc(t.name || (t.id || "").split(":").pop().replace(/_/g, " ")));
  if (ev.brand && ev.brand.tags) for (const t of ev.brand.tags) bag.push(lc(t.name));
  if (ev.brand && ev.brand.description) bag.push(lc(ev.brand.description));
  for (const m of (ev.mood_words || [])) bag.push(lc(m));
  if (ev.category) bag.push(lc(ev.category));
  const scoreMoods = (moods) => moods.reduce((s, m) => s + bag.filter(b => b.includes(m)).length, 0);
  const grades = GRADES.map(g => ({ id: g.id, name: g.name, score: scoreMoods(g.moods) })).sort((a, b) => b.score - a.score);
  const pairs = TYPE_PAIRS.map(p => ({ id: p.id, display: p.display, body: p.body, score: scoreMoods(p.moods) })).sort((a, b) => b.score - a.score);
  return {
    tempo: { index: round(index, 2), cuts_per_min: cpm, avg_shot_s: avgShot, music_hits: mergeHits(tm.hits).slice(0, 8), media_hits: mergeHits(tv.hits).slice(0, 8), music_index: tm.index != null ? round(tm.index, 2) : null, media_index: tv.index != null ? round(tv.index, 2) : null, nudge: round(nudge, 2) },
    candidate_styles: styles.length ? styles : ["rhythmic_jump", "montage_match"],
    candidate_grades: grades.slice(0, 5), candidate_pairs: pairs.slice(0, 5),
    music_genres: musicTags.slice(0, 10).map(t => ({ name: t.name, weight: round(t.weight, 2) })),
    media_genres: mediaTags.slice(0, 10).map(t => ({ name: t.name, weight: round(t.weight, 2) }))
  };
}
function bpmForGenres(genres) {
  const table = [["ambient",[60,80]],["classical",[60,100]],["jazz",[80,130]],["lo",[70,90]],["folk",[80,110]],["soul",[70,100]],["r&b",[65,95]],["rnb",[65,95]],["country",[85,115]],["indie",[100,130]],["pop",[100,125]],["rock",[110,140]],["afro",[100,115]],["amapiano",[110,115]],["reggaeton",[88,100]],["latin",[90,110]],["hip",[85,100]],["rap",[85,100]],["trap",[130,150]],["drill",[138,146]],["punk",[150,190]],["metal",[120,180]],["house",[120,128]],["techno",[125,140]],["edm",[125,135]],["dance",[118,130]],["drum",[170,176]],["disco",[110,125]],["funk",[95,115]],["k-pop",[110,130]]];
  const hits = [];
  for (const g of genres) { const k = lc(g.name); for (const [key, r] of table) if (k.includes(key)) { hits.push(r); break; } }
  if (!hits.length) return [90, 120];
  const lo = Math.round(hits.reduce((s, r) => s + r[0], 0) / hits.length), hi = Math.round(hits.reduce((s, r) => s + r[1], 0) / hits.length);
  return [lo, Math.max(hi, lo + 8)];
}

// ---------- the agent ----------
const DELIVERABLES = { "15s_reel": { label: "15 s vertical reel", seconds: 15, aspect: "9:16" }, "30s_ad": { label: "30 s ad", seconds: 30, aspect: "16:9" }, "60s_film": { label: "60 s brand film", seconds: 60, aspect: "16:9" }, "yt_preroll": { label: "YouTube pre-roll (6 + 20 s)", seconds: 26, aspect: "16:9" }, "3min_doc": { label: "3 min mini-doc", seconds: 180, aspect: "16:9" } };

async function runAgent(env, input, emit) {
  const t0 = Date.now();
  const trace = [];
  const step = (id, label, status = "running", extra = {}) => emit({ t: "step", id, label, status, tc: tc(Date.now() - t0), ...extra });
  const tool = (rec) => { trace.push(rec); emit({ t: "tool", tc: tc(Date.now() - t0), ...rec }); };
  const think = (text) => emit({ t: "think", tc: tc(Date.now() - t0), text });
  const q = new Qloo(env.QLOO_API_KEY, tool);
  const brandIn = String(input.brand || "").trim().slice(0, 120);
  const notes = String(input.notes || "").trim().slice(0, 1200);
  const delKey = DELIVERABLES[input.deliverable] ? input.deliverable : "30s_ad";
  const deliverable = { key: delKey, ...DELIVERABLES[delKey] };
  if (!brandIn) throw new Error("brand is required");

  // 1. READ — the LLM reads the request and plans the search
  step("read", "Reading the brief");
  let plan = null; let llmMeta = {};
  try {
    const r = await llm(env, [
      { role: "system", content: "You are TasteCut's planner, a senior creative director who briefs video editors. Reply with strict JSON only." },
      { role: "user", content: `Brand or client: "${brandIn}"\nNotes from the editor (may be empty): "${notes}"\nDeliverable: ${deliverable.label}.\n\nReturn JSON: {"brand_query": "the cleanest search string for the brand on a cultural database (brand name only, no descriptors)", "category": "2-4 word category guess", "likely_known": true|false (is this a globally known brand that a taste database of 250M entities would have?), "proxies": ["3 to 5 well-known brands with the same audience and vibe, for use if the brand itself is not in the database"], "audience_guess": "one sentence", "mood_words": ["5 to 8 lowercase adjectives for the brand's vibe"], "avoid": ["1 to 3 things this brand would never do in a video"]}` }
    ], { model: MODEL_SMALL, max_tokens: 400, temperature: 0.2 });
    plan = safeJsonParse(r.text); llmMeta.read = r.model; if (!plan) think("planner returned non-JSON: " + String(r.text).slice(0, 160));
  } catch (e) { think("planner unavailable (" + String(e.message).slice(0, 80) + "); using the brand name as the query"); }
  if (!plan || !plan.brand_query) plan = { brand_query: brandIn, category: "", likely_known: true, proxies: [], mood_words: [], avoid: [] };
  plan.brand_query = String(plan.brand_query || brandIn).slice(0, 80);
  think(`Query "${plan.brand_query}" · category: ${plan.category || "?"} · proxies if unknown: ${(plan.proxies || []).slice(0, 4).join(", ") || "none"}`);
  step("read", "Brief read", "done", { plan: { category: plan.category, mood_words: plan.mood_words, proxies: plan.proxies, audience_guess: plan.audience_guess, avoid: plan.avoid } });

  // 2. RESOLVE — find the brand on the taste graph
  step("resolve", "Resolving the brand on Qloo");
  let brand = null, resolvedVia = "qloo", candidates = [];
  try { candidates = await q.search(plan.brand_query, "urn:entity:brand", 6); } catch (e) { think("brand search failed: " + e.message.slice(0, 100)); }
  if (!candidates.length && plan.brand_query.toLowerCase() !== brandIn.toLowerCase()) { try { candidates = await q.search(brandIn, "urn:entity:brand", 6); } catch {} }
  if (candidates.length) {
    // pick: exact name match first, else highest popularity among top 3
    const exact = candidates.find(c => lc(c.name) === lc(plan.brand_query) || lc(c.name) === lc(brandIn));
    brand = exact || candidates.slice(0, 3).sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
    think(`${candidates.length} candidates; picked "${brand.name}"${brand.disambiguation ? " (" + brand.disambiguation + ")" : ""} popularity ${brand.popularity}`);
  }
  let signal = [];
  let proxies = [];
  if (brand) signal = [brand.id];
  else {
    resolvedVia = "proxy";
    think(`"${brandIn}" is not on the graph. Grounding through its cultural neighbours instead.`);
    const names = (plan.proxies || []).slice(0, 4);
    const found = await Promise.all(names.map(n => q.search(n, "urn:entity:brand", 1).then(r => r[0]).catch(() => null)));
    proxies = found.filter(Boolean);
    signal = proxies.map(p => p.id);
    if (!signal.length) throw Object.assign(new Error("Could not ground this brand or any proxy on Qloo. Try a better-known brand name or add comparable brands in the notes."), { status: 422 });
    think(`Proxies on the graph: ${proxies.map(p => p.name).join(", ")}`);
  }
  step("resolve", brand ? `Resolved: ${brand.name}` : `Grounded via ${proxies.length} proxy brands`, "done", { brand, proxies, via: resolvedVia });

  // 3-7. the taste graph, in parallel
  step("graph", "Reading the taste graph");
  const ex = { "feature.explainability": signal.length > 1 ? "true" : undefined };
  const [demo, taste, music, movies, tv, brands, podcasts] = await Promise.all([
    q.insights("urn:demographics", signal, {}, 10, "demographics").catch(e => ({ error: e.message, demographics: [] })),
    q.insights("urn:tag", signal, { "filter.tag.types": "urn:tag:keyword:media,urn:tag:genre:media,urn:tag:genre:music,urn:tag:genre:brand,urn:tag:style,urn:tag:audience" }, 24, "taste tags").catch(e => ({ error: e.message, tags: [] })),
    q.insights("urn:entity:artist", signal, ex, 12, "artists").catch(e => ({ error: e.message, entities: [] })),
    q.insights("urn:entity:movie", signal, ex, 8, "movies").catch(e => ({ error: e.message, entities: [] })),
    q.insights("urn:entity:tv_show", signal, ex, 6, "tv shows").catch(e => ({ error: e.message, entities: [] })),
    q.insights("urn:entity:brand", signal, { "filter.exclude.entities": signal.join(",") }, 10, "brands").catch(e => ({ error: e.message, entities: [] })),
    q.insights("urn:entity:podcast", signal, {}, 5, "podcasts").catch(e => ({ error: e.message, entities: [] }))
  ]);
  // taste tags fallback: if the typed filter returned nothing, ask untyped
  let tasteTags = taste.tags || [];
  if (!tasteTags.length && !taste.error) { try { tasteTags = (await q.insights("urn:tag", signal, {}, 24, "taste tags (all types)")).tags; } catch {} }
  const demographics = parseDemo(demo.demographics, signal);
  const ev = { brand, proxies, taste: tasteTags, music: music.entities || [], movies: movies.entities || [], tv: tv.entities || [], brands: brands.entities || [], podcasts: podcasts.entities || [], demographics };
  const counts = { tags: ev.taste.length, artists: ev.music.length, movies: ev.movies.length, tv: ev.tv.length, brands: ev.brands.length, podcasts: ev.podcasts.length };
  think(`Graph read: ${counts.artists} artists, ${counts.movies} films, ${counts.tv} shows, ${counts.brands} neighbouring brands, ${counts.tags} taste tags, ${demographics ? "demographics" : "no demographics"}`);
  step("graph", "Taste graph read", "done", { counts, evidence: { demographics, taste: ev.taste.slice(0, 18), music: ev.music, movies: ev.movies, tv: ev.tv, brands: ev.brands, podcasts: ev.podcasts }, errors: [demo, taste, music, movies, tv, brands, podcasts].map(x => x.error).filter(Boolean) });
  if (!ev.music.length && !ev.movies.length && !ev.tv.length) throw Object.assign(new Error("Qloo returned no affinities for this signal."), { status: 422 });

  // 8. DERIVE — deterministic craft numbers
  step("derive", "Deriving pacing, grade and type candidates");
  ev.mood_words = plan.mood_words; ev.category = plan.category;
  const d = derive(ev, deliverable.label);
  const bpm = bpmForGenres(d.music_genres);
  think(`Tempo index ${d.tempo.index} (music ${d.tempo.music_index ?? "–"}, screen ${d.tempo.media_index ?? "–"}, deliverable ${d.tempo.nudge >= 0 ? "+" : ""}${d.tempo.nudge}) → ${d.tempo.cuts_per_min} cuts/min, avg shot ${d.tempo.avg_shot_s} s · BPM ${bpm[0]}–${bpm[1]}`);
  step("derive", "Craft numbers derived", "done", { derive: d, bpm });

  // 9. SYNTHESISE — two parallel streamed writers (craft, and music + references)
  step("write", "Writing the brief");
  const ctxText = evidenceForPrompt(ev, d, bpm, plan, deliverable, brandIn, notes);
  const sys = "You are TasteCut, a senior creative director and editor briefing a video editor. Only make claims the evidence supports; name the evidence that drove each section. Tight, specific, craft-level English in an editor's voice, no marketing filler. Reply with strict JSON matching the requested shape and nothing else.";
  const progress = {}; let lastEmit = 0;
  const onText = (part) => (text) => { progress[part] = text.length; const now = Date.now(); if (now - lastEmit > 400) { lastEmit = now; emit({ t: "writing", tc: tc(now - t0), chars: Object.values(progress).reduce((x, y) => x + y, 0), tail: text.slice(-140) }); } };
  const ask = async (part, prompt) => { for (let attempt = 0; attempt < 2; attempt++) { try { const r = await llmStream(env, [{ role: "system", content: sys }, { role: "user", content: ctxText + "\n\n" + prompt + (attempt ? "\n\nReturn ONLY the JSON object, no prose." : "") }], { model: MODEL_MAIN, max_tokens: part === "craft" ? 1300 : 1000, temperature: 0.45, onText: onText(part) }); const j = safeJsonParse(r.text); if (input.dev && input.dev.raw) emit({ t: "raw", part, attempt, text: r.text }); if (j) return { j, model: r.model, fallback: r.fallback }; think(`${part} writer (${r.model}${r.fallback ? ", fallback: " + r.fallback : ""}) returned non-JSON (attempt ${attempt + 1}), ${r.text.length} chars: ${JSON.stringify(r.text.slice(0, 120))} … ${JSON.stringify(r.text.slice(-80))}`); } catch (e) { think(`${part} writer error: ${String(e.message).slice(0, 120)}`); } } return { j: null }; };
  const craftPrompt = `Write the CRAFT half of the brief as JSON with exactly these keys and NO others — no music, no references, they are written separately (keep every string under 40 words):
{"headline": "max 12 words, the whole direction in an editor's language",
 "positioning": "2 sentences on who this audience is culturally and what they respond to; name 2-3 specific artists/films/brands from the evidence",
 "edit_style": {"id": "<edit style id from the library>", "summary": "3 sentences of concrete technique for THIS ${deliverable.seconds} s ${deliverable.aspect} piece", "techniques": ["5 short technique lines"], "evidence": "the tags/entities that drove this"},
 "pacing": {"cuts_per_min": number (adjust the derived ${d.tempo.cuts_per_min} by at most 20%), "rhythm": "2 sentences on where to cut fast vs hold, with timecodes inside ${deliverable.seconds} s", "hook_0_3s": "exactly what is on screen and in the audio in the first 3 seconds", "evidence": ""},
 "typography": {"pair_id": "<type pair id>", "treatment": "2 sentences: size, case, motion, where type lives in frame", "evidence": ""},
 "grade": {"id": "<grade id>", "treatment": "2 sentences: how to push it for this brand — skin, highlights, grain", "evidence": ""},
 "sound_design": "2 sentences",
 "do": ["4 specific dos"], "dont": ["4 specific donts; include the brand's avoid list"],
 "confidence": {"score": 0-1, "note": "one line on how strong the Qloo signal was"}}`;
  const musicPrompt = `Write the MUSIC + REFERENCES half of the brief as JSON with exactly these two top-level keys and NO others (keep strings under 35 words):
{"music": {"direction": "3 sentences: genre, energy curve across ${deliverable.seconds} s, instrumentation, vocal or not", "genres": ["3-5"], "bpm": [lo, hi] (inside or near ${bpm[0]}-${bpm[1]}), "reference_artists": [{"name": "ONLY names from the artist evidence", "why": "one line: what to borrow from their sound"}] (4-6), "cue_map": [{"at_s": number, "label": "2-3 words"}] (4 points across ${deliverable.seconds} s: open, build, peak, button), "evidence": ""},
 "references": [{"title": "ONLY titles from the films / TV / brands / podcasts evidence", "kind": "film|tv|brand|podcast", "why": "one line on exactly what to steal (a cut, a frame, a colour, a title treatment)"}] (6)}`;
  const [craft, musicRefs] = await Promise.all([ask("craft", craftPrompt), ask("music", musicPrompt)]);
  let brief = { ...(craft.j || {}), ...(musicRefs.j || {}) };
  const writeModel = [craft.model, musicRefs.model].filter(Boolean).join(" + ") || null;
  if (craft.fallback || musicRefs.fallback) think("main model unavailable for part of the brief; the small model stood in");
  if (!craft.j) brief = { ...fallbackBrief(ev, d, bpm, deliverable, brandIn), ...(musicRefs.j || {}) };
  if (!musicRefs.j) { const fb = fallbackBrief(ev, d, bpm, deliverable, brandIn); brief.music = brief.music || fb.music; brief.references = brief.references || fb.references; }
  brief = normaliseBrief(brief, d, bpm, ev);
  step("write", "Brief written", "done", { models: writeModel });

  const out = {
    version: VERSION, degraded: !craft.j || !musicRefs.j, id: await sha(JSON.stringify({ brandIn, notes, delKey, v: VERSION })), created: new Date().toISOString(), elapsed_ms: Date.now() - t0,
    input: { brand: brandIn, notes, deliverable },
    plan, resolved: { via: resolvedVia, brand, proxies, signal },
    evidence: { ...ev, mood_words: undefined, category: undefined }, derived: { ...d, bpm }, brief, models: { read: llmMeta.read, write: writeModel }, qloo_calls: q.calls, trace
  };
  return out;
}

function parseDemo(list, signal) {
  if (!Array.isArray(list) || !list.length) return null;
  // average over the signal entities
  const age = {}, gender = {}; let n = 0;
  for (const d of list) { const qd = d.query || {}; if (!qd.age) continue; n++; for (const [k, v] of Object.entries(qd.age)) age[k] = (age[k] || 0) + v; for (const [k, v] of Object.entries(qd.gender || {})) gender[k] = (gender[k] || 0) + v; }
  if (!n) return null;
  for (const k in age) age[k] = round(age[k] / n, 2); for (const k in gender) gender[k] = round(gender[k] / n, 2);
  const top = Object.entries(age).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k.replace(/_/g, " "));
  const g = Object.entries(gender).sort((a, b) => b[1] - a[1])[0];
  return { age, gender, summary: `over-indexes ${top.join(" and ")}${g ? `, skews ${g[0]} (${g[1] > 0 ? "+" : ""}${g[1]})` : ""}` };
}

function evidenceForPrompt(ev, d, bpm, plan, deliverable, brandIn, notes) {
  const li = (arr, f) => arr.slice(0, 10).map(f).join("; ");
  const art = li(ev.music, a => `${a.name} (aff ${a.affinity ?? "–"}${a.tags && a.tags.length ? ", " + a.tags.filter(t => /genre/.test(lc(t.id))).slice(0, 2).map(t => t.name).join("/") : ""})`);
  const mov = li(ev.movies, m => `${m.name}${m.year ? " " + m.year : ""} (aff ${m.affinity ?? "–"}${m.tags && m.tags.length ? ", " + m.tags.filter(t => /genre/.test(lc(t.id))).slice(0, 2).map(t => t.name).join("/") : ""})`);
  const tvs = li(ev.tv, m => `${m.name} (aff ${m.affinity ?? "–"})`);
  const br = li(ev.brands, b => `${b.name} (aff ${b.affinity ?? "–"})`);
  const tags = ev.taste.slice(0, 18).map(t => `${t.name}${t.affinity != null ? " " + t.affinity : ""}`).join(", ");
  const pods = li(ev.podcasts, p => p.name);
  const demo = ev.demographics ? `age ${JSON.stringify(ev.demographics.age)}, gender ${JSON.stringify(ev.demographics.gender)} (positive = over-index vs average)` : "not available";
  const gradeList = GRADES.map(g => `${g.id} = ${g.name}: ${g.notes}`).join("\n");
  const pairList = TYPE_PAIRS.map(p => `${p.id} = ${p.display} + ${p.body}: ${p.why}`).join("\n");
  const styleList = EDIT_STYLES.map(s => `${s.id} = ${s.name} (tempo ${s.tempo[0]}-${s.tempo[1]}): ${s.desc}`).join("\n");
  return `BRAND: ${brandIn}${ev.brand ? ` — resolved on Qloo as "${ev.brand.name}" (popularity ${ev.brand.popularity}${ev.brand.description ? "; " + ev.brand.description.slice(0, 200) : ""})` : ` — not on Qloo; grounded via proxy brands ${ev.proxies.map(p => p.name).join(", ")}`}
CATEGORY GUESS: ${plan.category || "?"} · MOOD WORDS: ${(plan.mood_words || []).join(", ")} · AVOID: ${(plan.avoid || []).join("; ")}
EDITOR NOTES: ${notes || "(none)"}
DELIVERABLE: ${deliverable.label} (${deliverable.seconds} s, ${deliverable.aspect})

QLOO EVIDENCE (affinity 0-1, higher = the brand's audience loves it more than average):
- Audience demographics: ${demo}
- Taste tags: ${tags || "none"}
- Artists the audience over-indexes on: ${art || "none"}
- Films: ${mov || "none"}
- TV: ${tvs || "none"}
- Neighbouring brands (same audience): ${br || "none"}
- Podcasts: ${pods || "none"}

DERIVED NUMBERS (deterministic, from the genre tags above): tempo index ${d.tempo.index} (0 glacial → 1 frantic; music-side ${d.tempo.music_index ?? "n/a"}, screen-side ${d.tempo.media_index ?? "n/a"}, deliverable nudge ${d.tempo.nudge}); recommended ${d.tempo.cuts_per_min} cuts/min, average shot ${d.tempo.avg_shot_s} s; music BPM window ${bpm[0]}-${bpm[1]}; top music genres ${d.music_genres.map(g => g.name).join(", ") || "n/a"}; top screen genres ${d.media_genres.map(g => g.name).join(", ") || "n/a"}.
Candidate edit styles by tempo: ${d.candidate_styles.join(", ")}. Pre-scored grades: ${d.candidate_grades.map(g => g.id + "(" + g.score + ")").join(", ")}. Pre-scored type pairs: ${d.candidate_pairs.map(p => p.id + "(" + p.score + ")").join(", ")}.

LIBRARIES (pick ids from these):
EDIT STYLES:\n${styleList}
GRADES:\n${gradeList}
TYPE PAIRS:\n${pairList}

Write the brief as JSON with exactly these keys:
{
 "headline": "one line, max 12 words, the whole direction in the editor's language",
 "positioning": "2 sentences: who this audience is culturally and what they respond to, citing 2-3 specific artists/films/brands from the evidence",
 "edit_style": {"id": "<edit style id>", "name": "", "summary": "3 sentences of concrete technique for THIS deliverable", "techniques": ["5 short technique lines"], "evidence": "which evidence drove this (name the tags/entities)"},
 "pacing": {"cuts_per_min": number (you may adjust the derived number by at most 20%), "avg_shot_s": number, "rhythm": "2 sentences on where to cut fast vs hold, with timecodes for this ${deliverable.seconds} s piece", "hook_0_3s": "what happens in the first 3 seconds", "evidence": ""},
 "typography": {"pair_id": "<type pair id>", "display": "", "body": "", "treatment": "2 sentences: size, case, animation, where type lives in frame", "evidence": ""},
 "grade": {"id": "<grade id>", "name": "", "treatment": "2 sentences: how to push it for this brand, skin, highlights, grain", "evidence": ""},
 "music": {"direction": "3 sentences: genre, energy curve, instrumentation, vocal or not", "genres": ["3-5"], "bpm": [lo, hi], "reference_artists": [{"name": "from the artist evidence only", "why": "one line"}] (4-6), "cue_map": [{"at_s": number, "label": "short"}] (3-5 points across ${deliverable.seconds} s), "evidence": ""},
 "references": [{"title": "from films/TV/brands evidence only", "kind": "film|tv|brand|podcast", "why": "one line on what to steal from it"}] (5-7),
 "do": ["4 specific dos"], "dont": ["4 specific donts, include the brand's avoid list"],
 "sound_design": "2 sentences",
 "confidence": {"score": 0-1, "note": "one line on how strong the Qloo signal was"}
}`;
}
function briefSchema() {
  const S = (props, req) => ({ type: "object", properties: props, required: req || Object.keys(props) });
  const str = { type: "string" }, num = { type: "number" }, arr = (i) => ({ type: "array", items: i });
  return { name: "brief", schema: S({
    headline: str, positioning: str,
    edit_style: S({ id: str, name: str, summary: str, techniques: arr(str), evidence: str }),
    pacing: S({ cuts_per_min: num, avg_shot_s: num, rhythm: str, hook_0_3s: str, evidence: str }),
    typography: S({ pair_id: str, display: str, body: str, treatment: str, evidence: str }),
    grade: S({ id: str, name: str, treatment: str, evidence: str }),
    music: S({ direction: str, genres: arr(str), bpm: arr(num), reference_artists: arr(S({ name: str, why: str })), cue_map: arr(S({ at_s: num, label: str })), evidence: str }),
    references: arr(S({ title: str, kind: str, why: str })),
    do: arr(str), dont: arr(str), sound_design: str,
    confidence: S({ score: num, note: str })
  }) };
}
function normaliseBrief(b, d, bpm, ev) {
  b = b || {};
  const style = EDIT_STYLES.find(s => s.id === (b.edit_style && b.edit_style.id)) || EDIT_STYLES.find(s => s.id === d.candidate_styles[0]) || EDIT_STYLES[1];
  b.edit_style = { ...(b.edit_style || {}), id: style.id, name: style.name, library: style.desc };
  const grade = GRADES.find(g => g.id === (b.grade && b.grade.id)) || GRADES.find(g => g.id === d.candidate_grades[0].id) || GRADES[0];
  b.grade = { ...(b.grade || {}), id: grade.id, name: grade.name, palette: grade.palette, notes: grade.notes };
  const pair = TYPE_PAIRS.find(p => p.id === (b.typography && b.typography.pair_id)) || TYPE_PAIRS.find(p => p.id === d.candidate_pairs[0].id) || TYPE_PAIRS[0];
  b.typography = { ...(b.typography || {}), pair_id: pair.id, display: pair.display, body: pair.body, why: pair.why };
  b.pacing = b.pacing || {}; let cpm = Number(b.pacing.cuts_per_min); if (!cpm || !isFinite(cpm)) cpm = d.tempo.cuts_per_min; cpm = Math.round(clamp(cpm, d.tempo.cuts_per_min * 0.8, d.tempo.cuts_per_min * 1.2)); b.pacing.cuts_per_min = cpm; b.pacing.avg_shot_s = round(60 / cpm, 1); b.pacing.derived_cpm = d.tempo.cuts_per_min; b.pacing.tempo_index = d.tempo.index;
  b.music = b.music || {}; if (!Array.isArray(b.music.bpm) || b.music.bpm.length !== 2) b.music.bpm = bpm;
  const artistNames = new Set(ev.music.map(a => lc(a.name)));
  b.music.reference_artists = (b.music.reference_artists || []).filter(a => a && a.name).map(a => { const m = ev.music.find(x => lc(x.name) === lc(a.name)); return { ...a, affinity: m ? m.affinity : null, image: m ? m.image : null, on_graph: !!m }; });
  if (b.music.reference_artists.length < 3) for (const a of ev.music.slice(0, 5)) if (!b.music.reference_artists.find(x => lc(x.name) === lc(a.name))) b.music.reference_artists.push({ name: a.name, why: "high audience affinity", affinity: a.affinity, image: a.image, on_graph: true });
  const pool = [...ev.movies.map(m => ({ ...m, kind: "film" })), ...ev.tv.map(m => ({ ...m, kind: "tv" })), ...ev.brands.map(m => ({ ...m, kind: "brand" })), ...ev.podcasts.map(m => ({ ...m, kind: "podcast" }))];
  b.references = (b.references || []).filter(r => r && r.title).map(r => { const m = pool.find(x => lc(x.name) === lc(r.title)); return { ...r, affinity: m ? m.affinity : null, image: m ? m.image : null, year: m ? m.year : null, kind: m ? m.kind : (r.kind || "film"), on_graph: !!m }; });
  if (b.references.length < 4) for (const m of pool.slice(0, 6)) if (!b.references.find(x => lc(x.title) === lc(m.name))) b.references.push({ title: m.name, kind: m.kind, why: "high audience affinity", affinity: m.affinity, image: m.image, year: m.year, on_graph: true });
  b.do = (b.do || []).slice(0, 6); b.dont = (b.dont || []).slice(0, 6);
  b.confidence = b.confidence || { score: 0.5, note: "" };
  return b;
}
function fallbackBrief(ev, d, bpm, deliverable, brandIn) {
  const style = EDIT_STYLES.find(s => s.id === d.candidate_styles[0]) || EDIT_STYLES[1];
  return { headline: `${brandIn}: ${style.name.toLowerCase()} at ${d.tempo.cuts_per_min} cuts a minute`, positioning: `The audience over-indexes on ${ev.music.slice(0, 2).map(a => a.name).join(" and ")} and ${ev.movies.slice(0, 2).map(m => m.name).join(" / ")}.`, edit_style: { id: style.id, summary: style.desc, techniques: [], evidence: "tempo index from genre tags" }, pacing: { cuts_per_min: d.tempo.cuts_per_min, rhythm: "", hook_0_3s: "", evidence: "" }, typography: { pair_id: d.candidate_pairs[0].id, treatment: "", evidence: "" }, grade: { id: d.candidate_grades[0].id, treatment: "", evidence: "" }, music: { direction: `${d.music_genres.slice(0, 3).map(g => g.name).join(", ")} at ${bpm[0]}-${bpm[1]} BPM.`, genres: d.music_genres.slice(0, 4).map(g => g.name), bpm, reference_artists: [], cue_map: [{ at_s: 0, label: "open" }, { at_s: Math.round(deliverable.seconds * 0.6), label: "peak" }, { at_s: deliverable.seconds - 2, label: "button" }], evidence: "" }, references: [], do: [], dont: [], sound_design: "", confidence: { score: 0.4, note: "written without the language model; numbers are from Qloo tags only" } };
}

// ---------- match score: editor's reel vs brand ----------
async function runMatch(env, input, emit) {
  const t0 = Date.now(); const trace = [];
  const tool = (rec) => { trace.push(rec); emit && emit({ t: "tool", tc: tc(Date.now() - t0), ...rec }); };
  const think = (text) => emit && emit({ t: "think", tc: tc(Date.now() - t0), text });
  const q = new Qloo(env.QLOO_API_KEY, tool);
  const signal = (input.signal || []).filter(Boolean).slice(0, 5);
  const refs = String(input.reel || "").split(/[,\n;]+/).map(s => s.trim()).filter(Boolean).slice(0, 8);
  if (!signal.length) throw Object.assign(new Error("run a brief first"), { status: 400 });
  if (refs.length < 2) throw Object.assign(new Error("give at least two references (films, artists, brands you have cut for)"), { status: 400 });
  // resolve editor refs across types
  const resolved = [];
  for (const r of refs) {
    const hits = await q.search(r, "urn:entity:movie,urn:entity:tv_show,urn:entity:artist,urn:entity:brand,urn:entity:person", 3).catch(() => []);
    if (hits.length) { const h = hits[0]; resolved.push({ query: r, ...h }); }
    else resolved.push({ query: r, id: null });
  }
  const editor = resolved.filter(r => r.id);
  if (editor.length < 2) throw Object.assign(new Error("fewer than two of those references are on the taste graph; try better-known titles or artists"), { status: 422 });
  think(`Editor reel on the graph: ${editor.map(e => e.name).join(", ")}`);
  const eids = editor.map(e => e.id);
  // affinity overlap across four domains
  const types = ["urn:entity:artist", "urn:entity:movie", "urn:entity:brand", "urn:entity:tv_show"];
  const [a, b] = await Promise.all([
    Promise.all(types.map(t => q.insights(t, signal, {}, 20, "brand " + t.split(":").pop()).catch(() => ({ entities: [] })))),
    Promise.all(types.map(t => q.insights(t, eids, {}, 20, "editor " + t.split(":").pop()).catch(() => ({ entities: [] }))))
  ]);
  const domains = types.map((t, i) => {
    const A = new Map(a[i].entities.map(e => [e.id, e])), B = new Map(b[i].entities.map(e => [e.id, e]));
    const shared = [...A.keys()].filter(k => B.has(k)).map(k => ({ name: A.get(k).name, image: A.get(k).image, brand_aff: A.get(k).affinity, editor_aff: B.get(k).affinity }));
    // weighted Jaccard on affinities (missing = 0)
    const keys = new Set([...A.keys(), ...B.keys()]); let mn = 0, mx = 0;
    for (const k of keys) { const x = A.has(k) ? (A.get(k).affinity || 0.5) : 0, y = B.has(k) ? (B.get(k).affinity || 0.5) : 0; mn += Math.min(x, y); mx += Math.max(x, y); }
    return { type: t.split(":").pop().replace("_", " "), score: mx ? round(mn / mx, 3) : 0, shared: shared.slice(0, 6), brand_only: [...A.values()].filter(e => !B.has(e.id)).slice(0, 4).map(e => e.name), editor_only: [...B.values()].filter(e => !A.has(e.id)).slice(0, 4).map(e => e.name) };
  });
  // tag-level overlap (taste vocabulary)
  const TT = { "filter.tag.types": "urn:tag:keyword:media,urn:tag:genre:media,urn:tag:genre:music,urn:tag:genre:brand,urn:tag:style,urn:tag:audience" };
  const [ta, tb] = await Promise.all([q.insights("urn:tag", signal, TT, 30, "brand taste tags").catch(() => ({ tags: [] })), q.insights("urn:tag", eids, TT, 30, "editor taste tags").catch(() => ({ tags: [] }))]);
  const TA = new Set((ta.tags || []).map(t => t.id)), TB = new Set((tb.tags || []).map(t => t.id));
  const sharedTags = (ta.tags || []).filter(t => TB.has(t.id)).map(t => t.name).slice(0, 10);
  const tagScore = (TA.size || TB.size) ? round([...TA].filter(x => TB.has(x)).length / new Set([...TA, ...TB]).size, 3) : 0;
  // Qloo's own compare endpoint (if available on the hackathon tier)
  let compare = null;
  try { const c = await q.compare(signal, eids, "urn:entity:artist", 10); compare = { ok: true, sample: JSON.stringify(c).slice(0, 600) }; } catch (e) { compare = { ok: false, error: String(e.message).slice(0, 120) }; }
  // score: Jaccard numbers are small by nature; map with a soft curve so 0.08 overlap ≈ 50
  const raw = domains.reduce((s, d) => s + d.score, 0) / domains.length * 0.75 + tagScore * 0.25;
  const score = Math.round(clamp(100 * (1 - Math.exp(-raw / 0.12)), 3, 98));
  const verdict = score >= 70 ? "natural fit" : score >= 45 ? "reachable stretch" : score >= 25 ? "a stretch — borrow their references" : "different world — brief hard";
  let note = "";
  try {
    const r = await llm(env, [{ role: "system", content: "You are a blunt, kind creative director. Two sentences, editor's voice, no fluff." }, { role: "user", content: `An editor's reel references: ${editor.map(e => e.name).join(", ")}. The brand's audience loves: ${a[0].entities.slice(0, 5).map(e => e.name).join(", ")} (music), ${a[1].entities.slice(0, 4).map(e => e.name).join(", ")} (film). Shared affinities: ${domains.flatMap(d => d.shared.map(s => s.name)).slice(0, 8).join(", ") || "none"}. Shared taste tags: ${sharedTags.join(", ") || "none"}. Match score ${score}/100 (${verdict}). Write two sentences: what the editor should lean on from their own taste, and what to borrow from the brand's world.` }], { model: MODEL_SMALL, max_tokens: 160, temperature: 0.5 });
    note = r.text.trim();
  } catch {}
  return { score, verdict, note, raw: round(raw, 3), tag_score: tagScore, shared_tags: sharedTags, domains, editor: resolved, compare, elapsed_ms: Date.now() - t0, trace };
}

// ---------- LLM-only baseline (the "why Qloo" comparison) ----------
async function runBaseline(env, input) {
  const brand = String(input.brand || "").slice(0, 120); const deliverable = DELIVERABLES[input.deliverable] || DELIVERABLES["30s_ad"];
  const r = await llm(env, [{ role: "system", content: "You are a video editor's assistant. Answer as strict JSON." }, { role: "user", content: `Brand: ${brand}. Deliverable: ${deliverable.label}. With no other data, give your best guess as JSON: {"edit_style": "3 words", "cuts_per_min": number, "grade": "3 words", "type": "font pairing", "music_genres": ["3"], "reference_artists": ["4 names"], "references": ["4 films or shows"], "audience": "one line"}` }], { model: MODEL_MAIN, max_tokens: 350, temperature: 0.4 });
  return { baseline: safeJsonParse(r.text) || { raw: r.text }, model: r.model };
}

// ---------- share cache ----------
async function cachePut(id, data) { try { const c = caches.default; await c.put(new Request("https://tastecut.cache/brief/" + id), new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": "public, max-age=1209600" } })); } catch {} }
async function cacheGet(id) { try { const r = await caches.default.match(new Request("https://tastecut.cache/brief/" + id)); return r ? await r.json() : null; } catch { return null; } }

// ---------- HTTP ----------
function sse(handler) {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const emit = (obj) => w.write(enc.encode("data: " + JSON.stringify(obj) + "\n\n")).catch(() => {});
  const ping = setInterval(() => w.write(enc.encode(": ping\n\n")).catch(() => {}), 8000);
  (async () => { try { await handler(emit); } catch (e) { emit({ t: "error", message: String(e && e.message || e), status: e && e.status || 500 }); } finally { clearInterval(ping); try { await w.close(); } catch {} } })();
  return new Response(readable, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname.startsWith("/api/")) {
      if (!env.QLOO_API_KEY || env.QLOO_API_KEY === "placeholder") { if (url.pathname !== "/api/health") return json({ error: "Qloo key not configured on this deployment yet" }, 503, CORS); }
      try {
        if (url.pathname === "/api/health") return json({ ok: true, version: VERSION, qloo: !!env.QLOO_API_KEY && env.QLOO_API_KEY !== "placeholder", ai: !!env.AI, libraries: { grades: GRADES.length, type_pairs: TYPE_PAIRS.length, edit_styles: EDIT_STYLES.length } }, 200, CORS);
        if (url.pathname === "/api/libraries") return json({ grades: GRADES, type_pairs: TYPE_PAIRS, edit_styles: EDIT_STYLES, deliverables: DELIVERABLES }, 200, { ...CORS, "cache-control": "public, max-age=3600" });
        if (url.pathname === "/api/brief" && request.method === "POST") {
          const input = await request.json();
          const cacheKey = await sha(JSON.stringify({ b: lc(input.brand || "").trim(), n: String(input.notes || "").trim(), d: input.deliverable || "30s_ad", v: VERSION }));
          if (!input.fresh) { const hit = await cacheGet(cacheKey); if (hit && !hit.degraded) return sse(async (emit) => { emit({ t: "step", id: "cache", label: "Brief found in the room's cache (same brand, notes and deliverable)", status: "done", tc: "00:00:00" }); for (const r of (hit.trace || [])) emit({ t: "tool", cached: true, ...r }); emit({ t: "brief", data: { ...hit, cached: true } }); emit({ t: "done" }); }); }
          return sse(async (emit) => { const out = await runAgent(env, input, emit); out.id = cacheKey; ctx.waitUntil(cachePut(cacheKey, out)); emit({ t: "brief", data: out }); emit({ t: "done" }); });
        }
        if (url.pathname === "/api/match" && request.method === "POST") { const input = await request.json(); return sse(async (emit) => { const out = await runMatch(env, input, emit); emit({ t: "match", data: out }); emit({ t: "done" }); }); }
        if (url.pathname === "/api/baseline" && request.method === "POST") { const input = await request.json(); return json(await runBaseline(env, input), 200, CORS); }
        if (url.pathname.startsWith("/api/share/")) { const id = url.pathname.split("/").pop(); const hit = await cacheGet(id); return hit ? json(hit, 200, CORS) : json({ error: "not in cache (briefs live ~2 weeks in the edge cache; re-run the brand to regenerate)" }, 404, CORS); }
        return json({ error: "not found" }, 404, CORS);
      } catch (e) { return json({ error: String(e && e.message || e) }, e && e.status || 500, CORS); }
    }
    try { return await env.ASSETS.fetch(request); } catch (e) { return new Response("asset error: " + String(e && e.message || e), { status: 500 }); }
  }
};
