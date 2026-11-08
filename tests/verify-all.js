const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { PDFDocument } = require('pdf-lib');

const db = require('../services/db');
const { processPdfFile } = require('../services/pdfProcessor');
const { signReceipt } = require('../services/signer');

// Imagen PNG transparente simulando trazo de firma (1x1 transparente o pequeña firma)
const SAMPLE_PNG_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAAAyCAYAAAC37w0xAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACOSURBVHgB7dAxEQAgDMAw7N8ZG1hBg0U4aZve2T2e9kIeQpYQsoSQJYQsIWQJIUsIWULIEkKWELKEkCWEfC/g3s98yBJCliCEkCWELCFkCSFLEELIEkKWELKEkCWELCFkCSFLEELIEkKWELKEkCWEfC/g3s98yBJCliCEkCWELCFkCSFLEELIEkKWELKEkCWEfO+qHgFfHkKzwwAAAABJRU5ErkJggg==';

async function runTests() {
    console.log('====================================================');
    console.log('  INICIANDO SUITE DE PRUEBAS INTEGRAL DE VALIDACIÓN');
    console.log('====================================================\n');

    const samplePdfPath = path.resolve(__dirname, '../../App cortar recibos de sueldo/SUELDOS 07 2026.pdf');
    if (!fs.existsSync(samplePdfPath)) {
        throw new Error('No se encontró el PDF de prueba en: ' + samplePdfPath);
    }
    console.log(`[1/6] PDF de prueba localizado: ${samplePdfPath}`);

    // Limpiar DB de prueba
    db.clear();
    assert.strictEqual(db.getAll().length, 0, 'La base de datos debería estar vacía antes de iniciar');
    console.log('[2/6] Base de datos reiniciada limpiamente.');

    // Procesar PDF de prueba (55 páginas)
    console.log('[3/6] Procesando y dividiendo PDF de 55 páginas...');
    const startTime = Date.now();
    const receipts = await processPdfFile(samplePdfPath);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`      ✓ Procesadas ${receipts.length} páginas en ${duration}s.`);
    assert.strictEqual(receipts.length, 55, `Se esperaban 55 recibos cortados pero se obtuvieron ${receipts.length}`);

    // Verificar que los archivos físicos existan en storage/receipts
    const receiptsDir = path.join(__dirname, '../storage/receipts');
    for (const r of receipts) {
        const filePath = path.join(receiptsDir, r.filename);
        assert.ok(fs.existsSync(filePath), `El archivo PDF cortado ${r.filename} no existe en disco.`);
    }
    console.log('      ✓ Todos los 55 archivos PDF individuales existen físicamente en disco.');

    // Guardar en DB
    db.addMany(receipts);
    assert.strictEqual(db.getAll().length, 55, 'La base de datos debe contener 55 recibos.');
    console.log('      ✓ Los 55 recibos fueron persistidos en la base de datos.');

    // [4/6] Probar búsquedas del empleado
    console.log('\n[4/6] Probando búsquedas del empleado en el portal...');
    
    // Búsqueda por DNI (primer empleado: D EMILIO OSCAR con CUIL 20-13780044-7 -> DNI 13780044)
    const byDni = db.searchByEmployee('13780044');
    assert.ok(byDni.length >= 1, 'Debe encontrar al empleado por DNI 13780044');
    assert.strictEqual(byDni[0].name, 'D EMILIO OSCAR');
    console.log(`      ✓ Búsqueda por DNI '13780044': Encontrado '${byDni[0].name}' (CUIL: ${byDni[0].cuil})`);

    // Búsqueda por CUIL con guiones
    const byCuil = db.searchByEmployee('20-13780044-7');
    assert.ok(byCuil.length >= 1, 'Debe encontrar por CUIL con guiones');
    console.log(`      ✓ Búsqueda por CUIL con guiones: Encontrado correctamente.`);

    // Búsqueda por CUIL sin guiones
    const byCuilNoDash = db.searchByEmployee('20137800447');
    assert.ok(byCuilNoDash.length >= 1, 'Debe encontrar por CUIL sin guiones');
    console.log(`      ✓ Búsqueda por CUIL limpio sin guiones: Encontrado correctamente.`);

    // Búsqueda por Nombre parcial
    const byName = db.searchByEmployee('IBARRA');
    assert.ok(byName.length >= 1, 'Debe encontrar por nombre IBARRA');
    console.log(`      ✓ Búsqueda por nombre 'IBARRA': Encontrado '${byName[0].name}'`);

    // [5/6] Probar proceso de firma digital
    console.log('\n[5/6] Probando firma digital del recibo...');
    const receiptToSign = byDni[0];
    assert.strictEqual(receiptToSign.status, 'Pendiente', 'El estado inicial debe ser Pendiente');

    const signResult = await signReceipt(receiptToSign, SAMPLE_PNG_BASE64, {
        ip: '127.0.0.1',
        userAgent: 'Automated-Test-Runner'
    });

    assert.ok(signResult.signedFile, 'Debe retornar el nombre del archivo firmado');
    assert.ok(signResult.signedAt, 'Debe registrar la fecha y hora de firma');
    assert.ok(signResult.signatureMetadata.hash, 'Debe generar el hash de seguridad criptográfico');

    const signedDir = path.join(__dirname, '../storage/signed');
    const signedPath = path.join(signedDir, signResult.signedFile);
    assert.ok(fs.existsSync(signedPath), 'El archivo PDF firmado debe existir físicamente en disco');

    // Verificar que el PDF firmado sea un PDF válido y tenga al menos 1 página
    const signedBytes = fs.readFileSync(signedPath);
    const signedPdfDoc = await PDFDocument.load(signedBytes);
    assert.strictEqual(signedPdfDoc.getPageCount(), 1, 'El recibo firmado debe tener exactamente 1 página');
    console.log(`      ✓ Recibo firmado generado con éxito: ${signResult.signedFile} (${signedBytes.length} bytes)`);
    console.log(`      ✓ Sello criptográfico SHA-256: ${signResult.signatureMetadata.hash}`);

    // Actualizar en DB
    db.update(receiptToSign.id, {
        status: 'Firmado',
        signedFile: signResult.signedFile,
        signedAt: signResult.signedAt,
        signatureMetadata: signResult.signatureMetadata
    });

    const updatedReceipt = db.getById(receiptToSign.id);
    assert.strictEqual(updatedReceipt.status, 'Firmado', 'El estado en la base de datos debe ser Firmado');

    // [6/6] Probar estadísticas de empresa
    console.log('\n[6/6] Verificando métricas de la empresa...');
    const stats = db.getStats();
    assert.strictEqual(stats.total, 55, 'Total debe ser 55');
    assert.strictEqual(stats.signed, 1, 'Firmados debe ser 1');
    assert.strictEqual(stats.pending, 54, 'Pendientes debe ser 54');
    assert.strictEqual(stats.percentage, 2, 'Porcentaje debe ser 2% (1/55)');
    console.log(`      ✓ Métricas: Total=${stats.total}, Firmados=${stats.signed}, Pendientes=${stats.pending}, Tasa=${stats.percentage}%`);

    console.log('\n====================================================');
    console.log('  ¡TODAS LAS PRUEBAS COMPLETADAS CON ÉXITO! (100%)');
    console.log('====================================================');
}

runTests().catch(err => {
    console.error('\n❌ ERROR EN LAS PRUEBAS:', err);
    process.exit(1);
});
