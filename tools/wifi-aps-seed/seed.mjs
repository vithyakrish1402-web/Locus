/*
 * One-time import: the aggregated WiFi survey CSV -> Firestore `wifi_aps`, one document
 * per access point, with the BSSID as the document ID.
 *
 *   npm run seed -- <wifi_aps.csv> --dry-run
 *   npm run seed -- <wifi_aps.csv> --credentials <service-account.json>
 *
 * Run by hand, with real Admin credentials, from this folder. Nothing in LOCUS imports,
 * builds or ships it (see README.md).
 *
 * Safe to re-run. Every document is written with set() (no merge) under its BSSID, so
 * re-importing the same CSV overwrites the same documents instead of adding new ones,
 * and a field dropped from the mapping can't linger from an older import. Documents
 * already in the collection that this CSV doesn't mention are reported, never deleted.
 *
 * Credentials, first match wins:
 *   --credentials <file>              a service-account key (Firebase console > Project
 *                                     settings > Service accounts > Generate new private key)
 *   GOOGLE_APPLICATION_CREDENTIALS    the same, via the environment
 *   gcloud application-default login  your own Google account, if it has Firestore access
 * A key's project_id must match --project, so a key for another project can't be seeded by mistake.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { COLLECTION, parseApsCsv, summarize } from './src/apsCsv.js';

// Public client config from SRM-Locator-main/src/firebase.js, not a secret.
const DEFAULT_PROJECT = 'locus-5c6a8';
const BATCH_LIMIT = 500; // Firestore's cap on writes per batch
const ERRORS_SHOWN = 20;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'dry-run': { type: 'boolean', default: false },
    credentials: { type: 'string' },
    project: { type: 'string', default: DEFAULT_PROJECT },
  },
});

if (positionals.length !== 1) {
  console.error('Usage: npm run seed -- <wifi_aps.csv> [--dry-run] [--credentials <key.json>] [--project <id>]');
  process.exit(2);
}

const csvPath = positionals[0];
const { docs, errors } = parseApsCsv(readFileSync(csvPath, 'utf8'));
if (errors.length > 0) {
  console.error(`${csvPath}: ${errors.length} problem(s). Nothing was written.`);
  for (const e of errors.slice(0, ERRORS_SHOWN)) console.error(`  ${e}`);
  if (errors.length > ERRORS_SHOWN) console.error(`  ...and ${errors.length - ERRORS_SHOWN} more`);
  process.exit(1);
}

const summary = summarize(docs);
const byFloor = Object.entries(summary.byFloor)
  .map(([floor, n]) => `${floor}: ${n}`)
  .join(', ');

if (values['dry-run']) {
  console.log(`Dry run: ${csvPath} parsed cleanly. Nothing was written.`);
  console.log(`  would write:     ${summary.total} documents to ${COLLECTION} in ${values.project}`);
  console.log(`  ambiguousFloor:  ${summary.ambiguousFloor}`);
  console.log(`  by floor:        ${byFloor}`);
  console.log(`  flagged:         ${docs.filter((d) => d.ambiguousFloor).map((d) => d.bssid).join(', ') || 'none'}`);
  console.log(`  first document:  ${JSON.stringify(docs[0])}`);
  process.exit(0);
}

// Loaded only for a real run, so a dry run works before `npm install` and without credentials.
const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');

function credentialFor(project) {
  const keyPath = values.credentials ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    return { credential: applicationDefault(), source: 'gcloud application-default credentials' };
  }
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  if (key.type !== 'service_account') {
    if (values.credentials) {
      console.error(`${keyPath} is not a service-account key (type "${key.type}"). Nothing was written.`);
      process.exit(1);
    }
    // Some other ADC file (e.g. authorized_user) named by the environment; the SDK reads it.
    return { credential: applicationDefault(), source: keyPath };
  }
  if (key.project_id !== project) {
    console.error(`${keyPath} is a key for project "${key.project_id}", not "${project}". Nothing was written.`);
    console.error('Pass --project if you really mean that project.');
    process.exit(1);
  }
  return { credential: cert(key), source: key.client_email };
}

const { credential, source } = credentialFor(values.project);
const db = getFirestore(initializeApp({ credential, projectId: values.project }));
const collection = db.collection(COLLECTION);

// IDs only (select() with no fields): enough to tell a create from an overwrite.
const existing = new Set((await collection.select().get()).docs.map((d) => d.id));
const incoming = new Set(docs.map((d) => d.bssid));

// Each batch is atomic. If a later one fails, the earlier ones stay written, and
// re-running finishes the job: the same IDs are simply written again.
for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
  const batch = db.batch();
  for (const doc of docs.slice(i, i + BATCH_LIMIT)) {
    batch.set(collection.doc(doc.bssid), doc);
  }
  await batch.commit();
}

// Read the result back from Firestore rather than trusting the input: the counts below
// are what the collection holds now.
const [total, flagged] = await Promise.all([
  collection.count().get(),
  collection.where('ambiguousFloor', '==', true).count().get(),
]);
const overwritten = docs.filter((d) => existing.has(d.bssid)).length;
const untouched = [...existing].filter((id) => !incoming.has(id)).length;

console.log(`Seeded ${COLLECTION} in ${values.project} as ${source}`);
console.log(`  written:         ${docs.length} (created ${docs.length - overwritten}, overwritten ${overwritten})`);
console.log(`  ambiguousFloor:  ${summary.ambiguousFloor} in this CSV, ${flagged.data().count} flagged in the collection`);
console.log(`  by floor:        ${byFloor}`);
console.log(`  collection now:  ${total.data().count} documents` + (untouched ? ` (${untouched} not in this CSV, left as they were)` : ''));

if (total.data().count !== docs.length + untouched) {
  // Every write targets an existing-or-new ID, so this can only mean something else wrote
  // to the collection mid-run. Worth knowing before trusting the counts above.
  console.error('  WARNING: the document count does not add up. Another writer may have touched the collection.');
  process.exit(1);
}
