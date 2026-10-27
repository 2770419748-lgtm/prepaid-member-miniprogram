import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerType, Prisma } from '@prisma/client';
import { maskPhone } from '../audit/audit-log.view';
import { AccessPrincipal } from '../auth/access-principal';
import { assertStoreAccess, isSuperAdmin } from '../auth/staff-access';
import { BUSINESS_TIMEZONE, businessDay } from '../common/business-day';
import { PrismaService } from '../prisma/prisma.service';
import { DailyReconciliationQueryDto } from './dto/reconciliation.dto';
import { walkChain } from './ledger-chain';
import {
  DailyBalance,
  DailyFigures,
  DailyReconciliationView,
  emptyFigures,
  IntegrityCheckView,
  OverviewView,
  settle,
  StoreDailyFigures,
  WalletMismatch,
} from './reconciliation.view';

interface AggregateRow {
  store_id: string;
  type: LedgerType;
  up: boolean;
  count: number;
  total: bigint;
}

interface WalletCheckRow {
  wallet_id: string;
  member_id: string;
  phone: string;
  name: string | null;
  balance_cent: number;
  version: number;
  entry_count: number;
  ledger_net: bigint | null;
  chain_breaks: number;
  last_after: number | null;
}

const MAX_LISTED_MISMATCHES = 100;

function add(figures: DailyFigures, row: AggregateRow): void {
  const total = Number(row.total);
  if (row.type === LedgerType.RECHARGE) {
    figures.rechargeCount += row.count;
    figures.rechargeCent += total;
  } else if (row.type === LedgerType.CONSUME) {
    figures.consumeCount += row.count;
    figures.consumeCent += total;
  } else {
    figures.reversalCount += row.count;
    if (row.up) {
      figures.reversedConsumeCent += total;
    } else {
      figures.reversedRechargeCent += total;
    }
  }
}

/**
 * 对账：只读汇总流水，不改任何数。发现问题走冲正。
 * 当日对账：超级管理员看全部门店；店长、店员看自己的门店。「当天」按上海时间。
 * 余额核对：超级管理员逐只钱包核对余额与流水。
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async daily(actor: AccessPrincipal, query: DailyReconciliationQueryDto): Promise<DailyReconciliationView> {
    const day = businessDay(query.date);
    const stores = await this.storesInScope(actor, query.storeId);
    const rows = await this.aggregate(
      actor.orgId,
      stores.map((store) => store.id),
      day.from,
      day.to,
    );
    const byStore = new Map<string, DailyFigures>(stores.map((store) => [store.id, emptyFigures()]));
    const total = emptyFigures();
    for (const row of rows) {
      const figures = byStore.get(row.store_id);
      if (figures) {
        add(figures, row);
        add(total, row);
      }
    }
    const items: StoreDailyFigures[] = stores.map((store) => ({
      storeId: store.id,
      storeName: store.name,
      storeStatus: store.status,
      ...settle(byStore.get(store.id) ?? emptyFigures()),
    }));
    const settled = settle(total);
    const balance =
      isSuperAdmin(actor.roles) && !query.storeId
        ? await this.dailyBalance(actor.orgId, day.from, settled.netChangeCent)
        : null;
    return {
      date: day.date,
      timezone: BUSINESS_TIMEZONE,
      from: day.from.toISOString(),
      to: day.to.toISOString(),
      stores: items,
      total: settled,
      balance,
    };
  }

  async overview(actor: AccessPrincipal): Promise<OverviewView> {
    const day = businessDay(undefined);
    const superAdmin = isSuperAdmin(actor.roles);
    const stores = await this.storesInScope(actor, undefined);
    const storeIds = stores.map((store) => store.id);
    const rows = await this.aggregate(actor.orgId, storeIds, day.from, day.to);
    const today = emptyFigures();
    for (const row of rows) {
      add(today, row);
    }
    const cardWhere: Prisma.WalletWhereInput = superAdmin
      ? { member: { orgId: actor.orgId } }
      : { member: { orgId: actor.orgId, openStoreId: { in: storeIds } } };
    const [cardCount, balance] = await Promise.all([
      this.prisma.wallet.count({ where: cardWhere }),
      superAdmin
        ? this.prisma.wallet.aggregate({ where: cardWhere, _sum: { balanceCent: true } })
        : Promise.resolve(null),
    ]);
    return {
      scope: superAdmin ? 'ORG' : 'STORES',
      cardCount,
      totalBalanceCent: balance ? balance._sum.balanceCent ?? 0 : null,
      today: { date: day.date, ...settle(today) },
    };
  }

  /**
   * 逐只钱包核对：钱包余额 = 流水逐笔加减之和 = 最后一笔的后余额；version = 流水笔数；
   * 每笔前余额接得上上一笔后余额。流水方向按类型和被冲原流水的类型推出，不依赖流水自己记的前后余额。
   */
  async check(actor: AccessPrincipal): Promise<IntegrityCheckView> {
    if (!isSuperAdmin(actor.roles)) {
      throw new ForbiddenException('只有超级管理员可以核对全公司余额');
    }
    const checkedAt = new Date();
    const rows = await this.prisma.$queryRaw<WalletCheckRow[]>`
      WITH signed AS (
        SELECT e."wallet_id",
               e."id",
               e."created_at",
               e."balance_before",
               e."balance_after",
               CASE
                 WHEN e."type" = 'RECHARGE' THEN e."amount_cent"
                 WHEN e."type" = 'CONSUME' THEN -e."amount_cent"
                 WHEN o."type" = 'RECHARGE' THEN -e."amount_cent"
                 WHEN o."type" = 'CONSUME' THEN e."amount_cent"
               END AS "delta"
        FROM "ledger_entries" e
        LEFT JOIN "ledger_entries" o ON o."id" = e."reversal_of_id"
        WHERE e."org_id" = ${actor.orgId}
      ),
      chained AS (
        SELECT "wallet_id",
               "delta",
               "balance_after",
               "balance_before" <> COALESCE(LAG("balance_after") OVER w, 0) AS "broken",
               ROW_NUMBER() OVER (PARTITION BY "wallet_id" ORDER BY "created_at" DESC, "id" DESC) AS "rn_desc"
        FROM signed
        WINDOW w AS (PARTITION BY "wallet_id" ORDER BY "created_at", "id")
      ),
      per_wallet AS (
        SELECT "wallet_id",
               COUNT(*)::int AS "entry_count",
               -- 方向推不出来（例如冲正了冲正）时整只钱包的合计为空，下面按对不上处理。
               CASE WHEN COUNT(*) = COUNT("delta") THEN SUM("delta") END::bigint AS "ledger_net",
               COUNT(*) FILTER (WHERE "broken")::int AS "chain_breaks",
               MAX("balance_after") FILTER (WHERE "rn_desc" = 1) AS "last_after"
        FROM chained
        GROUP BY "wallet_id"
      )
      SELECT w."id" AS "wallet_id",
             w."member_id",
             m."phone",
             m."name",
             w."balance_cent",
             w."version",
             COALESCE(p."entry_count", 0) AS "entry_count",
             CASE WHEN p."wallet_id" IS NULL THEN 0::bigint ELSE p."ledger_net" END AS "ledger_net",
             COALESCE(p."chain_breaks", 0) AS "chain_breaks",
             p."last_after"
      FROM "wallets" w
      JOIN "members" m ON m."id" = w."member_id"
      LEFT JOIN per_wallet p ON p."wallet_id" = w."id"
      WHERE m."org_id" = ${actor.orgId}
      ORDER BY m."created_at", w."id"
    `;

    let entryCount = 0;
    let totalBalanceCent = 0;
    let ledgerNetCent = 0;
    const mismatches: WalletMismatch[] = [];
    for (const row of rows) {
      entryCount += row.entry_count;
      totalBalanceCent += row.balance_cent;
      ledgerNetCent += row.ledger_net == null ? 0 : Number(row.ledger_net);
      const mismatch = await this.verifyWallet(row);
      if (mismatch) {
        mismatches.push(mismatch);
      }
    }
    return {
      checkedAt: checkedAt.toISOString(),
      ok: mismatches.length === 0 && totalBalanceCent === ledgerNetCent,
      walletCount: rows.length,
      entryCount,
      totalBalanceCent,
      ledgerNetCent,
      mismatchCount: mismatches.length,
      mismatches: mismatches.slice(0, MAX_LISTED_MISMATCHES),
    };
  }

  /**
   * SQL 按时间和 ID 排序找断点。并发记账时几笔的时间可能完全相同，排序会把它们排错，
   * 所以 SQL 报了断点或末笔对不上时，取出这只钱包的流水按余额重新串一遍再下结论。
   */
  private async verifyWallet(row: WalletCheckRow): Promise<WalletMismatch | null> {
    const ledgerNet = row.ledger_net == null ? null : Number(row.ledger_net);
    let chainBreaks = row.chain_breaks;
    let lastAfter = row.last_after;
    const lastMatches = row.entry_count === 0 ? row.balance_cent === 0 : lastAfter === row.balance_cent;
    if (chainBreaks > 0 || !lastMatches) {
      const entries = await this.prisma.ledgerEntry.findMany({
        where: { walletId: row.wallet_id },
        select: { id: true, balanceBefore: true, balanceAfter: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const chain = walkChain(entries);
      chainBreaks = chain.breaks;
      lastAfter = entries.length > 0 ? chain.endBalance : null;
    }
    const consistent =
      ledgerNet === row.balance_cent &&
      row.version === row.entry_count &&
      chainBreaks === 0 &&
      (lastAfter ?? 0) === row.balance_cent;
    if (consistent) {
      return null;
    }
    return {
      memberId: row.member_id,
      memberPhone: maskPhone(row.phone),
      memberName: row.name,
      balanceCent: row.balance_cent,
      ledgerNetCent: ledgerNet ?? 0,
      version: row.version,
      entryCount: row.entry_count,
      lastBalanceAfter: lastAfter,
      chainBreaks,
    };
  }

  private async storesInScope(actor: AccessPrincipal, storeId: string | undefined) {
    if (storeId) {
      assertStoreAccess(actor.roles, storeId);
      const store = await this.prisma.store.findUnique({ where: { id: storeId } });
      if (!store || store.orgId !== actor.orgId) {
        throw new NotFoundException('门店不存在');
      }
      return [store];
    }
    return this.prisma.store.findMany({
      where: isSuperAdmin(actor.roles)
        ? { orgId: actor.orgId }
        : { orgId: actor.orgId, id: { in: actor.roles.map((role) => role.storeId) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** 日初余额 = 当天零点前全部流水逐笔加减之和（钱包开卡时余额为 0）。 */
  private async dailyBalance(orgId: string, from: Date, netChangeCent: number): Promise<DailyBalance> {
    const [row] = await this.prisma.$queryRaw<{ opening: bigint }[]>`
      SELECT COALESCE(SUM("balance_after"::bigint - "balance_before"), 0)::bigint AS "opening"
      FROM "ledger_entries"
      WHERE "org_id" = ${orgId}
        AND "created_at" < ${from}
    `;
    const openingCent = Number(row?.opening ?? 0);
    return { openingCent, netChangeCent, closingCent: openingCent + netChangeCent };
  }

  /** 按门店、类型、方向汇总。方向只对冲正有意义：余额变多是退回消费，变少是冲回充值。 */
  private aggregate(orgId: string, storeIds: string[], from: Date, to: Date): Promise<AggregateRow[]> {
    if (storeIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.$queryRaw<AggregateRow[]>`
      SELECT "store_id",
             "type",
             ("balance_after" > "balance_before") AS "up",
             COUNT(*)::int AS "count",
             COALESCE(SUM("amount_cent"), 0)::bigint AS "total"
      FROM "ledger_entries"
      WHERE "org_id" = ${orgId}
        AND "store_id" IN (${Prisma.join(storeIds)})
        AND "created_at" >= ${from}
        AND "created_at" < ${to}
      GROUP BY 1, 2, 3
    `;
  }
}
