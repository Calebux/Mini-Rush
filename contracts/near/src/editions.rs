//! Limited-edition cars: numbered NEP-171 tokens sold and resold for NEAR.
//!
//! Everything else in the garage is priced in RUSH, which is earned. An edition
//! is a fixed run of numbered cars sold for NEAR. The first sale pays the game;
//! every resale between players pays the seller and leaves a royalty with the
//! game. Payment and ownership settle inside one call.
use super::*;
use near_sdk::{NearToken, Promise};

/// The game's share of every player-to-player resale, in hundredths of a percent.
pub const ROYALTY_BPS: u128 = 200;
/// 0.05 NEAR. Covers the storage a minted car occupies many times over.
pub const MIN_EDITION_PRICE: u128 = 50_000_000_000_000_000_000_000;
/// 0.01 NEAR.
pub const MIN_RESALE_PRICE: u128 = 10_000_000_000_000_000_000_000;
/// 10,000 NEAR.
pub const MAX_NEAR_PRICE: u128 = 10_000_000_000_000_000_000_000_000_000;
pub const MAX_EDITION_SIZE: u32 = 500;
pub const MAX_EDITIONS: u32 = 40;
pub const MAX_EDITION_CARS_PER_GARAGE: usize = 24;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Edition {
    pub id: String,
    pub name: String,
    /// The car this edition drives as, by its game id (for example "tourbillon").
    pub model: String,
    /// Paint only this edition wears, as 0xRRGGBB.
    pub color: u32,
    /// Price of a new car from the game, in yoctoNEAR.
    pub price: U128,
    pub size: u32,
    pub minted: u32,
    pub story: String,
    pub created_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct EditionCar {
    pub id: String,
    pub edition_id: String,
    pub serial: u32,
    pub owner: AccountId,
    pub first_owner: AccountId,
    pub minted_ms: u64,
    /// The owner's asking price in yoctoNEAR while the car is for sale.
    pub price: Option<U128>,
    pub offer: u64,
    /// What the car last changed hands for, in yoctoNEAR.
    pub last_price: U128,
    pub sales: u32,
}

/// Season totals of the NEAR that moved through edition sales.
#[near(serializers = [borsh, json])]
#[derive(Clone, Default, Debug, PartialEq)]
pub struct NearLedger {
    pub primary_sales: u64,
    pub primary_volume: U128,
    pub resales: u64,
    pub resale_volume: U128,
    pub royalties: U128,
}

#[near(serializers = [borsh])]
pub struct Showroom {
    editions: IterableMap<String, Edition>,
    cars: IterableMap<String, EditionCar>,
    garages: LookupMap<AccountId, Vec<String>>,
    asks: IterableSet<String>,
    revision: u64,
    ledger: NearLedger,
}
impl Default for Showroom {
    fn default() -> Self {
        Self { editions: IterableMap::new(b"e1e".to_vec()), cars: IterableMap::new(b"e1c".to_vec()),
            garages: LookupMap::new(b"e1g".to_vec()), asks: IterableSet::new(b"e1a".to_vec()),
            revision: 0, ledger: NearLedger::default() }
    }
}

pub fn is_edition_car(token_id: &str) -> bool { token_id.starts_with("edition:") }

fn event(name: &str, data: near_sdk::serde_json::Value) {
    log!("EVENT_JSON:{}", json!({"standard":"minirush", "version":"2.0.0", "event":name, "data":[data]}));
}
fn nft_event(name: &str, data: near_sdk::serde_json::Value) {
    log!("EVENT_JSON:{}", json!({"standard":"nep171","version":"1.0.0","event":name,"data":[data]}));
}
fn slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 24 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

#[near]
impl Garage {
    /// Open a numbered run. The size and the model never change afterwards.
    pub fn create_edition(&mut self, id: String, name: String, model: String, color: u32, price: U128, size: u32, story: String) {
        self.assert_owner();
        require!(slug(&id) && slug(&model), "ids use lowercase letters, digits and hyphens, up to 24");
        require!(!name.is_empty() && name.len() <= 40, "name must be 1 to 40 characters");
        require!(story.len() <= MAX_REASON, "story too long");
        require!(color <= 0xff_ffff, "color is 0xRRGGBB");
        require!((1..=MAX_EDITION_SIZE).contains(&size), "size must be 1 to 500");
        require!((MIN_EDITION_PRICE..=MAX_NEAR_PRICE).contains(&price.0), "price must be 0.05 to 10000 NEAR");
        require!(!self.showroom.editions.contains_key(&id), "edition exists");
        require!(self.showroom.editions.len() < MAX_EDITIONS, "edition limit reached");
        let e = Edition { id: id.clone(), name, model, color, price, size, minted: 0, story, created_ms: env::block_timestamp_ms() };
        self.showroom.editions.insert(id, e.clone());
        event("edition_created", json!(e));
    }

    /// Reprice the cars not yet sold. Cars already owned are unaffected.
    pub fn set_edition_price(&mut self, id: String, price: U128) {
        self.assert_owner();
        require!((MIN_EDITION_PRICE..=MAX_NEAR_PRICE).contains(&price.0), "price must be 0.05 to 10000 NEAR");
        let mut e = self.showroom.editions.get(&id).cloned().expect("unknown edition");
        e.price = price;
        self.showroom.editions.insert(id, e.clone());
        event("edition_repriced", json!(e));
    }

    /// Buy the next numbered car from the game. Attach at least the price; any excess is returned.
    #[payable]
    pub fn buy_edition(&mut self, edition_id: String, max_price: U128) -> EditionCar {
        let mut e = self.showroom.editions.get(&edition_id).cloned().expect("unknown edition");
        let price = e.price.0;
        let paid = env::attached_deposit().as_yoctonear();
        require!(price <= max_price.0, "price went up");
        require!(paid >= price, "attach the full price");
        require!(e.minted < e.size, "sold out");
        let buyer = env::predecessor_account_id();
        let mut ids = self.showroom.garages.get(&buyer).cloned().unwrap_or_default();
        require!(ids.len() < MAX_EDITION_CARS_PER_GARAGE, "edition garage full");
        e.minted += 1;
        let car = EditionCar { id: format!("edition:{}:{}", e.id, e.minted), edition_id: e.id.clone(), serial: e.minted,
            owner: buyer.clone(), first_owner: buyer.clone(), minted_ms: env::block_timestamp_ms(),
            price: None, offer: 0, last_price: U128(price), sales: 0 };
        ids.push(car.id.clone());
        self.showroom.garages.insert(buyer.clone(), ids);
        self.showroom.cars.insert(car.id.clone(), car.clone());
        self.showroom.editions.insert(edition_id, e);
        let l = &mut self.showroom.ledger;
        l.primary_sales += 1;
        l.primary_volume = U128(l.primary_volume.0 + price);
        if paid > price { Promise::new(buyer.clone()).transfer(NearToken::from_yoctonear(paid - price)).detach(); }
        nft_event("nft_mint", json!({"owner_id":buyer,"token_ids":[car.id]}));
        event("edition_sold", json!({"car":car,"price":price.to_string()}));
        car
    }

    /// Put an owned car up for sale to other players, priced in yoctoNEAR.
    pub fn list_edition_car(&mut self, car_id: String, price: U128) -> EditionCar {
        require!((MIN_RESALE_PRICE..=MAX_NEAR_PRICE).contains(&price.0), "price must be 0.01 to 10000 NEAR");
        let mut c = self.my_edition_car(&car_id);
        self.showroom.revision += 1;
        c.offer = self.showroom.revision;
        c.price = Some(price);
        self.showroom.asks.insert(car_id.clone());
        self.showroom.cars.insert(car_id, c.clone());
        event("edition_listed", json!(c));
        c
    }

    pub fn cancel_edition_listing(&mut self, car_id: String) {
        let mut c = self.my_edition_car(&car_id);
        require!(c.price.is_some(), "not listed");
        c.price = None;
        self.showroom.asks.remove(&car_id);
        self.showroom.cars.insert(car_id.clone(), c);
        event("edition_listing_cancelled", json!({"car_id":car_id}));
    }

    /// Buy a listed car from its owner. The seller is paid in the same call, less the game's royalty.
    #[payable]
    pub fn buy_edition_car(&mut self, car_id: String, offer: u64, max_price: U128) -> EditionCar {
        let mut c = self.showroom.cars.get(&car_id).cloned().expect("unknown car");
        let price = c.price.expect("not listed").0;
        let paid = env::attached_deposit().as_yoctonear();
        require!(c.offer == offer, "listing changed; refresh");
        require!(price <= max_price.0, "price went up");
        require!(paid >= price, "attach the full price");
        let buyer = env::predecessor_account_id();
        require!(buyer != c.owner, "cannot buy your own car");
        let mut ids = self.showroom.garages.get(&buyer).cloned().unwrap_or_default();
        require!(ids.len() < MAX_EDITION_CARS_PER_GARAGE, "edition garage full");
        let royalty = price * ROYALTY_BPS / 10_000;
        let seller = c.owner.clone();
        let mut old = self.showroom.garages.get(&seller).cloned().unwrap_or_default();
        old.retain(|id| id != &car_id);
        ids.push(car_id.clone());
        self.showroom.garages.insert(seller.clone(), old);
        self.showroom.garages.insert(buyer.clone(), ids);
        c.owner = buyer.clone();
        c.price = None;
        c.last_price = U128(price);
        c.sales += 1;
        self.showroom.asks.remove(&car_id);
        self.showroom.cars.insert(car_id.clone(), c.clone());
        let l = &mut self.showroom.ledger;
        l.resales += 1;
        l.resale_volume = U128(l.resale_volume.0 + price);
        l.royalties = U128(l.royalties.0 + royalty);
        // If the seller's account no longer exists the transfer fails and the payment stays with the game.
        Promise::new(seller.clone()).transfer(NearToken::from_yoctonear(price - royalty)).detach();
        if paid > price { Promise::new(buyer.clone()).transfer(NearToken::from_yoctonear(paid - price)).detach(); }
        nft_event("nft_transfer", json!({"old_owner_id":seller,"new_owner_id":buyer,"token_ids":[car_id]}));
        event("edition_resold", json!({"car":c,"seller":seller,"price":price.to_string(),"royalty":royalty.to_string()}));
        c
    }

    pub fn editions(&self) -> Vec<Edition> { self.showroom.editions.values().cloned().collect() }
    pub fn edition_car(&self, car_id: String) -> Option<EditionCar> { self.showroom.cars.get(&car_id).cloned() }
    pub fn edition_garage(&self, account_id: AccountId) -> Vec<EditionCar> {
        self.showroom.garages.get(&account_id).cloned().unwrap_or_default().iter()
            .filter_map(|id| self.showroom.cars.get(id).cloned()).collect()
    }
    /// Cars owners are selling right now.
    pub fn edition_asks(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<EditionCar> {
        self.showroom.asks.iter().skip(from_index.unwrap_or(0) as usize).take(limit.unwrap_or(50).min(100) as usize)
            .filter_map(|id| self.showroom.cars.get(id).cloned()).collect()
    }
    /// Every numbered car of an edition, in serial order.
    pub fn edition_cars(&self, edition_id: String, from_serial: Option<u32>, limit: Option<u32>) -> Vec<EditionCar> {
        let first = from_serial.unwrap_or(1).max(1);
        (first..first.saturating_add(limit.unwrap_or(50).min(100)))
            .filter_map(|n| self.showroom.cars.get(&format!("edition:{edition_id}:{n}")).cloned()).collect()
    }
}

impl Garage {
    fn my_edition_car(&self, id: &str) -> EditionCar {
        let c = self.showroom.cars.get(id).cloned().expect("unknown car");
        require!(c.owner == env::predecessor_account_id(), "car owner only");
        c
    }
    pub(crate) fn near_ledger(&self) -> near_sdk::serde_json::Value {
        let minted: u32 = self.showroom.editions.values().map(|e| e.minted).sum();
        let size: u32 = self.showroom.editions.values().map(|e| e.size).sum();
        json!({ "editions": self.showroom.editions.len(), "cars_minted": minted, "cars_total": size,
            "asks": self.showroom.asks.len(), "royalty_percent": ROYALTY_BPS / 100, "ledger": self.showroom.ledger })
    }
    pub(crate) fn edition_supply(&self) -> u128 { u128::from(self.showroom.cars.len()) }
    pub(crate) fn edition_count_for(&self, who: &AccountId) -> usize {
        self.showroom.garages.get(who).map_or(0, |ids| ids.len())
    }
    pub(crate) fn edition_ids_for(&self, who: &AccountId) -> Vec<String> {
        self.showroom.garages.get(who).cloned().unwrap_or_default()
    }
    pub(crate) fn edition_nft(&self, token_id: &str) -> Option<near_sdk::serde_json::Value> {
        let c = self.showroom.cars.get(token_id)?;
        let e = self.showroom.editions.get(&c.edition_id)?;
        Some(json!({"token_id":c.id,"owner_id":c.owner,"metadata":{
            "title":format!("{} #{} of {}", e.name, c.serial, e.size),
            "description":e.story,"copies":e.size,"issued_at":c.minted_ms.to_string(),
            "extra":json!({"edition":e.id,"model":e.model,"serial":c.serial,"first_owner":c.first_owner}).to_string()
        }}))
    }
    /// A plain transfer between garages. A car that is for sale must be delisted first.
    pub(crate) fn transfer_edition_car(&mut self, token_id: &str, receiver: AccountId, memo: Option<String>) {
        let mut c = self.my_edition_car(token_id);
        require!(c.price.is_none(), "cancel the listing first");
        require!(c.owner != receiver, "sender and receiver must differ");
        let mut ids = self.showroom.garages.get(&receiver).cloned().unwrap_or_default();
        require!(ids.len() < MAX_EDITION_CARS_PER_GARAGE, "edition garage full");
        let previous = c.owner.clone();
        let mut old = self.showroom.garages.get(&previous).cloned().unwrap_or_default();
        old.retain(|id| id != token_id);
        ids.push(c.id.clone());
        self.showroom.garages.insert(previous.clone(), old);
        self.showroom.garages.insert(receiver.clone(), ids);
        c.owner = receiver.clone();
        self.showroom.cars.insert(c.id.clone(), c.clone());
        nft_event("nft_transfer", json!({"old_owner_id":previous,"new_owner_id":receiver,"token_ids":[c.id],"memo":memo}));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::{get_created_receipts, VMContextBuilder}, testing_env};
    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    fn account(s: &str) -> AccountId { s.parse().unwrap() }
    fn context(who: &str, deposit: u128) {
        testing_env!(VMContextBuilder::new().current_account_id(account("game.testnet"))
            .predecessor_account_id(account(who)).attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(100_000_000_000).build());
    }
    fn open() -> Garage {
        context("game.testnet", 0);
        let mut g = Garage::new(account("game.testnet"));
        g.create_edition("lagos-gold".into(), "LAGOS GOLD".into(), "tourbillon".into(), 0xffc531, U128(2 * NEAR), 2, "Two cars for the first season.".into());
        g
    }
    /// yoctoNEAR sent to `who` by transfers scheduled in the current call.
    fn sent(who: &str) -> u128 {
        get_created_receipts().iter().filter(|r| r.receiver_id == account(who)).flat_map(|r| r.actions.iter())
            .map(|a| match a { near_sdk::mock::MockAction::Transfer { deposit, .. } => deposit.as_yoctonear(), _ => 0 }).sum()
    }

    #[test]
    fn first_sale_numbers_the_car_keeps_the_price_and_returns_the_excess() {
        let mut g = open();
        context("ada.testnet", 3 * NEAR);
        let car = g.buy_edition("lagos-gold".into(), U128(2 * NEAR));
        assert_eq!((car.id.as_str(), car.serial, car.owner.as_str()), ("edition:lagos-gold:1", 1, "ada.testnet"));
        assert_eq!(sent("ada.testnet"), NEAR);
        assert_eq!(g.editions()[0].minted, 1);
        assert_eq!(g.edition_garage(account("ada.testnet")).len(), 1);
        let l = &g.showroom.ledger;
        assert_eq!((l.primary_sales, l.primary_volume.0, l.resales), (1, 2 * NEAR, 0));
        let token = g.nft_token("edition:lagos-gold:1".into()).unwrap();
        assert_eq!(token["metadata"]["title"], "LAGOS GOLD #1 of 2");
        assert_eq!(g.nft_supply_for_owner(account("ada.testnet")).0, 1);
    }
    #[test]
    #[should_panic(expected = "attach the full price")]
    fn underpaying_buys_nothing() {
        let mut g = open();
        context("ada.testnet", NEAR);
        g.buy_edition("lagos-gold".into(), U128(2 * NEAR));
    }
    #[test]
    #[should_panic(expected = "price went up")]
    fn a_repriced_edition_needs_fresh_consent() {
        let mut g = open();
        g.set_edition_price("lagos-gold".into(), U128(3 * NEAR));
        context("ada.testnet", 3 * NEAR);
        g.buy_edition("lagos-gold".into(), U128(2 * NEAR));
    }
    #[test]
    #[should_panic(expected = "sold out")]
    fn the_run_never_exceeds_its_size() {
        let mut g = open();
        for who in ["ada.testnet", "bo.testnet", "cy.testnet"] {
            context(who, 2 * NEAR);
            g.buy_edition("lagos-gold".into(), U128(2 * NEAR));
        }
    }
    #[test]
    fn resale_pays_the_seller_and_leaves_the_royalty_with_the_game() {
        let mut g = open();
        context("ada.testnet", 2 * NEAR);
        g.buy_edition("lagos-gold".into(), U128(2 * NEAR));
        context("ada.testnet", 0);
        let listed = g.list_edition_car("edition:lagos-gold:1".into(), U128(5 * NEAR));
        assert_eq!(g.edition_asks(None, None).len(), 1);
        context("bo.testnet", 5 * NEAR);
        let car = g.buy_edition_car("edition:lagos-gold:1".into(), listed.offer, U128(5 * NEAR));
        assert_eq!((car.owner.as_str(), car.first_owner.as_str(), car.sales, car.price), ("bo.testnet", "ada.testnet", 1, None));
        assert_eq!(sent("ada.testnet"), 5 * NEAR - NEAR / 10); // 2% of 5 NEAR stays with the game
        assert_eq!(sent("bo.testnet"), 0);
        assert!(g.edition_asks(None, None).is_empty());
        assert!(g.edition_garage(account("ada.testnet")).is_empty());
        let l = &g.showroom.ledger;
        assert_eq!((l.resales, l.resale_volume.0, l.royalties.0, l.primary_volume.0), (1, 5 * NEAR, NEAR / 10, 2 * NEAR));
        assert_eq!(g.economy()["near"]["ledger"]["royalties"], (NEAR / 10).to_string());
    }
    #[test]
    #[should_panic(expected = "listing changed; refresh")]
    fn a_relisted_car_cannot_be_bought_at_the_old_offer() {
        let mut g = open();
        context("ada.testnet", 2 * NEAR);
        g.buy_edition("lagos-gold".into(), U128(2 * NEAR));
        context("ada.testnet", 0);
        let first = g.list_edition_car("edition:lagos-gold:1".into(), U128(NEAR));
        g.list_edition_car("edition:lagos-gold:1".into(), U128(9 * NEAR));
        context("bo.testnet", 9 * NEAR);
        g.buy_edition_car("edition:lagos-gold:1".into(), first.offer, U128(9 * NEAR));
    }
    #[test]
    #[should_panic(expected = "car owner only")]
    fn only_the_owner_can_list() {
        let mut g = open();
        context("ada.testnet", 2 * NEAR);
        g.buy_edition("lagos-gold".into(), U128(2 * NEAR));
        context("bo.testnet", 0);
        g.list_edition_car("edition:lagos-gold:1".into(), U128(NEAR));
    }
    #[test]
    #[should_panic(expected = "cannot buy your own car")]
    fn owners_cannot_trade_with_themselves() {
        let mut g = open();
        context("ada.testnet", 2 * NEAR);
        g.buy_edition("lagos-gold".into(), U128(2 * NEAR));
        context("ada.testnet", 0);
        let listed = g.list_edition_car("edition:lagos-gold:1".into(), U128(NEAR));
        context("ada.testnet", NEAR);
        g.buy_edition_car("edition:lagos-gold:1".into(), listed.offer, U128(NEAR));
    }
    #[test]
    fn a_plain_transfer_moves_an_unlisted_car_and_cancelling_frees_a_listed_one() {
        let mut g = open();
        context("ada.testnet", 2 * NEAR);
        g.buy_edition("lagos-gold".into(), U128(2 * NEAR));
        context("ada.testnet", 0);
        g.list_edition_car("edition:lagos-gold:1".into(), U128(NEAR));
        g.cancel_edition_listing("edition:lagos-gold:1".into());
        context("ada.testnet", 1);
        g.nft_transfer(account("bo.testnet"), "edition:lagos-gold:1".into(), None, None);
        assert_eq!(g.edition_car("edition:lagos-gold:1".into()).unwrap().owner, account("bo.testnet"));
        assert_eq!(g.nft_tokens_for_owner(account("bo.testnet"), None, None).len(), 1);
        assert_eq!(g.nft_total_supply().0, 1);
    }
    #[test]
    #[should_panic(expected = "owner only")]
    fn players_cannot_open_editions() {
        let mut g = open();
        context("ada.testnet", 0);
        g.create_edition("mine".into(), "MINE".into(), "viper".into(), 0, U128(NEAR), 1, String::new());
    }
}
