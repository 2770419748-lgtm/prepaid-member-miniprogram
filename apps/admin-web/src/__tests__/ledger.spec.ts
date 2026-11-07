import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../api/types';
import { isLedgerTypeFilter, LEDGER_FILTER_OPTIONS, ledgerCsv, normalizeOrderNo, typeFilterQuery } from '../utils/ledger';

function entry(patch: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 'e1',
    memberId: 'm1',
    memberPhone: '13812345678',
    memberName: '王女士',
    storeId: 's1',
    storeName: '旗舰店',
    operatorStaffId: 'st1',
    operatorName: '李店员',
    type: 'CONSUME',
    amountCent: 12990,
    changeCent: -12990,
    balanceBefore: 100000,
    balanceAfter: 87010,
    remark: null,
    reversalOfId: null,
    reversalOfType: null,
    reversedById: null,
    orderNo: 'A5982',
    productAmountCent: 129900,
    orderNoTyped: false,
    codeless: false,
    createdAt: '2026-11-05T06:32:00.000Z',
    ...patch,
  };
}

describe('九讯云订单号', () => {
  it('小票上的单号和条码里的写法都认，整理成和服务端一样', () => {
    expect(normalizeOrderNo('5982')).toBe('A5982');
    expect(normalizeOrderNo(' a5982 ')).toBe('A5982');
    expect(normalizeOrderNo('A05982')).toBe('A5982');
    expect(normalizeOrderNo('59 82')).toBe('A5982');
  });

  it('不是单号返回 null', () => {
    expect(normalizeOrderNo('')).toBeNull();
    expect(normalizeOrderNo('A')).toBeNull();
    expect(normalizeOrderNo('A0')).toBeNull();
    expect(normalizeOrderNo('B5982')).toBeNull();
    expect(normalizeOrderNo('12345678901')).toBeNull();
    expect(normalizeOrderNo('5982-1')).toBeNull();
  });
});

describe('流水导出表格', () => {
  it('表头加每笔一行，手机号打码，金额不带千分位', () => {
    const csv = ledgerCsv([entry({})]);
    const [header, row] = csv.trim().split('\r\n');
    expect(header).toBe(
      '时间,门店,类型,办理方式,九讯云订单,单号来源,商品应付（元）,金额（元）,变动后余额（元）,已冲正,会员,手机号,操作人,备注,流水号',
    );
    expect(row.split(',').slice(1)).toEqual([
      '旗舰店',
      '消费',
      '扫码',
      'A5982',
      '扫码',
      '1299.00',
      '-129.90',
      '870.10',
      '',
      '王女士',
      '138****5678',
      '李店员',
      '',
      'e1',
    ]);
  });

  it('冲正行写明抵掉的是什么，带原消费的单号；手输、已冲正标出来', () => {
    const csv = ledgerCsv([
      entry({ reversedById: 'e2', orderNoTyped: true }),
      entry({
        id: 'e2',
        type: 'REVERSAL',
        reversalOfId: 'e1',
        reversalOfType: 'CONSUME',
        changeCent: 12990,
        productAmountCent: null,
        orderNoTyped: null,
      }),
    ]);
    const [, first, second] = csv.trim().split('\r\n');
    expect(first.split(',')[5]).toBe('手输');
    expect(first.split(',')[9]).toBe('是');
    expect(second.split(',').slice(2, 8)).toEqual(['冲正（抵掉消费）', '', 'A5982', '', '', '129.90']);
  });

  it('无码抵扣标出来，没填单号的单号列留空、商品金额照写，原因在备注', () => {
    const csv = ledgerCsv([
      entry({ codeless: true, orderNo: null, orderNoTyped: null, remark: '顾客没带手机', operatorName: '王店长' }),
    ]);
    const [, row] = csv.trim().split('\r\n');
    expect(row.split(',').slice(2, 8)).toEqual(['消费', '无码抵扣', '', '', '1299.00', '-129.90']);
    expect(row.split(',').slice(12, 14)).toEqual(['王店长', '顾客没带手机']);
  });

  it('备注带逗号、引号、换行的加引号；像公式的前面加单引号', () => {
    const csv = ledgerCsv([entry({ remark: '买手机, 送"膜"\n分两次' }), entry({ id: 'e3', remark: '=HYPERLINK("x")' })]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toContain('"买手机, 送""膜""\n分两次"');
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('流水类型筛选', () => {
  it('「消费 · 无码抵扣」查的是消费里的无码抵扣，排在消费后面', () => {
    expect(LEDGER_FILTER_OPTIONS.map((o) => o.label)).toEqual(['充值', '消费', '消费 · 无码抵扣', '冲正', '退余额']);
    expect(typeFilterQuery('CODELESS')).toEqual({ type: 'CONSUME', codeless: 'true' });
    expect(typeFilterQuery('CONSUME')).toEqual({ type: 'CONSUME' });
    expect(typeFilterQuery(undefined)).toEqual({});
    expect(isLedgerTypeFilter('CODELESS')).toBe(true);
    expect(isLedgerTypeFilter('REFUND')).toBe(true);
    expect(isLedgerTypeFilter('X')).toBe(false);
  });
});
