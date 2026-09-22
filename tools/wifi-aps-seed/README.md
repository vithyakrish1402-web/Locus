# wifi_aps seed (LOCUS WiFi Arc, Stage 3 → Firestore)

A one-time import. It reads the aggregated survey CSV (one row per BSSID, "strongest RSSI
wins") and writes one Firestore document per access point to the `wifi_aps` collection.
Stage 5's positioning code reads that collection, matching it against what the `WifiScan`
plugin sees.

It is run by hand, with real Admin credentials. **It is not part of LOCUS:** it lives
outside `SRM-Locator-main/`, has its own `package.json`, and nothing in the app's build,
tests, `npx cap sync` or `scripts/release*.mjs` reads this folder. `firebase-admin` never
enters the app's dependency tree.

## Run it

```bash
npm install
npm run seed -- path/to/wifi_aps.csv --dry-run
npm run seed -- path/to/wifi_aps.csv --credentials path/to/service-account.json
```

Always dry-run first. It parses and validates the whole file and prints what would be
written. It needs no credentials and touches no network.

**Credentials.** Firebase console → Project settings → Service accounts → Generate new
private key. Keep the file **outside this repo** and delete it when you're done: it has
full admin access to the project. `.gitignore` catches the usual key file names as a
backstop, not as a plan. Instead of `--credentials` you can set
`GOOGLE_APPLICATION_CREDENTIALS`, or use `gcloud auth application-default login` with an
account that has Firestore access. The script refuses a key whose `project_id` isn't the
target project (`locus-5c6a8` unless you pass `--project`).

On completion it prints something like:

```
Seeded wifi_aps in locus-5c6a8 as firebase-adminsdk-xxxx@locus-5c6a8.iam.gserviceaccount.com
  written:         197 (created 197, overwritten 0)
  ambiguousFloor:  11 in this CSV, 11 flagged in the collection
  by floor:        floor 0: 51, floor 1: 55, floor 2: 67, floor 7: 24
  collection now:  197 documents
```

The "flagged in the collection" and "collection now" counts are read back from Firestore
after the write, not echoed from the CSV.

## Re-running

Safe. The document ID is the BSSID and every write is a full `set()`, so:

- The same CSV again overwrites the same 197 documents (`created 0, overwritten 197`). It
  never adds a second copy.
- A new CSV with more survey data updates the APs it contains and adds the new ones.
- A field left over from an older import is removed, because documents are replaced, not merged.
- An AP already in the collection but **absent** from the CSV is reported
  (`N not in this CSV, left as they were`) and never deleted. Remove those by hand if they
  should go.

The file is validated in full before anything is written. One bad row (malformed BSSID,
non-numeric coordinate, an `ambiguous_floor` that isn't True/False, a BSSID listed twice, a
`best_floor` missing from `floors_seen`) aborts the import with its line number, so a
half-understood CSV can't be half-imported.

## Document shape

`wifi_aps/{bssid}`:

| field | from CSV | notes |
|---|---|---|
| `bssid` | `bssid` | lowercase, same as the document ID and the `WifiScan` plugin's output |
| `ssid` | `ssid` | `""` for hidden networks |
| `lat`, `lng` | `best_lat`, `best_lng` | position of the strongest sighting |
| `floor` | `best_floor` | integer, 0 = ground, -1 = basement; `null` if heard strongest outdoors |
| `building` | `best_building` | exact `SRM_MASTER_DATABASE` name; `null` outdoors |
| `rssi` | `best_rssi` | dBm, the strongest sighting |
| `accuracyM` | `best_accuracy_m` | GPS accuracy of that sighting. Indoors the building/floor tag is the real ground truth |
| `frequencyMhz` | `frequency_mhz` | 2.4 vs 5 GHz propagate differently; kept for Stage 6 |
| `numSightings` | `num_sightings` | survey points it was heard at |
| `floorsSeen` | `floors_seen` | every floor it was heard on, e.g. `[0, 1]` |
| `ambiguousFloor` | `ambiguous_floor` | strong on two floors. Stage 6 should weight its floor down, not trust it |

Field names follow the app's only earlier collection (`tactical_zones`): snake_case
collection, camelCase fields.

## Security rules (set these in the console)

The repo has no `firestore.rules`; the live rules exist only in the Firebase console.
This script uses the Admin SDK, which bypasses rules, so it works whatever they say. The
app will need read access in Stage 5. Add this block **alongside** whatever the console has
now, without replacing it:

```
match /wifi_aps/{bssid} {
  allow read: if request.auth != null;
  allow write: if false;  // only this Admin script writes
}
```

## Tests

`npm test` runs the parser and mapping tests (`node --test`, no extra dependencies).

To exercise a real write without touching production, run it against the Firestore
emulator:

```bash
npx firebase-tools emulators:start --only firestore --project demo-locus
# in another shell (Git Bash):
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed -- path/to/wifi_aps.csv --project demo-locus
```
