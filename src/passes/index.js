// The optimizer: passes over the query plan, each giving a plan that means the same, run for
// every engine.
import { decorrelate } from './decorrelate.js';

export const PASSES = [decorrelate];

export const optimize = plan => PASSES.reduce((p, pass) => pass(p), plan);
