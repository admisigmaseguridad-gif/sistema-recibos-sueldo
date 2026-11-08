const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { PDFExtract } = require('pdf.js-extract');
const { v4: uuidv4 } = require('uuid');

const extractor = new PDFExtract();

async function processPdfFile(inputPdfPath) {
    if (!fs.existsSync(inputPdfPath)) {
        throw new Error('El archivo PDF especificado no existe.');
    }

    const receiptsDir = path.join(__dirname, '..', 'storage', 'receipts');
    if (!fs.existsSync(receiptsDir)) {
        fs.mkdirSync(receiptsDir, { recursive: true });
    }

    // 1. Extraer estructura de texto con PDFExtract
    const extractData = await new Promise((resolve, reject) => {
        extractor.extract(inputPdfPath, {}, (err, data) => {
            if (err) return reject(err);
            resolve(data);
        });
    });

    // 2. Cargar documento original con PDF-Lib
    const originalPdfBytes = fs.readFileSync(inputPdfPath);
    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    const totalPages = pdfDoc.getPageCount();

    // Detección de período por nombre de archivo como fallback confiable
    const baseFilename = path.basename(inputPdfPath);
    let fallbackPeriod = '';
    const fnMatch = baseFilename.match(/(\d{1,2})[_\s-](\d{2,4})/);
    if (fnMatch) {
        const m = fnMatch[1].padStart(2, '0');
        let y = fnMatch[2];
        if (y.length === 2) y = '20' + y;
        fallbackPeriod = `${m}/${y}`;
    }

    const processedReceipts = [];

    for (let i = 0; i < totalPages; i++) {
        const pageData = extractData.pages[i] || { content: [] };
        const items = pageData.content || [];
        const fullText = items.map(c => c.str).join(' ');

        // 1. Extracción de CUIL (priorizamos 20, 23, 24, 27 para empleado, excluyendo 30 que es empresa)
        let cuil = '';
        let dni = '';
        const employeeCuilMatch = fullText.match(/\b(20|23|24|27)[-.\s]?\d{8}[-.\s]?\d\b/);
        if (employeeCuilMatch) {
            const rawCuil = employeeCuilMatch[0].replace(/[-.\s]/g, '');
            cuil = `${rawCuil.substring(0, 2)}-${rawCuil.substring(2, 10)}-${rawCuil.substring(10, 11)}`;
            dni = rawCuil.substring(2, 10);
        } else {
            const genericCuil = fullText.match(/\b\d{2}[-.\s]?\d{8}[-.\s]?\d\b/);
            if (genericCuil) {
                const raw = genericCuil[0].replace(/[-.\s]/g, '');
                cuil = `${raw.substring(0, 2)}-${raw.substring(2, 10)}-${raw.substring(10, 11)}`;
                dni = raw.substring(2, 10);
            }
        }

        let name = '';
        let legajo = '';
        let period = '';

        // ESTRATEGIA A: FORMATO CON TABLA MODERNA (Q. MES AÑO APELLIDO Y NOMBRE Nro. DE LEGAJO)
        const isTableFormatB = items.some(it => /Nro\.?\s*DE\s*LEGAJO/i.test(it.str));
        if (isTableFormatB) {
            const row79 = items.filter(it => it.y >= 70 && it.y <= 85 && it.str && it.str.trim());
            const nameItem = row79.find(it => it.x >= 120 && it.x < 315 && it.str.trim() && !/^\d+$/.test(it.str.trim()) && !/^\$/.test(it.str.trim()) && !/C\.U\.I\.L/i.test(it.str));
            const legajoItem = row79.find(it => it.x >= 310 && it.x <= 365 && /^\d+$/.test(it.str.trim()));
            const mesItem = row79.find(it => it.x >= 50 && it.x < 80 && /^\d{1,2}$/.test(it.str.trim()));
            const anioItem = row79.find(it => it.x >= 80 && it.x < 115 && /^\d{4}$/.test(it.str.trim()));

            if (nameItem) name = nameItem.str.trim();
            if (legajoItem) legajo = legajoItem.str.trim();
            if (mesItem && anioItem) period = `${mesItem.str.trim().padStart(2, '0')}/${anioItem.str.trim()}`;
        }

        // ESTRATEGIA B: FORMATO TRADICIONAL POR COORDENADAS (Legajo y Apellido y Nombres en fila y=90..105)
        if (!name) {
            const nameItemTrad = items.find(it => it.y >= 92 && it.y <= 106 && it.x >= 35 && it.x <= 135 && it.str.trim() && !/^\d+$/.test(it.str.trim()) && !/\//.test(it.str.trim()) && !/C\.U\.I\.L/i.test(it.str));
            const legajoItemTrad = items.find(it => it.y >= 92 && it.y <= 106 && it.x >= 5 && it.x <= 32 && /^\d+$/.test(it.str.trim()));
            if (nameItemTrad) name = nameItemTrad.str.trim();
            if (legajoItemTrad && !legajo) legajo = legajoItemTrad.str.trim();
        }

        // ESTRATEGIA C: PARSEO POR PATRONES DE TEXTO DIRECTOS
        if (!name) {
            const nameMatch1 = fullText.match(/\/\s*\/\s*(.*?)\s+C\.U\.I\.L\./i);
            const nameMatch2 = fullText.match(/Legajo\s*\d+\s*(?:\/\s*)+\s*(.*?)\s+C\.U\.I\.L\./i);
            const nameMatch3 = fullText.match(/Apellido y Nombres\s*:?\s*([A-ZÁÉÍÓÚÑa-záéíóúñ\s,]+?)(?=\s+C\.U\.I\.L|\s+Legajo|\s+Categor)/i);

            if (nameMatch1 && nameMatch1[1].trim()) {
                name = nameMatch1[1].trim();
            } else if (nameMatch2 && nameMatch2[1].trim()) {
                name = nameMatch2[1].trim();
            } else if (nameMatch3 && nameMatch3[1].trim()) {
                name = nameMatch3[1].trim();
            }
        }

        if (!name) {
            name = `Empleado Pág ${i + 1}`;
        }
        name = name.replace(/^[\s/|-]+|[\s/|-]+$/g, '').trim();

        // Legajo fallback
        if (!legajo) {
            const legajoMatch = fullText.match(/Legajo\s*[:#]?\s*(\d+)/i) || fullText.match(/Nro\.?\s*DE\s*LEGAJO\s*[:#]?\s*(\d+)/i);
            if (legajoMatch) {
                legajo = legajoMatch[1].trim();
            }
        }

        // Período fallback
        if (!period) {
            const periodMatch = fullText.match(/Per[íi]odo:\s*([^\n\r]+?)(?=\s+\$|\s+VGP|\s+RECIBO|\s+Categor|\s*\n|$)/i)
                             || fullText.match(/Per[íi]odo[^0-9]*((?:0[1-9]|1[0-2])\/\d{4})/i)
                             || fullText.match(/\b(?:0[1-9]|1[0-2])\/\d{4}\b/)
                             || fullText.match(/MES\s*[:#]?\s*(\d{1,2})\s*AÑO\s*[:#]?\s*(20\d{2})/i);
            if (periodMatch) {
                if (periodMatch[1] && periodMatch[2]) {
                    period = `${periodMatch[1].padStart(2, '0')}/${periodMatch[2]}`;
                } else {
                    period = (periodMatch[1] || periodMatch[0]).trim();
                }
            }
        }
        if (!period || period === 'Desconocido') {
            period = fallbackPeriod || '10/2026';
        }

        // Extracción de Empresa
        let company = 'SIGMA SEGURIDAD SRL';
        const companyMatch = fullText.match(/([A-Z0-9\s.,-]+(?:S\.R\.L\.|S\.A\.|S\.A\.S\.|SRL|SA))\b/i);
        if (companyMatch) {
            company = companyMatch[1].trim();
        }

        // Detección de coordenadas de la zona de firma
        let signatureCoords = null;
        const pageInfo = pageData.pageInfo || { width: 842, height: 595 };
        const firmaItem = items.find(item => /Firma Empleado/i.test(item.str)) 
                       || items.find(item => /Recibí el importe/i.test(item.str));

        if (firmaItem) {
            signatureCoords = {
                found: true,
                pdfJsX: firmaItem.x,
                pdfJsY: firmaItem.y,
                width: firmaItem.width,
                height: firmaItem.height,
                pageWidth: pageInfo.width,
                pageHeight: pageInfo.height
            };
        } else {
            signatureCoords = {
                found: false,
                pageWidth: pageInfo.width,
                pageHeight: pageInfo.height
            };
        }

        // Generar archivo PDF de una sola página
        const singlePdf = await PDFDocument.create();
        const [copiedPage] = await singlePdf.copyPages(pdfDoc, [i]);
        singlePdf.addPage(copiedPage);
        const singlePdfBytes = await singlePdf.save();

        const safeName = name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
        const safePeriod = period.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_');
        const receiptId = uuidv4();
        
        let outputFilename = `${legajo ? legajo + '_' : ''}${safeName}_${safePeriod}.pdf`;
        let outputPath = path.join(receiptsDir, outputFilename);

        // Si ya existe uno con el mismo nombre, le anexamos un fragmento de UUID para no colisionar
        if (fs.existsSync(outputPath)) {
            outputFilename = `${legajo ? legajo + '_' : ''}${safeName}_${safePeriod}_${receiptId.substring(0, 6)}.pdf`;
            outputPath = path.join(receiptsDir, outputFilename);
        }

        fs.writeFileSync(outputPath, singlePdfBytes);

        processedReceipts.push({
            id: receiptId,
            page: i + 1,
            legajo: legajo || '-',
            name: name,
            cuil: cuil || 'Sin CUIL',
            dni: dni || (cuil ? cuil.replace(/\D/g, '') : '-'),
            period: period,
            company: company,
            filename: outputFilename,
            originalSize: singlePdfBytes.length,
            status: 'Pendiente',
            createdAt: new Date().toISOString(),
            signatureCoords: signatureCoords,
            signedFile: null,
            signedAt: null,
            signatureMetadata: null
        });
    }

    return processedReceipts;
}

module.exports = {
    processPdfFile
};
