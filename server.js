const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const JSZip = require('jszip');

const db = require('./services/db');
const { processPdfFile } = require('./services/pdfProcessor');
const { signReceipt } = require('./services/signer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Servir frontend estático
app.use(express.static(path.join(__dirname, 'public')));

// Asegurar directorios de almacenamiento
const storageDirs = [
    path.join(__dirname, 'storage', 'uploads'),
    path.join(__dirname, 'storage', 'receipts'),
    path.join(__dirname, 'storage', 'signed')
];
storageDirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configuración de Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'storage', 'uploads'));
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}_${safeOriginal}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // hasta 50MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos en formato PDF'));
        }
    }
});

// Endpoint: Verificación de PIN para RRHH (Seguridad para acceso en la nube)
app.post('/api/auth/verify-pin', (req, res) => {
    const { pin } = req.body;
    const correctPin = process.env.ADMIN_PIN || '1234';
    if (pin && pin.toString().trim() === correctPin.toString().trim()) {
        return res.json({ success: true, message: 'Acceso autorizado' });
    }
    return res.status(401).json({ success: false, error: 'PIN de acceso incorrecto' });
});

// Endpoint: Subida y partición de PDF general por parte de la empresa
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se ha subido ningún archivo PDF.' });
        }

        const uploadedFilePath = req.file.path;
        console.log(`[Upload] Archivo recibido: ${req.file.originalname} (${req.file.size} bytes)`);

        // Procesar y dividir en páginas individuales
        const newReceipts = await processPdfFile(uploadedFilePath);
        
        // Guardar en la base de datos
        const addedCount = db.addMany(newReceipts);
        const stats = db.getStats();

        const hasScannedWithoutText = newReceipts.some(r => r.name.startsWith('Empleado Pág') || r.cuil === 'Sin CUIL');

        console.log(`[Upload] Procesadas ${newReceipts.length} páginas. Agregados ${addedCount} recibos nuevos.`);

        return res.json({
            success: true,
            message: `PDF procesado exitosamente. Se generaron ${newReceipts.length} recibos individuales.`,
            totalProcessed: newReceipts.length,
            addedCount: addedCount,
            receipts: newReceipts,
            stats: stats,
            hasScannedWithoutText: hasScannedWithoutText,
            notice: hasScannedWithoutText ? 'Se detectaron páginas que provienen de imágenes escaneadas sin texto digital directo. Podés verificar y editar los nombres y legajos en la tabla con el botón ✏️ Editar.' : null
        });
    } catch (error) {
        console.error('[Upload Error]', error);
        return res.status(500).json({
            error: 'Ocurrió un error al procesar el archivo PDF: ' + error.message
        });
    }
});

// Endpoint: Listado de todos los recibos (Panel Empresa)
app.get('/api/receipts', (req, res) => {
    const { status, search, period } = req.query;
    let list = db.getAll();

    if (status) {
        list = list.filter(r => r.status.toLowerCase() === status.toLowerCase());
    }

    if (period) {
        list = list.filter(r => r.period === period);
    }

    if (search) {
        const s = search.toLowerCase();
        list = list.filter(r => 
            (r.name && r.name.toLowerCase().includes(s)) ||
            (r.cuil && r.cuil.toLowerCase().includes(s)) ||
            (r.legajo && r.legajo.toLowerCase().includes(s)) ||
            (r.dni && r.dni.includes(s))
        );
    }

    res.json({
        total: list.length,
        receipts: list,
        stats: db.getStats()
    });
});

// Endpoint: Estadísticas
app.get('/api/receipts/stats', (req, res) => {
    res.json(db.getStats());
});

// Endpoint: Búsqueda para el empleado (por DNI o CUIL)
app.get('/api/employee/search', (req, res) => {
    const { query } = req.query;
    if (!query || query.trim() === '') {
        return res.status(400).json({ error: 'Debe ingresar un número de DNI o CUIL.' });
    }

    const results = db.searchByEmployee(query);
    res.json({
        query: query,
        found: results.length,
        receipts: results
    });
});

// Endpoint: Obtener un recibo por ID
app.get('/api/receipt/:id', (req, res) => {
    const receipt = db.getById(req.params.id);
    if (!receipt) {
        return res.status(404).json({ error: 'Recibo no encontrado.' });
    }
    res.json(receipt);
});

// Endpoint: Servir archivo PDF del recibo (original o firmado)
app.get('/api/files/receipt/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'storage', 'receipts', req.params.filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Archivo no encontrado');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${req.params.filename}"`);
    fs.createReadStream(filePath).pipe(res);
});

app.get('/api/files/signed/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'storage', 'signed', req.params.filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Archivo firmado no encontrado');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${req.params.filename}"`);
    fs.createReadStream(filePath).pipe(res);
});

// Endpoint: Firma digital de recibo por el empleado
app.post('/api/receipt/:id/sign', async (req, res) => {
    try {
        const { id } = req.params;
        const { signature } = req.body;

        if (!signature || !signature.startsWith('data:image/png;base64,')) {
            return res.status(400).json({ error: 'La firma manuscrita es requerida y debe ser una imagen válida.' });
        }

        const receipt = db.getById(id);
        if (!receipt) {
            return res.status(404).json({ error: 'Recibo de sueldo no encontrado.' });
        }

        const clientInfo = {
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
        };

        const signResult = await signReceipt(receipt, signature, clientInfo);

        const updated = db.update(id, {
            status: 'Firmado',
            signedFile: signResult.signedFile,
            signedAt: signResult.signedAt,
            signatureMetadata: signResult.signatureMetadata
        });

        console.log(`[Firma Exitosa] Recibo ${id} firmado por ${receipt.name}`);

        res.json({
            success: true,
            message: '¡Recibo firmado digitalmente con éxito!',
            receipt: updated
        });
    } catch (error) {
        console.error('[Sign Error]', error);
        res.status(500).json({ error: 'Error al procesar la firma: ' + error.message });
    }
});

// Endpoint: Descargar ZIP con recibos
app.get('/api/receipts/download-zip', async (req, res) => {
    try {
        const { filter = 'all' } = req.query; // 'all' o 'signed'
        const list = db.getAll();
        const zip = new JSZip();

        let count = 0;
        for (const r of list) {
            if (filter === 'signed') {
                if (r.status === 'Firmado' && r.signedFile) {
                    const filePath = path.join(__dirname, 'storage', 'signed', r.signedFile);
                    if (fs.existsSync(filePath)) {
                        zip.file(r.signedFile, fs.readFileSync(filePath));
                        count++;
                    }
                }
            } else {
                // Si está firmado agregamos el firmado, sino el original
                const filename = (r.status === 'Firmado' && r.signedFile) ? r.signedFile : r.filename;
                const folder = (r.status === 'Firmado' && r.signedFile) ? 'signed' : 'receipts';
                const filePath = path.join(__dirname, 'storage', folder, filename);
                if (fs.existsSync(filePath)) {
                    zip.file(filename, fs.readFileSync(filePath));
                    count++;
                }
            }
        }

        if (count === 0) {
            return res.status(404).send('No se encontraron recibos para comprimir.');
        }

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="recibos_${filter}_${Date.now()}.zip"`);
        res.send(zipBuffer);
    } catch (error) {
        console.error('[ZIP Error]', error);
        res.status(500).send('Error al generar archivo ZIP');
    }
});

// Endpoint: Actualizar datos de un recibo (Edición manual por RRHH)
app.put('/api/receipt/:id', (req, res) => {
    const { id } = req.params;
    const { name, cuil, dni, legajo, period } = req.body;

    const receipt = db.getById(id);
    if (!receipt) {
        return res.status(404).json({ error: 'Recibo no encontrado' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (cuil !== undefined) updates.cuil = cuil.trim();
    if (dni !== undefined) {
        updates.dni = dni.trim();
    } else if (cuil !== undefined) {
        const clean = cuil.replace(/\D/g, '');
        updates.dni = clean.length >= 10 ? clean.substring(2, 10) : clean;
    }
    if (legajo !== undefined) updates.legajo = legajo.trim();
    if (period !== undefined) updates.period = period.trim();

    const updated = db.update(id, updates);
    console.log(`[Update] Recibo ${id} actualizado: ${updated.name} (Legajo: ${updated.legajo}, CUIL: ${updated.cuil})`);
    res.json({ success: true, message: 'Datos actualizados correctamente.', receipt: updated });
});

// Endpoint: Eliminar recibo
app.delete('/api/receipt/:id', (req, res) => {
    const receipt = db.getById(req.params.id);
    if (!receipt) {
        return res.status(404).json({ error: 'Recibo no encontrado' });
    }

    // Borrar archivos
    try {
        const originalPath = path.join(__dirname, 'storage', 'receipts', receipt.filename);
        if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);

        if (receipt.signedFile) {
            const signedPath = path.join(__dirname, 'storage', 'signed', receipt.signedFile);
            if (fs.existsSync(signedPath)) fs.unlinkSync(signedPath);
        }
    } catch (e) {
        console.warn('Error al borrar archivos en disco:', e);
    }

    db.delete(req.params.id);
    res.json({ success: true, message: 'Recibo eliminado correctamente.' });
});

// Endpoint: Reset general (para pruebas)
app.post('/api/receipts/reset', (req, res) => {
    db.clear();
    // Limpiar directorios
    ['receipts', 'signed'].forEach(sub => {
        const dir = path.join(__dirname, 'storage', sub);
        if (fs.existsSync(dir)) {
            fs.readdirSync(dir).forEach(file => {
                fs.unlinkSync(path.join(dir, file));
            });
        }
    });
    res.json({ success: true, message: 'Base de datos y archivos reiniciados.' });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  SISTEMA DE RECIBOS DE SUELDO - ONLINE`);
    console.log(`  Servidor corriendo en: http://localhost:${PORT}`);
    console.log(`=======================================================`);
});
