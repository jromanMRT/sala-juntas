# 📅 Reserva Sala de Juntas

Herramienta temporal y sencilla para reservar una sala de juntas. Diseñada para equipos pequeños que necesitan gestionar reservas compartidas sin complicaciones.

## ✨ Características

- **Calendario mensual interactivo** para visualizar y seleccionar fechas
- **Consulta de reservas** con asunto, responsable y horario
- **Reserva sin autenticación** - solo ingresa tu nombre
- **Almacenamiento compartido** en base de datos D1 (SQLite)
- **Validación de conflictos atómica** - bloquea reservas que se empalmen
- **Código de cancelación privado** - solo el responsable puede cancelar su reserva
- **Actualización automática cada 15 segundos**
- **Zona horaria America/Chihuahua** mostrada claramente
- **Responsive** - funciona en celular y computadora

## 🚀 Despliegue

### Requisitos

- Cuenta de Cloudflare (gratuita)
- Node.js 16+
- Wrangler CLI (`npm install -g wrangler`)

### Pasos

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/jromanMRT/sala-juntas.git
   cd sala-juntas
   ```

2. **Autenticarse con Cloudflare**
   ```bash
   wrangler login
   ```

3. **Crear base de datos D1**
   ```bash
   wrangler d1 create sala-juntas-db
   ```
   Copia el `database_id` que aparece y pégalo en `wrangler.toml`:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "sala-juntas-db"
   database_id = "TU_DATABASE_ID_AQUI"
   ```

4. **Ejecutar migraciones**
   ```bash
   wrangler d1 execute sala-juntas-db --file migrations/001_init.sql --remote
   ```

5. **Desplegar**
   ```bash
   wrangler deploy
   ```

   La aplicación se publicará en una URL como: `https://sala-juntas.TU_USUARIO.workers.dev`

## 🔧 Desarrollo Local

```bash
npm install
npm run dev
```

Accede a `http://localhost:8787`

## 📋 API Endpoints

### GET `/api/reservas/:fecha`
Obtiene todas las reservas activas de una fecha (formato: `YYYY-MM-DD`)

**Respuesta:**
```json
[
  {
    "id": "uuid",
    "responsable": "Juan Pérez",
    "asunto": "Revisión de proyecto",
    "fecha": "2024-09-20",
    "hora_inicio": "09:00",
    "hora_final": "10:00",
    "creada_en": "2024-09-14T17:30:00Z"
  }
]
```

### POST `/api/reservas`
Crea una nueva reserva

**Body:**
```json
{
  "responsable": "Juan Pérez",
  "asunto": "Revisión de proyecto",
  "fecha": "2024-09-20",
  "hora_inicio": "09:00",
  "hora_final": "10:00"
}
```

**Respuesta (201):**
```json
{
  "id": "uuid",
  "responsable": "Juan Pérez",
  "asunto": "Revisión de proyecto",
  "fecha": "2024-09-20",
  "hora_inicio": "09:00",
  "hora_final": "10:00",
  "cancelacion_codigo": "ABC12345"
}
```

### POST `/api/reservas/:id/cancelar`
Cancela una reserva usando su código privado

**Body:**
```json
{
  "cancelacion_codigo": "ABC12345"
}
```

## 🔒 Validaciones

- ✅ No permite reservas en fechas pasadas
- ✅ Rechaza si hora final ≤ hora inicial
- ✅ Detecta conflictos de horario (bloqueo atómico)
- ✅ Permite que una junta empiece exactamente cuando termina otra
- ✅ Campos obligatorios: responsable, asunto, fecha, hora inicio, hora final

## 📊 Funcionamiento Compartido

Las reservas se almacenan en D1 (base de datos SQLite de Cloudflare) y son **compartidas automáticamente** entre todos los usuarios que accedan al enlace. No usa localStorage.

### Prueba de funcionamiento compartido:
1. Abre la URL en dos navegadores diferentes
2. Crea una reserva en uno
3. La reserva aparecerá en el otro automáticamente en ~15 segundos

## 🛑 Limitaciones Conocidas

- Una sola sala (no hay múltiples salas)
- Sin panel administrativo
- Sin integración de correos
- Sin verificación de identidad
- Cancelación solo con código privado (no hay recuperación)

## 📧 Soporte

Para reportar problemas, abre un issue en el repositorio.

## 📄 Licencia

Código abierto para uso libre.

---

**Zona Horaria:** America/Chihuahua (UTC-6, UTC-5 en horario de verano)
