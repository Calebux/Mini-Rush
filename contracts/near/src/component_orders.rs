//! Bounded, separately versioned storage leaves the existing Garage layout intact.
//! Reserved RUSH remains in the dealer balance; every ledger debit respects the lock.
use super::*;

const BOOK_KEY: &[u8] = b"minirush:component-orders:v1";
const MAX_ORDERS: usize = 96;
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct ComponentOrder {
    pub dealer: AccountId, pub recipe_id: String, pub revision: u64,
    pub price: U128, pub remaining: u32, pub expires_ms: u64, pub reason: String,
}
#[near(serializers = [borsh])]
#[derive(Default)]
struct OrderBook { revision: u64, orders: Vec<ComponentOrder> }
impl OrderBook {
    fn read() -> Self {
        env::storage_read(BOOK_KEY).map(|b| near_sdk::borsh::from_slice(&b).expect("order book state")).unwrap_or_default()
    }
    fn save(&self) { env::storage_write(BOOK_KEY, &near_sdk::borsh::to_vec(self).expect("order book encoding")); }
    fn reserved(&self, who: &AccountId) -> u128 {
        self.orders.iter().filter(|o| &o.dealer == who).map(|o| o.price.0 * u128::from(o.remaining)).sum()
    }
}
impl Garage {
    pub(crate) fn reserved_order_rush(&self, who: &AccountId) -> u128 { OrderBook::read().reserved(who) }
}
#[near]
impl Garage {
    pub fn component_orders(&self) -> Vec<ComponentOrder> {
        OrderBook::read().orders.into_iter().filter(|o| o.expires_ms > env::block_timestamp_ms() && self.dealers.contains(&o.dealer)).collect()
    }
    pub fn dealer_order_funds(&self, account_id: AccountId) -> near_sdk::serde_json::Value {
        let balance = self.balance(RUSH, &account_id);
        let reserved = self.reserved_order_rush(&account_id);
        json!({"balance":U128(balance), "reserved":U128(reserved), "available":U128(balance.saturating_sub(reserved))})
    }
    /// A dealer may reserve only existing funds. Replacing an order invalidates old quotes.
    pub fn place_component_order(&mut self, recipe_id: String, price: U128, quantity: u32, expires_ms: u64, reason: String, replace_revision: Option<u64>) -> ComponentOrder {
        let dealer = self.assert_dealer();
        recipe(&recipe_id);
        require!(price.0 >= 10 && price.0 <= MAX_PRICE, "price must be 10 to 1000000 RUSH");
        require!((1..=5).contains(&quantity), "quantity must be 1 to 5");
        require!(expires_ms > env::block_timestamp_ms() && expires_ms <= env::block_timestamp_ms() + DAY_MS, "expiry must be within 24 hours");
        require!(!reason.trim().is_empty() && reason.len() <= MAX_REASON, "provide a short order reason");
        let mut book = OrderBook::read();
        // Expired reservations can be released by anyone, including this dealer tick.
        book.orders.retain(|o| o.expires_ms > env::block_timestamp_ms());
        let existing = book.orders.iter().find(|o| o.dealer == dealer && o.recipe_id == recipe_id);
        require!(existing.map(|o| o.revision) == replace_revision, "order changed; refresh");
        book.orders.retain(|o| !(o.dealer == dealer && o.recipe_id == recipe_id));
        require!(book.orders.len() < MAX_ORDERS, "order board full");
        require!(self.balance(RUSH, &dealer) >= book.reserved(&dealer) + price.0 * u128::from(quantity), "not enough unreserved RUSH");
        book.revision = book.revision.checked_add(1).expect("order revisions exhausted");
        let order = ComponentOrder { dealer, recipe_id, revision: book.revision, price, remaining: quantity, expires_ms, reason };
        book.orders.push(order.clone()); book.save();
        event("component_order_placed", json!(order));
        order
    }
    /// Cancelling is permitted even after dealer access is revoked.
    pub fn cancel_component_order(&mut self, recipe_id: String, revision: u64) {
        let dealer = env::predecessor_account_id();
        let mut book = OrderBook::read();
        let index = book.orders.iter().position(|o| o.dealer == dealer && o.recipe_id == recipe_id).expect("order not found");
        require!(book.orders[index].revision == revision, "order changed; refresh");
        book.orders.remove(index); book.save();
        event("component_order_cancelled", json!({"dealer":dealer,"recipe_id":recipe_id,"revision":revision}));
    }
    pub fn expire_component_orders(&mut self) -> u32 {
        let mut book = OrderBook::read(); let before = book.orders.len();
        book.orders.retain(|o| o.expires_ms > env::block_timestamp_ms() && self.dealers.contains(&o.dealer));
        let removed = (before - book.orders.len()) as u32;
        if removed > 0 { book.save(); }
        removed
    }
    /// One synchronous call transfers the exact NFT and pays the seller from locked funds.
    /// Installed/listed parts must be explicitly freed first. Repeat delivery cannot pay twice.
    pub fn fill_component_order(&mut self, part_id: String, dealer: AccountId, revision: u64, min_payout: U128) -> U128 {
        let p = self.my_component(&part_id);
        require!(p.owner != dealer, "cannot fill your own order");
        require!(p.installed_on.is_none() && p.price.is_none(), "uninstall and cancel listing before delivery");
        require!(self.dealers.contains(&dealer), "dealer unavailable");
        let mut book = OrderBook::read();
        let index = book.orders.iter().position(|o| o.dealer == dealer && o.recipe_id == p.recipe_id).expect("no order for this recipe");
        let order = book.orders[index].clone();
        require!(order.revision == revision, "order changed; refresh");
        require!(order.expires_ms > env::block_timestamp_ms(), "order expired");
        let fee = (order.price.0 * 2 / 100).max(1);
        let payout = order.price.0 - fee;
        require!(payout >= min_payout.0, "payout went down");
        self.component_capacity(&dealer, self.component_inventory(dealer.clone()).len());
        require!(self.balance(RUSH, &dealer) >= book.reserved(&dealer), "order funding unavailable");
        book.orders[index].remaining -= 1;
        if book.orders[index].remaining == 0 { book.orders.remove(index); }
        book.save();
        self.debit(RUSH, &dealer, order.price.0);
        self.credit(RUSH, &p.owner, payout);
        emit("mt_transfer", json!({"old_owner_id":dealer,"new_owner_id":p.owner,"token_ids":[RUSH],"amounts":[payout.to_string()]}));
        emit("mt_burn", json!({"owner_id":dealer,"token_ids":[RUSH],"amounts":[fee.to_string()],"memo":"market fee"}));
        let seller = p.owner.clone();
        self.transfer_component(p, dealer.clone(), Some("purchase order delivery".into()));
        let l = &mut self.workshop.ledger;
        l.trades += 1; l.trade_volume += order.price.0 as u64; l.rush_burned_fees += fee as u64;
        event("component_order_filled", json!({"part_id":part_id,"dealer":dealer,"seller":seller,"revision":revision,"payout":payout.to_string(),"fee":fee.to_string()}));
        U128(payout)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{testing_env, test_utils::VMContextBuilder, NearToken};
    fn acc(s: &str) -> AccountId { s.parse().unwrap() }
    fn as_(who: &str, ms: u64) {
        testing_env!(VMContextBuilder::new().current_account_id(acc("game.testnet"))
            .predecessor_account_id(acc(who)).block_timestamp(ms * 1_000_000)
            .attached_deposit(NearToken::from_yoctonear(1)).build());
    }
    fn setup() -> (Garage, Component) {
        as_("game.testnet", 100_000);
        let mut g = Garage::new(acc("game.testnet"));
        g.set_dealer(acc("mama-t.testnet"), true);
        for (who, token, amount) in [("mama-t.testnet",RUSH,500), ("ada.testnet",RUSH,100),
            ("ada.testnet",ALLOY,12), ("ada.testnet",CIRCUIT,4), ("bo.testnet",RUSH,500)] {
            g.material_credit(&acc(who), token, amount);
        }
        as_("ada.testnet", 110_000);
        let p = g.craft_component("street-slick".into());
        (g,p)
    }
    fn order(g: &mut Garage, quantity: u32) -> ComponentOrder {
        as_("mama-t.testnet", 120_000);
        g.place_component_order("street-slick".into(), U128(100), quantity, 200_000, "Empty tire shelf".into(), None)
    }
    #[test]
    fn delivery_resale_install_preserves_provenance_and_conserves_money() {
        let (mut g,p) = setup(); let o = order(&mut g,2);
        let supply = g.mt_supply(RUSH.into()).unwrap().0;
        assert_eq!(g.reserved_order_rush(&o.dealer), 200);
        assert_eq!(g.dealer_order_funds(o.dealer.clone())["available"], "300");
        as_("ada.testnet",130_000);
        assert_eq!(g.fill_component_order(p.id.clone(),o.dealer.clone(),o.revision,U128(98)).0,98);
        assert_eq!(g.balance(RUSH,&acc("ada.testnet")),158);
        assert_eq!(g.balance(RUSH,&o.dealer),400);
        assert_eq!(g.reserved_order_rush(&o.dealer),100);
        assert_eq!(g.mt_supply(RUSH.into()).unwrap().0,supply-2);
        assert!(g.component_inventory(acc("ada.testnet")).is_empty());
        let bought = g.component(p.id.clone()).unwrap();
        assert_eq!(bought.maker,p.maker); assert_eq!(bought.owner,o.dealer);
        as_("mama-t.testnet",140_000);
        let listing = g.list_component(p.id.clone(),U128(130));
        as_("bo.testnet",150_000);
        g.buy_component(p.id.clone(),listing.offer,U128(130));
        g.install_component(p.id.clone(),Some("viper".into()));
        let fitted = g.component(p.id).unwrap();
        assert_eq!(fitted.maker,p.maker); assert_eq!(fitted.owner,acc("bo.testnet"));
        assert_eq!(fitted.installed_on.as_deref(),Some("viper"));
        assert_eq!(g.workshop.ledger.trades,2);
        assert_eq!(g.workshop.ledger.trade_volume,230);
        assert_eq!(g.workshop.ledger.rush_burned_fees,4);
        assert_eq!(g.mt_supply(RUSH.into()).unwrap().0,supply-4);
    }
    #[test]
    fn replacement_cancellation_and_expiry_release_only_reserved_funds() {
        let (mut g,_) = setup(); let o=order(&mut g,2);
        let supply=g.mt_supply(RUSH.into()).unwrap();
        let replaced=g.place_component_order(o.recipe_id.clone(),U128(120),3,210_000,"More demand".into(),Some(o.revision));
        assert!(replaced.revision>o.revision); assert_eq!(g.reserved_order_rush(&o.dealer),360);
        g.cancel_component_order(o.recipe_id,replaced.revision);
        assert_eq!(g.reserved_order_rush(&o.dealer),0);
        let next=order(&mut g,1); assert!(next.revision>replaced.revision);
        as_("bo.testnet",200_000);
        assert!(g.component_orders().is_empty());
        assert_eq!(g.expire_component_orders(),1); assert_eq!(g.expire_component_orders(),0);
        assert_eq!(g.balance(RUSH,&o.dealer),500); assert_eq!(g.mt_supply(RUSH.into()).unwrap(),supply);
    }
    #[test]
    fn filled_orders_remove_storage_but_revisions_never_repeat() {
        let (mut g,p)=setup(); let o=order(&mut g,1);
        as_("ada.testnet",130_000); g.fill_component_order(p.id,o.dealer.clone(),o.revision,U128(98));
        assert!(g.component_orders().is_empty()); assert_eq!(g.reserved_order_rush(&o.dealer),0);
        let next=order(&mut g,1); assert!(next.revision>o.revision);
    }
    #[test]
    #[should_panic(expected="RUSH reserved for purchase orders")]
    fn reserved_money_cannot_be_transferred() {
        let (mut g,_)=setup(); order(&mut g,5);
        g.mt_transfer(acc("bo.testnet"),RUSH.into(),U128(1),None,None);
    }
    #[test]
    #[should_panic(expected="not enough unreserved RUSH")]
    fn dealer_cannot_overcommit_multiple_orders() {
        let (mut g,_)=setup(); order(&mut g,5);
        g.place_component_order("sprint-block".into(),U128(100),1,200_000,"Need engine".into(),None);
    }
    #[test]
    #[should_panic(expected="component owner only")]
    fn repeated_delivery_cannot_pay_twice() {
        let (mut g,p)=setup(); let o=order(&mut g,2);
        as_("ada.testnet",130_000); g.fill_component_order(p.id.clone(),o.dealer.clone(),o.revision,U128(98));
        g.fill_component_order(p.id,o.dealer,o.revision,U128(98));
    }
    #[test]
    #[should_panic(expected="order changed; refresh")]
    fn stale_quote_cannot_deliver_to_replacement() {
        let (mut g,p)=setup(); let o=order(&mut g,1);
        g.place_component_order(o.recipe_id,U128(90),1,200_000,"New quote".into(),Some(o.revision));
        as_("ada.testnet",130_000); g.fill_component_order(p.id,o.dealer,o.revision,U128(88));
    }
    #[test]
    #[should_panic(expected="order changed; refresh")]
    fn overlapping_agent_ticks_cannot_replace_live_order() {
        let (mut g,_)=setup(); order(&mut g,1); order(&mut g,1);
    }
    #[test]
    #[should_panic(expected="no order for this recipe")]
    fn wrong_recipe_rejected() {
        let (mut g,_)=setup(); let p=g.craft_component("street-turbo".into()); let o=order(&mut g,1);
        as_("ada.testnet",130_000); g.fill_component_order(p.id,o.dealer,o.revision,U128(98));
    }
    #[test]
    #[should_panic(expected="uninstall and cancel listing before delivery")]
    fn equipped_part_is_not_silently_sold() {
        let (mut g,p)=setup(); g.install_component(p.id.clone(),Some("viper".into())); let o=order(&mut g,1);
        as_("ada.testnet",130_000); g.fill_component_order(p.id,o.dealer,o.revision,U128(98));
    }
    #[test]
    #[should_panic(expected="uninstall and cancel listing before delivery")]
    fn listed_part_must_be_freed_first() {
        let (mut g,p)=setup(); g.list_component(p.id.clone(),U128(120)); let o=order(&mut g,1);
        as_("ada.testnet",130_000); g.fill_component_order(p.id,o.dealer,o.revision,U128(98));
    }
    #[test]
    #[should_panic(expected="order expired")]
    fn expiration_is_enforced_at_settlement() {
        let (mut g,p)=setup(); let o=order(&mut g,1);
        as_("ada.testnet",200_000); g.fill_component_order(p.id,o.dealer,o.revision,U128(98));
    }
    #[test]
    #[should_panic(expected="payout went down")]
    fn payout_floor_is_net_of_fee() {
        let (mut g,p)=setup(); let o=order(&mut g,1);
        as_("ada.testnet",130_000); g.fill_component_order(p.id,o.dealer,o.revision,U128(100));
    }
    #[test]
    #[should_panic(expected="dealer only")]
    fn players_cannot_post_npc_orders() {
        let (mut g,_)=setup(); g.place_component_order("street-slick".into(),U128(10),1,200_000,"Fake dealer".into(),None);
    }
    #[test]
    fn removed_dealer_orders_can_be_released() {
        let (mut g,_)=setup(); let o=order(&mut g,1);
        as_("game.testnet",130_000); g.set_dealer(o.dealer.clone(),false);
        assert!(g.component_orders().is_empty());
        as_("bo.testnet",130_001); assert_eq!(g.expire_component_orders(),1);
        assert_eq!(g.reserved_order_rush(&o.dealer),0);
    }
    #[test]
    #[should_panic(expected="garage full")]
    fn pending_nft_refunds_reserve_dealer_capacity() {
        let (mut g,p)=setup(); let o=order(&mut g,1);
        g.workshop.reserved.insert(o.dealer.clone(),64);
        as_("ada.testnet",130_000); g.fill_component_order(p.id,o.dealer,o.revision,U128(98));
    }
    #[test]
    fn old_garage_layout_roundtrips_with_separate_order_storage() {
        let (g,p)=setup();
        let encoded=near_sdk::borsh::to_vec(&g).unwrap();
        drop(g); // Flush SDK collection caches, as a completed transaction does.
        let mut restored: Garage=near_sdk::borsh::from_slice(&encoded).unwrap();
        assert!(restored.component_orders().is_empty());
        let o=order(&mut restored,1);
        assert_eq!(near_sdk::borsh::to_vec(&restored).unwrap(),encoded);
        assert_eq!(restored.component(p.id).unwrap().owner,p.owner);
        assert_eq!(restored.reserved_order_rush(&o.dealer),100);
    }
}
