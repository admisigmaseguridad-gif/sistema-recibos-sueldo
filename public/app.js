// Variables de estado
let activeTab = 'employee';
let companyReceipts = [];
let currentEmployeeReceipts = [];
let activeReceiptForSigning = null;
let selectedFile = null;

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  setupCanvas();
  setupDropzone();
  checkUrlParams();

  // Escuchar enter en el buscador de empleado
  const searchInput = document.getElementById('employeeSearchInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchEmployeeReceipts();
    });
  }

  // Escuchar enter en el PIN de administrador
  const pinInput = document.getElementById('adminPinInput');
  if (pinInput) {
    pinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitAdminPin();
    });
  }
});

// Comprobar parámetros de URL (ej: /?id=UUID)
async function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const directReceiptId = urlParams.get('id');
  const viewMode = urlParams.get('view');

  if (viewMode === 'company') {
    switchTab('company');
  }

  if (directReceiptId) {
    try {
      const res = await fetch(`/api/receipt/${directReceiptId}`);
      if (res.ok) {
        const receipt = await res.json();
        // Cargar en vista de empleado automáticamente
        document.getElementById('employeeSearchInput').value = receipt.dni || receipt.cuil;
        searchEmployeeReceipts();
        // Abrir modal de firma si está pendiente
        if (receipt.status === 'Pendiente') {
          openSignModal(receipt);
        }
      }
    } catch (e) {
      console.warn('Error al verificar ID directo:', e);
    }
  }
}

// Cambio de pestaña
function switchTab(tab) {
  if (tab === 'company') {
    if (sessionStorage.getItem('adminAuthed') !== 'true') {
      openAdminPinModal();
      return;
    }
  }

  activeTab = tab;
  const btnEmployee = document.getElementById('tabBtnEmployee');
  const btnCompany = document.getElementById('tabBtnCompany');
  const secEmployee = document.getElementById('sectionEmployee');
  const secCompany = document.getElementById('sectionCompany');

  if (tab === 'employee') {
    btnEmployee.classList.add('active');
    btnCompany.classList.remove('active');
    secEmployee.style.display = 'block';
    secCompany.style.display = 'none';
  } else {
    btnEmployee.classList.remove('active');
    btnCompany.classList.add('active');
    secEmployee.style.display = 'none';
    secCompany.style.display = 'block';
    loadCompanyData();
  }
}

function openAdminPinModal() {
  const modal = document.getElementById('adminPinModal');
  const input = document.getElementById('adminPinInput');
  if (input) input.value = '';
  if (modal) modal.classList.add('active');
  setTimeout(() => input && input.focus(), 150);
}

function closeAdminPinModal() {
  const modal = document.getElementById('adminPinModal');
  if (modal) modal.classList.remove('active');
}

async function submitAdminPin() {
  const input = document.getElementById('adminPinInput');
  const pin = input ? input.value.trim() : '';

  if (!pin) {
    showToast('Por favor, ingresá el PIN de administrador.', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      sessionStorage.setItem('adminAuthed', 'true');
      closeAdminPinModal();
      showToast('Acceso autorizado como Administrador.', 'success');
      switchTab('company');
    } else {
      showToast(data.error || 'PIN incorrecto', 'error');
      if (input) input.value = '';
    }
  } catch (err) {
    console.error('Error al verificar PIN:', err);
    showToast('Error de conexión', 'error');
  }
}

// ==========================================
// PORTAL DEL EMPLEADO
// ==========================================

async function searchEmployeeReceipts() {
  const query = document.getElementById('employeeSearchInput').value.trim();
  if (!query) {
    showToast('Por favor, ingresá tu número de DNI o CUIL.', 'warning');
    return;
  }

  const btn = document.getElementById('btnSearchEmployee');
  btn.disabled = true;
  btn.innerText = 'Buscando...';

  try {
    const res = await fetch(`/api/employee/search?query=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Error al buscar recibos', 'error');
      return;
    }

    if (data.receipts && data.receipts.length > 0) {
      currentEmployeeReceipts = data.receipts;
      renderEmployeeReceipts(data.receipts);
      document.getElementById('employeeEmptyState').style.display = 'none';
      document.getElementById('employeeResults').style.display = 'block';
    } else {
      document.getElementById('employeeResults').style.display = 'none';
      const emptyState = document.getElementById('employeeEmptyState');
      emptyState.style.display = 'block';
      emptyState.innerHTML = `
        <div style="font-size: 3rem; margin-bottom: 0.75rem;">📂</div>
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 0.35rem;">No se encontraron recibos</h3>
        <p style="color: var(--text-muted); font-size: 0.9rem; max-width: 480px; margin: 0 auto;">
          No tenemos recibos registrados para el DNI/CUIL: <strong>${escapeHtml(query)}</strong>.
          Verificá el número o comunicate con el área de Recursos Humanos.
        </p>
      `;
    }
  } catch (error) {
    console.error('Error:', error);
    showToast('Error de conexión con el servidor', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <span>Buscar</span>
    `;
  }
}

function renderEmployeeReceipts(receipts) {
  const container = document.getElementById('employeeReceiptsList');
  container.innerHTML = '';

  const first = receipts[0];
  document.getElementById('employeeNameTitle').textContent = first.name || 'Empleado';
  document.getElementById('employeeIdSubtitle').textContent = `CUIL: ${first.cuil || '-'} | DNI: ${first.dni || '-'} | Legajo: ${first.legajo || '-'}`;

  receipts.forEach(r => {
    const card = document.createElement('div');
    card.className = 'receipt-card';

    const isSigned = r.status === 'Firmado';
    const badgeHtml = isSigned
      ? `<span class="badge badge-success">✓ Firmado</span>`
      : `<span class="badge badge-warning">⏳ Pendiente de Firma</span>`;

    const pdfUrl = isSigned 
      ? `/api/files/signed/${r.signedFile}` 
      : `/api/files/receipt/${r.filename}`;

    const displayPeriod = (r.period && r.period !== 'Desconocido') ? r.period : '10/2026';
    const hasRealName = r.name && !r.name.startsWith('Empleado Pág');

    card.innerHTML = `
      <div>
        <div class="receipt-card-header">
          <div>
            <div class="receipt-card-title">Período: ${escapeHtml(displayPeriod)}</div>
            <div class="receipt-card-subtitle">${escapeHtml(r.company || 'SIGMA SEGURIDAD SRL')}</div>
          </div>
          ${badgeHtml}
        </div>
        ${hasRealName ? `
          <div style="margin-top: 0.5rem; padding: 0.4rem 0.6rem; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
            <div style="font-size: 0.85rem; font-weight: 700; color: #0f172a;">👤 ${escapeHtml(r.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">Legajo: ${escapeHtml(r.legajo || '-')} | CUIL: ${escapeHtml(r.cuil || '-')}</div>
          </div>
        ` : `
          <div style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--text-muted);">
            Recibo individual N° ${r.page || 1}
          </div>
        `}
        <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.5rem;">
          ${isSigned && r.signedAt ? `Firmado el: ${new Date(r.signedAt).toLocaleDateString('es-AR')} a las ${new Date(r.signedAt).toLocaleTimeString('es-AR')}` : 'Esperando tu firma de conformidad.'}
        </div>
      </div>

      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem;">
        <a href="${pdfUrl}" target="_blank" class="btn btn-secondary btn-sm" style="flex: 1;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          <span>Ver PDF</span>
        </a>

        ${!isSigned ? `
          <button class="btn btn-primary btn-sm" style="flex: 1;" onclick='openSignModal(${JSON.stringify(r)})'>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
            </svg>
            <span>Firmar Recibo</span>
          </button>
        ` : `
          <a href="${pdfUrl}" download="${r.signedFile}" class="btn btn-success btn-sm" style="flex: 1;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Descargar Firmado</span>
          </a>
        `}
      </div>
    `;

    container.appendChild(card);
  });
}

function clearEmployeeSearch() {
  document.getElementById('employeeSearchInput').value = '';
  document.getElementById('employeeResults').style.display = 'none';
  document.getElementById('employeeEmptyState').style.display = 'block';
  document.getElementById('employeeEmptyState').innerHTML = `
    <div style="font-size: 3rem; margin-bottom: 0.75rem;">🔍</div>
    <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 0.35rem;">Ingresá tus datos para ver tus recibos</h3>
    <p style="color: var(--text-muted); font-size: 0.9rem; max-width: 480px; margin: 0 auto;">
      Podés escribir tu número de DNI o tu CUIL completo. El sistema buscará de inmediato todos los recibos liquidados a tu nombre.
    </p>
  `;
}

// ==========================================
// PANEL DE LA EMPRESA
// ==========================================

async function loadCompanyData() {
  try {
    const res = await fetch('/api/receipts');
    const data = await res.json();
    companyReceipts = data.receipts || [];
    renderCompanyStats(data.stats || {});
    renderCompanyTable(companyReceipts);
  } catch (error) {
    console.error('Error al cargar datos de empresa:', error);
    showToast('Error al cargar recibos', 'error');
  }
}

function renderCompanyStats(stats) {
  document.getElementById('statTotal').textContent = stats.total || 0;
  document.getElementById('statPending').textContent = stats.pending || 0;
  document.getElementById('statSigned').textContent = stats.signed || 0;
  document.getElementById('statRate').textContent = `${stats.percentage || 0}%`;
}

function renderCompanyTable(receipts) {
  const tbody = document.getElementById('companyTableBody');
  tbody.innerHTML = '';

  if (receipts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
          No hay recibos registrados aún. Subí un archivo PDF consolidado arriba para comenzar.
        </td>
      </tr>
    `;
    return;
  }

  receipts.forEach(r => {
    const tr = document.createElement('tr');
    const isSigned = r.status === 'Firmado';
    const badgeClass = isSigned ? 'badge-success' : 'badge-warning';

    const pdfUrl = isSigned 
      ? `/api/files/signed/${r.signedFile}` 
      : `/api/files/receipt/${r.filename}`;

    const host = window.location.origin;
    const directLink = `${host}/?id=${r.id}`;

    // Mensaje de WhatsApp personalizado con nombre, legajo, período y DNI
    const legajoStr = r.legajo && r.legajo !== '-' ? ` (Legajo N° ${r.legajo})` : '';
    const dniHelp = r.dni && r.dni !== '-' ? `Tu DNI para ingresar es: ${r.dni}` : `Ingresá con tu CUIL: ${r.cuil}`;
    const whatsappMsg = `Hola ${r.name}${legajoStr}, te informamos que ya se encuentra disponible tu recibo de sueldo de ${r.period}.\n\nPodés consultarlo y firmarlo digitalmente ingresando al siguiente enlace:\n👉 ${directLink}\n\n${dniHelp}\n(Al confirmar tu firma, el recibo firmado se envía automáticamente a la empresa sin que tengas que hacer nada más).`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappMsg)}`;

    // Enlace de Email con asunto y cuerpo prearmados
    const mailSubject = encodeURIComponent(`Recibo de Sueldo - ${r.period} - ${r.name}`);
    const mailBody = encodeURIComponent(`Estimado/a ${r.name}${legajoStr}:\n\nLe informamos que ya se encuentra disponible para su consulta y firma digital el recibo de sueldo correspondiente al período ${r.period}.\n\nPuede acceder directamente desde su celular o computadora en el siguiente enlace:\n${directLink}\n\nDatos de identificación:\n• Nombre: ${r.name}\n• Legajo: ${r.legajo || '-'}\n• CUIL: ${r.cuil || '-'}\n• Período: ${r.period}\n\nUna vez firmado en pantalla, la constancia digital quedará registrada de forma inmediata en el sistema de la empresa sin necesidad de trámites adicionales.\n\nSaludos cordiales,\nDepartamento de Recursos Humanos`);
    const mailUrl = `mailto:?subject=${mailSubject}&body=${mailBody}`;

    tr.innerHTML = `
      <td><strong>${escapeHtml(r.legajo || '-')}</strong></td>
      <td>
        <div style="font-weight: 600;">${escapeHtml(r.name)}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(r.company || '')}</div>
      </td>
      <td><code>${escapeHtml(r.cuil || '-')}</code></td>
      <td>${escapeHtml(r.period)}</td>
      <td><span class="badge ${badgeClass}">${r.status}</span></td>
      <td style="text-align: right;">
        <div style="display: inline-flex; gap: 0.35rem; flex-wrap: wrap; justify-content: flex-end;">
          <a href="${pdfUrl}" target="_blank" class="btn btn-secondary btn-sm" title="Ver documento">
            Ver PDF
          </a>
          <button class="btn btn-secondary btn-sm" onclick="copyLink('${directLink}')" title="Copiar enlace de firma">
            Copiar Link
          </button>
          <a href="${whatsappUrl}" target="_blank" class="btn btn-success btn-sm" title="Enviar por WhatsApp a ${escapeHtml(r.name)}">
            WhatsApp
          </a>
          <a href="${mailUrl}" class="btn btn-secondary btn-sm" title="Enviar por Email a ${escapeHtml(r.name)}">
            ✉️ Email
          </a>
          <button class="btn btn-secondary btn-sm" onclick='openEditModal(${JSON.stringify(r)})' title="Editar datos del empleado">
            ✏️ Editar
          </button>
          <button class="btn btn-secondary btn-sm" style="color: var(--danger);" onclick="deleteReceipt('${r.id}')" title="Eliminar recibo">
            ✕
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function applyTableFilters() {
  const searchTerm = (document.getElementById('companyTableFilter').value || '').toLowerCase();
  const statusTerm = document.getElementById('companyStatusFilter').value;

  const filtered = companyReceipts.filter(r => {
    const matchStatus = !statusTerm || r.status === statusTerm;
    const matchSearch = !searchTerm || 
      (r.name && r.name.toLowerCase().includes(searchTerm)) ||
      (r.cuil && r.cuil.toLowerCase().includes(searchTerm)) ||
      (r.legajo && r.legajo.toLowerCase().includes(searchTerm));
    return matchStatus && matchSearch;
  });

  renderCompanyTable(filtered);
}

function copyLink(link) {
  navigator.clipboard.writeText(link).then(() => {
    showToast('¡Enlace de firma copiado al portapapeles!', 'success');
  }).catch(() => {
    prompt('Copia este enlace para el empleado:', link);
  });
}

async function deleteReceipt(id) {
  if (!confirm('¿Estás seguro de que deseas eliminar este recibo?')) return;

  try {
    const res = await fetch(`/api/receipt/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Recibo eliminado correctamente', 'success');
      loadCompanyData();
    } else {
      showToast('Error al eliminar recibo', 'error');
    }
  } catch (e) {
    showToast('Error de conexión', 'error');
  }
}

function downloadZip(filter) {
  window.location.href = `/api/receipts/download-zip?filter=${filter}`;
}

// Drag & Drop y Subida de Archivo
function setupDropzone() {
  const dropzone = document.getElementById('pdfDropzone');
  if (!dropzone) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-active');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-active');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
      setSelectedFile(files[0]);
    } else {
      showToast('Por favor arrastrá un archivo PDF válido.', 'warning');
    }
  });
}

function handleFileSelected(event) {
  if (event.target.files.length > 0) {
    setSelectedFile(event.target.files[0]);
  }
}

function setSelectedFile(file) {
  selectedFile = file;
  const label = document.getElementById('selectedFileName');
  label.textContent = `Archivo seleccionado: ${file.name} (${Math.round(file.size / 1024)} KB)`;
  label.style.display = 'block';
  document.getElementById('btnUploadSubmit').disabled = false;
}

async function uploadAndSplitPdf() {
  if (!selectedFile) return;

  const btn = document.getElementById('btnUploadSubmit');
  const progressContainer = document.getElementById('uploadProgressContainer');
  const progressBar = document.getElementById('uploadProgressBar');
  const progressPercent = document.getElementById('uploadProgressPercent');
  const progressText = document.getElementById('uploadProgressText');

  btn.disabled = true;
  progressContainer.style.display = 'block';
  progressBar.style.width = '30%';
  progressPercent.textContent = '30%';
  progressText.textContent = 'Subiendo archivo al servidor...';

  const formData = new FormData();
  formData.append('pdf', selectedFile);

  try {
    progressBar.style.width = '60%';
    progressPercent.textContent = '60%';
    progressText.textContent = 'Cortando y analizando recibos por página...';

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (res.ok) {
      progressBar.style.width = '100%';
      progressPercent.textContent = '100%';
      progressText.textContent = '¡Completado con éxito!';

      showToast(`¡Excelente! Se procesaron ${data.totalProcessed} recibos correctamente.`, 'success');
      if (data.notice) {
        setTimeout(() => {
          showToast(data.notice, 'warning');
        }, 1200);
      }
      loadCompanyData();

      setTimeout(() => {
        progressContainer.style.display = 'none';
        progressBar.style.width = '0%';
        selectedFile = null;
        document.getElementById('selectedFileName').style.display = 'none';
        document.getElementById('pdfFileInput').value = '';
        btn.disabled = true;
      }, 1500);
    } else {
      showToast(data.error || 'Error al procesar el archivo', 'error');
      progressContainer.style.display = 'none';
      btn.disabled = false;
    }
  } catch (error) {
    console.error('Upload Error:', error);
    showToast('Error de conexión durante la subida', 'error');
    progressContainer.style.display = 'none';
    btn.disabled = false;
  }
}

// ==========================================
// CANVAS DE FIRMA DIGITAL Y MODAL
// ==========================================

let canvas, ctx;
let isDrawing = false;
let hasDrawn = false;

function setupCanvas() {
  canvas = document.getElementById('signatureCanvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  window.addEventListener('resize', () => {
    if (document.getElementById('signModal').classList.contains('active')) {
      resizeCanvas();
    }
  });

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function start(e) {
    isDrawing = true;
    hasDrawn = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }

  function draw(e) {
    if (!isDrawing) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    e.preventDefault();
  }

  function stop(e) {
    if (!isDrawing) return;
    isDrawing = false;
    ctx.closePath();
    e.preventDefault();
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', draw);
  window.addEventListener('mouseup', stop);

  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  canvas.addEventListener('touchend', stop, { passive: false });
}

function openSignModal(receipt) {
  activeReceiptForSigning = receipt;
  document.getElementById('modalSignTitle').textContent = `Firmar Recibo: ${receipt.name}`;
  document.getElementById('modalSignSubtitle').textContent = `Período: ${receipt.period} | CUIL: ${receipt.cuil} | Legajo: ${receipt.legajo}`;
  
  const pdfUrl = `/api/files/receipt/${receipt.filename}`;
  document.getElementById('pdfPreviewFrame').src = pdfUrl;
  document.getElementById('modalDownloadOriginalLink').href = pdfUrl;

  const modal = document.getElementById('signModal');
  modal.classList.add('active');

  // Inicializar canvas después de que el modal es visible
  setTimeout(() => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    clearSignatureCanvas();
  }, 100);
}

function closeSignModal() {
  document.getElementById('signModal').classList.remove('active');
  document.getElementById('pdfPreviewFrame').src = '';
  activeReceiptForSigning = null;
  clearSignatureCanvas();
}

function clearSignatureCanvas() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasDrawn = false;
}

async function submitSignature() {
  if (!activeReceiptForSigning) return;

  if (!hasDrawn) {
    showToast('Por favor, dibuja tu firma antes de confirmar.', 'warning');
    return;
  }

  const btn = document.getElementById('btnSubmitSignature');
  btn.disabled = true;
  btn.innerText = 'Estampando firma digital...';

  // Exportar canvas
  const signatureData = canvas.toDataURL('image/png');

  try {
    const res = await fetch(`/api/receipt/${activeReceiptForSigning.id}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: signatureData })
    });

    const data = await res.json();

    if (res.ok) {
      closeSignModal();

      // Si estamos en el portal del empleado, refrescar búsqueda
      const searchVal = document.getElementById('employeeSearchInput').value.trim();
      if (searchVal) {
        searchEmployeeReceipts();
      }

      // Si la empresa está abierta, refrescar tabla
      if (activeTab === 'company') {
        loadCompanyData();
      }

      // Mostrar modal claro de confirmación y remitido automático a la empresa
      const signedUrl = `/api/files/signed/${data.receipt.signedFile}`;
      openSuccessModal(signedUrl);
    } else {
      showToast(data.error || 'Error al firmar el recibo', 'error');
    }
  } catch (error) {
    console.error('Error al firmar:', error);
    showToast('Error de conexión al firmar', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Confirmar y Firmar Recibo</span>
    `;
  }
}

// ==========================================
// MODAL DE ÉXITO TRAS LA FIRMA
// ==========================================

function openSuccessModal(signedUrl) {
  const modal = document.getElementById('signatureSuccessModal');
  const btnDownload = document.getElementById('btnSuccessDownloadCopy');
  if (btnDownload) {
    btnDownload.href = signedUrl;
  }
  if (modal) {
    modal.classList.add('active');
  }
}

function closeSuccessModal() {
  const modal = document.getElementById('signatureSuccessModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

// ==========================================
// MODAL DE EDICIÓN DE DATOS (RRHH)
// ==========================================

function openEditModal(receipt) {
  document.getElementById('editReceiptId').value = receipt.id;
  document.getElementById('editReceiptName').value = receipt.name === `Empleado Pág ${receipt.page}` ? '' : receipt.name;
  document.getElementById('editReceiptLegajo').value = receipt.legajo === '-' ? '' : receipt.legajo;
  document.getElementById('editReceiptPeriod').value = receipt.period === 'Desconocido' ? '' : receipt.period;
  document.getElementById('editReceiptCuil').value = receipt.cuil === 'Sin CUIL' ? '' : receipt.cuil;
  document.getElementById('editReceiptDni').value = receipt.dni === '-' ? '' : receipt.dni;

  document.getElementById('editReceiptModal').classList.add('active');
}

function closeEditModal() {
  document.getElementById('editReceiptModal').classList.remove('active');
}

async function saveReceiptEdit() {
  const id = document.getElementById('editReceiptId').value;
  if (!id) return;

  const name = document.getElementById('editReceiptName').value.trim();
  const legajo = document.getElementById('editReceiptLegajo').value.trim();
  const period = document.getElementById('editReceiptPeriod').value.trim();
  const cuil = document.getElementById('editReceiptCuil').value.trim();
  const dni = document.getElementById('editReceiptDni').value.trim();

  if (!name) {
    showToast('Por favor, ingresá el nombre y apellido del empleado.', 'warning');
    return;
  }

  const btn = document.getElementById('btnSaveEditReceipt');
  btn.disabled = true;
  btn.innerText = 'Guardando...';

  try {
    const res = await fetch(`/api/receipt/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        legajo: legajo || '-',
        period: period || 'Desconocido',
        cuil: cuil || 'Sin CUIL',
        dni: dni || (cuil ? cuil.replace(/\D/g, '').substring(2, 10) : '-')
      })
    });

    const data = await res.json();
    if (res.ok) {
      showToast('¡Datos del empleado guardados exitosamente!', 'success');
      closeEditModal();
      loadCompanyData();

      // Si el empleado estaba buscando, refrescar también su portal
      const searchVal = document.getElementById('employeeSearchInput').value.trim();
      if (searchVal) {
        searchEmployeeReceipts();
      }
    } else {
      showToast(data.error || 'Error al guardar cambios', 'error');
    }
  } catch (error) {
    console.error('Error al actualizar datos:', error);
    showToast('Error de conexión al guardar cambios', 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Guardar Cambios';
  }
}

// ==========================================
// UTILIDADES
// ==========================================

function showToast(message, type = 'info') {
  const toast = document.getElementById('toastNotification');
  const msgSpan = document.getElementById('toastMessage');
  const iconSpan = document.getElementById('toastIcon');

  msgSpan.textContent = message;
  if (type === 'success') {
    iconSpan.textContent = '✅';
    toast.style.background = '#065f46';
  } else if (type === 'error') {
    iconSpan.textContent = '❌';
    toast.style.background = '#991b1b';
  } else if (type === 'warning') {
    iconSpan.textContent = '⚠️';
    toast.style.background = '#92400e';
  } else {
    iconSpan.textContent = 'ℹ️';
    toast.style.background = '#0f172a';
  }

  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
