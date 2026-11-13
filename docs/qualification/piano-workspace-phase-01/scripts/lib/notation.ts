/**
 * Loads the repository's `packages/music-notation` from the resolved repository root.
 *
 * A literal relative import would silently depend on how deep this file sits; loading
 * through `createRequire` with an explicit root keeps the scripts runnable from their
 * committed location even if a future submitter moves the folder.
 */
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {repoRoot} from './paths.ts';

type NotationModule = typeof import('../../../../../packages/music-notation/index.ts');

let loaded: NotationModule | null = null;

export function loadNotation(): NotationModule {
  if (loaded) return loaded;
  const entry = join(repoRoot(), 'packages', 'music-notation', 'index.ts');
  const require = createRequire(import.meta.url);
  loaded = require(entry) as NotationModule;
  return loaded;
}
