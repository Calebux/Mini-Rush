import type { AuthConfig } from 'convex/server';

// Verify normal login ID tokens, never the short-lived transaction-signing JWT.
export default {
  providers: [{
    domain: 'https://login.testnet.fast-auth.com',
    applicationID: process.env.NEAR_AUTH_CLIENT_ID ?? 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl'
  }]
} satisfies AuthConfig;
