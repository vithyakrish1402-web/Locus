// Node module hooks for running app source files from a script (scripts/floor7-leave-one-out.mjs):
//   - the app's Firebase imports become empty stand-ins (the estimator never touches them), and
//   - a .json import works without the `with { type: 'json' }` the browser build does not need.
// Registered by registerShims.mjs. Scripts only; no app build ever loads this.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STUBS = {
  'firebase/firestore': 'export const collection = () => { throw new Error("Firestore is not available in scripts"); }; export const getDocsFromServer = collection;',
  firebaseApp: 'export const auth = {}; export const db = {};',
};

export async function resolve(specifier, context, next) {
  if (specifier === 'firebase/firestore') return { url: `data:text/javascript,${encodeURIComponent(STUBS['firebase/firestore'])}`, shortCircuit: true };
  if (/(^|\/)firebase\.js$/.test(specifier)) return { url: `data:text/javascript,${encodeURIComponent(STUBS.firebaseApp)}`, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    return { format: 'json', source: readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true };
  }
  return next(url, context);
}
