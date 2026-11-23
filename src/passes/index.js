// The optimizer: passes over the query plan, each giving a plan that means the same, run for
// every engine.
import { decorrelate } from './decorrelate.js';
import { fuse } from './fuse.js';
import { joins } from './joins.js';
import { standard } from './standard.js';
import { exact } from './exact.js';
import { share } from './share.js';
import { inline } from './inline.js';
import { renames } from './renames.js';
import { prune } from './prune.js';

export const PASSES = [decorrelate, fuse, joins, standard, exact, share, inline, renames, prune];

export const optimize = plan => PASSES.reduce((p, pass) => pass(p), plan);
