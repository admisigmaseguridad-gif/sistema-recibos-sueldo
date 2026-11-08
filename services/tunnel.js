const localtunnel = require('localtunnel');
const http = require('http');

const PORT = process.env.PORT || 3000;

(async () => {
  console.log('Iniciando túnel seguro para acceso remoto...');
  try {
    const tunnel = await localtunnel({ port: PORT });
    console.log('=======================================================');
    console.log('  ¡SISTEMA PUBLICADO EN INTERNET (ACCESO REMOTO)!');
    console.log(`  URL Pública para Empleados: ${tunnel.url}`);
    console.log('=======================================================');

    tunnel.on('close', () => {
      console.log('Túnel cerrado.');
    });

    tunnel.on('error', (err) => {
      console.error('Error en el túnel:', err);
    });
  } catch (err) {
    console.error('No se pudo establecer el túnel:', err.message);
  }
})();
