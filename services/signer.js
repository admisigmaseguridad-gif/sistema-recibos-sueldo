const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const crypto = require('crypto');

async function signReceipt(receipt, signatureBase64, clientInfo = {}) {
    const receiptsDir = path.join(__dirname, '..', 'storage', 'receipts');
    const signedDir = path.join(__dirname, '..', 'storage', 'signed');
    
    if (!fs.existsSync(signedDir)) {
        fs.mkdirSync(signedDir, { recursive: true });
    }

    const inputPath = path.join(receiptsDir, receipt.filename);
    if (!fs.existsSync(inputPath)) {
        throw new Error(`El archivo original del recibo no existe: ${receipt.filename}`);
    }

    const originalBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(originalBytes);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width: pageWidth, height: pageHeight } = firstPage.getSize();

    // Limpiar data URL base64
    const cleanBase64 = signatureBase64.replace(/^data:image\/png;base64,/, '');
    const signatureBuffer = Buffer.from(cleanBase64, 'base64');

    // Incrustar imagen de firma
    const signatureImage = await pdfDoc.embedPng(signatureBuffer);
    
    // Escalar la imagen de la firma manteniendo proporción
    const desiredSignatureWidth = 140;
    const scale = desiredSignatureWidth / signatureImage.width;
    const sigDims = {
        width: desiredSignatureWidth,
        height: Math.min(signatureImage.height * scale, 65)
    };

    // Coordenadas calculadas
    let sigX = pageWidth - 220;
    let sigY = 55;
    let stampX = pageWidth - 250;
    let stampY = 25;

    if (receipt.signatureCoords && receipt.signatureCoords.found) {
        const coords = receipt.signatureCoords;
        // pdf-lib tiene el origen abajo a la izquierda; pdf.js-extract mide desde arriba
        const convertedY = pageHeight - coords.pdfJsY;
        
        // Centramos sobre el texto "Firma Empleado"
        sigX = Math.max(20, Math.min(coords.pdfJsX - 35, pageWidth - sigDims.width - 20));
        sigY = Math.max(35, convertedY + 8); // Justo arriba de la línea/texto
        stampX = Math.max(20, sigX - 20);
        stampY = Math.max(12, convertedY - 14);
    }

    // Dibujar la firma manuscrita
    firstPage.drawImage(signatureImage, {
        x: sigX,
        y: sigY,
        width: sigDims.width,
        height: sigDims.height,
    });

    // Cargar fuentes para el sello digital
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const now = new Date();
    const formattedDate = now.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    const formattedTime = now.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    // Hash de comprobación de integridad
    const signatureHash = crypto.createHash('sha256')
        .update(signatureBuffer)
        .digest('hex')
        .substring(0, 16)
        .toUpperCase();

    // Dibujar sello digital de verificación completo con todos los datos legales y laborales
    const legajoText = receipt.legajo && receipt.legajo !== '-' ? `  |  LEGAJO: ${receipt.legajo}` : '';
    const dniText = receipt.dni && receipt.dni !== '-' ? ` (DNI: ${receipt.dni})` : '';
    const periodText = receipt.period && receipt.period !== 'Desconocido' ? `  |  PERÍODO: ${receipt.period}` : '';

    // Línea 1: Identidad del empleado
    firstPage.drawText(`FIRMADO DIGITALMENTE POR: ${receipt.name}${legajoText}`, {
        x: stampX,
        y: stampY,
        size: 6.5,
        font: helveticaBold,
        color: rgb(0.08, 0.42, 0.22), // Verde esmeralda profesional
    });

    // Línea 2: CUIL, DNI y Período
    firstPage.drawText(`C.U.I.L.: ${receipt.cuil}${dniText}${periodText}`, {
        x: stampX,
        y: stampY - 8,
        size: 5.5,
        font: helvetica,
        color: rgb(0.15, 0.15, 0.15),
    });

    // Línea 3: Constancia legal de conformidad, fecha y hash criptográfico
    firstPage.drawText(`CONSTANCIA DE CONFORMIDAD  |  ${formattedDate} ${formattedTime}  |  HASH: [${signatureHash}]`, {
        x: stampX,
        y: stampY - 15,
        size: 5,
        font: helvetica,
        color: rgb(0.35, 0.35, 0.35),
    });

    const signedPdfBytes = await pdfDoc.save();
    
    // Nombre del archivo firmado
    const signedFilename = `FIRMADO_${receipt.filename}`;
    const outputPath = path.join(signedDir, signedFilename);
    fs.writeFileSync(outputPath, signedPdfBytes);

    return {
        signedFile: signedFilename,
        signedAt: now.toISOString(),
        signatureMetadata: {
            signedDate: `${formattedDate} ${formattedTime}`,
            hash: signatureHash,
            ip: clientInfo.ip || 'Local',
            userAgent: clientInfo.userAgent || 'Web'
        }
    };
}

module.exports = {
    signReceipt
};
