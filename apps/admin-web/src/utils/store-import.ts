import type { StoreView } from '../api/types';
import { readXlsx, SheetFileError, writeXlsx } from './xlsx';

/** 门店表格的列，顺序就是模板里的顺序。 */
export const STORE_SHEET_HEADERS = ['门店名称', '详细地址', '联系电话', '营业时间', '坐标'] as const;
export const STORE_SHEET_NAME = '门店清单';
export const STORE_IMPORT_MAX_ROWS = 200;
/** 取坐标的网页：腾讯地图的坐标和微信小程序导航用的是同一套（GCJ-02）。 */
export const COORDINATE_PICKER_URL = 'https://lbs.qq.com/getPoint/';

const LIMITS = { name: 80, address: 200, phone: 30, businessHours: 200 } as const;

export interface Coordinates {
  lat: number;
  lng: number;
}

export type CoordinateResult = { ok: true; value: Coordinates | null } | { ok: false; message: string };

/** 国内大致范围：纬度 3～54，经度 73～136，两个数不会搞混，所以谁在前都能认出来。 */
function isChinaLat(value: number): boolean {
  return value >= 3 && value <= 54;
}

function isChinaLng(value: number): boolean {
  return value >= 73 && value <= 136;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * 认坐标：腾讯拾取器给「纬度,经度」，高德给「经度,纬度」，都能直接粘贴。
 * 中间用逗号、中文逗号、空格都行；空的表示不填。
 */
export function parseCoordinates(input: string): CoordinateResult {
  const text = input.trim();
  if (!text) {
    return { ok: true, value: null };
  }
  const numbers = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length !== 2) {
    return { ok: false, message: '坐标要两个数，例如 30.657180,104.080810' };
  }
  const [a, b] = numbers;
  if (isChinaLat(a) && isChinaLng(b)) {
    return { ok: true, value: { lat: round6(a), lng: round6(b) } };
  }
  if (isChinaLng(a) && isChinaLat(b)) {
    return { ok: true, value: { lat: round6(b), lng: round6(a) } };
  }
  return { ok: false, message: '这个坐标不在国内，请重新取一次' };
}

export function formatCoordinates(lat: number | null, lng: number | null): string {
  return lat === null || lng === null ? '' : `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** 发给接口的一行：没填的项不带。 */
export interface StoreImportRow {
  name: string;
  address?: string;
  phone?: string;
  businessHours?: string;
  lat?: number;
  lng?: number;
}

export interface SheetRow {
  /** Excel 里的行号（表头是第 1 行）。 */
  line: number;
  row: StoreImportRow;
}

export interface SheetProblem {
  line: number;
  message: string;
}

export interface ParsedStoreSheet {
  rows: SheetRow[];
  problems: SheetProblem[];
}

type Column = 'name' | 'address' | 'phone' | 'businessHours' | 'coordinates' | 'lat' | 'lng';

const HEADER_ALIASES: Record<Column, string[]> = {
  name: ['门店名称', '门店', '名称', '店名', '门店名'],
  address: ['详细地址', '地址', '门店地址'],
  phone: ['联系电话', '电话', '门店电话', '联系方式', '手机'],
  businessHours: ['营业时间'],
  coordinates: ['坐标', '经纬度', '地图坐标', '门店坐标'],
  lat: ['纬度'],
  lng: ['经度'],
};

/** 「门店名称（必填）」「*坐标」都认：去掉括号里的说明、星号和空格。 */
function normalizeHeader(value: string): string {
  return value
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[*＊\s]/g, '')
    .trim();
}

function headerColumns(header: string[]): Partial<Record<Column, number>> {
  const found: Partial<Record<Column, number>> = {};
  header.forEach((cell, index) => {
    const name = normalizeHeader(cell);
    for (const [column, aliases] of Object.entries(HEADER_ALIASES) as [Column, string[]][]) {
      if (found[column] === undefined && aliases.includes(name)) {
        found[column] = index;
      }
    }
  });
  return found;
}

/** 把表格的每一行整理成要导入的门店；格式不对的行列进 problems，给人看行号改。 */
export function parseStoreSheet(table: string[][]): ParsedStoreSheet {
  const problems: SheetProblem[] = [];
  const rows: SheetRow[] = [];
  const firstFilled = table.findIndex((row) => row.some((cell) => cell.trim() !== ''));
  if (firstFilled < 0) {
    return { rows, problems: [{ line: 1, message: '表格是空的' }] };
  }
  // 表头上面可能还有一行标题，往下找几行，找到有「门店名称」的那行当表头。
  const headerIndex = table
    .slice(0, firstFilled + 5)
    .findIndex((row, index) => index >= firstFilled && headerColumns(row).name !== undefined);
  if (headerIndex < 0) {
    return {
      rows,
      problems: [{ line: firstFilled + 1, message: '找不到表头：第一行要写「门店名称」「详细地址」这些列名（可以先下载门店表格照着填）' }],
    };
  }
  const columns = headerColumns(table[headerIndex]);
  const cell = (row: string[], column: Column): string => {
    const index = columns[column];
    return index === undefined ? '' : (row[index] ?? '').trim();
  };
  const firstLine = new Map<string, number>();

  for (let i = headerIndex + 1; i < table.length; i += 1) {
    const raw = table[i] ?? [];
    const line = i + 1;
    if (!raw.some((value) => value.trim() !== '')) {
      continue;
    }
    const name = cell(raw, 'name');
    const fail = (message: string) => problems.push({ line, message });
    if (!name) {
      fail('没填门店名称');
      continue;
    }
    const row: StoreImportRow = { name };
    let ok = true;
    if (name.length > LIMITS.name) {
      fail(`门店名称太长，最多 ${LIMITS.name} 个字`);
      ok = false;
    }
    const earlier = firstLine.get(name);
    if (earlier !== undefined) {
      fail(`和第 ${earlier} 行门店名称重复，同一家店只写一行`);
      ok = false;
    } else {
      firstLine.set(name, line);
    }
    for (const key of ['address', 'phone', 'businessHours'] as const) {
      const value = cell(raw, key);
      if (!value) {
        continue;
      }
      if (value.length > LIMITS[key]) {
        fail(`${key === 'address' ? '地址' : key === 'phone' ? '电话' : '营业时间'}太长，最多 ${LIMITS[key]} 个字`);
        ok = false;
        continue;
      }
      // 营业时间那格没设成文本时，Excel 会把「10:00」存成 0.4166… 这样的小数。
      if (key === 'businessHours' && /^0?\.\d+$/.test(value)) {
        fail('营业时间被 Excel 当成了时间数字，请把这一格改成文字，例如「每天 10:00-22:00」');
        ok = false;
        continue;
      }
      row[key] = value;
    }
    let coordText = cell(raw, 'coordinates');
    const lat = cell(raw, 'lat');
    const lng = cell(raw, 'lng');
    if (!coordText && (lat || lng)) {
      if (!lat || !lng) {
        fail('纬度和经度要一起填');
        ok = false;
      }
      coordText = `${lat},${lng}`;
    }
    if (ok && coordText) {
      const coords = parseCoordinates(coordText);
      if (!coords.ok) {
        fail(coords.message);
        ok = false;
      } else if (coords.value) {
        row.lat = coords.value.lat;
        row.lng = coords.value.lng;
      }
    }
    if (ok) {
      rows.push({ line, row });
    }
  }
  if (rows.length === 0 && problems.length === 0) {
    problems.push({ line: headerIndex + 2, message: '表头下面还没有门店' });
  }
  if (rows.length + problems.length > STORE_IMPORT_MAX_ROWS) {
    problems.unshift({ line: headerIndex + 1, message: `一次最多导入 ${STORE_IMPORT_MAX_ROWS} 家门店，请分几次导` });
  }
  return { rows, problems };
}

/** CSV 一般是 UTF-8；Excel 在中文 Windows 上另存的 CSV 是 GBK，两种都认。 */
export function decodeCsv(bytes: Uint8Array): string {
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('gb18030').decode(body);
  }
}

export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', '\t', ';'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
    } else if (ch === '"' && value === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(value);
      value = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }
  if (value !== '' || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

/** 认文件：.xlsx 和 .csv；旧版 .xls 请另存。 */
export function readStoreFile(fileName: string, bytes: Uint8Array): string[][] {
  const lower = fileName.toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOldXls = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isOldXls || (lower.endsWith('.xls') && !isZip)) {
    throw new SheetFileError('这是旧版 Excel（.xls），请在 Excel 里「另存为」.xlsx 再上传');
  }
  if (isZip || lower.endsWith('.xlsx')) {
    return readXlsx(bytes, STORE_SHEET_NAME);
  }
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return parseCsv(decodeCsv(bytes));
  }
  throw new SheetFileError('只能上传 Excel 表格（.xlsx）或 .csv 文件');
}

const GUIDE = [
  '门店清单怎么填（一行一家店，填完保存，在商家后台「门店管理 → 批量导入」上传）',
  '',
  '门店名称（必填）：会员在小程序「可用门店」里看到的就是这个名字，最多 80 个字，不能重名。',
  '详细地址：写到商场楼层和铺位号，例如「成都市锦江区某某路 1 号 某某广场 3 楼 3012」。会员点「导航」时显示。',
  '联系电话：会员在小程序里一键拨打，建议填门店座机或店里的工作手机。',
  '营业时间：原样显示，例如「每天 10:00-22:00」。',
  `坐标：会员点「导航」要用。打开腾讯坐标拾取器 ${COORDINATE_PICKER_URL} ，搜商场名，在门店位置点一下，把显示的两个数复制进来，例如「30.657180,104.080810」。高德地图坐标拾取器的也行，两个数谁在前都可以。不要用百度地图的坐标，会偏几百米。不填也能导入，只是会员端「导航」按钮是灰的。`,
  '',
  '和后台已有门店同名的，会补上或改成表里填的资料；名字不一样的会新建。导入前会先列出来给你看一遍，确认了才写进去。',
  '空着的格子不会清掉后台已有的资料。要给门店改名、清空某一项或停用，在后台点那家店的「编辑」或「停用」。',
];

/** 下载用的门店表格：把现有门店先列上，改完直接传回来；没有门店时就是空模板。 */
export function storeSheetFile(stores: Pick<StoreView, 'name' | 'address' | 'phone' | 'businessHours' | 'lat' | 'lng'>[]): Uint8Array {
  const rows = [
    [...STORE_SHEET_HEADERS],
    ...stores.map((store) => [
      store.name,
      store.address ?? '',
      store.phone ?? '',
      store.businessHours ?? '',
      formatCoordinates(store.lat, store.lng),
    ]),
  ];
  return writeXlsx([
    { name: STORE_SHEET_NAME, rows, widths: [22, 48, 16, 20, 26], header: true, textColumns: true },
    { name: '填写说明', rows: GUIDE.map((line) => [line]), widths: [110], wrap: true },
  ]);
}

export { SheetFileError };
