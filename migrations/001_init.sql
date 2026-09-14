-- Tabla de reservas de sala de juntas
CREATE TABLE IF NOT EXISTS reservas (
  id TEXT PRIMARY KEY,
  responsable TEXT NOT NULL,
  asunto TEXT NOT NULL,
  fecha TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  hora_final TEXT NOT NULL,
  cancelacion_codigo TEXT NOT NULL UNIQUE,
  creada_en DATETIME DEFAULT CURRENT_TIMESTAMP,
  cancelada BOOLEAN DEFAULT 0,
  cancelada_en DATETIME
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_fecha ON reservas(fecha);
CREATE INDEX IF NOT EXISTS idx_activas ON reservas(cancelada, fecha);
CREATE INDEX IF NOT EXISTS idx_fecha_horario ON reservas(fecha, hora_inicio, hora_final);
