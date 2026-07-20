import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import path from 'path';
import util from 'util';
import { fileURLToPath } from 'url';

const execPromise = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LATEX_DIR = path.join(__dirname, 'latex');
const TEMPLATE_FILE = path.join(LATEX_DIR, 'template.tex');

/**
 * Generates a unique PDF path
 * @returns Path to generated PDF
 */
const generateUniquePdfPath = (workDir: string, data: any): string => {
    // Clean the title to be filesystem safe
    const safeTitle = data.title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
    
    // Check if date_ordered is valid, otherwise use current date
    let date;
    if (!data.date_ordered || data.date_ordered === "—") {
        // Generate current date in mm-dd-yyyy format
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const year = now.getFullYear();
        date = `${month}-${day}-${year}`;
    } else {
        date = data.date_ordered.replace(/\//g, '-');
    }
    
    return path.join(workDir, `${safeTitle}_${date}.pdf`);
};

/**
 * Generates a PDF from LaTeX template
 * @param data Object containing order details
 * @returns Path to generated PDF
 */
export const generatePdf = async (data: any): Promise<string> => {
    // Each request gets its own working directory so concurrent generations
    // can't clobber each other's output.tex/output.pdf. The caller is
    // responsible for removing the directory once the PDF has been sent.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-pdf-'));
    const outputTex = path.join(workDir, 'output.tex');
    try {
        console.log("Processing LaTeX template...");

        // Ensure date_ordered is valid, set to current date if not
        if (!data.date_ordered || data.date_ordered === "—") {
            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const year = now.getFullYear();
            data.date_ordered = `${month}/${day}/${year}`;
        }

        // Read LaTeX template
        let latexTemplate = fs.readFileSync(TEMPLATE_FILE, 'utf8');

        // Log the generated parcel table rows
        const parcelTableRows = formatParcelTable(data.parcels);
        console.log("Generated LaTeX parcel table rows:\n", parcelTableRows);

        // Replace placeholders with escaped data
        latexTemplate = latexTemplate
            .replace('{{title}}', escapeLatex(data.title))
            .replace('{{date_ordered}}', escapeLatex(data.date_ordered))
            .replace('{{title_scope_items}}', formatScopeItems(data.title_scope_items))
            .replace('{{er_items}}', formatScopeItems(data.er_items))
            .replace('{{include_property_profile}}', escapeLatex(data.include_property_profile))
            .replace('{{delivery_instructions}}', formatLatexMultiline(data.delivery_instructions))
            .replace('{{delivery_email}}', escapeLatex(data.delivery_email))
            .replace('{{parcels}}', parcelTableRows);

        // Log the full LaTeX template
        console.log("Full LaTeX template to be compiled:\n", latexTemplate);

        // Write the processed template
        fs.writeFileSync(outputTex, latexTemplate);

        console.log("Running pdflatex (pass 1)...");
        await execPromise(`pdflatex -interaction=nonstopmode -output-directory=${workDir} ${outputTex}`);

        console.log("Running pdflatex (pass 2)...");
        await execPromise(`pdflatex -interaction=nonstopmode -output-directory=${workDir} ${outputTex}`);

        // Generate unique filename and copy the PDF
        const uniquePdfPath = generateUniquePdfPath(workDir, data);
        fs.copyFileSync(path.join(workDir, 'output.pdf'), uniquePdfPath);

        if (!fs.existsSync(uniquePdfPath)) {
            throw new Error("PDF was not generated.");
        }

        console.log("PDF generated successfully:", uniquePdfPath);
        return uniquePdfPath;
    } catch (error) {
        console.error('Error generating PDF:', error);
        // Log the LaTeX source for inspection if it failed
        try {
            if (fs.existsSync(outputTex)) {
                console.error('Failed LaTeX source:\n', fs.readFileSync(outputTex, 'utf8'));
            }
        } catch (readErr) {
            console.error('Failed to read failed LaTeX file:', readErr);
        }
        // Clean up the working directory on failure
        fs.rmSync(workDir, { recursive: true, force: true });
        throw new Error('Failed to generate PDF');
    }
};

/**
 * Escapes LaTeX special characters
 */
const escapeLatex = (text: string): string => {
    if (!text) return "—";
    return text
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/&/g, '\\&')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
        .replace(/\$/g, '\\$')
        .replace(/#/g, '\\#')
        .replace(/{/g, '\\{')
        .replace(/}/g, '\\}')
        .replace(/~/g, '\\textasciitilde{}')
        .replace(/\^/g, '\\textasciicircum{}')
        .replace(/\n/g, '\\newline ');
};

// URLs are interpolated into \href{} where escaping can't make arbitrary
// input safe (e.g. "}" breaks out of the argument), so instead only accept
// ClickUp task URLs and drop anything else.
const SAFE_CLICKUP_URL = /^https:\/\/app\.clickup\.com\/t\/[A-Za-z0-9_-]+$/;
const safeLatexUrl = (url: string): string =>
    url && SAFE_CLICKUP_URL.test(url) ? url : '';

/**
 * Formats multiline text for LaTeX
 */
const formatLatexMultiline = (text: string): string => {
    // Remove leading and trailing newlines
    text = text.trim();
    return escapeLatex(text).replace(/\n/g, " \\\\\\ "); // Convert newlines into LaTeX line breaks
};

/**
 * Formats parcel data into LaTeX table rows
 */
const formatParcelTable = (parcels: any[]): string => {
    if (!parcels || parcels.length === 0) return "No parcels found. \\ \hline";
    return parcels.map((p, i) => {
        const name = escapeLatex(p.name || '—');
        const url = safeLatexUrl(p.url);
        const nameCell = url ? `\\href{${url}}{${name}}` : name;
        const row = `${nameCell} & ${escapeLatex(p.parcel_id || '—')} & ${escapeLatex(p.address || '—')} & ${escapeLatex(p.county_st || '—')}`;
        // Add \\ \hline to all the rows
        return i < parcels.length ? `${row} \\\\ \\hline` : row;
    }).join('\n');
};

/**
 * Formats scope items (Title Scope or E&Rs) into LaTeX format
 */
const formatScopeItems = (items: Array<{name: string, description: string}>): string => {
    if (!items || items.length === 0) return "—";
    return items.map(item => {
        // Clean up the input text by replacing newlines with spaces and trimming
        const name = (item.name || '').replace(/\r?\n/g, ' ').trim();
        const description = item.description ? (item.description).replace(/\r?\n/g, ' ').trim() : '';
        
        return `\\textbf{${escapeLatex(name)}}${description ? `: ${escapeLatex(description)}` : ''}`;
    }).join('\\newline ').trim();
};

