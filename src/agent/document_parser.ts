import axios from 'axios';

export interface DocumentPart {
  type: 'text' | 'image';
  content: string; // Actual text OR base64 data for image
  mimeType?: string;
}

export async function parseDocument(fileUrl: string, mimeType: string, fileName: string): Promise<DocumentPart[]> {
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data);
  const parts: DocumentPart[] = [];

  try {
    if (mimeType === 'application/pdf') {
       /* @ts-ignore */
       const lib: any = await import('pdf-parse');
       const parser = lib.default || lib;
       const data = await parser(buffer);
       parts.push({ type: 'text', content: data.text });
       return parts;
    } 
    
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
       /* @ts-ignore */
       const lib: any = await import('mammoth');
       const mammoth = lib.default || lib;
       
       const images: DocumentPart[] = [];
       const options = {
           convertImage: (mammoth.images as any).inline((element: any) => {
               return element.read("base64").then((imageBuffer: string) => {
                   images.push({ 
                       type: 'image', 
                       content: imageBuffer,
                       mimeType: element.contentType
                   });
                   return {
                       src: `[IMAGE_PLACEHOLDER_${images.length - 1}]`
                   };
               });
           })
       };

       const result = await (mammoth as any).convertToMarkdown({ buffer }, options);
       parts.push({ type: 'text', content: result.value });
       
       // Return interleaved or just append
       return [...parts, ...images];
    }
    
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) {
       /* @ts-ignore */
       const xlsx: any = await import('xlsx');
       const workbook = xlsx.read(buffer, { type: 'buffer' });
       let text = '';
       for (const sheetName of workbook.SheetNames) {
           text += `--- Sheet: ${sheetName} ---\n`;
           const sheet = workbook.Sheets[sheetName];
           text += xlsx.utils.sheet_to_csv(sheet) + '\n';
       }
       parts.push({ type: 'text', content: text });
       return parts;
    }

    if (mimeType.startsWith('text/') || fileName.endsWith('.txt') || fileName.endsWith('.md')) {
        parts.push({ type: 'text', content: buffer.toString('utf-8') });
        return parts;
    }

    parts.push({ type: 'text', content: `[Unsupported document type: ${fileName} (${mimeType})]` });
    return parts;
  } catch (e: any) {
    console.error(`[Document Parser Error] ${e.message}`);
    return [{ type: 'text', content: `[Error parsing document: ${e.message}]` }];
  }
}
