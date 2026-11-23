// The optimizer: passes over the query plan, each giving a plan that means the same, run for
// every engine.
import { decorrelate } from './decorrelate.js';
import { fuse } from './fuse.js';
import { joins } from './joins.js';
import { standard } from './standard.js';
import { exact } from './exact.js';
import { share } from './share.js';

export const PASSES = [decorrelate, fuse, joins, standard, exact, share];

export const optimize = plan => PASSES.reduce((p, pass) => pass(p), plan);
