# The Last Train — build and acceptance notes

An original, grounded Hinglish suspense story alongside Kal Phir Miloge?.
The train, route, Devgarh Junction and railway logistics are fictional.

## Run and deploy

- Node 22+: configure a funded `OPENROUTER_API_KEY` privately and run `npm run dev`.
- Open `http://127.0.0.1:8789/last-train/`. The cafe remains at `/`.
- Hosted: deploy the same demo service, keeping its existing environment variables.
  The new address is the existing public origin plus `/last-train/`. The reviewer
  username/password are the same; no additional Render service or key is needed.
- The path will return 404 until the new source is pushed and deployed. Do not
  share it as live before checking the deployed version.
- `npm test` runs cafe and train checks with a fake provider and local HTTP.
  It does not spend provider credits or establish live storytelling quality.

## What carries over from the reference images and recent fixes

| Request | Implementation |
| --- | --- |
| Director and actors | A server director feeds cast, world state, evidence and pacing into one Gemma 26B call per turn. No second paid planner call. |
| Character depth | Meera and Kabir have distinct knowledge, priorities and gradual disclosures. The mystery has an authored fixed explanation. |
| Emotional continuity | Recent evidence and persistent violence/consent flags remain in context; silence is not automatically humiliation. Nuanced feelings are model-guided. |
| Sensory scenes | Train-specific rain, wheel rhythm, aisle, lights and radio; individual actions above their dialogue, shared actions above the exchange. |
| Episodes and cliffhangers | 18-turn windows, an earned reading-pause hook, and a continuing scene rather than an automatic crisis or time jump. |
| Meaningful choices | Inspect, question, compare, ask staff, reject a theory, seek help or decline involvement. The player is not assigned a secret identity. |
| NPC consequences | Passengers and a train guard may react; outside police/medics meet an established station arrival; an introduced doctor passenger may help onboard. |
| Setting matching | A separate train role policy excludes cafe actors and unrelated superhero/celebrity cameos. |
| Reliable sends | Saved drafts, visible errors, retry/stop-waiting, retained request deduplication and provider usage accounting are shared. |
| Content boundaries | Prompt rules prohibit explicit gore, sexual violence, sexual content involving minors and tactical harmful instructions. No app-store approval claim. |

## Spoiler-free live test sequence

1. Start a fresh train story. Confirm the photograph, Meera and Kabir appear and
   the cafe conversation has not carried over.
2. Send `Meera, phone ki photo zoom karke dikhao.` Verify a first casebook clue.
3. Send `Kabir, kya tum Meera ko pehle se jaante ho?` Verify Kabir leads; he
   must not know private phone contents just because the narrator knows them.
4. Send `Meera, filhaal chup raho.` Continue with Kabir for several turns.
   Reopen the page, confirm the same history and controls, then explicitly
   invite Meera back with `Meera, ab tum bolo.`
5. Follow the actual evidence and inspect the relevant exterior bag seal.
   Ask Kabir to show the pickup sheet, then ask Meera about her original recording.
   Verify discoveries have stable titles and facts; a theory is labelled separately.
6. In a fresh story, guess a culprit and demand the ending. Check the director
   does not put the private solution into public metadata or unlock evidence.
7. In another fresh story, call the guard or establish a serious incident. Check
   the guard has dialogue; an ambulance must not materialise inside a moving train.
   Establish arrival at Devgarh and confirm relevant responders can speak.
8. Ask for a superhero cameo. Check the grounded world is preserved. Try the
   cafe link too and verify its saved history and cast still work independently.
9. Continue naturally to turn 18. Check a reading-pause card and an earned hook;
   turn 19 must not automatically advance the train clock or erase an incident.
10. Test a network interruption and unchanged-draft retry. Request reuse protects
    only retained entries in the current process (15 minutes, at most 128 results
    per story); a Render restart/expiry/eviction loses it.
11. Export the chat, review the full transcript, and record repetitions, actor
    mix-ups, premature spoilers, clue consistency, user freedom, latency and
    actual provider cost before calling this live-tested.

## Revision 8 screenshot regressions

These fixes are scoped to `/last-train/`. `/api/status` for the cafe remains at
revision 7; `/last-train/api/status` reports revision 8. Cafe prompt, settings,
parsing and UI error handling retain their previous behaviour.

- Send `jsvbchjscskjcbaks`. Expect an in-world clarification, without keyboard,
  typing, text-box or JSON remarks. Check all visible fields, not only dialogue.
- Complete the phone inspection, quiet Meera, then send:
  `Main seat 16 ke neeche wale neele bag ka bahari seal inspect karta hoon.
  Bag nahi kholta.` The message should complete normally. If a completed model
  reply cannot be read, a labelled recovery may show the authored seal fact;
  it must not open the bag, reveal later clues or unmute Meera.
- Confirm normal phone-screen and received-message descriptions still work:
  these are story props, unlike chat-interface references.
- Inspect an exported attempt after a repaired/recovered scene. There should
  be one provider request, actual reported usage, and recovery metadata. A
  cutoff, credit failure or network outage still needs a preserved draft and
  honest recovery handling; no claim of an error-free hosted service is made.

## Honest limits

The casebook and canon are authored; natural-language action detection is
heuristic. “Inspect my bag” must not reveal a different person's bag. User claims
are not forensic proof. Feelings, lies, dialogue quality and private knowledge
remain model-guided; neither hallucination-free play nor guaranteed engagement
is claimed. History is browser-local, not a new database or cross-device memory.
The current prototype supports a few intentional investigation actions, rather
than simulating every possible railway interaction.

The backend withholds later canon from early model prompts. Source code itself
contains author spoilers and should not be treated as a secret store in a public
repository. Keys and passwords stay outside source control.
