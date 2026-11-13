/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as boards from "../boards.js";
import type * as bounty from "../bounty.js";
import type * as challenges from "../challenges.js";
import type * as crons from "../crons.js";
import type * as friends from "../friends.js";
import type * as identityProofCrypto from "../identityProofCrypto.js";
import type * as near from "../near.js";
import type * as nearDb from "../nearDb.js";
import type * as profiles from "../profiles.js";
import type * as usage from "../usage.js";
import type * as weekend from "../weekend.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  boards: typeof boards;
  bounty: typeof bounty;
  challenges: typeof challenges;
  crons: typeof crons;
  friends: typeof friends;
  identityProofCrypto: typeof identityProofCrypto;
  near: typeof near;
  nearDb: typeof nearDb;
  profiles: typeof profiles;
  usage: typeof usage;
  weekend: typeof weekend;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
