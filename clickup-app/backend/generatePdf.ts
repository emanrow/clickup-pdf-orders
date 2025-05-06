import fs from 'fs';
import { exec } from 'child_process';
import path from 'path';
import util from 'util';
import { fileURLToPath } from 'url';

const execPromise = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LATEX_DIR = path.join(__dirname, 'latex');
const TEMPLATE_FILE = path.join(LATEX_DIR, 'template.tex');
const OUTPUT_TEX = path.join(LATEX_DIR, 'output.tex');

/**
 * Generates a unique PDF path
 * @returns Path to generated PDF
 */
const generateUniquePdfPath = (data: any): string => {
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
    
    return path.join(LATEX_DIR, `${safeTitle}_${date}.pdf`);
};

/**
 * Generates a PDF from LaTeX template
 * @param data Object containing order details
 * @returns Path to generated PDF
 */
export const generatePdf = async (data: any): Promise<string> => {
    let uniquePdfPath = '';
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

        // Replace placeholders with escaped data
        latexTemplate = latexTemplate
            .replace('{{title}}', escapeLatex(data.title))
            .replace('{{date_ordered}}', escapeLatex(data.date_ordered))
            .replace('{{title_scope_items}}', formatScopeItems(data.title_scope_items))
            .replace('{{er_items}}', formatScopeItems(data.er_items))
            .replace('{{include_property_profile}}', escapeLatex(data.include_property_profile))
            .replace('{{delivery_instructions}}', formatLatexMultiline(data.delivery_instructions))
            .replace('{{delivery_email}}', escapeLatex(data.delivery_email))
            .replace('{{parcels}}', formatParcelTable(data.parcels));

        // Write the processed template
        fs.writeFileSync(OUTPUT_TEX, latexTemplate);

        console.log("Running pdflatex...");
        await execPromise(`pdflatex -output-directory=${LATEX_DIR} ${OUTPUT_TEX}`);

        // Generate unique filename and copy the PDF
        uniquePdfPath = generateUniquePdfPath(data);
        fs.copyFileSync(path.join(LATEX_DIR, 'output.pdf'), uniquePdfPath);

        if (!fs.existsSync(uniquePdfPath)) {
            throw new Error("PDF was not generated.");
        }

        console.log("PDF generated successfully:", uniquePdfPath);
        return uniquePdfPath;
    } catch (error) {
        console.error('Error generating PDF:', error);
        // If we created a unique PDF but something else failed, clean it up
        if (uniquePdfPath && fs.existsSync(uniquePdfPath)) {
            fs.unlinkSync(uniquePdfPath);
        }
        throw new Error('Failed to generate PDF');
    } finally {
        // Clean up all temporary files
        const tempFiles = [
            'output.aux',
            'output.log',
            'output.pdf',
            'output.tex',
            'texput.log'
        ].map(f => path.join(LATEX_DIR, f));

        tempFiles.forEach(file => {
            try {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            } catch (err) {
                console.error(`Failed to delete temporary file ${file}:`, err);
            }
        });
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
    return parcels.map(p => 
        `${escapeLatex(p.name)} & ${escapeLatex(p.parcel_id)} & ${escapeLatex(p.address)} & ${escapeLatex(p.county_st)} \\\\ \\hline`
    ).join('\n');
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

