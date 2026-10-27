import { http } from './http';
import type { LedgerEntry, LedgerType, MoneyMoveResult, PageQuery, PageResult } from './types';

export interface MoneyMoveBody {
  storeId: string;
  amountCent: number;
  remark?: string;
  requestId: string;
}

export async function recharge(memberId: string, body: MoneyMoveBody): Promise<MoneyMoveResult> {
  const { data } = await http.post<MoneyMoveResult>(`/wallets/${encodeURIComponent(memberId)}/recharge`, body);
  return data;
}

export async function consume(memberId: string, body: MoneyMoveBody): Promise<MoneyMoveResult> {
  const { data } = await http.post<MoneyMoveResult>(`/wallets/${encodeURIComponent(memberId)}/consume`, body);
  return data;
}

export async function reverse(
  entryId: string,
  body: { remark: string; requestId: string },
): Promise<MoneyMoveResult> {
  const { data } = await http.post<MoneyMoveResult>(`/ledger/${encodeURIComponent(entryId)}/reversal`, body);
  return data;
}

export interface LedgerQuery extends PageQuery {
  memberId?: string;
  storeId?: string;
  type?: LedgerType;
  from?: string;
  to?: string;
}

export async function listLedger(query: LedgerQuery): Promise<PageResult<LedgerEntry>> {
  const { data } = await http.get<PageResult<LedgerEntry>>('/ledger', { params: query });
  return data;
}

export async function getLedgerEntry(id: string): Promise<LedgerEntry> {
  const { data } = await http.get<LedgerEntry>(`/ledger/${encodeURIComponent(id)}`);
  return data;
}
