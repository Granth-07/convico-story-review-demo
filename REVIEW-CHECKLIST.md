# Kal Phir Miloge? — revision 6 live acceptance

Use a fresh story in the separate demo. This exercise calls the funded provider.
Keep exports private; they contain the user's conversation. Never attach keys.

1. Verify an unauthenticated browser asks for the reviewer password. Verify the
   opening loads and `/api/status` reports revision 6 and the approved 26B model.
2. Send: `Mera naam Granth hai. Main Pune se hoon. Baarish mein purane gaane
   sunna pasand hai. Chai bina cheeni aur kam orange peel ke banana.`
3. Send: `Naina, tum mazaak achha kar leti ho. Tumhara din kaisa tha?`
   Expect only Naina's dialogue, not a compulsory Arohi reply.
4. Send: `Arohi, filhaal chup raho. Beech mein mat bolo.`
   Expect no Arohi dialogue or angry spoken acknowledgement. A quiet gesture
   is fine; Naina need not answer an instruction directed to Arohi.
5. Send five ordinary follow-ups to Naina: ask about the menu, preparations,
   music, tomorrow's opening and your chai order. Arohi must remain silent.
6. Close and reopen the same URL in the same browser profile. Confirm history
   and Arohi's “Ab bolo” control remain. Ask `Arohi, opening kab hai?`.
   She should still remain quiet; a question alone is not permission to resume.
7. Send: `Arohi, ab tum bolo. Meri chai kaise banaogi?`
   Expect Arohi's answer: no sugar, reduced orange peel. No Naina interruption.
8. Use the two character controls to quiet both. Send an ordinary action.
   Expect action/atmosphere with no dialogue; no invented third speaker.
9. Send: `Naina, ab tum bolo.` Verify only Naina resumes. Then invite Arohi.
10. Ask: `Mera naam, sheher aur baarish mein music preference yaad hai?`
    Check the answer against step 2, not just whether it sounds confident.
11. Continue naturally through turns 10–20: offer help, ask about finances or
    her plans, apologise after a disagreement, or decline romance. Check gradual
    disclosures, proportionate feelings, continuity and user freedom. No forced
    gangster, violent twist, romance, time jump or impossible NPC knowledge.
12. Confirm episode 2 appears on user turn 19; this must not itself skip time.
13. Export the playthrough. Note repetitions, unwanted speakers, reveal timing,
    scene continuity, provider token/cost coverage and latency. Compare against
    the previous demo using similar conversation lengths; extra prompt context
    may raise input cost even though model calls per turn are unchanged.
14. Try a saved earlier-version browser profile. Verify its conversation remains
    available and exports. Cancel a restart once, then confirm a fresh restart.

Only share as verified after this live exercise passes. Automated tests with
a simulated provider cannot establish Gemma's storytelling quality. Provider
failures may still cost money; no automatic retries or fabricated cost figures.
