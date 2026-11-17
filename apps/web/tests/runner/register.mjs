/**
 * Preload that installs the TypeScript test loader for `node --test`.
 * Kept in one place so focused and full runs use identical compilation.
 */
import {register} from 'node:module';

register('./typescript-loader.mjs', import.meta.url);
