//! MiniRush garage — the game's items on NEAR.
//!
//! The multi-token ledger holds RUSH, dealer stock and stackable materials:
//!   * `rush`        — the coin races pay out (fungible, minted by the game)
//!   * `car:<id>`    — cars (one per unit, bought from a dealer)
//!   * `part:<id>`   — legacy dealer parts and consumables
//!
//! `components.rs` adds individually owned component NFTs, crafting,
//! installation, player sales, recycling and idempotent race salvage rewards.
//! `editions.rs` adds limited-edition cars: numbered NFTs sold and resold for NEAR.
//!
//! Cars and parts are sold from dealer stalls. Each stall belongs to a dealer
//! account run by an AI agent off-chain; the agent reprices its stock from
//! demand and writes the price *and its reason* here, so every price a player
//! sees can be traced to a signed decision on chain.

mod components;
mod editions;
use components::Workshop;
use editions::Showroom;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, IterableSet, LookupMap};
use near_sdk::{env, log, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub const RUSH: &str = "rush";
/// Per-call administrative mint limit. Race emissions have separate daily budgets.
pub const MAX_MINT_PER_CALL: u128 = 5_000;
pub const MAX_PRICE: u128 = 1_000_000;
pub const MAX_REASON: usize = 280;
pub const MAX_STOCK: u32 = 99;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Dealers,
    Tokens,
    Supply,
    Balances,
    Owned,
    Listings,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenInfo {
    /// "coin" | "car" | "part"
    pub kind: String,
    pub name: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Listing {
    pub dealer: AccountId,
    pub price: U128,
    pub stock: u32,
    pub sold: u32,
    /// Why the dealer set this price, in its own words.
    pub reason: String,
    pub updated_ms: u64,
}

#[near(serializers = [json])]
pub struct ListingView {
    pub token_id: String,
    pub kind: String,
    pub name: String,
    pub dealer: AccountId,
    pub price: U128,
    pub stock: u32,
    pub sold: u32,
    pub reason: String,
    pub updated_ms: u64,
}

#[near(serializers = [json])]
pub struct Token {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct Holding {
    pub token_id: String,
    pub balance: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Garage {
    owner: AccountId,
    dealers: IterableSet<AccountId>,
    tokens: IterableMap<String, TokenInfo>,
    supply: LookupMap<String, u128>,
    balances: LookupMap<String, u128>,
    owned: LookupMap<AccountId, Vec<String>>,
    listings: IterableMap<String, Listing>,
    workshop: Workshop,
    showroom: Showroom,
}

fn bal_key(token_id: &str, account: &AccountId) -> String {
    format!("{token_id}:{account}")
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    log!(
        "EVENT_JSON:{}",
        json!({ "standard": "nep245", "version": "1.0.0", "event": event, "data": [data] })
    );
}

#[near]
impl Garage {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        let mut g = Self {
            owner: owner_id,
            dealers: IterableSet::new(Key::Dealers),
            tokens: IterableMap::new(Key::Tokens),
            supply: LookupMap::new(Key::Supply),
            balances: LookupMap::new(Key::Balances),
            owned: LookupMap::new(Key::Owned),
            listings: IterableMap::new(Key::Listings),
            workshop: Workshop::default(),
            showroom: Showroom::default(),
        };
        g.tokens.insert(RUSH.to_string(), TokenInfo { kind: "coin".into(), name: "RUSH".into() });
        g
    }

    // ───────────────────────── admin ─────────────────────────

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    pub fn register_token(&mut self, token_id: String, kind: String, name: String) {
        self.assert_owner();
        require!(kind == "car" || kind == "part", "kind must be car or part");
        require!(token_id.starts_with(&format!("{kind}:")), "token id must start with its kind");
        require!(token_id.len() <= 64 && !token_id.contains(' '), "bad token id");
        self.tokens.insert(token_id, TokenInfo { kind, name });
    }

    pub fn set_dealer(&mut self, account_id: AccountId, enabled: bool) {
        self.assert_owner();
        if enabled {
            self.dealers.insert(account_id);
        } else {
            self.dealers.remove(&account_id);
        }
    }

    /// The game pays race coins (and can grant starter items) through this.
    pub fn mint(&mut self, receiver_id: AccountId, token_id: String, amount: U128, memo: Option<String>) {
        self.assert_owner();
        require!(!token_id.starts_with("material:"), "materials come from race rewards");
        require!(self.tokens.contains_key(&token_id), "unknown token");
        if token_id == RUSH {
            require!(amount.0 <= MAX_MINT_PER_CALL, "payout too large");
        }
        self.credit(&token_id, &receiver_id, amount.0);
        emit(
            "mt_mint",
            json!({ "owner_id": receiver_id, "token_ids": [token_id], "amounts": [amount], "memo": memo }),
        );
    }

    // ───────────────────────── dealers ─────────────────────────

    fn assert_dealer(&self) -> AccountId {
        let me = env::predecessor_account_id();
        require!(self.dealers.contains(&me), "dealer only");
        me
    }

    fn check_price(price: u128, reason: &str) {
        require!(price > 0 && price <= MAX_PRICE, "price out of range");
        require!(reason.len() <= MAX_REASON, "reason too long");
    }

    /// Open a stall for an item, or take over a stall nobody holds.
    pub fn dealer_list(&mut self, token_id: String, price: U128, stock: u32, reason: String) {
        let me = self.assert_dealer();
        let info = self.tokens.get(&token_id).expect("unknown token");
        require!(info.kind == "car" || info.kind == "part", "only dealer cars and consumables");
        Self::check_price(price.0, &reason);
        require!(stock <= MAX_STOCK, "too much stock");
        if let Some(l) = self.listings.get(&token_id) {
            require!(l.dealer == me, "another dealer holds this stall");
        }
        let sold = self.listings.get(&token_id).map(|l| l.sold).unwrap_or(0);
        self.listings.insert(
            token_id.clone(),
            Listing { dealer: me.clone(), price, stock, sold, reason: reason.clone(), updated_ms: env::block_timestamp_ms() },
        );
        log!("EVENT_JSON:{}", json!({ "standard": "minirush", "version": "1.0.0", "event": "price",
            "data": [{ "token_id": token_id, "dealer": me, "price": price, "stock": stock, "reason": reason }] }));
    }

    /// Reprice a stall. `reason` is stored next to the price for players to read.
    pub fn dealer_set_price(&mut self, token_id: String, price: U128, reason: String) {
        let me = self.assert_dealer();
        Self::check_price(price.0, &reason);
        let mut l = self.listings.get(&token_id).cloned().expect("no stall");
        require!(l.dealer == me, "not your stall");
        l.price = price;
        l.reason = reason.clone();
        l.updated_ms = env::block_timestamp_ms();
        self.listings.insert(token_id.clone(), l);
        log!("EVENT_JSON:{}", json!({ "standard": "minirush", "version": "1.0.0", "event": "price",
            "data": [{ "token_id": token_id, "dealer": me, "price": price, "reason": reason }] }));
    }

    pub fn dealer_restock(&mut self, token_id: String, add: u32) {
        let me = self.assert_dealer();
        let mut l = self.listings.get(&token_id).cloned().expect("no stall");
        require!(l.dealer == me, "not your stall");
        l.stock = (l.stock + add).min(MAX_STOCK);
        self.listings.insert(token_id, l);
    }

    // ───────────────────────── players ─────────────────────────

    /// Buy one unit from a stall, paying in RUSH. The coins go to the dealer.
    pub fn buy(&mut self, token_id: String, max_price: U128) -> U128 {
        let buyer = env::predecessor_account_id();
        let mut l = self.listings.get(&token_id).cloned().expect("no stall");
        require!(l.stock > 0, "sold out");
        // the price can move between seeing it and paying; never pay more than was shown
        require!(l.price.0 <= max_price.0, "price went up");
        require!(buyer != l.dealer, "dealers can't buy their own stock");
        self.debit(RUSH, &buyer, l.price.0);
        self.credit(RUSH, &l.dealer, l.price.0);
        self.credit(&token_id, &buyer, 1);
        l.stock -= 1;
        l.sold += 1;
        let price = l.price;
        let dealer = l.dealer.clone();
        self.listings.insert(token_id.clone(), l);
        emit("mt_transfer", json!({ "old_owner_id": buyer, "new_owner_id": dealer,
            "token_ids": [RUSH], "amounts": [price], "memo": format!("buy {token_id}") }));
        emit("mt_mint", json!({ "owner_id": buyer, "token_ids": [token_id], "amounts": ["1"] }));
        price
    }

    /// Sell one unit back to whoever runs its stall, for half the current price.
    pub fn sell_back(&mut self, token_id: String, min_payout: U128) -> U128 {
        let seller = env::predecessor_account_id();
        let mut l = self.listings.get(&token_id).cloned().expect("no stall");
        let payout = l.price.0 / 2;
        require!(payout >= min_payout.0, "price went down");
        self.debit(&token_id, &seller, 1);
        self.debit(RUSH, &l.dealer, payout);
        self.credit(RUSH, &seller, payout);
        l.stock = (l.stock + 1).min(MAX_STOCK);
        let dealer = l.dealer.clone();
        self.listings.insert(token_id.clone(), l);
        emit("mt_burn", json!({ "owner_id": seller, "token_ids": [token_id], "amounts": ["1"] }));
        emit("mt_transfer", json!({ "old_owner_id": dealer, "new_owner_id": seller,
            "token_ids": [RUSH], "amounts": [U128(payout)], "memo": "sell back" }));
        U128(payout)
    }

    /// Burn one consumable part (a nitro can) as the race starts.
    pub fn consume(&mut self, token_id: String) {
        let me = env::predecessor_account_id();
        let info = self.tokens.get(&token_id).expect("unknown token");
        require!(info.kind == "part", "only parts are consumed");
        self.debit(&token_id, &me, 1);
        emit("mt_burn", json!({ "owner_id": me, "token_ids": [token_id], "amounts": ["1"], "memo": "used in a race" }));
    }

    // ───────────────────────── NEP-245 core ─────────────────────────

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        require!(approval.is_none(), "approvals are not supported");
        let sender = env::predecessor_account_id();
        require!(sender != receiver_id, "sender and receiver must differ");
        require!(amount.0 > 0, "amount must be positive");
        self.debit(&token_id, &sender, amount.0);
        self.credit(&token_id, &receiver_id, amount.0);
        emit("mt_transfer", json!({ "old_owner_id": sender, "new_owner_id": receiver_id,
            "token_ids": [token_id], "amounts": [amount], "memo": memo }));
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        require!(approvals.map_or(true, |a| a.iter().all(|x| x.is_none())), "approvals are not supported");
        require!(token_ids.len() == amounts.len(), "length mismatch");
        let sender = env::predecessor_account_id();
        require!(sender != receiver_id, "sender and receiver must differ");
        for (t, a) in token_ids.iter().zip(amounts.iter()) {
            require!(a.0 > 0, "amount must be positive");
            self.debit(t, &sender, a.0);
            self.credit(t, &receiver_id, a.0);
        }
        emit("mt_transfer", json!({ "old_owner_id": sender, "new_owner_id": receiver_id,
            "token_ids": token_ids, "amounts": amounts, "memo": memo }));
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.balance(&token_id, &account_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|t| U128(self.balance(t, &account_id))).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        if !self.tokens.contains_key(&token_id) {
            return None;
        }
        Some(U128(self.supply.get(&token_id).copied().unwrap_or(0)))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|t| self.mt_supply(t)).collect()
    }

    /// Items here are semi-fungible, so no single owner is reported.
    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<Token>> {
        token_ids
            .into_iter()
            .map(|t| self.tokens.contains_key(&t).then(|| Token { token_id: t, owner_id: None }))
            .collect()
    }

    pub fn mt_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u32>) -> Vec<Holding> {
        let ids = self.owned.get(&account_id).cloned().unwrap_or_default();
        let start = from_index.map_or(0, |i| i.0 as usize);
        ids.into_iter()
            .skip(start)
            .take(limit.unwrap_or(100) as usize)
            .map(|t| Holding { balance: U128(self.balance(&t, &account_id)), token_id: t })
            .collect()
    }

    // ───────────────────────── views ─────────────────────────

    pub fn tokens(&self) -> Vec<(String, TokenInfo)> {
        self.tokens.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn listings(&self) -> Vec<ListingView> {
        self.listings
            .iter()
            .map(|(t, l)| {
                let info = self.tokens.get(t).cloned().unwrap_or(TokenInfo { kind: "?".into(), name: t.clone() });
                ListingView {
                    token_id: t.clone(),
                    kind: info.kind,
                    name: info.name,
                    dealer: l.dealer.clone(),
                    price: l.price,
                    stock: l.stock,
                    sold: l.sold,
                    reason: l.reason.clone(),
                    updated_ms: l.updated_ms,
                }
            })
            .collect()
    }

    pub fn dealers(&self) -> Vec<AccountId> {
        self.dealers.iter().cloned().collect()
    }

    pub fn owner(&self) -> AccountId {
        self.owner.clone()
    }

    // ───────────────────────── internals ─────────────────────────

    fn balance(&self, token_id: &str, account: &AccountId) -> u128 {
        self.balances.get(&bal_key(token_id, account)).copied().unwrap_or(0)
    }

    fn credit(&mut self, token_id: &str, account: &AccountId, amount: u128) {
        let before = self.balance(token_id, account);
        self.balances.insert(bal_key(token_id, account), before.checked_add(amount).expect("overflow"));
        let s = self.supply.get(token_id).copied().unwrap_or(0);
        // supply counts every unit in existence; transfers credit and debit it evenly
        self.supply.insert(token_id.to_string(), s.checked_add(amount).expect("supply overflow"));
        if before == 0 && amount > 0 {
            let mut ids = self.owned.get(account).cloned().unwrap_or_default();
            ids.push(token_id.to_string());
            self.owned.insert(account.clone(), ids);
        }
    }

    fn debit(&mut self, token_id: &str, account: &AccountId, amount: u128) {
        let before = self.balance(token_id, account);
        require!(before >= amount, format!("not enough {token_id}"));
        if token_id == RUSH {
            require!(before - amount >= self.reserved_order_rush(account), "RUSH reserved for purchase orders");
        }
        let after = before - amount;
        if after == 0 {
            self.balances.remove(&bal_key(token_id, account));
            if let Some(mut ids) = self.owned.get(account).cloned() {
                ids.retain(|t| t != token_id);
                self.owned.insert(account.clone(), ids);
            }
        } else {
            self.balances.insert(bal_key(token_id, account), after);
        }
        let s = self.supply.get(token_id).copied().unwrap_or(0);
        self.supply.insert(token_id.to_string(), s - amount);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken};

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn as_(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(acc(who)).build());
    }

    fn as_yocto(who: &str) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(acc(who))
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
    }

    fn setup() -> Garage {
        as_("game.testnet");
        let mut g = Garage::new(acc("game.testnet"));
        g.register_token("car:viper".into(), "car".into(), "VIPER GT".into());
        g.set_dealer(acc("mama.testnet"), true);
        g.mint(acc("ada.testnet"), RUSH.into(), U128(500), Some("race".into()));
        as_("mama.testnet");
        g.dealer_list("car:viper".into(), U128(300), 3, "fresh stock".into());
        g
    }

    #[test]
    fn buy_moves_coins_to_dealer_and_car_to_buyer() {
        let mut g = setup();
        as_("ada.testnet");
        g.buy("car:viper".into(), U128(300));
        assert_eq!(g.mt_balance_of(acc("ada.testnet"), RUSH.into()).0, 200);
        assert_eq!(g.mt_balance_of(acc("mama.testnet"), RUSH.into()).0, 300);
        assert_eq!(g.mt_balance_of(acc("ada.testnet"), "car:viper".into()).0, 1);
        let l = &g.listings()[0];
        assert_eq!((l.stock, l.sold), (2, 1));
        let held: Vec<String> = g.mt_tokens_for_owner(acc("ada.testnet"), None, None).into_iter().map(|h| h.token_id).collect();
        assert_eq!(held, vec!["rush".to_string(), "car:viper".to_string()]);
    }

    #[test]
    #[should_panic(expected = "price went up")]
    fn buy_never_pays_more_than_shown() {
        let mut g = setup();
        as_("ada.testnet");
        g.buy("car:viper".into(), U128(299));
    }

    #[test]
    #[should_panic(expected = "not enough rush")]
    fn buy_needs_the_coins() {
        let mut g = setup();
        as_("bo.testnet");
        g.buy("car:viper".into(), U128(300));
    }

    #[test]
    fn dealer_reprices_with_a_reason() {
        let mut g = setup();
        as_("mama.testnet");
        g.dealer_set_price("car:viper".into(), U128(420), "three sold this hour".into());
        let l = &g.listings()[0];
        assert_eq!(l.price.0, 420);
        assert_eq!(l.reason, "three sold this hour");
    }

    #[test]
    #[should_panic(expected = "dealer only")]
    fn players_cannot_set_prices() {
        let mut g = setup();
        as_("ada.testnet");
        g.dealer_set_price("car:viper".into(), U128(1), "cheap".into());
    }

    #[test]
    #[should_panic(expected = "another dealer holds this stall")]
    fn dealers_cannot_steal_stalls() {
        let mut g = setup();
        as_("game.testnet");
        g.set_dealer(acc("oga.testnet"), true);
        as_("oga.testnet");
        g.dealer_list("car:viper".into(), U128(10), 1, "mine now".into());
    }

    #[test]
    fn sell_back_pays_half_and_burns() {
        let mut g = setup();
        as_("ada.testnet");
        g.buy("car:viper".into(), U128(300));
        let paid = g.sell_back("car:viper".into(), U128(150));
        assert_eq!(paid.0, 150);
        assert_eq!(g.mt_balance_of(acc("ada.testnet"), RUSH.into()).0, 350);
        assert_eq!(g.mt_balance_of(acc("ada.testnet"), "car:viper".into()).0, 0);
        assert_eq!(g.mt_supply("car:viper".into()).unwrap().0, 0);
        assert_eq!(g.listings()[0].stock, 3);
    }

    #[test]
    fn transfer_between_players() {
        let mut g = setup();
        as_("ada.testnet");
        g.buy("car:viper".into(), U128(300));
        as_yocto("ada.testnet");
        g.mt_transfer(acc("bo.testnet"), "car:viper".into(), U128(1), None, None);
        assert_eq!(g.mt_balance_of(acc("bo.testnet"), "car:viper".into()).0, 1);
        assert!(g.mt_tokens_for_owner(acc("ada.testnet"), None, None).iter().all(|h| h.token_id != "car:viper"));
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn transfer_needs_one_yocto() {
        let mut g = setup();
        as_("ada.testnet");
        g.mt_transfer(acc("bo.testnet"), RUSH.into(), U128(1), None, None);
    }

    #[test]
    fn parts_are_consumed() {
        let mut g = setup();
        as_("game.testnet");
        g.register_token("part:nitro-can".into(), "part".into(), "NITRO CAN".into());
        g.mint(acc("ada.testnet"), "part:nitro-can".into(), U128(2), None);
        as_("ada.testnet");
        g.consume("part:nitro-can".into());
        assert_eq!(g.mt_balance_of(acc("ada.testnet"), "part:nitro-can".into()).0, 1);
    }

    #[test]
    #[should_panic(expected = "only parts are consumed")]
    fn cars_are_not_consumed() {
        let mut g = setup();
        as_("ada.testnet");
        g.buy("car:viper".into(), U128(300));
        g.consume("car:viper".into());
    }

    #[test]
    #[should_panic(expected = "payout too large")]
    fn race_payouts_are_capped() {
        let mut g = setup();
        as_("game.testnet");
        g.mint(acc("ada.testnet"), RUSH.into(), U128(MAX_MINT_PER_CALL + 1), None);
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn only_the_game_mints() {
        let mut g = setup();
        as_("ada.testnet");
        g.mint(acc("ada.testnet"), RUSH.into(), U128(1), None);
    }
}
