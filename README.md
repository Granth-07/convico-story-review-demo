# Kal Phir Miloge? — standalone reviewer service

This service is independent of the main Convico application. It contains the original
Hinglish café story, three suggested replies plus free text, and direct Gemma 26B calls.
The provider key stays on the server. Each browser keeps its own story history.

## The Last Train

A second, original grounded thriller is available at `/last-train/` after deploying
this version. It has Meera and Kabir, an authored mystery, action-earned clues,
its own casebook and browser storage, and train-specific supporting characters.
The cafe remains at `/`. Both stories share the existing reviewer credentials,
funded provider configuration, process request budget and single-call work gate.
See `TRAIN-REVIEW.md` for setup, feature coverage and live acceptance.

For local play, set the funded provider key privately and run `npm run dev`.
Open `http://127.0.0.1:8789/last-train/` for the thriller or `/` for the cafe.

## Updated story (revision 7)

- The cast validator now accepts relevant supporting roles, rather than failing
  generation whenever a police officer or medic speaks. Police Officer,
  Paramedic, Doctor, Customer, Neighbour, Delivery Rider and Friend are permitted
  only when supported by this modern Mumbai setting and the conversation.
- A replayable incident ledger tracks reported violence, help being requested,
  intervening beats, responders, retractions and consent boundaries. A serious
  injury prompts help without the user having to name every responder. Essential
  emergency/arrival lines are supplied by the story engine if the model omits
  them; `world_corrections` in chat exports identifies these additions. Those
  lines are authored story templates, not clinical or legal advice.
- A claimed death is not treated as a diagnosis. A later joke, cake or surprise
  does not erase a witnessed incident. Forced contact does not automatically
  result in a successful hug or affection. Natural-language event detection is
  heuristic; this is a fiction demo, not a real-world emergency simulator.
- Individual actions are displayed immediately above their character's words.
  Shared scenes remain at the top. The old narration-only format still loads.
- Sending now saves the pending draft before the request. Errors appear beside
  the composer; retry and stop-waiting controls remain available. An unknown
  network result reuses a request ID, while an explicit failed generation can
  be retried manually as a new, potentially billable call.
- The process retains up to 128 request results for 15 minutes. Duplicate
  in-flight/completed IDs with the same history reuse the result and quota slot;
  reuse with changed history is rejected. This is not durable idempotency across
  a Render restart, redeployment, expiry or cache eviction. No claim of exactly
  once billing is made outside that retention window.

- Arohi and Naina no longer both speak automatically. One relevant speaker is
  displayed by default; explicitly addressing both permits both.
- “Arohi, chup raho”, “Arohi, don't interrupt” and the equivalent character
  control persist until “Arohi, ab tum bolo” / “you can speak now”. Merely asking
  Arohi another question does not lift her silence. Both characters can be quiet.
- The server reconstructs permissions from user turns each request, including
  after browser reload. It filters disallowed structured dialogue; apparent
  speech attributed to a quiet character in narration is removed when detected.
  There is no paid automatic retry. General natural-language understanding and
  detection of speech hidden in prose are heuristic, not an absolute guarantee;
  use the visible character controls for unambiguous instructions.
- A rules-based director adds episode windows (18 user turns), relevant recent
  relationship evidence and gradually available fictional backstories to the
  same Gemma call. No second LLM call is added. Turn 18 displays a reading-pause
  card with an earned model hook (or a neutral pause if omitted); turn 19 starts
  the next window. This does not resolve an emergency or automatically skip time.
- Arohi's financing worry and Naina's possible job offer supply optional depth.
  Details enter the prompt only from turn 10. Nuanced emotional continuity,
  private knowledge and long-form reveals remain model-guided; there
  is no new database, RAG, numerical trust meter or guaranteed 50-turn recall.
- Existing saved chats are preserved with a notice. “Start updated story” asks
  before replacing a conversation. Export first to keep an independent copy.

## Tests and live review

Run `npm test` in this folder (Node 22+). Tests use a simulated provider and a
real local HTTP server; they incur no inference charges. They cover speaker
control, reload/resume, NPC dialogue, incident continuity, world matching,
provider errors, replayed requests, telemetry, reviewer authentication, request
limits, legacy storage and the actual browser composer in a DOM harness.
These are not a real browser rendering check or a live Gemma playthrough.
Follow `REVIEW-CHECKLIST.md` for live acceptance after deployment.

## Update the existing Render service

Copy this folder's source changes into the existing demo Git checkout, including
the NEW `train-engine.mjs`, `train-prompt.txt`, `train.test.mjs` and `TRAIN-REVIEW.md`,
as well as `story-world.mjs`, `story-director.mjs` and the shared server/UI. Run `npm test`, review `git diff`,
then commit and push to its connected branch yourself. Do not stage `.env`,
credentials or chat exports. Keep all existing Render secrets configured.

In the **demo** service, choose **Manual Deploy → Deploy latest commit** if
automatic deployment is disabled. The existing HTTPS address does not change.
Verify password protection, reload the page, choose “Start updated story”, and
complete the live checklist before asking Ayushman to review it. No main Convico
service needs changes. These local edits alone do not update the deployed link.

## Render deployment

Use a separate private GitHub repository containing only this folder's source files.
Create a new Render **Web Service**, runtime **Node**, plan **Free**.
Build: `npm install --omit=dev --ignore-scripts`. Start: `npm start`.
Health check: `/healthz`. This binds `0.0.0.0:$PORT` and uses `RENDER_EXTERNAL_URL`.
Do not connect or deploy this code to the main Convico repository or service.

Set the funded `OPENROUTER_API_KEY` privately in Render, plus `DEMO_REVIEW_PASSWORD`
(at least 16 characters). Set `DEMO_PROVIDER=openrouter`,
`DEMO_MODEL=google/gemma-4-26b-a4b-it`, `DEMO_MAX_REQUESTS=100`.
Do not upload a real `.env`, chat exports, provider keys, or passwords to GitHub.

Share the service's HTTPS link, username **reviewer**, and reviewer password with the team.
Reviewers do not need PowerShell, a provider key or a Render account.
Keep the provider key separate from the reviewer password.

## Limits and measurements

- All story routes require the reviewer password; `/healthz` exposes only `ok`.
- At most 100 new model attempts per running process (retained request replays do
  not consume another slot). The counter resets when Render
  restarts/redeploys the process. It is not a permanent dollar spending limit.
- One model call runs at a time. There is no automatic retry or different-model fallback.
- Each session is capped at 60 turns / 60000 history characters, with 1100 output tokens
  per call. Full completed history is supplied each turn; input cost grows over time.
- Actual token usage and provider cost appear only when the provider returns them.
  Missing cost is labelled unavailable. Rejected/failed requests can still incur charges.
- History is local to each reviewer's browser, not durable server-side memory.
- A shared browser profile shares its story history; a new profile starts a fresh story.
- Hosting and inference are separate: selecting Free hosting does not make model calls free.

Original local model playthrough supplied by Granth: eight turns, initial recall 5/5,
browser-history resume with follow-up recall, total reported cost $0.0024397.
That verifies the local direct-provider path, not this hosted service. After deployment,
verify password gating and a new live turn before sharing the review link.

Render references: https://render.com/docs/web-services#port-binding and
https://render.com/docs/environment-variables .
