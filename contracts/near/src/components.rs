//! Unique crafted components, atomic RUSH settlement and bounded race emissions.
//! Components expose NEP-171 ownership plus metadata and enumeration.
use super::*;

pub const ALLOY: &str = "material:alloy";
pub const CIRCUIT: &str = "material:circuit";
const DAY_MS: u64 = 86_400_000;

#[near(serializers = [json])]
#[derive(Clone)]
pub struct Recipe {
    pub id: String, pub name: String, pub slot: String,
    pub rush: u32, pub alloy: u32, pub circuit: u32,
    pub speed: i32, pub accel: i32, pub grip: i32, pub nitro: i32, pub detail: String,
}
pub fn recipes() -> Vec<Recipe> {
    near_sdk::serde_json::from_str(include_str!("../../../shared/components.json")).expect("recipe catalogue")
}
fn recipe(id: &str) -> Recipe { recipes().into_iter().find(|r| r.id == id).expect("unknown recipe") }

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Component {
    pub id: String, pub recipe_id: String, pub owner: AccountId, pub maker: AccountId,
    pub created_ms: u64, pub installed_on: Option<String>, pub price: Option<U128>, pub offer: u64,
}
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Emission { day: u64, races: u32, last_ms: u64 }
/// Season-long totals for every faucet and sink, so the economy can be audited from one view.
#[near(serializers = [borsh, json])]
#[derive(Clone, Default, Debug, PartialEq)]
pub struct Ledger {
    pub races_paid: u64, pub podiums: u64,
    pub rush_minted: u64, pub alloy_minted: u64, pub circuit_minted: u64,
    pub rush_burned_craft: u64, pub rush_burned_fees: u64,
    pub alloy_burned: u64, pub circuit_burned: u64,
    pub parts_crafted: u64, pub parts_recycled: u64,
    pub trades: u64, pub trade_volume: u64,
}
pub const RACES_PER_ACCOUNT_DAY: u32 = 20;
pub const RACES_PER_DAY: u32 = 2000;
/// RUSH for a finished race. Finishing always pays; a podium pays more, so a better build earns more.
pub fn race_rush(place: Option<u8>) -> u128 {
    match place { Some(1) => 45, Some(2) => 36, Some(3) => 30, _ => 24 }
}
#[near(serializers = [borsh])]
pub struct Workshop {
    parts: IterableMap<String, Component>,
    inventories: LookupMap<AccountId, Vec<String>>,
    offers: IterableMap<String, Component>,
    rewards: LookupMap<String, AccountId>,
    emissions: LookupMap<AccountId, Emission>,
    global: Emission,
    serial: u64,
    revision: u64,
    reserved: LookupMap<AccountId, u32>,
    ledger: Ledger,
}
impl Default for Workshop {
    fn default() -> Self {
        Self { parts: IterableMap::new(b"w2p".to_vec()), inventories: LookupMap::new(b"w2i".to_vec()),
            offers: IterableMap::new(b"w2o".to_vec()), rewards: LookupMap::new(b"w2r".to_vec()),
            emissions: LookupMap::new(b"w2e".to_vec()), global: Emission::default(), serial: 0, revision: 0, reserved: LookupMap::new(b"w2res".to_vec()), ledger: Ledger::default() }
    }
}
fn event(name: &str, data: near_sdk::serde_json::Value) {
    log!("EVENT_JSON:{}", json!({"standard":"minirush", "version":"2.0.0", "event":name, "data":[data]}));
}

#[near]
impl Garage {
    /// Upgrade the original garage without dropping balances, dealers or listings.
    #[init(ignore_state)]
    #[private]
    pub fn migrate_components() -> Self {
        let old: LegacyGarage = env::state_read().expect("expected v1 garage state");
        Self { owner: old.owner, dealers: old.dealers, tokens: old.tokens, supply: old.supply,
            balances: old.balances, owned: old.owned, listings: old.listings, workshop: Workshop::default() }
    }
    pub fn component_recipes(&self) -> Vec<Recipe> { recipes() }
    pub fn component_inventory(&self, account_id: AccountId) -> Vec<Component> {
        self.workshop.inventories.get(&account_id).cloned().unwrap_or_default().iter()
            .filter_map(|id| self.workshop.parts.get(id).cloned()).collect()
    }
    pub fn component_offers(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Component> {
        self.workshop.offers.values().skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(30).min(100) as usize).cloned().collect()
    }
    pub fn component(&self, part_id: String) -> Option<Component> { self.workshop.parts.get(&part_id).cloned() }
    /// One read of the whole economy: live supply, where RUSH sits, and every faucet and sink to date.
    pub fn economy(&self) -> near_sdk::serde_json::Value {
        let day = env::block_timestamp_ms() / DAY_MS;
        let today = if self.workshop.global.day == day { self.workshop.global.races } else { 0 };
        let supply = |t: &str| U128(self.supply.get(t).copied().unwrap_or(0));
        let dealer_rush: u128 = self.dealers.iter().map(|d| self.balance(RUSH, d)).sum();
        json!({ "rush_supply": supply(RUSH), "alloy_supply": supply(ALLOY), "circuit_supply": supply(CIRCUIT),
            "dealer_rush": U128(dealer_rush), "parts": self.workshop.parts.len(), "offers": self.workshop.offers.len(),
            "parts_issued": self.workshop.serial, "races_today": today, "races_per_day": RACES_PER_DAY,
            "races_per_account_day": RACES_PER_ACCOUNT_DAY,
            "payout": { "first": U128(race_rush(Some(1))), "second": U128(race_rush(Some(2))),
                "third": U128(race_rush(Some(3))), "finish": U128(race_rush(None)), "alloy": 2, "circuit": 1 },
            "market_fee_percent": 2, "ledger": self.workshop.ledger })
    }

    pub fn craft_component(&mut self, recipe_id: String) -> Component {
        let r = recipe(&recipe_id);
        let who = env::predecessor_account_id();
        let mut ids = self.workshop.inventories.get(&who).cloned().unwrap_or_default();
        self.component_capacity(&who, ids.len());
        require!(self.workshop.serial < 100_000, "season component capacity reached");
        for (token, amount) in [(RUSH,r.rush), (ALLOY,r.alloy), (CIRCUIT,r.circuit)] {
            require!(self.balance(token, &who) >= u128::from(amount), format!("not enough {token}"));
        }
        for (token, amount) in [(RUSH,r.rush), (ALLOY,r.alloy), (CIRCUIT,r.circuit)] {
            self.debit(token, &who, u128::from(amount));
            emit("mt_burn", json!({"owner_id":who,"token_ids":[token],"amounts":[amount.to_string()],"memo":"craft"}));
        }
        let l = &mut self.workshop.ledger;
        l.rush_burned_craft += u64::from(r.rush); l.alloy_burned += u64::from(r.alloy);
        l.circuit_burned += u64::from(r.circuit); l.parts_crafted += 1;
        self.workshop.serial += 1;
        let p = Component { id: format!("component:{}", self.workshop.serial), recipe_id,
            owner: who.clone(), maker: who.clone(), created_ms: env::block_timestamp_ms(),
            installed_on: None, price: None, offer: 0 };
        ids.push(p.id.clone());
        self.workshop.inventories.insert(who, ids);
        self.workshop.parts.insert(p.id.clone(), p.clone());
        nft_event("nft_mint", json!({"owner_id":p.owner,"token_ids":[p.id]}));
        event("component_crafted", json!(p));
        p
    }

    /// Installing replaces that chassis's existing part in the same slot.
    pub fn install_component(&mut self, part_id: String, chassis: Option<String>) {
        let mut p = self.my_component(&part_id);
        require!(p.price.is_none(), "cancel the listing first");
        if let Some(ref car) = chassis {
            require!(car == "viper" || car == "rush-one", "incompatible chassis");
            let slot = recipe(&p.recipe_id).slot;
            for mut other in self.component_inventory(p.owner.clone()) {
                if other.id != part_id && other.installed_on.as_ref() == Some(car) && recipe(&other.recipe_id).slot == slot {
                    other.installed_on = None;
                    self.workshop.parts.insert(other.id.clone(), other);
                }
            }
        }
        p.installed_on = chassis;
        self.workshop.parts.insert(part_id, p.clone());
        event("component_installed", json!(p));
    }

    pub fn list_component(&mut self, part_id: String, price: U128) -> Component {
        require!(price.0 >= 10 && price.0 <= MAX_PRICE, "price must be 10 to 1000000 RUSH");
        let mut p = self.my_component(&part_id);
        require!(self.workshop.offers.len() < 2000 || p.price.is_some(), "market capacity reached");
        self.workshop.revision += 1;
        p.offer = self.workshop.revision;
        p.price = Some(price);
        p.installed_on = None;
        self.workshop.parts.insert(part_id.clone(), p.clone());
        self.workshop.offers.insert(part_id, p.clone());
        event("component_listed", json!(p));
        p
    }
    pub fn cancel_component(&mut self, part_id: String) {
        let mut p = self.my_component(&part_id);
        require!(p.price.is_some(), "not listed");
        p.price = None;
        self.workshop.offers.remove(&part_id);
        self.workshop.parts.insert(part_id.clone(), p);
        event("component_cancelled", json!({"part_id":part_id}));
    }
    /// Inventory and payment settle together, inside a single contract call.
    pub fn buy_component(&mut self, part_id: String, offer: u64, max_price: U128) -> Component {
        let mut p = self.workshop.parts.get(&part_id).cloned().expect("unknown component");
        let price = p.price.expect("not listed").0;
        require!(p.offer == offer, "listing changed; refresh");
        require!(price <= max_price.0, "price went up");
        let buyer = env::predecessor_account_id();
        require!(buyer != p.owner, "cannot buy your own component");
        let mut ids = self.workshop.inventories.get(&buyer).cloned().unwrap_or_default();
        self.component_capacity(&buyer, ids.len());
        let fee = (price * 2 / 100).max(1);
        self.debit(RUSH, &buyer, price);
        self.credit(RUSH, &p.owner, price - fee);
        emit("mt_transfer", json!({"old_owner_id":buyer,"new_owner_id":p.owner,"token_ids":[RUSH],"amounts":[(price-fee).to_string()]}));
        emit("mt_burn", json!({"owner_id":buyer,"token_ids":[RUSH],"amounts":[fee.to_string()],"memo":"market fee"}));
        let l = &mut self.workshop.ledger;
        l.trades += 1; l.trade_volume += price as u64; l.rush_burned_fees += fee as u64;
        let seller = p.owner.clone();
        let mut old = self.workshop.inventories.get(&seller).cloned().unwrap_or_default();
        old.retain(|id| id != &part_id);
        ids.push(part_id.clone());
        self.workshop.inventories.insert(seller.clone(), old);
        self.workshop.inventories.insert(buyer.clone(), ids);
        p.owner = buyer;
        p.installed_on = None;
        p.price = None;
        self.workshop.offers.remove(&part_id);
        self.workshop.parts.insert(part_id.clone(), p.clone());
        nft_event("nft_transfer", json!({"old_owner_id":seller,"new_owner_id":p.owner,"token_ids":[part_id]}));
        event("component_sold", json!({"part":p,"seller":seller,"price":price.to_string(),"fee":fee.to_string()}));
        p
    }
    pub fn recycle_component(&mut self, part_id: String) {
        let p = self.my_component(&part_id);
        require!(p.price.is_none() && p.installed_on.is_none(), "uninstall and cancel listing before recycling");
        let r = recipe(&p.recipe_id);
        let mut ids = self.workshop.inventories.get(&p.owner).cloned().unwrap_or_default();
        ids.retain(|id| id != &part_id);
        self.workshop.inventories.insert(p.owner.clone(), ids);
        self.workshop.parts.remove(&part_id);
        self.workshop.ledger.parts_recycled += 1;
        // Rounding down and never refunding RUSH prevents a profitable recycle loop.
        self.material_credit(&p.owner, ALLOY, u128::from(r.alloy / 2));
        self.material_credit(&p.owner, CIRCUIT, u128::from(r.circuit / 2));
        nft_event("nft_burn", json!({"owner_id":p.owner,"token_ids":[part_id]}));
        event("component_recycled", json!({"part_id":part_id,"alloy":r.alloy/2,"circuit":r.circuit/2}));
    }

    /// Idempotent payout: one backend-issued session can mint once, even after a timeout.
    /// Validation is performed by the game server, not by this contract. `place` only
    /// selects one of four fixed RUSH amounts, so no caller can ask for more than a win pays.
    pub fn reward_race(&mut self, receiver_id: AccountId, race_id: String, place: Option<u8>) -> bool {
        self.assert_owner();
        require!(!race_id.is_empty() && race_id.len() <= 80, "bad race id");
        if let Some(who) = self.workshop.rewards.get(&race_id) {
            require!(who == &receiver_id, "race belongs to another account");
            return false;
        }
        let now = env::block_timestamp_ms();
        let day = now / DAY_MS;
        let mut e = self.workshop.emissions.get(&receiver_id).cloned().unwrap_or_default();
        require!(e.last_ms == 0 || now >= e.last_ms + 40_000, "race rewards too close");
        if e.day != day { e.day = day; e.races = 0; }
        if self.workshop.global.day != day { self.workshop.global.day = day; self.workshop.global.races = 0; }
        require!(e.races < RACES_PER_ACCOUNT_DAY, "daily race reward limit");
        require!(self.workshop.global.races < RACES_PER_DAY, "daily season reward budget used");
        e.races += 1; e.last_ms = now;
        self.workshop.global.races += 1;
        self.workshop.emissions.insert(receiver_id.clone(), e);
        self.workshop.rewards.insert(race_id.clone(), receiver_id.clone());
        let rush = race_rush(place);
        for (token, amount) in [(RUSH,rush), (ALLOY,2), (CIRCUIT,1)] {
            self.material_credit(&receiver_id, token, amount);
        }
        let l = &mut self.workshop.ledger;
        l.races_paid += 1; l.rush_minted += rush as u64; l.alloy_minted += 2; l.circuit_minted += 1;
        if matches!(place, Some(1..=3)) { l.podiums += 1; }
        event("race_reward", json!({"race_id":race_id,"account":receiver_id,"place":place,"rush":rush.to_string(),"alloy":2,"circuit":1}));
        true
    }
}
impl Garage {
    fn my_component(&self, id: &str) -> Component {
        let p = self.workshop.parts.get(id).cloned().expect("unknown component");
        require!(p.owner == env::predecessor_account_id(), "component owner only");
        p
    }
    fn material_credit(&mut self, who: &AccountId, token: &str, amount: u128) {
        if amount == 0 { return; }
        if !self.tokens.contains_key(token) {
            self.tokens.insert(token.to_string(), TokenInfo {kind:"material".into(), name:token.to_string()});
        }
        self.credit(token, who, amount);
        emit("mt_mint", json!({"owner_id":who,"token_ids":[token],"amounts":[amount.to_string()]}));
    }
}

#[near(serializers = [borsh])]
pub struct LegacyGarage {
    owner: AccountId, dealers: IterableSet<AccountId>, tokens: IterableMap<String, TokenInfo>,
    supply: LookupMap<String, u128>, balances: LookupMap<String, u128>,
    owned: LookupMap<AccountId, Vec<String>>, listings: IterableMap<String, Listing>,
}

fn nft_event(name: &str, data: near_sdk::serde_json::Value) {
    log!("EVENT_JSON:{}", json!({"standard":"nep171","version":"1.0.0","event":name,"data":[data]}));
}
#[near]
impl Garage {
    pub fn nft_metadata(&self) -> near_sdk::serde_json::Value {
        json!({"spec":"nft-1.0.0","name":"MiniRush Components","symbol":"RUSHPART"})
    }
    pub fn nft_token(&self, token_id: String) -> Option<near_sdk::serde_json::Value> {
        self.workshop.parts.get(&token_id).map(|p| {
            let r = recipe(&p.recipe_id);
            json!({"token_id":p.id,"owner_id":p.owner,"metadata":{
                "title":format!("{} #{}", r.name, p.id.trim_start_matches("component:")),
                "description":r.detail,"copies":1,"issued_at":p.created_ms.to_string(),
                "extra":json!({"recipe":p.recipe_id,"maker":p.maker,"slot":r.slot}).to_string()
            }})
        })
    }
    pub fn nft_total_supply(&self) -> U128 { U128(u128::from(self.workshop.parts.len())) }
    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.workshop.inventories.get(&account_id).map_or(0, |ids| ids.len()) as u128)
    }
    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u32>) -> Vec<near_sdk::serde_json::Value> {
        let start = from_index.unwrap_or(U128(0)).0.min(u128::from(self.workshop.parts.len())) as usize;
        self.workshop.parts.keys().skip(start).take(limit.unwrap_or(50).min(100) as usize)
            .filter_map(|id| self.nft_token(id.clone())).collect()
    }
    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u32>) -> Vec<near_sdk::serde_json::Value> {
        let ids = self.workshop.inventories.get(&account_id).cloned().unwrap_or_default();
        let start = from_index.unwrap_or(U128(0)).0.min(ids.len() as u128) as usize;
        ids.into_iter().skip(start).take(limit.unwrap_or(50).min(100) as usize).filter_map(|id| self.nft_token(id)).collect()
    }
    #[payable]
    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        require!(approval_id.is_none(), "approvals not supported");
        require!(memo.as_ref().map_or(true, |m| m.len() <= 280), "memo too long");
        let p = self.my_component(&token_id);
        require!(p.price.is_none(), "cancel the listing first");
        self.transfer_component(p, receiver_id, memo);
    }
    #[payable]
    pub fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>, msg: String) -> near_sdk::Promise {
        use near_sdk::{Gas, NearToken, Promise};
        require!(env::prepaid_gas().as_gas() >= Gas::from_tgas(80).as_gas(), "attach at least 80 Tgas");
        require!(msg.len() <= 2048, "message too long");
        let sender = env::predecessor_account_id();
        self.nft_transfer(receiver_id.clone(), token_id.clone(), approval_id, memo);
        let held = self.workshop.reserved.get(&sender).copied().unwrap_or(0);
        self.workshop.reserved.insert(sender.clone(), held + 1);
        Promise::new(receiver_id.clone()).function_call("nft_on_transfer",
            json!({"sender_id":sender,"previous_owner_id":sender,"token_id":token_id,"msg":msg}).to_string().into_bytes(),
            NearToken::from_yoctonear(0), Gas::from_tgas(25))
        .then(Promise::new(env::current_account_id()).function_call("nft_resolve_transfer",
            json!({"previous_owner_id":sender,"receiver_id":receiver_id,"token_id":token_id}).to_string().into_bytes(),
            NearToken::from_yoctonear(0), Gas::from_tgas(30)))
    }
    #[private]
    pub fn nft_resolve_transfer(&mut self, previous_owner_id: AccountId, receiver_id: AccountId, token_id: String) -> bool {
        let held = self.workshop.reserved.get(&previous_owner_id).copied().unwrap_or(0);
        if held > 0 { self.workshop.reserved.insert(previous_owner_id.clone(), held - 1); }
        let refund = match env::promise_result_checked(0, 32) {
            Ok(bytes) => near_sdk::serde_json::from_slice::<bool>(&bytes).unwrap_or(true),
            _ => true,
        };
        if !refund { return true; }
        let Some(mut p) = self.workshop.parts.get(&token_id).cloned() else { return true; };
        if p.owner != receiver_id { return true; }
        // A receiver may have listed/equipped the item before rejecting it.
        self.workshop.offers.remove(&token_id);
        p.price = None;
        self.transfer_component(p, previous_owner_id, Some("transfer call refund".into()));
        false
    }
}
impl Garage {
    fn component_capacity(&self, who: &AccountId, count: usize) {
        require!((count + self.workshop.reserved.get(who).copied().unwrap_or(0) as usize) < 64, "garage full");
    }
    fn transfer_component(&mut self, mut p: Component, receiver: AccountId, memo: Option<String>) {
        require!(p.owner != receiver, "sender and receiver must differ");
        let mut ids = self.workshop.inventories.get(&receiver).cloned().unwrap_or_default();
        self.component_capacity(&receiver, ids.len());
        let previous = p.owner.clone();
        let mut old = self.workshop.inventories.get(&previous).cloned().unwrap_or_default();
        old.retain(|id| id != &p.id); ids.push(p.id.clone());
        self.workshop.inventories.insert(previous.clone(), old);
        self.workshop.inventories.insert(receiver.clone(), ids);
        p.owner = receiver.clone(); p.installed_on = None;
        self.workshop.parts.insert(p.id.clone(), p.clone());
        nft_event("nft_transfer", json!({"old_owner_id":previous,"new_owner_id":receiver,"token_ids":[p.id],"memo":memo}));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};
    fn account(s: &str) -> AccountId { s.parse().unwrap() }
    fn context(who: &str, ms: u64) {
        testing_env!(VMContextBuilder::new().current_account_id(account("game.testnet"))
            .predecessor_account_id(account(who)).block_timestamp(ms * 1_000_000).build());
    }
    fn funded() -> Garage {
        context("game.testnet", 100_000);
        let mut g = Garage::new(account("game.testnet"));
        for (token, amount) in [(RUSH,500), (ALLOY,20), (CIRCUIT,10)] {
            g.material_credit(&account("ada.testnet"), token, amount);
        }
        g.material_credit(&account("bo.testnet"), RUSH, 500);
        context("ada.testnet", 110_000);
        g
    }
    #[test]
    fn catalogue_has_four_slots_and_no_free_upgrades() {
        let all = recipes();
        assert_eq!(all.len(), 12);
        for slot in ["engine", "gearbox", "tires", "nitro"] {
            assert_eq!(all.iter().filter(|r| r.slot == slot).count(), 3);
        }
        for r in all {
            let stats = [r.speed,r.accel,r.grip,r.nitro];
            assert!(stats.iter().any(|n| *n > 0) && stats.iter().any(|n| *n < 0));
            assert!(r.rush > 0 && r.alloy > 0 && r.circuit > 0);
        }
    }
    #[test]
    fn craft_burns_inputs_and_creates_unique_provenance() {
        let mut g = funded();
        let p = g.craft_component("street-turbo".into());
        let q = g.craft_component("street-turbo".into());
        assert_ne!(p.id, q.id);
        assert_eq!(p.maker, account("ada.testnet"));
        assert_eq!(g.balance(RUSH, &p.owner), 380);
        assert_eq!(g.balance(ALLOY, &p.owner), 8);
        assert_eq!(g.mt_supply(RUSH.into()).unwrap().0, 880);
    }
    #[test]
    #[should_panic(expected="not enough material:alloy")]
    fn cannot_craft_without_materials() {
        let mut g = funded(); context("bo.testnet", 120_000);
        g.craft_component("street-turbo".into());
    }
    #[test]
    fn installing_replaces_slot_and_listing_uninstalls() {
        let mut g = funded();
        let a = g.craft_component("street-turbo".into());
        let b = g.craft_component("sprint-block".into());
        g.install_component(a.id.clone(), Some("viper".into()));
        g.install_component(b.id.clone(), Some("viper".into()));
        assert!(g.component(a.id).unwrap().installed_on.is_none());
        assert_eq!(g.component(b.id.clone()).unwrap().installed_on.as_deref(), Some("viper"));
        let offered = g.list_component(b.id, U128(100));
        assert!(offered.installed_on.is_none());
    }
    #[test]
    fn trade_transfers_exact_part_pays_seller_and_burns_fee() {
        let mut g = funded();
        let p = g.craft_component("street-turbo".into());
        let offer = g.list_component(p.id.clone(), U128(100));
        context("bo.testnet", 120_000);
        let bought = g.buy_component(p.id.clone(), offer.offer, U128(100));
        assert_eq!(bought.maker, account("ada.testnet"));
        assert_eq!(bought.owner, account("bo.testnet"));
        assert!(bought.price.is_none() && bought.installed_on.is_none());
        assert!(g.component_inventory(account("ada.testnet")).is_empty());
        assert_eq!(g.component_inventory(account("bo.testnet")).len(), 1);
        assert_eq!(g.balance(RUSH, &account("ada.testnet")), 538);
        assert_eq!(g.balance(RUSH, &account("bo.testnet")), 400);
        assert_eq!(g.mt_supply(RUSH.into()).unwrap().0, 938);
        assert!(g.component_offers(None, None).is_empty());
    }
    #[test]
    #[should_panic(expected="listing changed")]
    fn stale_offer_rejected_even_after_same_price_relist() {
        let mut g = funded(); let p = g.craft_component("street-turbo".into());
        let offer = g.list_component(p.id.clone(), U128(100));
        g.cancel_component(p.id.clone()); g.list_component(p.id.clone(), U128(100));
        context("bo.testnet", 120_000); g.buy_component(p.id, offer.offer, U128(100));
    }
    #[test]
    #[should_panic(expected="component owner only")]
    fn seller_cannot_install_sold_part() {
        let mut g = funded(); let p = g.craft_component("street-turbo".into());
        let offer = g.list_component(p.id.clone(), U128(100));
        context("bo.testnet", 120_000); g.buy_component(p.id.clone(), offer.offer, U128(100));
        context("ada.testnet", 130_000); g.install_component(p.id, Some("viper".into()));
    }
    #[test]
    #[should_panic(expected="cancel the listing first")]
    fn listed_part_cannot_be_equipped() {
        let mut g = funded(); let p = g.craft_component("street-turbo".into());
        g.list_component(p.id.clone(), U128(100)); g.install_component(p.id, Some("viper".into()));
    }
    #[test]
    fn recycle_destroys_part_and_returns_only_half_materials() {
        let mut g = funded(); let p = g.craft_component("street-turbo".into());
        g.recycle_component(p.id.clone());
        assert!(g.component(p.id).is_none());
        assert!(g.component_inventory(account("ada.testnet")).is_empty());
        assert_eq!(g.balance(ALLOY, &account("ada.testnet")), 17);
        assert_eq!(g.balance(CIRCUIT, &account("ada.testnet")), 9);
        assert_eq!(g.balance(RUSH, &account("ada.testnet")), 440);
    }
    #[test]
    #[should_panic(expected="uninstall and cancel")]
    fn installed_part_cannot_be_recycled() {
        let mut g = funded(); let p = g.craft_component("street-turbo".into());
        g.install_component(p.id.clone(), Some("viper".into())); g.recycle_component(p.id);
    }
    #[test]
    fn reward_is_idempotent_across_retries() {
        let mut g = funded(); context("game.testnet", 150_000);
        assert!(g.reward_race(account("ada.testnet"), "race-1".into(), Some(3)));
        // A retry claiming a better finish cannot top the first payout up.
        assert!(!g.reward_race(account("ada.testnet"), "race-1".into(), Some(1)));
        assert_eq!(g.balance(RUSH, &account("ada.testnet")), 530);
        assert_eq!(g.balance(ALLOY, &account("ada.testnet")), 22);
        assert_eq!(g.balance(CIRCUIT, &account("ada.testnet")), 11);
    }
    #[test]
    #[should_panic(expected="race belongs to another account")]
    fn cannot_claim_another_players_reward() {
        let mut g = funded(); context("game.testnet", 150_000);
        g.reward_race(account("ada.testnet"), "race-1".into(), None);
        g.reward_race(account("bo.testnet"), "race-1".into(), None);
    }
    #[test]
    #[should_panic(expected="owner only")]
    fn players_cannot_issue_rewards() {
        let mut g = funded(); g.reward_race(account("ada.testnet"), "fake-race".into(), None);
    }
    #[test]
    #[should_panic(expected="daily race reward limit")]
    fn daily_reward_cap_is_enforced() {
        let mut g = funded();
        for i in 0..21 { context("game.testnet", 150_000 + i * 45_000); g.reward_race(account("ada.testnet"), format!("race-{i}"), None); }
    }
    #[test]
    fn daily_budget_resets_but_replay_protection_does_not() {
        let mut g = funded();
        context("game.testnet", 150_000); g.reward_race(account("ada.testnet"), "first".into(), None);
        context("game.testnet", DAY_MS + 150_000);
        assert!(!g.reward_race(account("ada.testnet"), "first".into(), None));
        assert!(g.reward_race(account("ada.testnet"), "second".into(), None));
        assert_eq!(g.workshop.emissions.get(&account("ada.testnet")).unwrap().races, 1);
    }
    #[test]
    fn migration_preserves_existing_balances() {
        let g = funded();
        let old = LegacyGarage {owner:g.owner, dealers:g.dealers, tokens:g.tokens, supply:g.supply,
            balances:g.balances, owned:g.owned, listings:g.listings};
        env::state_write(&old);
        drop(old); // Flush cached collection entries before loading their descriptors.
        context("game.testnet", 200_000);
        let migrated = Garage::migrate_components();
        assert_eq!(migrated.balance(RUSH, &account("ada.testnet")), 500);
        assert_eq!(migrated.balance(RUSH, &account("bo.testnet")), 500);
        assert_eq!(migrated.workshop.serial, 0);
    }
    #[test]
    fn nft_views_and_transfer_preserve_maker_and_clear_installation() {
        let mut g = funded(); let p = g.craft_component("street-turbo".into());
        g.install_component(p.id.clone(), Some("viper".into()));
        testing_env!(VMContextBuilder::new().predecessor_account_id(account("ada.testnet"))
            .attached_deposit(near_sdk::NearToken::from_yoctonear(1)).build());
        g.nft_transfer(account("bo.testnet"), p.id.clone(), None, None);
        let token = g.nft_token(p.id.clone()).unwrap();
        assert_eq!(token["owner_id"], "bo.testnet");
        assert_eq!(g.nft_total_supply().0, 1);
        assert_eq!(g.nft_supply_for_owner(account("ada.testnet")).0, 0);
        assert_eq!(g.nft_tokens_for_owner(account("bo.testnet"), None, None).len(), 1);
        let part = g.component(p.id).unwrap();
        assert_eq!(part.maker, account("ada.testnet"));
        assert!(part.installed_on.is_none());
    }
    #[test]
    #[should_panic(expected="Requires attached deposit of exactly 1 yoctoNEAR")]
    fn nft_transfer_requires_security_deposit() {
        let mut g = funded(); let p = g.craft_component("street-turbo".into());
        g.nft_transfer(account("bo.testnet"), p.id, None, None);
    }
    #[test]
    #[should_panic(expected="cancel the listing first")]
    fn nft_cannot_bypass_market_listing_lock() {
        let mut g = funded(); let p = g.craft_component("street-turbo".into());
        g.list_component(p.id.clone(), U128(100));
        testing_env!(VMContextBuilder::new().predecessor_account_id(account("ada.testnet"))
            .attached_deposit(near_sdk::NearToken::from_yoctonear(1)).build());
        g.nft_transfer(account("bo.testnet"), p.id, None, None);
    }
    fn callback(result: near_sdk::PromiseResult) {
        testing_env!(VMContextBuilder::new().current_account_id(account("game.testnet"))
            .predecessor_account_id(account("game.testnet")).build(),
            near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), std::collections::HashMap::default(), vec![result]);
    }
    #[test]
    fn rejected_nft_transfer_call_refunds_and_clears_receiver_listing() {
        let mut g = funded(); let p = g.craft_component("street-turbo".into());
        testing_env!(VMContextBuilder::new().current_account_id(account("game.testnet"))
            .predecessor_account_id(account("ada.testnet")).attached_deposit(near_sdk::NearToken::from_yoctonear(1))
            .prepaid_gas(near_sdk::Gas::from_tgas(100)).build());
        drop(g.nft_transfer_call(account("bo.testnet"), p.id.clone(), None, None, "".into()));
        assert_eq!(g.workshop.reserved.get(&account("ada.testnet")), Some(&1));
        context("bo.testnet", 150_000); g.list_component(p.id.clone(), U128(100));
        callback(near_sdk::PromiseResult::Successful(b"true".to_vec()));
        assert!(!g.nft_resolve_transfer(account("ada.testnet"), account("bo.testnet"), p.id.clone()));
        assert_eq!(g.component(p.id).unwrap().owner, account("ada.testnet"));
        assert!(g.component_offers(None, None).is_empty());
        assert_eq!(g.workshop.reserved.get(&account("ada.testnet")), Some(&0));
    }
    #[test]
    fn failed_nft_receiver_refunds_but_accepted_receiver_keeps_part() {
        let mut g = funded(); let p = g.craft_component("street-turbo".into());
        g.transfer_component(p.clone(), account("bo.testnet"), None);
        callback(near_sdk::PromiseResult::Successful(b"false".to_vec()));
        assert!(g.nft_resolve_transfer(account("ada.testnet"), account("bo.testnet"), p.id.clone()));
        assert_eq!(g.component(p.id.clone()).unwrap().owner, account("bo.testnet"));
        callback(near_sdk::PromiseResult::Failed);
        assert!(!g.nft_resolve_transfer(account("ada.testnet"), account("bo.testnet"), p.id.clone()));
        assert_eq!(g.component(p.id).unwrap().owner, account("ada.testnet"));
    }
    #[test]
    fn nft_refund_does_not_take_part_from_subsequent_buyer() {
        let mut g = funded(); let p = g.craft_component("street-turbo".into());
        g.transfer_component(p.clone(), account("bo.testnet"), None);
        let p = g.component(p.id).unwrap();
        g.transfer_component(p.clone(), account("cee.testnet"), None);
        callback(near_sdk::PromiseResult::Failed);
        assert!(g.nft_resolve_transfer(account("ada.testnet"), account("bo.testnet"), p.id.clone()));
        assert_eq!(g.component(p.id).unwrap().owner, account("cee.testnet"));
    }

    #[test]
    fn podium_pays_more_and_place_cannot_exceed_a_win() {
        let mut g = funded(); let ada = account("ada.testnet");
        let mut paid = vec![];
        for (i, place) in [Some(1), Some(2), Some(3), Some(4), None, Some(0), Some(255)].into_iter().enumerate() {
            context("game.testnet", 150_000 + i as u64 * 45_000);
            let before = g.balance(RUSH, &ada);
            assert!(g.reward_race(ada.clone(), format!("tier-{i}"), place));
            paid.push(g.balance(RUSH, &ada) - before);
        }
        assert_eq!(paid, vec![45, 36, 30, 24, 24, 24, 24]);
        assert_eq!(g.balance(ALLOY, &ada), 20 + 14);
        assert_eq!(g.balance(CIRCUIT, &ada), 10 + 7);
    }
    #[test]
    fn ledger_matches_every_faucet_and_sink() {
        let mut g = funded(); let ada = account("ada.testnet");
        context("game.testnet", 150_000); g.reward_race(ada.clone(), "win".into(), Some(1));
        context("game.testnet", 200_000); g.reward_race(ada.clone(), "mid".into(), Some(4));
        context("game.testnet", 200_500); assert!(!g.reward_race(ada.clone(), "win".into(), Some(1)));
        context("ada.testnet", 210_000);
        let sold = g.craft_component("street-turbo".into());
        let scrap = g.craft_component("street-slick".into());
        g.recycle_component(scrap.id);
        let offer = g.list_component(sold.id.clone(), U128(100));
        context("bo.testnet", 220_000); g.buy_component(sold.id, offer.offer, U128(100));
        assert_eq!(g.workshop.ledger, Ledger { races_paid: 2, podiums: 1, rush_minted: 69, alloy_minted: 4, circuit_minted: 2,
            rush_burned_craft: 100, rush_burned_fees: 2, alloy_burned: 10, circuit_burned: 3,
            parts_crafted: 2, parts_recycled: 1, trades: 1, trade_volume: 100 });
        let e = g.economy();
        // funded() seeds 1000 RUSH outside the race faucet; everything after it must reconcile.
        assert_eq!(e["rush_supply"], "967"); // 1000 + 69 minted - 100 crafted - 2 fee
        assert_eq!(e["parts"], 1); assert_eq!(e["offers"], 0); assert_eq!(e["parts_issued"], 2);
        assert_eq!(e["races_today"], 2); assert_eq!(e["payout"]["first"], "45");
        assert_eq!(e["ledger"]["trade_volume"], 100);
    }
}
