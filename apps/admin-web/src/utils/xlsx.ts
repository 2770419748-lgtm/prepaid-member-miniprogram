import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * 够门店表格用的 Excel（.xlsx）读写：只读出单元格里的文字，只写文字、加粗表头和列宽。
 * .xlsx 是一个 zip，里面是几份 XML；Excel、WPS 存出来的格式都固定，这里用正则取值，不做完整的 XML 解析。
 */

export class SheetFileError extends Error {}

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITY[name.toLowerCase()] ?? whole;
    })
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 不允许的控制字符直接去掉（换行、制表符保留）。
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function attr(attrs: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)(?:\\w+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return match ? decodeXml(match[2] ?? match[3] ?? '') : null;
}

/** 一段 XML 里所有 <t> 的文字连起来（富文本会拆成好几段）；注音 <rPh> 不要。 */
function textRuns(xml: string): string {
  const body = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  let out = '';
  for (const match of body.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) {
    out += decodeXml(match[1]);
  }
  return out;
}

/** 「B12」里的列号，从 0 开始。 */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function columnName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** 数字格子按最短写法给出：13800000000 不会变成 1.38E+10，30.657180000000001 写成 30.65718。 */
function numberText(raw: string): string {
  const value = Number(raw);
  return raw.trim() !== '' && Number.isFinite(value) ? String(value) : raw;
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1);
  }
  const parts = `xl/${target}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      out.pop();
    } else if (part !== '.' && part !== '') {
      out.push(part);
    }
  }
  return out.join('/');
}

/**
 * 读 .xlsx 里的一张表，返回每行每格的文字（空格子是 ''）。
 * 有叫 preferredSheet 的表就读它，否则读第一张。
 */
export function readXlsx(data: Uint8Array, preferredSheet?: string): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (file) => file.name.startsWith('xl/') || file.name === '[Content_Types].xml',
    });
  } catch {
    throw new SheetFileError('这个文件打不开，请确认是 Excel 存的 .xlsx 文件');
  }
  const read = (path: string): string | null => (files[path] ? strFromU8(files[path]) : null);
  const workbook = read('xl/workbook.xml');
  if (!workbook) {
    throw new SheetFileError('这个文件里没有表格，请确认是 Excel 存的 .xlsx 文件');
  }
  const sheets = [...workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)].map((m) => ({
    name: attr(m[1], 'name') ?? '',
    rid: attr(m[1], 'id'),
  }));
  if (sheets.length === 0) {
    throw new SheetFileError('这个文件里没有表格');
  }
  const sheet = sheets.find((s) => preferredSheet && s.name.trim() === preferredSheet) ?? sheets[0];
  const rels = read('xl/_rels/workbook.xml.rels') ?? '';
  let path = 'xl/worksheets/sheet1.xml';
  for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const target = attr(m[1], 'Target');
    if (attr(m[1], 'Id') === sheet.rid && target) {
      path = resolveTarget(target);
    }
  }
  const sheetXml = read(path);
  if (!sheetXml) {
    throw new SheetFileError('这个文件里的表格读不出来，请在 Excel 里另存一份 .xlsx 再试');
  }

  const shared: string[] = [];
  const sharedXml = read('xl/sharedStrings.xml');
  if (sharedXml) {
    for (const m of sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\b[^>]*\/>/g)) {
      shared.push(m[1] ? textRuns(m[1]) : '');
    }
  }

  const rows: string[][] = [];
  let nextRow = 0;
  for (const rowMatch of sheetXml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const rowNumber = Number(attr(rowMatch[1], 'r'));
    const rowIndex = Number.isInteger(rowNumber) && rowNumber > 0 ? rowNumber - 1 : nextRow;
    nextRow = rowIndex + 1;
    const cells: string[] = [];
    let nextCol = 0;
    for (const cell of (rowMatch[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = attr(cell[1], 'r');
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      const type = attr(cell[1], 't');
      const inner = cell[2] ?? '';
      const raw = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') {
        value = shared[Number(raw)] ?? '';
      } else if (type === 'inlineStr') {
        value = textRuns(inner);
      } else if (type === 'str') {
        value = raw === undefined ? '' : decodeXml(raw);
      } else if (type === 'b') {
        value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : '';
      } else if (type === 'e') {
        value = '';
      } else if (raw !== undefined) {
        value = numberText(decodeXml(raw));
      }
      while (cells.length < col) {
        cells.push('');
      }
      cells[col] = value;
    }
    while (rows.length < rowIndex) {
      rows.push([]);
    }
    rows[rowIndex] = cells;
  }
  return rows;
}

export interface SheetSpec {
  name: string;
  rows: string[][];
  /** 每列宽度（字符数）。 */
  widths?: number[];
  /** 第一行是表头：加粗、蓝底白字、冻结在顶上。 */
  header?: boolean;
  /** 整列设成「文本」格式，免得手机号变成 1.38E+10、营业时间变成小数。 */
  textColumns?: boolean;
  /** 长文字自动换行（填写说明用）。 */
  wrap?: boolean;
}

const STYLE = { plain: 0, header: 1, text: 2, wrap: 3 } as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="等线"/><family val="2"/><charset val="134"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="等线"/><family val="2"/><charset val="134"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1677FF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(spec: SheetSpec): string {
  const columns = Math.max(spec.widths?.length ?? 0, ...spec.rows.map((row) => row.length), 1);
  const bodyStyle = spec.wrap ? STYLE.wrap : spec.textColumns ? STYLE.text : STYLE.plain;
  const cols = Array.from({ length: columns }, (_, i) => {
    const width = spec.widths?.[i] ?? 14;
    return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"${bodyStyle ? ` style="${bodyStyle}"` : ''}/>`;
  }).join('');
  const rows = spec.rows
    .map((row, r) => {
      const style = spec.header && r === 0 ? STYLE.header : bodyStyle;
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          const s = style ? ` s="${style}"` : '';
          if (value === '') {
            return style ? `<c r="${ref}"${s}/>` : '';
          }
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join('');
      const height = spec.header && r === 0 ? ' ht="22" customHeight="1"' : '';
      return `<row r="${r + 1}"${height}>${cells}</row>`;
    })
    .join('');
  const pane = spec.header
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pane}<sheetFormatPr defaultRowHeight="16"/><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
}

/** 写一个 .xlsx（只有文字），可以有好几张表。 */
export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets
        .map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });
  return zipSync(files, { level: 6 });
}
