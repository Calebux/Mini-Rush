import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
// The three dealer agents look at their stalls and reprice every 15 minutes.
crons.interval('dealer agents', { minutes: 15 }, internal.near.dealerTick, {});
crons.interval('completed action retention', { hours: 6 }, internal.nearDb.pruneGarageActions, {});
crons.interval('ownership challenge retention', { hours: 1 }, internal.nearDb.pruneIdentityProofs, {});
export default crons;
