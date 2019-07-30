import React from 'react';
require('semantic-ui-css/semantic.min.css');

import { Icon, Label, Header, Segment, Button } from 'semantic-ui-react';
import { Bond } from 'oo7';
import { If } from 'oo7-react';
import { calls, runtime } from 'oo7-substrate';
import { Identicon } from 'polkadot-identicon';
import { SignerBond } from './AccountIdBond.jsx';
import { TransactButton } from './TransactButton.jsx';
import { Pretty } from './Pretty';
import { SvgRow } from './SvgRow';

const bufEq = require('arraybuffer-equal');

import { decode, image, hidden } from './cards.js';
import { decrypt } from './naive_rsa.js';
import { BONDS } from './keys.js';
import {BalanceBond} from "./BalanceBond";
const keys = require('./keys.js');
const stages = require('./stages.js');

function accountsAreEqualAndNotNull(left, right) {
    return left != null && right != null
        && bufEq(left.buffer, right.buffer);
}

function bondsAccountsAreEqualAndNotNull(left, right) {
    return left.map(d => right.map(u => accountsAreEqualAndNotNull(d, u)));
}

export class GameSegment extends React.Component {
    constructor () {
        super();
        window.game = this;

        this.user = new Bond;
        this.isLoggedIn = (new Bond).default(false);
        this.isLoggedOut = this.isLoggedIn.map(flag => !flag);

        this.dealer = runtime.poker.dealer;
        this.player = runtime.poker.player;

        this.isDealer = bondsAccountsAreEqualAndNotNull(this.dealer, this.user);
        this.isPlayer = bondsAccountsAreEqualAndNotNull(this.player, this.user);

        this.opponent = this.isDealer.map(isDealer => {
            if (isDealer) {
                return this.player;
            } else {
                return this.dealer;
            }
        });

        this.dealerIsJoined = this.dealer.map(d => d != null);
        this.playerIsJoined = this.player.map(p => p != null);

        this.isJoined = this.isDealer.map(d =>
            this.isPlayer.map(p =>
                d || p));

        this.handKey = new Bond();
        this.flopKey = new Bond();
        this.turnKey = new Bond();
        this.riverKey = new Bond();

        this.handCards = runtime.poker.handCards(game.user);
        this.opponentCards = this.opponent.map(runtime.poker.openCards);

        this.sharedCards = runtime.poker.sharedCards;
        this.stage = runtime.poker.stage;

        this.handCardsAreDealt = this.handCards.map(encrypted => encrypted.length !== 0);
        this.opponentCardsAreRevealed = this.opponentCards.map(encrypted => encrypted.length !== 0);

        this.isJoined.tie(joined => {
            this.isLoggedIn.then(logged => {
                if (joined && logged) {
                    this.handCardsAreDealt.then(dealt => console.assert(!dealt));
                    console.log("Joined the game");
                    keys.generate();
                }
            });
        })
    }

    logIn () {
        game.isLoggedIn.changed(true);
        game.isJoined.then(joined => {
           if (joined) {
               console.log("Resuming to the game");
               game.handCardsAreDealt.then(dealt => {
                   if (dealt) {
                       keys.load();
                   } else {
                       keys.generate();
                   }
               })
           }
        });
    }

    logOut () {
        game.isLoggedIn.changed(false);
    }

    logInKeyPressHandler (event) {
        if (event.key === "Enter" && game.user.isReady()) {
            game.logIn();
        }
    }

    render () {
        return <Segment style={{ margin: '1em' }} padded>
            <Header as='h2'>
                <Icon name='send' />
                <Header.Content>
                    <table><tbody><tr>
                        <td width="400">
                            Blockchain Poker
                            <Header.Subheader>Play poker via blockchain</Header.Subheader>
                        </td><td>
                            <If condition={this.isLoggedIn} then={
                                <div style={{ paddingTop: '1em' }}>
                                    <Button onClick={this.logOut} content="Log out" icon="sign in" color="orange" />
                                </div>
                            }/>
                        </td>
                    </tr></tbody></table>
                </Header.Content>
            </Header>
            <div>
                {/* Logging in */}
                <If condition={this.isLoggedOut} then={<span>
                    <div style={{ fontSize: 'small' }}>Please input account information:</div>
                    <SignerBond bond={this.user} onKeyDown={this.logInKeyPressHandler}/>
					<div style={{ paddingTop: '1em' }}>
                        <If condition={this.user.ready()} then={
                            <Button onClick={this.logIn} content="Log in" icon="sign in" color="orange"/>
                        } else={
                            <Button content="Log in" icon="sign in" />
                        } />
					</div>
				</span>} />

				{/* User logged in */}
                <If condition={this.isLoggedIn} then={<span>
                    { this.displayAccountInfo() }

                    <If condition={this.dealerIsJoined} then={<div style={{ paddingTop: '1em' }}>
                        <table><tbody><tr>
                            <td>Blind bet is </td>
                            <td><Label color="violet" size="large">
                                <Pretty value={runtime.poker.blind}/>
                            </Label></td>
                            <td> in this game</td>
                        </tr></tbody></table>

                        <If condition={this.handCardsAreDealt}
                            else={this.displayParticipant(this.dealer, false)}/>
                        <If condition={this.playerIsJoined} then={<div>
                            <If condition={this.handCardsAreDealt}
                                else={this.displayParticipant(this.player, false)}/>
                            <p />

                            <If condition={this.isJoined} then={
                                this.renderGameTable()
                            } else={
                                this.displayStatus("Sorry, at the moment here are only two chairs...")
                            }/>
                        </div>} else={
                            <If condition={this.isJoined} then={
                                this.displayStatus("You are waiting at the table...")
                            } else={<span>
                                { this.displayStatus("One person is waiting at the table.") }
                                { this.renderJoinGameSection() }
                            </span>}/>
                        }/>
                    </div>} else={<span>
                        { this.displayStatus("There is nobody in the room.") }
                        { this.renderCreateGameSection() }
                    </span>}/>
				</span>} />
            </div>
        </Segment>
    }

    renderCreateGameSection () {
        let buyIn = new Bond;
        let blind = new Bond;

        return <div style={{ paddingTop: '1em' }}>
            <div style={{ paddingBottom: '1em' }}>
                <div style={{ fontSize: 'small' }}>minimal amount to bet</div>
                <BalanceBond bond={blind} />
            </div>
            <div style={{ paddingBottom: '1em' }}>
                <div style={{ fontSize: 'small' }}>amount to put on table</div>
                <BalanceBond bond={buyIn} />
            </div>
            <div style={{ paddingTop: '1em' }}>
                <TransactButton tx={{
                    sender: this.user,
                    call: calls.poker.createGame(buyIn, blind),
                    compact: false,
                    longevity: true
                }} color="green" icon="sign in"
                                content="Join"/>
            </div>
        </div>;
    }

    renderJoinGameSection () {
        let buyIn = new Bond;

        return <div style={{ paddingTop: '1em' }}>
            <div style={{ paddingBottom: '1em' }}>
                <div style={{ fontSize: 'small' }}>amount to put on table</div>
                <BalanceBond bond={buyIn} />
            </div>
            <div style={{ paddingTop: '1em' }}>
                <TransactButton tx={{
                    sender: this.user,
                    call: calls.poker.joinGame(buyIn),
                    compact: false,
                    longevity: true
                }} color="green" icon="sign in"
                   content="Join"/>
            </div>
        </div>;
    }

    renderGameTable () {
        return <div style={{
            'width': '1282px',
            'height': '679px',
            'backgroundColor': 'green',
            'border': '10px solid darkgreen',
            'borderRadius': '20px',
            'paddingTop': '20px',
            'paddingLeft': '20px',
            'paddingRight': '20px',
            'paddingBottom': '20px',
        }}>
            <If condition={this.handCardsAreDealt} then={<span>
                {/*Players have received cards on their hands*/}
                <table><tbody><tr>
                        <td>
                            <table><tbody><tr><td>
                                { this.displayParticipant(this.opponent, true)}
                                { this.displayOpponentCards() }
                            </td></tr><tr height="80"><td>
                                <div align="right">
                                    <TransactButton content="Next!" icon='game' tx={{
                                        sender: this.user,
                                        call: calls.poker.nextStage(this.stage.map(stage => {
                                            return keys.BONDS[stages.next(stage)].map(key => key.exponent);
                                        }))
                                    }}/>
                                </div>
                            </td></tr><tr><td>
                                { this.displayHandCards() }
                                { this.displayParticipant(this.user, true)}
                            </td></tr></tbody></table>
                        </td>
                        <td>
                            <div style={{
                                'paddingLeft': '24px'}}>
                                <div style={{
                                    'height': '265px',
                                    'width': '838px',
                                    'backgroundColor': 'forestgreen',
                                    'border': '6px solid greenyellow',
                                    'borderRadius': '12px',
                                    'paddingTop': '12px',
                                    'paddingLeft': '12px',
                                    'paddingRight': '12px',
                                    'paddingBottom': '12px',}}>
                                    <If condition={this.sharedCards.map(encoded => encoded.length > 0)}
                                        then={this.displaySharedCards()}/>
                                </div>
                            </div>
                        </td>
                </tr></tbody></table>
            </span>} else={<span>
                {/*Players haven't received cards on their hands*/}
                <TransactButton content="deal cards" icon='game' tx={{
                    sender: this.user,
                    call: calls.poker.preflop(
                        keys.hand.map(key => key.modulus),
                        keys.flop.map(key => key.modulus),
                        keys.turn.map(key => key.modulus),
                        keys.river.map(key => key.modulus))
                }}/>
                {this.displayStatus("Good luck and have fun.")}
            </span>}/>
        </div>;
    }

    displayAccountInfo () {
        return <div>
            <Label>Logged in as
                <Label.Detail>
                    <Pretty value={this.user} />
                </Label.Detail>
            </Label>
            <Label>Balance
                <Label.Detail>
                    <Pretty value={runtime.balances.balance(this.user)} />
                </Label.Detail>
            </Label>
        </div>;
    }

    displayParticipant (participant, markDealer) {
        function printAccount(account) {
            return runtime.indices.ss58Encode(runtime.indices.tryIndex(account));
        }

        let content = <span>
            <Label color="blue"><Pretty value={participant.map(printAccount)}/></Label>
            <Label><Pretty value={runtime.poker.stacks(participant)}/></Label>
            <If condition={bondsAccountsAreEqualAndNotNull(participant, this.user)}
                then={<Label color="yellow">You</Label>}
                else={<Label color="yellow">Opponent</Label>}/>
        </span>;

        {/*<Identicon size='24' account={participant} />*/}

        return <table><tbody>
            <If condition={markDealer} then={<tr>
                <td width="259px">{content}</td>
                <td>
                    <If condition={bondsAccountsAreEqualAndNotNull(participant, this.dealer)}
                        then={<Label color="red"><Pretty value="Dealer" /></Label>}/>
                </td>
            </tr>} else={<tr><td>
                {content}
            </td></tr>}/>
        </tbody></table>;
    }

    displayHandCards () {
        return SvgRow("hand",
            this.handCards.map(encrypted =>
                keys.hand.map(key => {
                    let decrypted = decrypt(encrypted, key.modulus, key.exponent);
                    let cards = decode(decrypted);
                    return cards.map(image);
                }))
        );
    }

    displayOpponentCards () {
        let hiddenCards = new Bond();
        hiddenCards.changed([...Array(2).keys()]
            .map(_ => hidden()));

        return <If condition={this.opponentCardsAreRevealed}
           then={SvgRow("opponent-revealed",
               this.opponentCards.map(encoded => decode(encoded).map(image)))}
           else={SvgRow("opponent-hidden", hiddenCards)}/>;
    }

    displaySharedCards () {
        return SvgRow("shared",
            this.sharedCards.map(encoded => {
                let cards = decode(encoded);
                return cards.map(image);
            })
        );
    }

    displayStatus (status) {
        return <div style={{ paddingTop: '1em' }}>
            <Label size="large" color="blue">
                { status }
            </Label>
        </div>;
    }
}

//todo:
//1. Try to use `bonds.me`, see this doc for details: https://wiki.parity.io/oo7-Parity-Examples

// const {} = require('oo7-react');
// const {} = require('oo7-parity');
// const {AccountLabel} = require('parity-reactive-ui');