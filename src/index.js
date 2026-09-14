import { Router } from 'itty-router';
import { v4 as uuidv4 } from 'crypto';

const router = Router();

// Helpers para validación y generación
function generarCodigoUnico() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function validarFecha(fecha) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fechaObj = new Date(fecha + 'T00:00:00');
  return fechaObj >= hoy;
}

function validarHorarios(horaInicio, horaFinal) {
  const [hiHora, hiMin] = horaInicio.split(':').map(Number);
  const [hfHora, hfMin] = horaFinal.split(':').map(Number);
  const minutoInicio = hiHora * 60 + hiMin;
  const minutoFinal = hfHora * 60 + hfMin;
  return minutoFinal > minutoInicio;
}

function hayConflicto(nuevaReserva, reservasExistentes) {
  const [niHora, niMin] = nuevaReserva.hora_inicio.split(':').map(Number);
  const [nfHora, nfMin] = nuevaReserva.hora_final.split(':').map(Number);
  const nuevoInicio = niHora * 60 + niMin;
  const nuevoFinal = nfHora * 60 + nfMin;

  for (const reserva of reservasExistentes) {
    if (reserva.cancelada) continue;
    const [eiHora, eiMin] = reserva.hora_inicio.split(':').map(Number);
    const [efHora, efMin] = reserva.hora_final.split(':').map(Number);
    const existenteInicio = eiHora * 60 + eiMin;
    const existenteFinal = efHora * 60 + efMin;

    // Permite que una junta empiece exactamente cuando termina otra
    if (nuevoInicio < existenteFinal && nuevoFinal > existenteInicio) {
      return true;
    }
  }
  return false;
}

// API: Obtener reservas por fecha
router.get('/api/reservas/:fecha', async (request, env) => {
  try {
    const { fecha } = request.params;
    
    // Validar formato de fecha
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return new Response(JSON.stringify({ error: 'Formato de fecha inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const reservas = await env.DB.prepare(
      `SELECT id, responsable, asunto, fecha, hora_inicio, hora_final, creada_en 
       FROM reservas 
       WHERE fecha = ? AND cancelada = 0 
       ORDER BY hora_inicio ASC`
    ).bind(fecha).all();

    return new Response(JSON.stringify(reservas.results || []), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error en GET /api/reservas/:fecha', error);
    return new Response(JSON.stringify({ error: 'Error al obtener reservas' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// API: Crear reserva (con validación atómica de conflictos)
router.post('/api/reservas', async (request, env) => {
  try {
    const body = await request.json();
    const { responsable, asunto, fecha, hora_inicio, hora_final } = body;

    // Validaciones
    if (!responsable?.trim() || !asunto?.trim() || !fecha || !hora_inicio || !hora_final) {
      return new Response(JSON.stringify({ error: 'Campos obligatorios faltantes' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!validarFecha(fecha)) {
      return new Response(JSON.stringify({ error: 'La fecha no puede ser pasada' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!validarHorarios(hora_inicio, hora_final)) {
      return new Response(JSON.stringify({ error: 'La hora final debe ser posterior a la inicial' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Búsqueda de conflictos (operación atómica)
    const reservasExistentes = await env.DB.prepare(
      `SELECT hora_inicio, hora_final, cancelada 
       FROM reservas 
       WHERE fecha = ? AND cancelada = 0`
    ).bind(fecha).all();

    if (hayConflicto(
      { hora_inicio, hora_final },
      reservasExistentes.results || []
    )) {
      return new Response(JSON.stringify({ error: 'Conflicto de horario: la sala ya está reservada en ese tiempo' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Crear reserva
    const id = uuidv4();
    const cancelacion_codigo = generarCodigoUnico();

    await env.DB.prepare(
      `INSERT INTO reservas (id, responsable, asunto, fecha, hora_inicio, hora_final, cancelacion_codigo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, responsable.trim(), asunto.trim(), fecha, hora_inicio, hora_final, cancelacion_codigo).run();

    return new Response(JSON.stringify({
      id,
      responsable,
      asunto,
      fecha,
      hora_inicio,
      hora_final,
      cancelacion_codigo
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error en POST /api/reservas', error);
    return new Response(JSON.stringify({ error: 'Error al crear reserva' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// API: Cancelar reserva con código privado
router.post('/api/reservas/:id/cancelar', async (request, env) => {
  try {
    const body = await request.json();
    const { cancelacion_codigo } = body;
    const { id } = request.params;

    if (!cancelacion_codigo) {
      return new Response(JSON.stringify({ error: 'Código de cancelación requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const reserva = await env.DB.prepare(
      `SELECT cancelacion_codigo, cancelada FROM reservas WHERE id = ?`
    ).bind(id).first();

    if (!reserva) {
      return new Response(JSON.stringify({ error: 'Reserva no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (reserva.cancelada) {
      return new Response(JSON.stringify({ error: 'La reserva ya fue cancelada' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (reserva.cancelacion_codigo !== cancelacion_codigo) {
      return new Response(JSON.stringify({ error: 'Código de cancelación inválido' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await env.DB.prepare(
      `UPDATE reservas SET cancelada = 1, cancelada_en = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(id).run();

    return new Response(JSON.stringify({ mensaje: 'Reserva cancelada exitosamente' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error en POST /api/reservas/:id/cancelar', error);
    return new Response(JSON.stringify({ error: 'Error al cancelar reserva' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Servir archivo HTML/JS estático
router.get('/', async () => {
  return new Response(await getIndexHTML(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
});

async function getIndexHTML() {
  // Se sirve desde aquí directamente
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reserva - Sala de Juntas</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 16px;
      color: #333;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
    }

    header {
      text-align: center;
      color: white;
      margin-bottom: 24px;
    }

    header h1 {
      font-size: 28px;
      margin-bottom: 4px;
    }

    header p {
      font-size: 14px;
      opacity: 0.9;
    }

    .timezone-info {
      text-align: center;
      color: white;
      font-size: 12px;
      margin-bottom: 16px;
      opacity: 0.85;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
      margin-bottom: 24px;
    }

    @media (min-width: 768px) {
      .grid {
        grid-template-columns: 1fr 1fr;
      }
    }

    .card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      padding: 20px;
    }

    .card h2 {
      font-size: 18px;
      margin-bottom: 16px;
      color: #333;
      border-bottom: 2px solid #667eea;
      padding-bottom: 8px;
    }

    /* Calendario */
    .calendar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .calendar-header button {
      background: #667eea;
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
    }

    .calendar-header button:hover {
      background: #5568d3;
    }

    .calendar-header .current-month {
      font-weight: 600;
      font-size: 16px;
    }

    .weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
      margin-bottom: 8px;
    }

    .weekday {
      text-align: center;
      font-weight: 600;
      font-size: 12px;
      color: #667eea;
      padding: 8px 0;
    }

    .days {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
    }

    .day {
      aspect-ratio: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      background: #f5f5f5;
      border: 2px solid transparent;
      transition: all 0.2s;
    }

    .day:hover:not(.other-month) {
      background: #e8e8ff;
      border-color: #667eea;
    }

    .day.other-month {
      color: #ccc;
      cursor: default;
      background: #fafafa;
    }

    .day.today {
      background: #667eea;
      color: white;
      font-weight: 700;
    }

    .day.selected {
      background: #764ba2;
      color: white;
      border-color: #764ba2;
    }

    .day.has-reservas {
      position: relative;
    }

    .day.has-reservas::after {
      content: '';
      position: absolute;
      bottom: 2px;
      width: 4px;
      height: 4px;
      background: #764ba2;
      border-radius: 50%;
    }

    /* Reservas del día */
    .day-reservas {
      background: #f9f9f9;
      border-radius: 8px;
      padding: 16px;
      min-height: 120px;
    }

    .day-reservas.empty {
      color: #999;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 14px;
    }

    .reserva-item {
      background: white;
      border-left: 4px solid #667eea;
      padding: 12px;
      margin-bottom: 12px;
      border-radius: 6px;
      font-size: 13px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    .reserva-item.last {
      margin-bottom: 0;
    }

    .reserva-horario {
      font-weight: 700;
      color: #667eea;
      margin-bottom: 4px;
    }

    .reserva-asunto {
      color: #333;
      margin-bottom: 4px;
      font-weight: 500;
    }

    .reserva-responsable {
      color: #666;
      font-size: 12px;
    }

    /* Formulario de reserva */
    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      font-weight: 600;
      margin-bottom: 6px;
      color: #333;
      font-size: 14px;
    }

    .form-group input,
    .form-group textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-family: inherit;
      font-size: 14px;
    }

    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .form-group textarea {
      resize: vertical;
      min-height: 60px;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    @media (max-width: 480px) {
      .form-row {
        grid-template-columns: 1fr;
      }
    }

    .button {
      padding: 12px 20px;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
    }

    .button.primary {
      background: #667eea;
      color: white;
    }

    .button.primary:hover:not(:disabled) {
      background: #5568d3;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }

    .button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Modal de confirmación */
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }

    .modal.active {
      display: flex;
    }

    .modal-content {
      background: white;
      border-radius: 12px;
      padding: 32px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    }

    .modal-content h3 {
      margin-bottom: 16px;
      color: #333;
    }

    .modal-content p {
      margin-bottom: 16px;
      color: #666;
      font-size: 14px;
      line-height: 1.5;
    }

    .modal-code {
      background: #f5f5f5;
      padding: 12px;
      border-radius: 6px;
      font-family: monospace;
      font-weight: 700;
      font-size: 16px;
      color: #333;
      text-align: center;
      margin-bottom: 16px;
      user-select: all;
    }

    .modal-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .modal-buttons button {
      padding: 10px 16px;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
    }

    .modal-buttons .btn-copy {
      background: #667eea;
      color: white;
    }

    .modal-buttons .btn-copy:hover {
      background: #5568d3;
    }

    .modal-buttons .btn-close {
      background: #f0f0f0;
      color: #333;
    }

    .modal-buttons .btn-close:hover {
      background: #e0e0e0;
    }

    /* Notificaciones */
    .notification {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: white;
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 2000;
      max-width: 300px;
      animation: slideIn 0.3s ease-out;
    }

    .notification.error {
      border-left: 4px solid #ef4444;
      color: #ef4444;
    }

    .notification.success {
      border-left: 4px solid #10b981;
      color: #10b981;
    }

    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    .loading {
      display: inline-block;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #667eea;
      animation: blink 1s infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    @media (max-width: 480px) {
      .notification {
        left: 16px;
        right: 16px;
        max-width: none;
      }

      header h1 {
        font-size: 22px;
      }

      .card {
        padding: 16px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📅 Reserva Sala de Juntas</h1>
      <p>Herramienta de reservas compartida</p>
    </header>

    <div class="timezone-info">
      🕐 Zona horaria: America/Chihuahua
    </div>

    <div class="grid">
      <!-- Calendario -->
      <div class="card">
        <h2>Calendario</h2>
        <div class="calendar-header">
          <button id="prevMonth">← Anterior</button>
          <div class="current-month" id="currentMonth"></div>
          <button id="nextMonth">Siguiente →</button>
        </div>
        <div class="weekdays">
          <div class="weekday">D</div>
          <div class="weekday">L</div>
          <div class="weekday">M</div>
          <div class="weekday">X</div>
          <div class="weekday">J</div>
          <div class="weekday">V</div>
          <div class="weekday">S</div>
        </div>
        <div class="days" id="daysGrid"></div>
      </div>

      <!-- Reservas del día -->
      <div class="card">
        <h2>Juntas - <span id="selectedDateDisplay">Hoy</span></h2>
        <div class="day-reservas empty" id="reservasContainer">
          Selecciona un día para ver las juntas
        </div>
      </div>
    </div>

    <!-- Formulario de Reserva -->
    <div class="card">
      <h2>Crear Reserva</h2>
      <form id="reservaForm">
        <div class="form-group">
          <label for="responsable">Nombre del Responsable *</label>
          <input type="text" id="responsable" name="responsable" required placeholder="Tu nombre">
        </div>

        <div class="form-group">
          <label for="asunto">Asunto de la Junta *</label>
          <textarea id="asunto" name="asunto" required placeholder="Tema de la junta"></textarea>
        </div>

        <div class="form-group">
          <label for="fecha">Fecha *</label>
          <input type="date" id="fecha" name="fecha" required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="horaInicio">Hora de Inicio *</label>
            <input type="time" id="horaInicio" name="horaInicio" required>
          </div>
          <div class="form-group">
            <label for="horaFinal">Hora de Finalización *</label>
            <input type="time" id="horaFinal" name="horaFinal" required>
          </div>
        </div>

        <button type="submit" class="button primary">Reservar Sala</button>
      </form>
    </div>
  </div>

  <!-- Modal de Confirmación -->
  <div class="modal" id="confirmModal">
    <div class="modal-content">
      <h3>✅ Reserva Creada</h3>
      <p>Tu reserva ha sido creada exitosamente. Guarda este código para cancelarla después si es necesario:</p>
      <div class="modal-code" id="modalCode"></div>
      <p style="font-size: 12px; color: #999;">Este código es personal. No lo compartas si no quieres que otros cancelen tu reserva.</p>
      <div class="modal-buttons">
        <button class="btn-copy" onclick="copiarCodigo()">📋 Copiar Código</button>
        <button class="btn-close" onclick="cerrarModal()">Cerrar</button>
      </div>
    </div>
  </div>

  <script>
    const API_BASE = window.location.origin;
    let currentDate = new Date();
    let selectedDate = new Date();
    let cancelacionCodigoActual = null;

    // Inicialización
    document.addEventListener('DOMContentLoaded', () => {
      inicializarFormulario();
      renderizarCalendario();
      cargarReservasDelDia();
      setearFechaMinima();
      actualizarReservasCada15Segundos();
    });

    function inicializarFormulario() {
      const hoy = new Date();
      document.getElementById('fecha').valueAsDate = hoy;
      document.getElementById('horaInicio').value = '09:00';
      document.getElementById('horaFinal').value = '10:00';
    }

    function setearFechaMinima() {
      const hoy = new Date();
      const año = hoy.getFullYear();
      const mes = String(hoy.getMonth() + 1).padStart(2, '0');
      const día = String(hoy.getDate()).padStart(2, '0');
      document.getElementById('fecha').min = \`\${año}-\${mes}-\${día}\`;
    }

    function renderizarCalendario() {
      const año = currentDate.getFullYear();
      const mes = currentDate.getMonth();
      
      document.getElementById('currentMonth').textContent = 
        new Date(año, mes).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

      const primerDia = new Date(año, mes, 1);
      const ultimoDia = new Date(año, mes + 1, 0);
      const diasAnterior = primerDia.getDay();
      const diasMes = ultimoDia.getDate();

      const daysGrid = document.getElementById('daysGrid');
      daysGrid.innerHTML = '';

      // Días del mes anterior
      for (let i = diasAnterior - 1; i >= 0; i--) {
        const dia = new Date(año, mes, -i);
        agregarDiaAlCalendario(daysGrid, dia.getDate(), 'other-month', false);
      }

      // Días del mes actual
      for (let día = 1; día <= diasMes; día++) {
        const fecha = new Date(año, mes, día);
        const esHoy = esHoyFunc(fecha);
        const esSeleccionado = esSeleccionadoFunc(fecha);
        const clases = [];
        if (esHoy) clases.push('today');
        if (esSeleccionado) clases.push('selected');
        
        agregarDiaAlCalendario(daysGrid, día, clases.join(' '), true, fecha);
      }

      // Días del mes siguiente
      const diasSiguiente = 42 - (diasAnterior + diasMes);
      for (let día = 1; día <= diasSiguiente; día++) {
        agregarDiaAlCalendario(daysGrid, día, 'other-month', false);
      }
    }

    function agregarDiaAlCalendario(container, dia, clases, clickeable, fecha) {
      const elemento = document.createElement('div');
      elemento.className = 'day ' + clases;
      elemento.textContent = dia;

      if (clickeable && fecha) {
        elemento.style.cursor = 'pointer';
        elemento.addEventListener('click', () => {
          selectedDate = new Date(fecha);
          renderizarCalendario();
          cargarReservasDelDia();
        });
      }

      container.appendChild(elemento);
    }

    function esHoyFunc(fecha) {
      const hoy = new Date();
      return fecha.getDate() === hoy.getDate() &&
             fecha.getMonth() === hoy.getMonth() &&
             fecha.getFullYear() === hoy.getFullYear();
    }

    function esSeleccionadoFunc(fecha) {
      return fecha.getDate() === selectedDate.getDate() &&
             fecha.getMonth() === selectedDate.getMonth() &&
             fecha.getFullYear() === selectedDate.getFullYear();
    }

    async function cargarReservasDelDia() {
      const año = selectedDate.getFullYear();
      const mes = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const día = String(selectedDate.getDate()).padStart(2, '0');
      const fechaStr = \`\${año}-\${mes}-\${día}\`;

      document.getElementById('selectedDateDisplay').textContent = 
        selectedDate.toLocaleDateString('es-MX', { weekday: 'long', month: 'long', day: 'numeric' });

      try {
        const response = await fetch(\`\${API_BASE}/api/reservas/\${fechaStr}\`);
        const reservas = await response.json();

        const container = document.getElementById('reservasContainer');
        if (!reservas || reservas.length === 0) {
          container.className = 'day-reservas empty';
          container.textContent = 'No hay juntas programadas para este día';
        } else {
          container.className = 'day-reservas';
          container.innerHTML = reservas.map((r, i) => \`
            <div class="reserva-item \${i === reservas.length - 1 ? 'last' : ''}"">
              <div class="reserva-horario">\${r.hora_inicio} - \${r.hora_final}</div>
              <div class="reserva-asunto">\${r.asunto}</div>
              <div class="reserva-responsable">Responsable: \${r.responsable}</div>
            </div>
          \`).join('');
        }
      } catch (error) {
        console.error('Error cargando reservas:', error);
        const container = document.getElementById('reservasContainer');
        container.className = 'day-reservas empty';
        container.textContent = 'Error al cargar las juntas';
      }
    }

    document.getElementById('prevMonth').addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      renderizarCalendario();
    });

    document.getElementById('nextMonth').addEventListener('click', () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      renderizarCalendario();
    });

    document.getElementById('reservaForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;

      const responsable = document.getElementById('responsable').value;
      const asunto = document.getElementById('asunto').value;
      const fecha = document.getElementById('fecha').value;
      const hora_inicio = document.getElementById('horaInicio').value;
      const hora_final = document.getElementById('horaFinal').value;

      try {
        const response = await fetch(\`\${API_BASE}/api/reservas\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            responsable, asunto, fecha, hora_inicio, hora_final
          })
        });

        const data = await response.json();

        if (response.ok) {
          cancelacionCodigoActual = data.cancelacion_codigo;
          document.getElementById('modalCode').textContent = data.cancelacion_codigo;
          document.getElementById('confirmModal').classList.add('active');
          
          // Limpiar formulario
          document.getElementById('reservaForm').reset();
          inicializarFormulario();
          
          // Recargar reservas del día
          cargarReservasDelDia();
          mostrarNotificacion('Reserva creada exitosamente', 'success');
        } else {
          mostrarNotificacion(data.error || 'Error al crear reserva', 'error');
        }
      } catch (error) {
        console.error('Error:', error);
        mostrarNotificacion('Error de conexión', 'error');
      } finally {
        btn.disabled = false;
      }
    });

    function copiarCodigo() {
      const codigo = document.getElementById('modalCode').textContent;
      navigator.clipboard.writeText(codigo).then(() => {
        mostrarNotificacion('Código copiado al portapapeles', 'success');
      });
    }

    function cerrarModal() {
      document.getElementById('confirmModal').classList.remove('active');
    }

    function mostrarNotificacion(mensaje, tipo) {
      const notif = document.createElement('div');
      notif.className = \`notification \${tipo}\`;
      notif.textContent = mensaje;
      document.body.appendChild(notif);
      setTimeout(() => notif.remove(), 4000);
    }

    function actualizarReservasCada15Segundos() {
      setInterval(cargarReservasDelDia, 15000);
    }

    // Cierra el modal cuando se hace clic fuera
    document.getElementById('confirmModal').addEventListener('click', (e) => {
      if (e.target.id === 'confirmModal') {
        cerrarModal();
      }
    });
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    return router.handle(request, env);
  }
};
