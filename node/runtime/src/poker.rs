use crate::{
	stage::{self, StageId},
	naive_rsa,
	cards,
	keys,
};

use support::{decl_module, decl_storage, decl_event, StorageValue, StorageMap};
use support::dispatch::Result;
use support::traits::Currency;
use system::ensure_signed;

use rstd::prelude::*;

use core::debug_assert;
use runtime_io;

use runtime_primitives::traits::Hash;
use parity_codec::Encode;

pub trait Trait: system::Trait + balances::Trait {
	type Event: From<Event<Self>> + Into<<Self as system::Trait>::Event>;
}

decl_storage! {
	trait Store for Module<T: Trait> as Poker {
		Stage get(stage): u32;

		///Maximum 2 players currently
		Dealer get(dealer): Option<T::AccountId>;
		Player get(player): Option<T::AccountId>;

		Keys get(keys): map T::AccountId => keys::PublicStorage;
		Secrets get(secrets): map T::AccountId => keys::RevealedSecrets;

		HandCards get(hand_cards): map T::AccountId => Vec<u8>;
		SharedCards get(shared_cards): Vec<u8>;

		//Shared cards are hidden and revealed by-stage when all
		//players submit their secret keys for corresponding stages
		FlopCards get(flop_cards): Vec<u8>;
		TurnCards get(turn_cards): Vec<u8>;
		RiverCards get(river_cards): Vec<u8>;
	}
}

decl_module! {
	pub struct Module<T: Trait> for enum Call where origin: T::Origin {
		fn deposit_event<T>() = default;

		fn join_game(origin) -> Result {
			let who = ensure_signed(origin)?;

			let dealer = <Dealer<T>>::get();
			let player = <Player<T>>::get();
			if dealer.is_none() {
				debug_assert!(player.is_none()); //First player is always dealer
				runtime_io::print("Dealer joins the game, waiting for a player...");

				<Dealer<T>>::put(&who);
				Self::deposit_event(RawEvent::DealerJoined(who));
			} else if player.is_none() {
				runtime_io::print("Player joins the game! It's gonna be hot!");

				<Player<T>>::put(&who);
				Self::deposit_event(RawEvent::PlayerJoined(who));
			} else {
				runtime_io::print("Sorry man, no room.");
			}

			Ok(())
		}

		fn preflop(origin,
				hand_key: Vec<u8>,
				flop_key: Vec<u8>,
				turn_key: Vec<u8>,
				river_key: Vec<u8>) -> Result {
			let who = ensure_signed(origin)?;

			if <Keys<T>>::get(&who).is_initialized() {
				Err("For current round, preflop stage is already initialized")
			} else {
				runtime_io::print("Registering participant's keys for preflop stage");

				//All keys are received in big-endian format
				let keys = keys::PublicStorage {
					hand: hand_key,
					flop: flop_key,
					turn: turn_key,
					river: river_key
				};

				debug_assert!(keys.is_valid());
				<Keys<T>>::insert(&who, &keys);


				let dealer = <Dealer<T>>::get().unwrap();
				let player = <Player<T>>::get().unwrap();

				let dealer_keys = <Keys<T>>::get(&dealer);
				let player_keys = <Keys<T>>::get(&player);

				if dealer_keys.is_initialized() && player_keys.is_initialized() {
					//Since we can't store the state of cards deck in (visible) blocks,
					//we have to deal all cards in one atomic transaction;
					//then we encrypt flop, turn and river with public keys of all participants
					//and we encrypt hand cards by public keys of corresponding player
					runtime_io::print("Dealing cards for this round");

					//This is fake random for my proof-of-concept;
					//in future, it has to be replaced with off-chain random generation
					//also it probably can be workarounded with sending a nonce from the player
					let seed = (<system::Module<T>>::random_seed(), &who, &dealer_keys, &player_keys)
						.using_encoded(<T as system::Trait>::Hashing::hash);

					let mut deck = (0..1024)
						.flat_map(|i| (seed, i).using_encoded(|x| x.to_vec())) //32 bytes
						.map(cards::from_random);

					let mut cards = vec![];
					while cards.len() < 12 {
						let card = deck.next().unwrap();
						if !cards.contains(&card) {
							cards.push(card);
						}
					}

					let player_cards = cards::encode(vec![&cards[0], &cards[2]]);
					let dealer_cards = cards::encode(vec![&cards[1], &cards[3]]);
					let flop_cards   = cards::encode(vec![&cards[5], &cards[6], &cards[7]]);
					let turn_cards   = cards::encode(vec![&cards[9]]);
					let river_cards  = cards::encode(vec![&cards[11]]);

					let player_cards = naive_rsa::encrypt(&player_cards[..], &player_keys.hand[..])?;
					<HandCards<T>>::insert(player, player_cards);

					let dealer_cards = naive_rsa::encrypt(&dealer_cards[..], &dealer_keys.hand[..])?;
					<HandCards<T>>::insert(dealer, dealer_cards);

					let flop_cards = naive_rsa::encrypt(&flop_cards[..], &player_keys.flop[..])?;
					let flop_cards = naive_rsa::encrypt(&flop_cards[..], &dealer_keys.flop[..])?;
					<FlopCards<T>>::put(flop_cards);

					let turn_cards = naive_rsa::encrypt(&turn_cards[..], &player_keys.turn[..])?;
					let turn_cards = naive_rsa::encrypt(&turn_cards[..], &dealer_keys.turn[..])?;
					<TurnCards<T>>::put(turn_cards);

					let river_cards = naive_rsa::encrypt(&river_cards[..], &player_keys.river[..])?;
					let river_cards = naive_rsa::encrypt(&river_cards[..], &dealer_keys.river[..])?;
					<RiverCards<T>>::put(river_cards);

					<Stage<T>>::put(stage::PREFLOP);
					Ok(())
				} else {
					runtime_io::print("Waiting for other participants to deal hand cards");
					Ok(())
				}
			}
		}

		fn next_stage(origin, stage_secret: Vec<u8>) -> Result {
			let who = ensure_signed(origin)?;
			let stage = <Stage<T>>::get() + 1;

			if <Secrets<T>>::get(&who).retrieve(stage).is_some() {
				Err("The next stage is already initialized for this player")
			} else {
				runtime_io::print("Registering participant's keys for the next stage");

				let mut secrets = <Secrets<T>>::get(&who);
				secrets.submit(stage, stage_secret);
				debug_assert!(secrets.is_valid());
				<Secrets<T>>::insert(&who, &secrets);

				let dealer = <Dealer<T>>::get().unwrap();
				let player = <Player<T>>::get().unwrap();

				let dealer_secret = <Secrets<T>>::get(&dealer).retrieve(stage);
				let player_secret = <Secrets<T>>::get(&player).retrieve(stage);

				if dealer_secret.is_some() && player_secret.is_some() {
					runtime_io::print("Revealing cards of the next stage");
					let dealer_secret = dealer_secret.unwrap();
					let player_secret = player_secret.unwrap();

					let dealer_key = <Keys<T>>::get(&dealer).retrieve(stage);
					let player_key = <Keys<T>>::get(&player).retrieve(stage);

					let hidden = match stage {
						stage::FLOP  => <FlopCards<T>>::get(),
						stage::TURN  => <TurnCards<T>>::get(),
						stage::RIVER => <RiverCards<T>>::get(),

						_ => unreachable!()
					};

					let revealed = naive_rsa::decrypt(&hidden, &dealer_key[..], &dealer_secret[..])?;
					let mut revealed = naive_rsa::decrypt(&revealed, &player_key[..], &player_secret[..])?;

					let mut shared_cards = <SharedCards<T>>::get();
					shared_cards.append(&mut revealed);
					<SharedCards<T>>::put(shared_cards);

					<Stage<T>>::put(stage);
					Ok(())
				} else {
					//Technically, if we use commutative encryption, then we can
					//remove one layer of encryption after each player submits his secret
					//for current stage. Also we can do it in current implementation
					//after receiving dealer's secret (because his secret is last of applied),
					//but for simplicity we wait for all in PoC
					runtime_io::print("Waiting for other participants to deal next stage");
					Ok(())
				}
			}
		}
	}
}

decl_event!(
	pub enum Event<T> where AccountId = <T as system::Trait>::AccountId {
		DealerJoined(AccountId),
		PlayerJoined(AccountId),
	}
);
