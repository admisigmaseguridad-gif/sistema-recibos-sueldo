const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'storage', 'database.json');

class DatabaseService {
    constructor() {
        this.receipts = [];
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(DB_PATH)) {
                const data = fs.readFileSync(DB_PATH, 'utf-8');
                this.receipts = JSON.parse(data);
            } else {
                this.receipts = [];
                this.save();
            }
        } catch (error) {
            console.error('Error al cargar la base de datos:', error);
            this.receipts = [];
        }
    }

    save() {
        try {
            const dir = path.dirname(DB_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(DB_PATH, JSON.stringify(this.receipts, null, 2), 'utf-8');
        } catch (error) {
            console.error('Error al guardar la base de datos:', error);
        }
    }

    getAll() {
        return this.receipts;
    }

    getById(id) {
        return this.receipts.find(r => r.id === id) || null;
    }

    // Busca por DNI numérico, CUIL con o sin guiones, o por nombre
    searchByEmployee(query) {
        if (!query) return [];
        const cleanQuery = query.toString().trim().toLowerCase().replace(/[-.\s]/g, '');
        
        return this.receipts.filter(r => {
            const rDni = (r.dni || '').toString().toLowerCase().replace(/[-.\s]/g, '');
            const rCuil = (r.cuil || '').toString().toLowerCase().replace(/[-.\s]/g, '');
            const rName = (r.name || '').toString().toLowerCase();

            return rDni.includes(cleanQuery) || 
                   rCuil.includes(cleanQuery) || 
                   rName.includes(query.toString().trim().toLowerCase());
        });
    }

    addMany(newReceipts) {
        // Evitamos duplicar si ya existe el mismo legajo/cuil y período
        let addedCount = 0;
        for (const item of newReceipts) {
            const existingIndex = this.receipts.findIndex(r => 
                (r.cuil === item.cuil && r.period === item.period && r.period !== 'Desconocido')
            );
            if (existingIndex >= 0) {
                // Si existe pero está pendiente, actualizamos el archivo
                if (this.receipts[existingIndex].status !== 'Firmado') {
                    this.receipts[existingIndex] = { ...this.receipts[existingIndex], ...item, id: this.receipts[existingIndex].id };
                }
            } else {
                this.receipts.unshift(item);
                addedCount++;
            }
        }
        this.save();
        return addedCount;
    }

    update(id, updates) {
        const index = this.receipts.findIndex(r => r.id === id);
        if (index === -1) return null;
        this.receipts[index] = { ...this.receipts[index], ...updates };
        this.save();
        return this.receipts[index];
    }

    delete(id) {
        const index = this.receipts.findIndex(r => r.id === id);
        if (index === -1) return false;
        const deleted = this.receipts.splice(index, 1)[0];
        this.save();
        return deleted;
    }

    clear() {
        this.receipts = [];
        this.save();
    }

    getStats() {
        const total = this.receipts.length;
        const signed = this.receipts.filter(r => r.status === 'Firmado').length;
        const pending = total - signed;
        const percentage = total > 0 ? Math.round((signed / total) * 100) : 0;
        return { total, signed, pending, percentage };
    }
}

module.exports = new DatabaseService();
