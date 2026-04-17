// @ts-ignore - no bundled types for the inner entry point
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { readFileSync } from "fs";

export interface ExtractedPdf {
  totalPages: number;
  pages: string[];
  fullText: string;
}

export async function extractPdf(path: string): Promise<ExtractedPdf> {
  const buf = readFileSync(path);
  const pages: string[] = [];

  async function pagerender(pageData: any): Promise<string> {
    const textContent = await pageData.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });

    let text = "";
    let lastY: number | null = null;
    for (const item of textContent.items) {
      const y = item.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 4) {
        text += "\n";
      }
      text += item.str ?? "";
      if (item.hasEOL || (item.str && !item.str.endsWith(" "))) text += " ";
      if (y !== undefined) lastY = y;
    }
    const clean = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    pages.push(clean);
    return clean;
  }

  const data = await pdfParse(buf, { pagerender });

  return {
    totalPages: data.numpages ?? pages.length,
    pages,
    fullText: data.text ?? pages.join("\n\n"),
  };
}
