// Import this first, before any app source file: it installs nodeShims.mjs.
import { register } from 'node:module';

register('./nodeShims.mjs', import.meta.url);
