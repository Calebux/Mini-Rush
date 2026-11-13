// Isolated browser tests only; no credentials and no live Auth0 requests.
export async function signedInDriver(page) {
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').findLast(r => r.name.includes('/src/nearAuth.ts'))?.name ?? '/src/nearAuth.ts';
    const auth = await import(url);
    const { provider } = await auth.loadNearAuth();
    provider.client.isAuthenticated = async () => true;
    provider.client.getIdTokenClaims = async () => ({ sub: 'google-oauth2|fixture', __raw: 'fixture-login-token', exp: Math.floor(Date.now() / 1000) + 3600 });
    await auth.loginToken();
  });
}
