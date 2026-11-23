import { PDFParse } from "pdf-parse";

/**
 * Readable text from a reference PDF buffer (including FlateDecode / Identity-H
 * DejaVu output from PDFKit). Used so compressed PDFs cannot pass presence or
 * absence assertions on opaque bytes alone.
 */
export async function extractPdfText(bytes: Buffer | Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: Uint8Array.from(bytes) });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}
