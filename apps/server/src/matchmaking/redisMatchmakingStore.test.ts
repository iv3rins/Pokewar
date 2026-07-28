import { describe, expect, it } from 'vitest';
import type { QueueEntry, MatchProposal } from './model.js';
import { RedisMatchmakingStore, type RedisMatchmakingClient } from './redisMatchmakingStore.js';

class FakeRedis implements RedisMatchmakingClient {
  readonly strings = new Map<string, string>();
  readonly sorted = new Map<string, Map<string, number>>();
  get(key: string) {
    return Promise.resolve(this.strings.get(key) ?? null);
  }
  set(key: string, value: string) {
    this.strings.set(key, value);
    return Promise.resolve('OK');
  }
  del(keys: string | string[]) {
    const list = Array.isArray(keys) ? keys : [keys];
    let count = 0;
    for (const key of list) if (this.strings.delete(key)) count += 1;
    return Promise.resolve(count);
  }
  mGet(keys: string[]) {
    return Promise.resolve(keys.map((key) => this.strings.get(key) ?? null));
  }
  zAdd(key: string, members: { score: number; value: string }[]) {
    const values = this.sorted.get(key) ?? new Map<string, number>();
    for (const member of members) values.set(member.value, member.score);
    this.sorted.set(key, values);
    return Promise.resolve(members.length);
  }
  zRem(key: string, members: string[]) {
    const values = this.sorted.get(key);
    let count = 0;
    for (const member of members) if (values?.delete(member)) count += 1;
    return Promise.resolve(count);
  }
  zRange(key: string, start: number, stop: number) {
    const values = [...(this.sorted.get(key) ?? new Map<string, number>()).entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([value]) => value);
    return Promise.resolve(values.slice(start, stop === -1 ? undefined : stop + 1));
  }
  zRangeByScore(
    key: string,
    min: number,
    max: number,
    options?: { LIMIT?: { offset: number; count: number } },
  ) {
    let values = [...(this.sorted.get(key) ?? new Map<string, number>()).entries()]
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1])
      .map(([value]) => value);
    if (options?.LIMIT)
      values = values.slice(options.LIMIT.offset, options.LIMIT.offset + options.LIMIT.count);
    return Promise.resolve(values);
  }
}

const entry = (id: string, enqueuedAt: number): QueueEntry => ({
  identity: { id, kind: 'account', nickname: id, displayName: `${id}#TEST` },
  mode: 'quick',
  requestedSize: 4,
  allowFallback: false,
  rating: 1500,
  enqueuedAt,
});

describe('RedisMatchmakingStore multiplayer groups', () => {
  it('persists queue entries, retained groups, reconfirmation deadlines, and cleanup', async () => {
    const redis = new FakeRedis();
    const store = new RedisMatchmakingStore(redis, 'test:');
    const players = [entry('a', 1_000), entry('b', 1_001), entry('c', 1_002), entry('d', 1_003)];
    for (const player of players) expect(await store.enqueue(player)).toBe('queued');
    const proposal: MatchProposal = {
      id: 'proposal-1',
      roomId: 'A2BCD',
      mode: 'quick',
      finalSize: 4,
      players,
      acceptedIds: [],
      expiresAt: 16_000,
    };
    expect(await store.createProposal(proposal)).toBe(true);
    expect((await store.getProposalFor('d'))?.players).toHaveLength(4);
    expect((await store.acceptProposal('proposal-1', 'a'))?.acceptedIds).toEqual(['a']);
    expect(await store.dueProposals(16_000, 10)).toHaveLength(1);

    const retained = {
      ...proposal,
      players: players.slice(0, 3),
      acceptedIds: [],
      expiresAt: null,
    };
    await store.updateProposal(retained);
    expect(await store.dueProposals(99_999, 10)).toEqual([]);
    expect((await store.proposals(10))[0]?.players).toHaveLength(3);
    await store.deleteProposal('proposal-1');
    expect(await store.getProposalFor('a')).toBeNull();
  });
});
