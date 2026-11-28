// The optimizer: passes over the query plan, each giving a plan that means the same, run for
// every engine.
import { decorrelate } from './decorrelate.js';
import { ownRows } from './own-rows.js';
import { fuse } from './fuse.js';
import { joins } from './joins.js';
import { standard } from './standard.js';
import { outer } from './outer.js';
import { exact } from './exact.js';
import { share } from './share.js';
import { inline } from './inline.js';
import { renames } from './renames.js';
import { prune } from './prune.js';
import { pipe } from '../check.js';

export const PASSES = [ownRows, decorrelate, fuse, joins, standard, outer, exact, share, inline, renames, prune];

export const optimize = pipe(PASSES.map(pass => [pass.name, pass]));
