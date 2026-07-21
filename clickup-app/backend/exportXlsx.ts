import ExcelJS from 'exceljs';

export interface ColumnSpec {
    id: string;
    title: string;
    custom: boolean;
}

const DATE_FIELDS = new Set(['date_created', 'date_updated', 'due_date']);

// Column width heuristics (Excel character units)
const MIN_WIDTH = 10;
const MAX_WIDTH = 45;
const WRAP_THRESHOLD = 60; // values longer than this wrap instead of widening
const DATE_WIDTH = 17;

const cellString = (task: any, col: ColumnSpec): string => {
    const v = col.custom ? task.custom_fields?.[col.title] : task[col.id];
    return v === null || v === undefined ? '' : String(v);
};

/**
 * Builds a formatted Excel workbook from flattened task rows:
 * styled + frozen header row with autofilter, sensible column widths,
 * wrapped long-text columns, real date cells, clickable task URLs, and
 * ID-like values kept as text (no 1.62E+09 mangling).
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
            const raw = cellString(task, col);
            if (!raw) return '';
            if (!col.custom && DATE_FIELDS.has(col.id)) return new Date(raw);
            if (!col.custom && col.id === 'url') return { text: raw, hyperlink: raw };
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

    // Column sizing and wrapping
    columns.forEach((col, i) => {
        const column = ws.getColumn(i + 1);
        let maxLen = col.title.length;
        for (const task of tasks) {
            const len = cellString(task, col).length;
            if (len > maxLen) maxLen = len;
        }

        if (!col.custom && DATE_FIELDS.has(col.id)) {
            column.width = DATE_WIDTH;
            column.numFmt = 'yyyy-mm-dd hh:mm';
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
