// The optimizer: passes over the query plan, each giving a plan that means the same, run for
// every engine.
import { decorrelate } from './decorrelate.js';
import { joins } from './joins.js';
import { standard } from './standard.js';

export const PASSES = [decorrelate, joins, standard];

export const optimize = plan => PASSES.reduce((p, pass) => pass(p), plan);
