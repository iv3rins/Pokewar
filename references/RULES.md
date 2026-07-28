# PokeWar Normative Rules

> Status: Normative source of truth
>
> This file may change only after explicit product approval. Ordinary implementation work must treat it as read-only. Unresolved behavior is listed in `docs/OPEN_QUESTIONS.md` and must not be guessed.

## 1. Match Overview

| Item                      | Rule                                          |
| ------------------------- | --------------------------------------------- |
| Players                   | 2-12                                          |
| Modes                     | Normal and Quick                              |
| Initial hand              | 5 card entities                               |
| Hand limit                | 7 card entities                               |
| Turn order                | Fixed seat order, skipping eliminated players |
| Winner                    | Last surviving player                         |
| Play timer                | 30 seconds                                    |
| Character selection timer | 15 seconds                                    |
| Joker rescue offer        | 5 seconds per player                          |
| Disconnect recovery       | 30 seconds                                    |

The host selects Normal or Quick mode. Players join private rooms by room code. The host is implicitly ready; every other player must explicitly become ready before the host can start. Changing mode clears every non-host ready state. Public matchmaking creates two-player matches in either mode. Spectators and chat remain outside the first online release.

Before character selection, the server independently randomizes each character suit; repeated suits are allowed. All players select starters privately and in parallel. A player's 15-second deadline is independent. After every player has selected or timed out, all starters are revealed simultaneously. The server then randomly shuffles players into fixed seats, randomly selects the first player, creates the deck, and deals initial hands one card at a time in seat order. Ordinary turns remain clockwise and skip eliminated seats.

## 1.1 Identity, Accounts, And Public Names

Every first visit automatically receives a persistent guest identity. The server generates its immutable public name from one reviewed prefix and one reviewed noun and appends a four-character system tag. Guests cannot enter or edit public names.

A guest may register an account using a private login name and password. Registration upgrades the existing identity and preserves room membership, replay access, and history. During registration the player may choose one reviewed prefix and one reviewed noun exactly once. Login names are private and never appear to other players. Account sessions roll for 30 days. The first release has no email collection or password recovery.

## 1.2 Public Matchmaking And Ladder

Normal and Quick each have separate public queues for 4-player, 8-player, and 12-player matches and separate account ratings. Guests may enter the same queues but every match containing a guest is unranked. A match affects rating only when both players are registered accounts.

Matching begins within 100 rating points, expands by 50 points every 10 seconds, and stops expanding at 500 points. A proposed match requires both players to accept within 15 seconds. Players may cancel or decline without penalty. A disconnect during confirmation does not immediately reject the proposal; the player may reconnect and accept before the absolute deadline. If only one player accepts, that player returns to the queue with the original enqueue time and expanded rating range.

After every player in a proposed 4-player, 8-player, or 12-player group accepts, the server creates a hidden, locked room at that final size and immediately starts the selected mode. Matchmade rooms expose no join code, accept no additional players, and do not permit kicking or mode changes.

Players explicitly select 4, 8, or 12 players. A player may opt in to stepwise fallback before joining: 12-player requests become eligible for 8-player groups after 60 seconds and 4-player groups after another 60 seconds; 8-player requests become eligible for 4-player groups after 60 seconds. Fallback players may mix with players who selected the smaller size. Groups must fill the final size exactly.

Candidate groups are built in queue order. Every added candidate creates a new group average rating, and every member's difference from that average must fit that member's current time-expanded rating range. Confirmation shows final player count and whether the match is ranked, but not names, tiers, or ratings.

If confirmation fails, players who accepted remain grouped with their original enqueue times and receive priority replacement players. A cancelling player alone leaves the retained group. After replacements fill all vacancies, every member receives a fresh 15-second confirmation and must accept again. Once started, every ranked match is fully rated. Active leave and 30-second disconnect elimination count as ordinary losses.

An identity has at most one global matchmaking state across devices and tabs. A player in a private room cannot queue. In an unstarted private room, a non-host may leave and immediately rejoin. If the host leaves, ownership transfers to the earliest-joined remaining member; an empty room is deleted.

In a pure-account multiplayer match, final placement is reverse elimination order with the winner first. Players eliminated in the same resolution tie. Each player's Glicko-2 update compares that player against every opponent: a higher placement scores 1, a lower placement scores 0, and a tie scores 0.5. Active leave and disconnect elimination use their actual elimination position. A fallback match remains ranked when all final participants are accounts.

Account ratings use Glicko-2 with initial rating 1500, rating deviation 350, volatility 0.06, tau 0.5, and immediate per-match updates. Normal and Quick ratings are independent. The first five completed ranked matches are provisional and excluded from the Top 10 leaderboard.

Rating tiers are Bronze below 1200, Silver 1200-1399, Gold 1400-1599, Platinum 1600-1799, Diamond 1800-1999, and Champion at 2000 or above.

## 2. Deck And Card Zones

### 2.1 Deck composition

For every started group of four players, use one deck:

- 2-4 players: 1 deck
- 5-8 players: 2 decks
- 9-12 players: 3 decks

Each deck contains:

- 40 ordinary cards: four suits, ranks A through 10
- 2 Jokers

J, Q, and K are character ranks only and do not appear in the draw deck.

### 2.2 Zones

Physical cards have exactly one zone at a time: draw pile, hand, recyclable discard pile, or permanently removed zone.

- Cards spent in ordinary plays and single-Joker rescues enter the recyclable discard pile.
- Two Jokers spent on an execution enter the permanently removed zone and can never be drawn again in that match.
- When a draw requires more cards than remain in the draw pile, shuffle the recyclable discard pile into the draw pile, then continue.
- If the combined draw pile and recyclable discard pile still cannot satisfy a draw, draw as many as possible, except where a rule explicitly says otherwise.

### 2.3 Hand entities and limit

The hand limit is seven card entities. A physical card is one entity. An unplayed fused A card is also one entity even though it records two source cards.

A player at the hand limit is skipped by effects that draw cards. A draw never forces a discard merely because the player reached seven cards.

## 3. Characters And Modes

### 3.1 Character values

| Rank | Maximum HP |
| ---- | ---------: |
| J    |         30 |
| Q    |         40 |
| K    |         50 |

Every character also has:

- one randomly assigned suit: spade, heart, diamond, or club;
- current HP, initially equal to maximum HP;
- shield, initially 0;
- one life.

HP cannot exceed maximum HP. Shield has no upper limit.

### 3.2 Normal mode

Each player receives one J, one Q, and one K character. Their suits are random. The owner can see all three characters. Other players can see only the active character; reserve rank, suit, and status remain hidden until that character enters play.

At match start, all players choose active characters privately and in parallel within their individual 15-second deadlines. On timeout, the server randomly chooses one of that player's available characters. No starter is revealed until all players have chosen or timed out; then every starter is revealed simultaneously.

When the active character is eliminated and unused characters remain, the player chooses a replacement within 15 seconds. On timeout, the server randomly chooses an available character. The replacement starts at full HP with zero shield, and the player draws five cards after first discarding their entire hand.

The player is eliminated after all three characters are eliminated.

### 3.3 Quick mode

Each player has one character whose rank is independently randomized from J, Q, and K and whose suit is independently randomized. Rank HP remains J=30, Q=40, and K=50 with no compensation. Quick mode skips starter selection: all generated characters are revealed, then the server immediately randomizes seats and first player, deals initial hands, and enters `PLAYING`. All other combat and Joker rules are unchanged. When that character is eliminated, the player is eliminated.

## 4. Legal Hand Plays

A normal turn permits exactly one play and then advances to the next surviving player after all resulting phases finish.

A legal ordinary play contains exactly:

- one card entity; or
- three card entities of the same effective suit; or
- five card entities of the same effective suit.

Two-card and four-card ordinary plays are illegal. Plays containing more than five entities are illegal. Values of all played entities are added.

Jokers are not ordinary cards and cannot be included in an ordinary combination. Their actions are defined in section 8.

### 4.1 Target requirement

- Spade, heart, and diamond plays are attacks and must target one surviving opponent.
- Club plays are defensive actions, have no target, deal no damage, and grant shield to the acting player's active character.
- A double-Joker execution targets one opponent's active character.

## 5. A Fusion

A fusion uses exactly:

- one physical A; and
- one physical ordinary card ranked 2 through 10.

A+A, A+Joker, one A plus multiple other cards, and any other fusion are illegal.

The player selects the fused card's suit from the two source suits. Its value is the non-A card's value plus one. The fused card carries `bypassSuitImmunity = true`.

Fusion can be created only during the owner's `PLAYING` turn before that player submits a card play. Creating it does not consume or extend the turn: the same 30-second deadline continues, and the player must still make a legal play. The fused card may be played immediately or retained in hand. Fusion is irreversible.

The two source cards immediately enter the recyclable discard pile. The resulting synthetic fused card remains in the player's hand until played or otherwise removed and counts as one hand entity. When played or discarded by a timeout, the synthetic entity is destroyed; it never enters any physical-card zone. Its source cards remain in the recyclable discard pile.

A fused card can be played alone. It can also be one entity in a legal three- or five-entity play when all entities have the fused card's effective suit. A play containing a fused card bypasses the target character's suit immunity for that play.

## 6. Suit Resolution

### 6.1 Suit immunity

If an attack's effective suit equals the target active character's suit, only that suit's additional effect is immune. Base damage still resolves.

- Spade: damage is not doubled.
- Heart: attacker does not heal.
- Diamond: harvest draw does not occur.
- Club character passive is separate from card-suit immunity.

If the play contains a fused A card, suit immunity is bypassed and the additional effect resolves normally.

### 6.2 Spade attack

If not immune, double the summed card value before shield and HP resolution.

### 6.3 Heart attack

After damage resolves, if not immune, heal the attacker's active character by the actual HP removed from the target. Damage absorbed by shield does not count. Healing cannot exceed the attacker's maximum HP.

### 6.4 Diamond attack: harvest draw

After the attack, if not immune, distribute a total number of successful draws equal to the summed card value.

Starting with the attacker, repeatedly visit all surviving players in seat order:

- a player below seven hand entities draws one card and consumes one successful-draw count;
- a player at seven is skipped and consumes no count;
- continue until the required number of cards has been dealt, all surviving players are full, or no drawable cards remain after recyclable discard reshuffling.

If cards run out, keep already completed draws and stop the effect.

### 6.5 Club defense

A club play deals no damage and has no target. Add shield equal to the summed card value to the acting player's active character, then end the turn.

A club-suit character does not turn a club play into an attack.

### 6.6 Club character passive

Every damaging attack made by a club-suit active character ignores the target's shield, regardless of the attack card suit. The full resolved damage is deducted directly from target HP. Existing target shield is not consumed.

## 7. Damage Resolution

For a damaging play:

1. Sum card entity values.
2. Apply the spade multiplier when applicable.
3. If the attacker is a club character, skip shield; otherwise shield absorbs damage first.
4. Deduct remaining damage from target HP, to a minimum of zero.
5. Apply heart healing from actual HP removed when applicable.
6. If target HP is zero, enter the ordered Joker rescue phase unless the action was a double-Joker execution.

All values are integers.

## 8. Joker Actions

### 8.1 Single-Joker rescue

When a character reaches zero HP from ordinary attack damage or a turn-timeout penalty, the room pauses in `WAITING_FOR_JOKER`.

Starting with the dying player and continuing once in seat order, every non-eliminated player receives exactly one rescue offer:

- each offer lasts 5 seconds;
- cancel, timeout, or being disconnected counts as decline;
- a player may spend one Joker from their hand to rescue the dying character;
- the first accepted rescue ends the phase immediately;
- if every eligible player declines once, the character is eliminated.

On rescue:

- the spent Joker enters the recyclable discard pile;
- the dying character returns to full HP and zero shield;
- the dying player discards their entire remaining hand to the recyclable discard pile;
- the dying player draws up to five cards;
- play later resumes according to the server-owned turn sequence.

### 8.2 Double-Joker execution

During the acting player's normal `PLAYING` turn, they may spend exactly two Jokers to execute an opponent's active character.

- The character is eliminated immediately.
- No rescue phase occurs.
- Both Jokers enter the permanently removed zone.
- The acting player receives the three-card elimination reward, subject to the hand limit and available cards.
- If the target has a reserve character in Normal mode, replacement selection follows; otherwise the target player is eliminated.
- The execution consumes the turn.

## 9. Character Elimination And Rewards

If an ordinary damage death is not rescued:

1. Eliminate the zero-HP character.
2. The attacker draws up to three cards as the elimination reward. System timeout damage has no attacker and grants no reward.
3. In Normal mode, if the victim has an unused character, enter replacement selection.
4. Before the replacement enters play, the victim discards their entire hand and then draws up to five cards.
5. If no character remains, eliminate the player.
6. If one surviving player remains, end the match; otherwise resume play with eliminated seats skipped.

For a diamond attack that causes a death, pause and resolve the ordered Joker rescue or elimination/replacement flow first. Then resolve diamond harvest using the resulting surviving players, then award three cards to the killer if the character was not rescued, and finally check the original attacker for empty-hand supply. If the original attacker is no longer alive when harvest begins, start from the next surviving seat after the attacker's fixed seat.

A double-Joker execution follows the same replacement/player-elimination flow and grants its actor the reward, but cannot be rescued.

## 10. Draw Rules

### 10.1 Initial hand

Initial cards are dealt only after all starter characters have been selected and revealed, seats and first player have been randomized, and the deck has been created. Deal one card per player in clockwise seat order repeatedly until every player has five cards or no drawable card remains.

### 10.2 Empty-hand supply

After a card play is fully resolved, if the acting player's hand is empty or contains only Jokers, they immediately draw up to three additional cards without exceeding seven entities. Existing Jokers remain in hand and do not reduce the requested three-card supply. The supply may draw Jokers. If cards run out after reshuffling, draw as many as possible.

### 10.3 Replacement and rescue draw

After rescue or replacement, the affected player discards their entire hand and draws up to five cards. The seven-entity limit still applies. If cards run out after reshuffling, draw as many as possible.

## 11. Turn And Selection Timeouts

### 11.1 Play timeout

If the acting player does not submit a legal play within 30 seconds:

1. Deduct 5 HP directly from their active character, ignoring shield.
2. Randomly discard one card entity from the entire hand, including a Joker or fused card.
3. The penalty is a system action: it triggers no suit effect, lifesteal, or elimination reward.
4. If HP reaches zero, enter the normal ordered Joker rescue phase.
5. Otherwise end the turn and advance.

Random selection is made by the authoritative server/domain context. Every hand entity has equal discard probability; a fused card has weight one and is destroyed if selected.

### 11.2 Character selection timeout

If a player does not choose a starter or replacement within 15 seconds, the server randomly selects one of that player's legal characters.

## 12. Phase State Machine

```text
LOBBY
  -> SELECTING_STARTER
  -> PLAYING
       | ordinary/timeout death
       v
     WAITING_FOR_JOKER
       | rescued --------------------------> PLAYING
       | not rescued
       v
     SELECTING_REPLACEMENT (Normal, reserve exists)
       |-----------------------------------> PLAYING
       `-> GAME_OVER (when only one player survives)

PLAYING
  | double-Joker execution
  v
SELECTING_REPLACEMENT or GAME_OVER
```

The room is paused during rescue and replacement selection. Only the player currently offered rescue or replacement may submit the corresponding command. When rescue or replacement finishes, the original attacker's turn is complete and play continues from the next surviving seat after that attacker.

## 13. Connectivity

- Client heartbeat interval: 15 seconds.
- Client reconnect begins after approximately 3 seconds and uses exponential backoff for at most five attempts.
- The authoritative recovery deadline is 30 seconds after server-confirmed disconnect.
- Reconnection with the same signed guest identity restores that player's room projection.
- A disconnected player automatically declines an active Joker rescue offer.
- Turn and disconnect deadlines run independently. If a disconnected player's normal turn expires first, apply the standard 5 HP and random-discard penalty. Do not pause the room solely for disconnection.
- If the player does not reconnect within 30 seconds, eliminate that player and all of their remaining characters. Continue the match with their seat skipped; if one player remains, end the match.

Client retry behavior does not extend the server's 30-second deadline. If multiple deadlines are equal, process valid system commands in this priority: disconnect elimination, Joker offer, character selection, ordinary turn. Player commands are timely only when the authoritative lock-time `now` is at or before the stored deadline.

## 14. Information Visibility

A player can see:

- their full hand, including source details of fused cards;
- all three of their characters in Normal mode;
- every public action and discard;
- each opponent's active character, HP, shield, connectivity, and hand entity count.

A player cannot see an opponent's hand contents or reserve character rank/suit/status before that character becomes active.

The server must send viewer-specific projections and must never expose canonical hidden state to clients.

Completed full replays are available only to match participants identified by their signed guest identity. They may reveal all hands, reserve characters, deck order, seed, and random outcomes after the match. Full command replays are retained for 14 days; anonymized result summaries may be retained longer.
