import type { ValidatedPlay } from '../cards/play.js';
import type { CharacterState } from '../model/characters.js';

export interface CombatResolution {
  readonly immuneToSuitEffect: boolean;
  readonly resolvedDamage: number;
  readonly shieldLost: number;
  readonly hpLost: number;
  readonly healing: number;
  readonly shieldGained: number;
  readonly diamondDrawCount: number;
  readonly targetHp: number;
  readonly targetShield: number;
  readonly attackerHp: number;
  readonly attackerShield: number;
}

export function resolvePlay(
  play: ValidatedPlay,
  attacker: CharacterState,
  target?: CharacterState,
): CombatResolution {
  if (play.kind === 'defense') {
    return {
      immuneToSuitEffect: false,
      resolvedDamage: 0,
      shieldLost: 0,
      hpLost: 0,
      healing: 0,
      shieldGained: play.value,
      diamondDrawCount: 0,
      targetHp: target?.hp ?? 0,
      targetShield: target?.shield ?? 0,
      attackerHp: attacker.hp,
      attackerShield: attacker.shield + play.value,
    };
  }

  if (!target) throw new Error('ATTACK_TARGET_REQUIRED');

  const immuneToSuitEffect = target.suit === play.suit && !play.bypassSuitImmunity;
  const resolvedDamage = play.suit === 'spade' && !immuneToSuitEffect ? play.value * 2 : play.value;
  const penetratesShield = attacker.suit === 'club';
  const shieldLost = penetratesShield ? 0 : Math.min(target.shield, resolvedDamage);
  const hpDamage = resolvedDamage - shieldLost;
  const hpLost = Math.min(target.hp, hpDamage);
  const healing =
    play.suit === 'heart' && !immuneToSuitEffect
      ? Math.min(
          hpLost,
          attacker.rank === 'J'
            ? 30 - attacker.hp
            : attacker.rank === 'Q'
              ? 40 - attacker.hp
              : 50 - attacker.hp,
        )
      : 0;

  return {
    immuneToSuitEffect,
    resolvedDamage,
    shieldLost,
    hpLost,
    healing,
    shieldGained: 0,
    diamondDrawCount: play.suit === 'diamond' && !immuneToSuitEffect ? play.value : 0,
    targetHp: target.hp - hpLost,
    targetShield: target.shield - shieldLost,
    attackerHp: attacker.hp + healing,
    attackerShield: attacker.shield,
  };
}
