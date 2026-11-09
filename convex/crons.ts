import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
// The three dealer agents look at their stalls and reprice every 15 minutes.
crons.interval('dealer agents', { minutes: 15 }, internal.near.dealerTick, {});
export default crons;
