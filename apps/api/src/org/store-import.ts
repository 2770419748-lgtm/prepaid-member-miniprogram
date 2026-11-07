import { Prisma, StoreStatus } from '@prisma/client';
import type { StoreImportRowDto } from './dto/store.dto';

/** 每一行会怎么处理：新建、补全/修改已有门店、没有变化、有问题。 */
export type StoreImportAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR';

/** 已有门店会被改动的项。 */
export type StoreImportField = 'address' | 'phone' | 'businessHours' | 'location';

export interface StoreImportItem {
  /** 在提交的 rows 里的位置，从 0 开始；前端据此对回表格行号。 */
  index: number;
  name: string;
  action: StoreImportAction;
  /** 对上的已有门店，或新建出来的门店（真正导入后才有）。 */
  storeId: string | null;
  /** 对上的是已停用的门店：照样改资料，不改营业状态。 */
  storeDisabled: boolean;
  changes: StoreImportField[];
  error: string | null;
}

export interface StoreImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
  items: StoreImportItem[];
}

export interface ExistingStore {
  id: string;
  name: string;
  status: StoreStatus;
  address: string | null;
  contactPhone: string | null;
  businessHours: string | null;
  lat: Prisma.Decimal | null;
  lng: Prisma.Decimal | null;
}

/** 整理好的一行：没填的项是 undefined（已有门店保持原样），填了的已去掉首尾空格。 */
export interface CleanImportRow {
  name: string;
  address?: string;
  phone?: string;
  businessHours?: string;
  lat?: Prisma.Decimal;
  lng?: Prisma.Decimal;
}

export interface StoreImportPlan {
  items: StoreImportItem[];
  /** 和 items 一一对应；有问题的行是 null。 */
  rows: (CleanImportRow | null)[];
  /** 对上的已有门店，和 items 一一对应。 */
  matches: (ExistingStore | null)[];
}

function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(6));
}

function sameDecimal(a: Prisma.Decimal | null, b: Prisma.Decimal | undefined): boolean {
  return a !== null && b !== undefined && a.equals(b);
}

/**
 * 按门店名称对上已有门店：对上的只改填了且不一样的项，对不上的新建。
 * 只核对、不写库；真正导入时在事务里对着最新数据再算一遍。
 */
export function planStoreImport(input: StoreImportRowDto[], existing: ExistingStore[]): StoreImportPlan {
  const byName = new Map<string, ExistingStore[]>();
  for (const store of existing) {
    const key = store.name.trim();
    byName.set(key, [...(byName.get(key) ?? []), store]);
  }
  const seen = new Set<string>();
  const items: StoreImportItem[] = [];
  const rows: (CleanImportRow | null)[] = [];
  const matches: (ExistingStore | null)[] = [];

  input.forEach((raw, index) => {
    const name = raw.name.trim();
    const item: StoreImportItem = {
      index,
      name,
      action: 'ERROR',
      storeId: null,
      storeDisabled: false,
      changes: [],
      error: null,
    };
    const fail = (message: string) => {
      item.error = message;
      items.push(item);
      rows.push(null);
      matches.push(null);
    };

    if (!name) {
      fail('门店名称不能为空');
      return;
    }
    if (seen.has(name)) {
      fail(`表格里前面已经有一家叫「${name}」，同一家店只写一行`);
      return;
    }
    seen.add(name);
    const hasLat = typeof raw.lat === 'number';
    const hasLng = typeof raw.lng === 'number';
    if (hasLat !== hasLng) {
      fail('纬度和经度要一起填');
      return;
    }
    const row: CleanImportRow = {
      name,
      address: optionalText(raw.address),
      phone: optionalText(raw.phone),
      businessHours: optionalText(raw.businessHours),
      ...(hasLat && hasLng ? { lat: decimal(raw.lat as number), lng: decimal(raw.lng as number) } : {}),
    };
    const found = byName.get(name) ?? [];
    if (found.length > 1) {
      fail(`后台有 ${found.length} 家门店都叫「${name}」，请先在门店列表里改名再导入`);
      return;
    }
    const match = found[0] ?? null;
    if (!match) {
      item.action = 'CREATE';
    } else {
      item.storeId = match.id;
      item.storeDisabled = match.status === StoreStatus.DISABLED;
      if (row.address !== undefined && row.address !== match.address) {
        item.changes.push('address');
      }
      if (row.phone !== undefined && row.phone !== match.contactPhone) {
        item.changes.push('phone');
      }
      if (row.businessHours !== undefined && row.businessHours !== match.businessHours) {
        item.changes.push('businessHours');
      }
      if (row.lat !== undefined && !(sameDecimal(match.lat, row.lat) && sameDecimal(match.lng, row.lng))) {
        item.changes.push('location');
      }
      item.action = item.changes.length > 0 ? 'UPDATE' : 'UNCHANGED';
    }
    items.push(item);
    rows.push(row);
    matches.push(match);
  });

  return { items, rows, matches };
}

export function summarizeImport(dryRun: boolean, items: StoreImportItem[]): StoreImportResult {
  const count = (action: StoreImportAction) => items.filter((item) => item.action === action).length;
  return {
    dryRun,
    created: count('CREATE'),
    updated: count('UPDATE'),
    unchanged: count('UNCHANGED'),
    errors: count('ERROR'),
    items,
  };
}
