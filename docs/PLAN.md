# TasteCut — build plan (Oct 20 2026)

Entry for the Qloo Agentic Hackathon (deadline Oct 31 03:45 UTC). Solo, Matthew Ifeanyi (@zxreigns).

## One line
A brand walks in; a culturally grounded edit brief walks out. TasteCut is an agent for video editors: it resolves a brand on Qloo's taste graph, reads what that brand's audience actually watches and listens to, and turns it into a concrete creative brief — edit style, pacing (cuts/min), typography, colour grade, music direction with reference artists, screen references — every line backed by Qloo affinities. Optional: a match score between the brand and the editor's own reel.

## Stack (all free tier, all already in hand)
- Cloudflare Pages (static UI) + `_worker.js` (advanced mode) for /api/* — Workers AI binding (Llama 3.3 70B) for the agent's reasoning + synthesis, `QLOO_API_KEY` as a project secret. Deploy with scripts/deploy.sh (direct upload API, no wrangler).
- Qloo hackathon API (hackathon.api.qloo.com): /search, /v2/insights (brand, artist, movie, tv_show, podcast, urn:tag, urn:demographics, feature.explainability), /v2/analysis/compare for the match score.
- No framework: semantic HTML, hand CSS, vanilla JS. Fonts from Google Fonts (Instrument Serif, Inter Tight, JetBrains Mono + the pairing fonts rendered live).
- Public repo github.com/zxreigns/tastecut, MIT.

## Agent (visible, multi-step, tool-using)
READ (LLM parses the brand + notes + deliverable, proposes proxies if obscure) → RESOLVE (Qloo /search, LLM disambiguation) → AUDIENCE (urn:demographics) → TASTE (urn:tag analysis) → MUSIC (artists + genre tags) → SCREEN (movies, tv) → BRAND WORLD (neighbouring brands) → DERIVE (deterministic tempo index → cuts/min, candidate grades + type pairings scored from tags) → SYNTHESISE (LLM writes the brief as strict JSON citing evidence) → optional MATCH (editor reel vs brand via Qloo compare + affinity overlap) → optional BASELINE (LLM-only brief for the "why Qloo" comparison). Streams as SSE so the UI shows every step with its tool call.

## UX: the cutting room
Dark edit-suite look (#0B0B0C / #F3F1EC / amber timecodes), Instrument Serif display. Signature: the brief is laid out as the deliverable's own TIMELINE — a filmstrip ruler with cut marks at the computed pacing, music cue blocks, the 3-second hook window, grade applied to the frames, the type pairing rendered on the brand name. The agent console streams like a script supervisor's log with timecodes. The room tints itself to the brand's grade when the brief lands.
