# Floor 7 plan: change log and confidence

Files: `floor7_plan.svg` (drawing), `floor7_plan.json` (data for software), this file.

**Nothing in this plan is measured.** There was no tape measure, so every distance is an estimate or a guess. The lab passage is drawn 46 m from spine to spine. That is a guess from your survey notes (35 to 40 m) plus the symmetry, and it may be too long.

## Frame of reference
- Origin (0, 0): centre of lift lobby A (the two-lift lobby with the Department sign and the "7th FLOOR" plan).
- x increases east (right), y increases north (up). Units are metres.
- North is assumed. The south ends of the two vertical wings (703A and 706A) are taken to face the front of the Tech Park.
- Shape: two symmetrical vertical wings (west spine x = -9, east spine x = +37, mirror line x = 14) joined by one horizontal lab passage at y = 0. Each wing has four rooms, a lift lobby at the join (two lifts in A, three in B), a lift directly across from the staff room (703A, 706A) and stairs at the north end of the spine, after 701 and after 704. The east wing is the mirror image of the west wing (you said both sides are symmetrical): 704 mirrors 701, 705 mirrors 702, 706 mirrors 703, 706A mirrors 703A.

## Certain (from photos or your statements)
- The rooms and signs exist: 701, 703, 704, 705, 706, 703A and 706A (staff rooms), Labs C (TP709), D (TP710), E (TP713) and F, Gents, Ladies, a disabled toilet, the "W" door, lifts, stairs S1 and S4.
- 702 exists (your statement; no photo). Room 707 does not exist and has been removed from the plan and the data.
- Restroom L = old ladies, Restroom M = old gents, "W" = new ladies, "new restroom" = new disabled toilet. Old and new toilets are in different parts of the floor.
- Two Department entrances at the two ends of the lab passage; the passage opens into both wings.
- D faces E across the passage (photos 13, 14).

## Estimated (supported by photos or survey order; sizes and distances assumed)
- Order of 703A, 703, 702, 701 along the west spine, all on its west side.
- Lab passage and its two Department doors, with D/E at the west end and C/F at the east end.
- Lift lobby A (two lifts) and stairs S1 at the west join.
- Lift across from 706A (photos 36, 37) and stairs at the north end after 701.
- Corridor width 2.4 m, passage width 3.0 m, door 0.9 m.

## Layout note
In both wings the restrooms are on the north side of the lab passage and the stairs beside the lobby are on the south side, directly opposite each other (as you asked).

## Lifts and back path
- Every lift shaft is drawn about 2.4 x 2.8 m (6.7 sq m, assumed).
- Behind the lobby lifts a back path (2.2 m wide, assumed) runs from each spine to the restrooms. The restrooms sit on the north side of the back path, each about 4 x 6 m (24 sq m, assumed). The two restrooms of a wing sit at opposite corners of the back path, about 8 m apart (disabled at the spine corner and W at the lab corner on the west; L at the spine corner and M at the lab corner on the east). Their doors open onto the back path, not onto the lab passage. The small space between the lifts, the back path and the lab is left blank (unknown). West path is `west_back`, east path is `east_back` in the JSON.

## Stairs around the lobbies
The space in front of and beside each lift lobby is filled with stairs, joined into one continuous block with no empty gaps (flights going up or down). Each block wraps from the spine, round the front of the lobby, to the lab wall. In lobby B the block goes around lift B3. Only the west block is supported by photos (3, 19); the east block is a mirror. Individual flights, landings and the up/down direction are not known.

## Guessed (marked "?" on the drawing, dashed brown)
- All room sizes (every room is drawn 6 to 8 m deep, which is a guess).
- Which side of the passage the labs are on (C and D north, E and F south).
- Room order 704, 705, 706, 706A in the east wing. It comes from the mirror rule only.
- Room 702 position (between 701 and 703 by number).
- Room 704 is placed as the mirror of 701; its survey position is unknown.
- Positions of all four toilets.
- Lifts: lobby A has two lifts and one more lift across from 703A (three on the west). Lobby B has two lifts side by side on its north wall, a third lift on the opposite wall facing them, and one more across from 706A (four on the east). This follows your last two messages; it differs from your earlier "four west, three east". Only the lift across from 706A and two lobby lifts were photographed; the rest are from your description.
- Stairs after 704 and beside lobby B are mirrors of the west stairs, not photographed.
- Door positions on every room (drawn at mid-wall).
- Lab F: C faces F is your statement; photo 17 does not prove it.

## Not placed (left unknown on purpose)
- Anything on the other side of the corridors from the rooms (for example the east side of the west spine) is blank.

## Needs checking on site
1. Measure the lab passage length, one corridor width and one room width; then rescale. Everything scales from these.
2. Which side of the lab passage C/F and D/E are on.
3. Confirm the real positions of 702 and 704.
4. Count the lifts in each wing (plan shows 3 on the west and 4 on the east).
5. Check the east wing against the west wing: lobby B, its three lifts and stairs, and which rooms sit where.
6. Confirm the compass: which way the front of the Tech Park faces.
7. Check the tiled-floor Department doors: are they at the ends of the lab passage as drawn?

## Photos
34 of 37 used. Photos 8, 20 and 35 were set aside (blurred or duplicates).

## How to use for the radio map
`floor7_plan.json` -> `survey_spots` gives the corridor point in front of each survey place, with the distance along the centreline. Use these as starting coordinates, then adjust once real measurements exist. Because scale is estimated, treat all distances as +/- several metres.
