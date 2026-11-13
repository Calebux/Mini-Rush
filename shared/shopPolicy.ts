const PAID = ['buy', 'buy_component', 'craft_component'];

/** The value of SHOP_SIGN_IN / VITE_SHOP_SIGN_IN that makes buying require a login. */
export const signInRequired = (setting: string | undefined): boolean => setting?.trim() === 'required';

/**
 * Whether a garage call needs a signed-in driver. By default nothing does: the
 * garage key made on the player's device is their access to the game. A
 * deployment can require a login for purchases and paid crafting; racing stays open.
 */
export const requiresShopSignIn = (method: string, required: boolean): boolean =>
  required && PAID.includes(method);
