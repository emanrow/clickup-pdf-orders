import ExcelJS from 'exceljs';

export interface ColumnSpec {
    id: string;
    title: string;
    custom: boolean;
}

/**
 * A custom field value converted for export. `text` is always present (used
 * by CSV/JSON); the typed members are set when ClickUp's declared field type
 * says the value is a date/number/currency, so XLSX can emit real typed cells.
 */
export interface ExportCell {
    text: string;
    date?: Date;
    hasTime?: boolean;
    number?: number;
    currencyCode?: string;
    precision?: number;
}

/**
 * Timezone used to render date/time values (Excel cells are timezone-naive).
 * ClickUp stores instants as epoch ms; date-only fields default to 4:00 AM in
 * the workspace's timezone, so rendering must happen in a concrete zone.
 * Set EXPORT_TIMEZONE to an IANA name (e.g. America/Chicago); defaults to UTC.
 */
const EXPORT_TZ = (() => {
    const tz = process.env.EXPORT_TIMEZONE || 'UTC';
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: tz });
        return tz;
    } catch {
        console.error(`Invalid EXPORT_TIMEZONE "${tz}", falling back to UTC`);
        return 'UTC';
    }
})();

const TZ_FORMAT = new Intl.DateTimeFormat('en-CA', {
    timeZone: EXPORT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
});

const tzParts = (d: Date): Record<string, number> => {
    const parts: Record<string, number> = {};
    for (const p of TZ_FORMAT.formatToParts(d)) {
        if (p.type !== 'literal') parts[p.type] = Number(p.value);
    }
    return parts;
};

/** The instant's wall-clock time in EXPORT_TZ, as a naive Date for Excel. */
const wallClockDate = (d: Date): Date => {
    const p = tzParts(d);
    return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
};

const dateText = (d: Date, hasTime: boolean): string => {
    const p = tzParts(d);
    const pad = (n: number) => String(n).padStart(2, '0');
    const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    return hasTime ? `${day} ${pad(p.hour)}:${pad(p.minute)}` : day;
};

/**
 * Convert a raw ClickUp custom field to an ExportCell using the field's
 * declared `type` — driven entirely by API metadata, no value sniffing.
 */
export const flattenCustomField = (field: any): ExportCell => {
    const v = field?.value;
    if (v === null || v === undefined || v === '') return { text: '' };

    switch (field.type) {
        case 'date': {
            // ClickUp stores dates as epoch milliseconds (e.g. "1783411200000").
            // Whether a time was actually set is declared in value_options.time
            // (date-only fields still carry a default time-of-day in the ms).
            const ms = Number(v);
            if (!Number.isFinite(ms)) return { text: String(v) };
            const d = new Date(ms);
            const hasTime = field.value_options?.time === true;
            return {
                text: dateText(d, hasTime),
                date: wallClockDate(d),
                hasTime
            };
        }
        case 'currency':
        case 'money': {
            const num = Number(v);
            if (!Number.isFinite(num)) return { text: String(v) };
            const rawPrecision = Number(field.type_config?.precision);
            const precision = Number.isFinite(rawPrecision) ? rawPrecision : 2;
            return {
                text: num.toFixed(precision),
                number: num,
                currencyCode: String(field.type_config?.currency_type || ''),
                precision
            };
        }
        case 'number': {
            const num = Number(v);
            if (!Number.isFinite(num)) return { text: String(v) };
            return { text: String(v), number: num };
        }
        case 'checkbox':
            return { text: v === true || v === 'true' ? 'TRUE' : 'FALSE' };
        default: {
            let text: string;
            if (Array.isArray(v)) {
                text = v.map((x: any) => x.name || x.label || x).join(', ');
            } else if (typeof v === 'object') {
                text = v.name || v.formatted_address || JSON.stringify(v);
            } else {
                text = String(v);
            }
            return { text };
        }
    }
};

const DATE_FIELDS = new Set(['date_created', 'date_updated', 'due_date']);

// Column width heuristics (Excel character units)
const MIN_WIDTH = 10;
const MAX_WIDTH = 45;
const WRAP_THRESHOLD = 60; // values longer than this wrap instead of widening
const DATE_WIDTH = 17;

const CURRENCY_SYMBOLS: Record<string, string> = {
    USD: '$', CAD: '$', AUD: '$', NZD: '$', HKD: '$', SGD: '$', MXN: '$',
    EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹', KRW: '₩', CHF: 'CHF '
};

const currencyNumFmt = (code: string, precision: number): string => {
    const decimals = precision > 0 ? '.' + '0'.repeat(precision) : '';
    const symbol = CURRENCY_SYMBOLS[code];
    return symbol
        ? `"${symbol}"#,##0${decimals}`
        : `#,##0${decimals}${code ? `" ${code}"` : ''}`;
};

const customCell = (task: any, col: ColumnSpec): ExportCell | undefined =>
    task.custom_fields?.[col.title];

const cellString = (task: any, col: ColumnSpec): string => {
    if (col.custom) return customCell(task, col)?.text ?? '';
    const v = task[col.id];
    return v === null || v === undefined ? '' : String(v);
};

/**
 * Builds a formatted Excel workbook from flattened task rows:
 * styled + frozen header row with autofilter, sensible column widths,
 * wrapped long-text columns, real date/currency/number cells (from ClickUp's
 * declared field types), clickable task URLs, and everything else kept as
 * text (no 1.62E+09 mangling of ID-like values).
 */
export const buildTaskWorkbook = async (
    listName: string,
    columns: ColumnSpec[],
    tasks: any[]
): Promise<Buffer> => {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();

    // Sheet names: max 31 chars, no []:*?/\
    const sheetName = (listName || 'Tasks').replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Tasks';
    const ws = workbook.addWorksheet(sheetName, {
        views: [{ state: 'frozen', ySplit: 1 }]
    });

    // Header row
    const header = ws.addRow(columns.map(c => c.title));
    header.font = { bold: true };
    header.alignment = { vertical: 'middle' };
    header.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
    });
    ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length }
    };

    // Data rows
    for (const task of tasks) {
        const row = ws.addRow(columns.map(col => {
            if (col.custom) {
                const cell = customCell(task, col);
                if (!cell || cell.text === '') return '';
                if (cell.date) return cell.date;
                if (cell.number !== undefined) return cell.number;
                return cell.text;
            }
            const raw = cellString(task, col);
            if (!raw) return '';
            if (DATE_FIELDS.has(col.id)) return wallClockDate(new Date(raw));
            if (col.id === 'url') return { text: raw, hyperlink: raw };
            // Everything else stays a string — protects IDs like parcel
            // numbers from scientific-notation coercion.
            return raw;
        }));
        row.alignment = { vertical: 'top' };
        // Style URL cells like links
        columns.forEach((col, i) => {
            if (!col.custom && col.id === 'url' && cellString(task, col)) {
                row.getCell(i + 1).font = { color: { argb: 'FF3366CC' }, underline: true };
            }
        });
    }

    // Column sizing, wrapping, and number formats
    columns.forEach((col, i) => {
        const column = ws.getColumn(i + 1);

        // Uniform per-column formats for typed custom fields, derived from the
        // first populated cell (all cells in a column share one field type)
        let dateFmt: string | null = null;
        let numFmtStr: string | null = null;
        if (col.custom) {
            let anyTime = false;
            for (const task of tasks) {
                const cell = customCell(task, col);
                if (!cell || cell.text === '') continue;
                if (cell.date) {
                    dateFmt = 'yyyy-mm-dd';
                    if (cell.hasTime) anyTime = true;
                } else if (cell.currencyCode !== undefined) {
                    numFmtStr = currencyNumFmt(cell.currencyCode, cell.precision ?? 2);
                    break;
                } else {
                    break;
                }
            }
            if (dateFmt && anyTime) dateFmt = 'yyyy-mm-dd hh:mm';
        }

        let maxLen = col.title.length;
        for (const task of tasks) {
            const len = cellString(task, col).length;
            if (len > maxLen) maxLen = len;
        }

        if (!col.custom && DATE_FIELDS.has(col.id)) {
            column.width = DATE_WIDTH;
            column.numFmt = 'yyyy-mm-dd hh:mm';
        } else if (dateFmt) {
            column.width = Math.max(DATE_WIDTH, col.title.length + 2);
            column.numFmt = dateFmt;
        } else if (numFmtStr) {
            column.width = Math.min(Math.max(maxLen + 4, MIN_WIDTH), MAX_WIDTH);
            column.numFmt = numFmtStr;
        } else if (maxLen > WRAP_THRESHOLD) {
            column.width = MAX_WIDTH;
            column.alignment = { vertical: 'top', wrapText: true };
        } else {
            column.width = Math.min(Math.max(maxLen + 2, MIN_WIDTH), MAX_WIDTH);
        }
    });

    // Column-level alignment overwrote the header's; restore it
    header.font = { bold: true };
    header.alignment = { vertical: 'middle', wrapText: false };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};
