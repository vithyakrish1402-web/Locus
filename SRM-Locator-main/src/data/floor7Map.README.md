# Floor 7 map (TECH PARK) — how to replace the placeholder

`floor7Map.json` is **placeholder geometry** (`"placeholder": true`): a corridor with rooms either
side, drawn so the filter, the debug overlay and the tests have something to run on. It is not
the real floor. Until it is replaced, every metre figure the demo shows (and every error the
leave-one-scan-out check reports) is about the placeholder, not about Floor 7.

Used only by the Floor 7 demo in the separate "LOCUS Test" build. No other build contains it.

## The frame

Everything is in **metres**, in the frame defined by `src/utils/floor7Frame.js`:

- the origin `FLOOR7_ORIGIN` (a placeholder lat/lng near the middle of the floor),
- `FLOOR7_ROTATION_DEG`, how far the plan's x axis is turned counter-clockwise from east.

Pick the origin at a corner or a pillar you can find again on the real floor, set the rotation
so the plan's long wall is along x, and change both constants in that one file. Nothing else needs to move.

## Tracing the plan from a photo

1. Photograph (or scan) the floor plan flat-on, with a scale bar or one known distance
   (e.g. the length of the corridor).
2. Open the image in any editor that shows pixel coordinates (Paint, GIMP, Figma). Note the
   pixel position of your origin, and the pixels-per-metre from the known distance.
3. For each point you need: `x = (px − originPx) / pxPerMetre`, `y = (originPy − py) / pxPerMetre`
   (image y runs down; plan y runs up).
4. Fill in the three sections of `floor7Map.json`:
   - **`walkable`**: one polygon per corridor, room and the lift lobby, as `[[x, y], ...]`
     (corners in order, first point not repeated). Rooms touch the corridor along the door.
   - **`walls`**: solid walls only, as `[[x1, y1], [x2, y2]]`. **A doorway is a gap in `walls`**,
     so leave it out; do not draw a door.
   - **`spots`**: the 14 surveyed spots, each at the (x, y) where the surveyor actually stood
     (not the room centre): `Room 701`, `Room 702`, `Room 703`, `Room 703A`, `TP704`, `TP705`,
     `TP706`, `TP707`, `TP709`, `TP710`, `Computing Lab C`, `Computing Lab D`, `Computing Lab E`,
     `Lift near TP706`. Every spot must be inside `walkable` (a test checks this).
5. Set `"placeholder": false` and update `note`.

## Then rebuild the access points and check by eye

```bash
node scripts/build-floor7-aps.mjs <survey1.csv> <survey2.csv> <survey3.csv>
```

This places each radio at the spot where it was heard strongest (`scripts/lib/floor7Anchors.mjs`)
and rewrites `floor7Aps.json`. Fix any radio by hand in `floor7ApsOverrides.json`
(`{ "48:b4:c3:6f:eb": { "spot": "TP706" } }` or `{ "x": 3, "y": -2 }`) and rerun.

In the test build, signed in as the owner, the **F7 debug** button draws the plan, walls, spots,
access points, the raw estimates and the filtered track. If the plan does not line up with where
people really stood, fix the geometry here. A wrong wall silently rejects good estimates.
