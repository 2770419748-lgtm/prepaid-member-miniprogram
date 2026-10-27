import { maskPhone } from '../src/audit/audit-log.view';
import { ChainEntry, walkChain } from '../src/reconciliation/ledger-chain';

function entry(id: string, before: number, after: number, at: string): ChainEntry {
  return { id, balanceBefore: before, balanceAfter: after, createdAt: new Date(at) };
}

describe('walkChain', () => {
  it('links entries recorded at the same instant by balance, not by id', () => {
    const result = walkChain([
      entry('x', 0, 100, '2026-10-27T01:00:00Z'),
      entry('a', 50, 80, '2026-10-27T01:00:01Z'),
      entry('b', 100, 50, '2026-10-27T01:00:01Z'),
    ]);
    expect(result).toEqual({ breaks: 0, endBalance: 80 });
  });

  it('counts a break when a balance does not carry over', () => {
    const result = walkChain([entry('x', 0, 100, '2026-10-27T01:00:00Z'), entry('y', 90, 40, '2026-10-27T01:00:01Z')]);
    expect(result).toEqual({ breaks: 1, endBalance: 40 });
  });

  it('treats an empty ledger as a zero balance', () => {
    expect(walkChain([])).toEqual({ breaks: 0, endBalance: 0 });
  });
});

describe('maskPhone', () => {
  it('keeps the first three and last four digits', () => {
    expect(maskPhone('13812345678')).toBe('138****5678');
    expect(maskPhone('123')).toBe('****');
  });
});
