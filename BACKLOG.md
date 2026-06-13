# UX Backlog

Issues surfaced from a UX audit on 2026-06-10. Items #13+ are from a follow-up mobile review the same day (tested at 390×844 and 360×740 in Chrome device emulation).

## Open

### High impact

**#13 — Today's past-due slots appear twice** (Home · Overdue + worker)
`getOverdueSlots` includes today's already-passed slots, so they render in both the Today panel and the Overdue panel ("Today: 2 pending" next to "Overdue: 5 open slots" is contradictory). On mobile this doubles scroll length and shows up to 8 identical "Mark complete" buttons — easy to log the wrong dose.
Fix: exclude today's slots from the overdue query (or filter them client-side); let the Today panel own today.

**#14 — Overdue cards show no date** (Home · SlotCard)
An overdue card says only "4:30 PM / 16:30" — you cannot tell yesterday's missed 4:30 PM from today's. For a med app this is a double-dose risk.
Fix: show the slot date (e.g. "Yesterday · 4:30 PM", "Jun 8 · 8:30 AM") on cards outside the selected day.

**#15 — Inputs trigger iOS focus zoom** (All views · forms)
Date/time/text inputs inherit 14.88px font (0.93rem from `.settings-field`; the home date input is 0.88rem). Anything under 16px makes iOS Safari zoom the whole page on focus, which is jarring and leaves the layout zoomed.
Fix: force `font-size: 16px` (or 1rem) on `input, select` at mobile widths.

### Medium impact

**#16 — App-bar "next pending" picks the newest missed dose, not the oldest** (Home · app-bar + worker)
Overdue is sorted `DESC`, and `nextPending` takes the first pending of `[...overdue, ...day.slots]`, so the title shows the most recently missed slot while an older missed dose is the real priority.
Fix: sort overdue ascending (oldest first) or pick `nextPending` by earliest date+time.

**#17 — Lateness shown as raw minutes** (Home + Stats)
"579 min late", "avg +1119m", "worst +1119m" are unreadable past an hour.
Fix: format as hours+minutes ("9h 39m late", "avg +18h 39m"); pairs with #10's renaming.

**#18 — Slot card title duplicates the time** (Home · SlotCard; Settings cards)
Labels are the times ("8:30 AM") and the card prints the 24h `slot.time` ("08:30") right under it — two lines spent on the same fact on every card.
Fix: drop the 24h line (or replace it with something useful, e.g. the date for overdue cards per #14).

**#19 — Settings "Apply to Range" sits above the cards it applies** (Settings · Date Overrides)
On mobile you edit the Range Template cards, then must scroll back up past them to find the Apply button.
Fix: move the apply CTA below the template cards, or make it sticky above the bottom nav while drafts are dirty.

**#20 — Stats range needs a manual Refresh** (Stats)
Changing start/end does nothing until you tap Refresh — extra friction with the native date picker on mobile, and stale data looks current.
Fix: auto-fetch on change (debounced); add preset chips (Last 7 days / 30 days / All).

### Low impact

**#21 — Sign out occupies prime app-bar space** (App bar)
A rare, destructive-ish action gets the top-right hot zone on every screen and squeezes the title on 360px screens.
Fix: move Sign out into Settings; keep the app bar for status.

**#22 — Checkbox tap targets are 16×16** (Settings · skip checkbox)
The label row helps, but the row is still under 44px tall.
Fix: enlarge the checkbox (1.4rem+) and pad the label row vertically.

**#23 — No aria-current / heading structure in app shell** (A11y)
The signed-in app has no `h1`, the app-bar title is a div, and the active nav tab is conveyed by color only (no `aria-current="page"`).
Fix: make the app-bar title an `h1`, add `aria-current` to the active nav button.

**#1 — Pending dose has no visual priority** (Home · SlotCard)
Next pending slot looks identical to completed/skipped cards. User has to scan to find the action.
Fix: heavier border or elevated card for the next pending dose; larger "Mark complete" button.

**#2 — App bar title missing lateness info** (Home · app-bar)
"Evening pending" is shown but not the scheduled time or how overdue it is.
Fix: append scheduled time, e.g. "Evening — 4:30 PM"; add urgency sub-label when late.

**#3 — Overdue section below today's slots** (Home · layout)
Past-day missed doses are more urgent but render after today's panel.
Fix: render overdue first, then today.

**#7 — No notification prompt on Home screen** (Home · push)
First-time users have no indication notifications are off until they find Settings.
Fix: dismissable banner on Home when `pushState.supported && !pushState.subscribed`.

### Medium impact

**#4 — Date picker takes up primary header space** (Home · home-day-top)
Date navigation is a rarely-used power feature competing for space in the main header.
Fix: collapse to a calendar icon button that expands inline.

**#9 — No way to delete overrides** (Settings · Upcoming Overrides)
Upcoming Overrides list is read-only; no visible path to remove a mistaken entry.
Fix: add a remove/× button on each override row.

**#11 — Who completed the dose is buried** (Home · SlotCard)
`completedByName` is small-print text, but in a two-person app "was it Pai or me?" matters.
Fix: surface name in the slot title row or the Done pill, e.g. "Done · Pai".

**#12 — Identity select is slow and uses native wheel picker** (Login)
Three taps before the primary action; native `<select>` is heavy for a two-option choice.
Fix: replace with two large full-width tap targets, one per person; tapping IS the login.

### Low impact

**#10 — "Delta" is jargon** (Stats · labels)
"Average delta", "Best delta", "Worst delta" require a mental translation step.
Fix: rename to "Avg. lateness", "Best time", "Latest given"; color-code values.

## Done

**#5 — Stats row is hard to parse** (Home · day-stats-row)
Dense low-contrast text; avg/max lateness on home doesn't belong there.
Fix: three colored pills (green/amber/grey) for done/pending/skipped; remove avg/max from home.

**#6 — Nav: no icons, touch targets too small** (Nav · bottom-nav)
Text-only tabs require reading; touch targets ~36px below 44pt minimum.
Fix: add icons above labels; increase padding to hit 44px.

**#8 — Batch settings flow is confusing** (Settings · Batch Settings)
Three date inputs at once; changing preview date silently resets draft edits; Apply button above the drafts.
Fix: restructure as Step 1 (preview) / Step 2 (apply range) with warning about draft reset.
