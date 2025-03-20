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
const OUTPUT_PDF = path.join(LATEX_DIR, 'output.pdf');

/**
 * Generates a PDF from LaTeX template
 * @param data Object containing order details
 * @returns Path to generated PDF
 */
export const generatePdf = async (data: any): Promise<string> => {
    try {
        console.log("Processing LaTeX template...");

        // Read LaTeX template
        let latexTemplate = fs.readFileSync(TEMPLATE_FILE, 'utf8');

        // Replace placeholders with escaped data
        latexTemplate = latexTemplate
            .replace('{{title}}', escapeLatex(data.title))
            .replace('{{date_ordered}}', escapeLatex(data.date_ordered))
            .replace('{{title_scope}}', escapeLatex(data.title_scope))
            .replace('{{ers}}', escapeLatex(data.ers))
            .replace('{{include_property_profile}}', escapeLatex(data.include_property_profile ? 'Yes' : 'No'))
            .replace('{{delivery_instructions}}', escapeLatex(data.delivery_instructions))
            .replace('{{delivery_email}}', escapeLatex(data.delivery_email))
            .replace('{{parcels}}', formatParcelTable(data.parcels));

        // Overwrite `output.tex` file to ensure LaTeX uses the updated data
        fs.writeFileSync(OUTPUT_TEX, latexTemplate);

        console.log("Running pdflatex...");
        await execPromise(`pdflatex -output-directory=${LATEX_DIR} ${OUTPUT_TEX}`);

        if (!fs.existsSync(OUTPUT_PDF)) {
            throw new Error("PDF was not generated.");
        }

        console.log("PDF generated successfully:", OUTPUT_PDF);
        return OUTPUT_PDF;
    } catch (error) {
        console.error('Error generating PDF:', error);
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


/**
 * Formats multiline text for LaTeX
 */
const formatLatexMultiline = (text: string): string => {
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

