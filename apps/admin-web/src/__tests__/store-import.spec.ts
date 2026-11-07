import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  decodeCsv,
  formatCoordinates,
  parseCoordinates,
  parseCsv,
  parseStoreSheet,
  readStoreFile,
  SheetFileError,
  storeSheetFile,
} from '../utils/store-import';
import { readXlsx } from '../utils/xlsx';

const HEADER = ['门店名称', '详细地址', '联系电话', '营业时间', '坐标'];

describe('认坐标', () => {
  it('腾讯给的「纬度,经度」和高德给的「经度,纬度」都认得', () => {
    expect(parseCoordinates('30.657180,104.080810')).toEqual({ ok: true, value: { lat: 30.65718, lng: 104.08081 } });
    expect(parseCoordinates('104.080810,30.657180')).toEqual({ ok: true, value: { lat: 30.65718, lng: 104.08081 } });
    expect(parseCoordinates(' 30.6571801234，104.0808109876 ')).toEqual({
      ok: true,
      value: { lat: 30.65718, lng: 104.080811 },
    });
    expect(parseCoordinates('纬度 30.65718 经度 104.08081')).toEqual({ ok: true, value: { lat: 30.65718, lng: 104.08081 } });
  });

  it('空的表示不填，看不懂或不在国内的给出白话提示', () => {
    expect(parseCoordinates('  ')).toEqual({ ok: true, value: null });
    expect(parseCoordinates('30.65')).toEqual({ ok: false, message: '坐标要两个数，例如 30.657180,104.080810' });
    expect(parseCoordinates('0,0')).toEqual({ ok: false, message: '这个坐标不在国内，请重新取一次' });
    expect(parseCoordinates('40.7128,-74.0060')).toMatchObject({ ok: false });
  });

  it('写回表格时固定六位小数，纬度在前', () => {
    expect(formatCoordinates(30.65718, 104.08081)).toBe('30.657180,104.080810');
    expect(formatCoordinates(null, null)).toBe('');
  });
});

describe('整理门店表格', () => {
  it('跳过空行，去掉首尾空格，没填的项不带', () => {
    const parsed = parseStoreSheet([
      HEADER,
      [' 成都蜀都万达店 ', '成都市锦江区示例路 1 号', '028-12345678', '每天 10:00-22:00', '30.657180,104.080810'],
      ['', '', '', '', ''],
      ['内江吾悦店'],
    ]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        line: 2,
        row: {
          name: '成都蜀都万达店',
          address: '成都市锦江区示例路 1 号',
          phone: '028-12345678',
          businessHours: '每天 10:00-22:00',
          lat: 30.65718,
          lng: 104.08081,
        },
      },
      { line: 4, row: { name: '内江吾悦店' } },
    ]);
  });

  it('认表头的别名和顺序，也认分开的纬度、经度两列；表头上面可以有标题行', () => {
    const parsed = parseStoreSheet([
      ['鑫耀门店清单'],
      ['电话', '*门店名称', '纬度', '经度', '地址（写到门牌号）'],
      ['0838-1234567', '德阳印象汇店', '31.1270', '104.3979', '德阳市示例路'],
      ['', '德阳上美广场店', '31.12', '', ''],
    ]);
    expect(parsed.rows).toEqual([
      { line: 3, row: { name: '德阳印象汇店', phone: '0838-1234567', address: '德阳市示例路', lat: 31.127, lng: 104.3979 } },
    ]);
    expect(parsed.problems).toEqual([{ line: 4, message: '纬度和经度要一起填' }]);
  });

  it('把有问题的行和行号列出来', () => {
    const parsed = parseStoreSheet([
      HEADER,
      ['南充临江万达店'],
      ['', '只有地址没有名称'],
      ['南充临江万达店'],
      ['南充王府井店', '', '', '0.4166666666666667'],
      ['南充仁和广场店', '', '', '', '30.8'],
      ['店'.repeat(81)],
    ]);
    expect(parsed.rows.map((r) => r.line)).toEqual([2]);
    expect(parsed.problems).toEqual([
      { line: 3, message: '没填门店名称' },
      { line: 4, message: '和第 2 行门店名称重复，同一家店只写一行' },
      { line: 5, message: '营业时间被 Excel 当成了时间数字，请把这一格改成文字，例如「每天 10:00-22:00」' },
      { line: 6, message: '坐标要两个数，例如 30.657180,104.080810' },
      { line: 7, message: '门店名称太长，最多 80 个字' },
    ]);
  });

  it('没有表头或没有门店时说清楚', () => {
    expect(parseStoreSheet([]).problems[0].message).toBe('表格是空的');
    expect(parseStoreSheet([['随便写的'], ['东西']]).problems[0].message).toContain('找不到表头');
    expect(parseStoreSheet([HEADER]).problems[0].message).toBe('表头下面还没有门店');
    const many = parseStoreSheet([HEADER, ...Array.from({ length: 201 }, (_, i) => [`门店${i}`])]);
    expect(many.problems[0].message).toBe('一次最多导入 200 家门店，请分几次导');
  });
});

describe('读 Excel 文件', () => {
  it('读 openpyxl 存的表：挑「门店清单」那张，富文本、数字手机号、& 符号都正常', () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/stores-openpyxl.xlsx', import.meta.url)));
    const table = readStoreFile('门店清单.xlsx', bytes);
    expect(table[0]).toEqual(['门店名称（必填）', '详细地址', '联系电话', '营业时间', '坐标']);
    expect(table[1]).toEqual(['成都蜀都万达店', '成都市锦江区示例路 1 号 3 楼 & 3012', '028-12345678', '每天 10:00-22:00', '30.657180,104.080810']);
    expect(table[2]).toEqual(['内江吾悦店', '', '13900000000', '', '105.066140, 29.580150']);
    expect(table[4][0]).toBe('遂宁万象汇店');
    const parsed = parseStoreSheet(table);
    expect(parsed.rows[1]).toEqual({ line: 3, row: { name: '内江吾悦店', phone: '13900000000', lat: 29.58015, lng: 105.06614 } });
    // 营业时间那格被 Excel 存成了时间，提示改成文字。
    expect(parsed.problems).toEqual([
      { line: 5, message: '营业时间被 Excel 当成了时间数字，请把这一格改成文字，例如「每天 10:00-22:00」' },
    ]);
  });

  it('读 Excel 自己存的样子：共享字符串、带前缀的标签、隔开的列、科学计数的数字', () => {
    const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
<x:row r="1" spans="1:5"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="s"><x:v>1</x:v></x:c><x:c r="E1" t="s"><x:v>2</x:v></x:c></x:row>
<x:row r="3"><x:c r="A3" t="s"><x:v>3</x:v></x:c><x:c r="C3"><x:v>1.39E+10</x:v></x:c><x:c r="E3" t="s"><x:v>4</x:v></x:c><x:c r="F3" t="b"><x:v>1</x:v></x:c><x:c r="G3" t="e"><x:v>#N/A</x:v></x:c></x:row>
</x:sheetData></x:worksheet>`;
    const shared = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5"><si><t>门店名称</t></si><si><t>联系电话</t></si><si><t>坐标</t></si><si><r><t>南充</t></r><r><rPr><b/></rPr><t xml:space="preserve">王府井店</t></r><rPh sb="0" eb="2"><t>ナン</t></rPh></si><si><t>30.79,106.08</t></si></sst>`;
    const workbook = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId7"/></sheets></workbook>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="worksheet" Target="/xl/worksheets/data.xml"/></Relationships>`;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/workbook.xml': strToU8(workbook),
      'xl/_rels/workbook.xml.rels': strToU8(rels),
      'xl/sharedStrings.xml': strToU8(shared),
      'xl/worksheets/data.xml': strToU8(sheet),
    });
    const table = readXlsx(bytes, '门店清单');
    expect(table).toEqual([
      ['门店名称', '', '联系电话', '', '坐标'],
      [],
      ['南充王府井店', '', '13900000000', '', '30.79,106.08', 'TRUE', ''],
    ]);
  });

  it('下载的门店表格能原样读回来，现有门店都列在上面', () => {
    const bytes = storeSheetFile([
      { name: '成都蜀都万达店', address: '成都市 <锦江区> "示例"路', phone: '028-12345678', businessHours: null, lat: 30.65718, lng: 104.08081 },
      { name: '内江吾悦店', address: null, phone: null, businessHours: '每天 10:00-22:00', lat: null, lng: null },
    ]);
    const table = readStoreFile('门店清单.xlsx', bytes);
    expect(table).toEqual([
      HEADER,
      ['成都蜀都万达店', '成都市 <锦江区> "示例"路', '028-12345678', '', '30.657180,104.080810'],
      ['内江吾悦店', '', '', '每天 10:00-22:00', ''],
    ]);
    expect(readXlsx(bytes, '填写说明')[0][0]).toContain('门店清单怎么填');
    expect(parseStoreSheet(table).rows).toHaveLength(2);
  });

  it('CSV 认 UTF-8 和 Excel 另存的 GBK，引号里的逗号和换行不拆', () => {
    const text = '门店名称,详细地址\r\n"成都蜀都万达店","锦江区, 3 楼\n3012"\r\n内江吾悦店,"说""好的"""\r\n';
    expect(parseCsv(text)).toEqual([
      ['门店名称', '详细地址'],
      ['成都蜀都万达店', '锦江区, 3 楼\n3012'],
      ['内江吾悦店', '说"好的"'],
    ]);
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('门店名称\n')]);
    expect(decodeCsv(utf8)).toBe('门店名称\n');
    // 「门店」的 GBK 编码。
    const gbk = new Uint8Array([0xc3, 0xc5, 0xb5, 0xea]);
    expect(decodeCsv(gbk)).toBe('门店');
  });

  it('旧版 .xls、打不开的文件、别的格式都给出白话提示', () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]);
    expect(() => readStoreFile('门店.xls', xls)).toThrow('旧版 Excel');
    expect(() => readStoreFile('门店.xlsx', new Uint8Array([0x50, 0x4b, 1, 2]))).toThrow(SheetFileError);
    expect(() => readStoreFile('门店.pdf', new Uint8Array([1, 2, 3]))).toThrow('只能上传 Excel 表格');
  });
});
