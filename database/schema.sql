CREATE DATABASE IF NOT EXISTS educativo2026 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE educativo2026;
CREATE TABLE IF NOT EXISTS estudiantes (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(100) NOT NULL, edad TINYINT UNSIGNED NOT NULL, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS actividades (id INT AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(50) NOT NULL UNIQUE, titulo VARCHAR(100) NOT NULL, nivel ENUM('preprimaria','primaria') NOT NULL);
CREATE TABLE IF NOT EXISTS progresos (id INT AUTO_INCREMENT PRIMARY KEY, estudiante_id INT NOT NULL, actividad_id INT NOT NULL, puntaje INT NOT NULL, total INT NOT NULL, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(estudiante_id) REFERENCES estudiantes(id), FOREIGN KEY(actividad_id) REFERENCES actividades(id));
INSERT IGNORE INTO actividades (codigo,titulo,nivel) VALUES ('espacial','Conocimientos espaciales','preprimaria'),('figuras','Figuras geométricas','preprimaria'),('memoria','Juego de memoria','preprimaria'),('tablas','Tablas de multiplicar','primaria'),('fracciones','Suma de quebrados','primaria'),('decimales','Multiplicación con decimales','primaria');
