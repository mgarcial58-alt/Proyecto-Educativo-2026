# Validación local de autenticación — 28 de octubre de 2026

## Resultado

- Instalación limpia de backend y frontend con `npm ci`: correcta. Se sincronizó el `package-lock.json` del frontend con su `package.json`, que antes no coincidían.
- `npm test` del backend: **14 pruebas aprobadas**, 0 fallos. Utilizan HTTP local y una base simulada; no cargan credenciales de MySQL.
- `npm run build` del frontend: correcto con las dependencias del archivo de bloqueo (Vite 6.4.5).
- Prueba de navegador sobre una API local aislada: registro, acceso a un alumno anterior, seis juegos completos, consulta de seis resultados, filtro, actualización, cierre de sesión y recuperación del alumno después de recargar: correctos.

## Casos de seguridad comprobados

1. Hash con sal aleatoria y verificación de contraseña; rechazo de formatos inseguros.
2. El servidor rechaza configuración sin secretos válidos u orígenes CORS exactos.
3. Consultas globales nuevas y antiguas devuelven `401` sin sesión, incluso con filtro por alumno.
4. Contraseña incorrecta no abre sesión; una contraseña temporal de prueba sí.
5. Cierre de sesión revoca el token; caducidad y reinicio lo invalidan.
6. Límites por IP y global devuelven `429`; encabezados de proxy no confiables no evaden el límite.
7. CORS permite el origen configurado y el encabezado Authorization; rechaza orígenes ajenos.
8. Registro de dos alumnos y guardado de las seis actividades sin sesión docente.
9. Un alumno no puede guardar resultados para otro ni consultar los de otro; los roles no se intercambian.
10. Firma alterada, identificador manipulado y credencial vencida son rechazados.
11. Docente puede habilitar un perfil previo conservando su identificador e historial.
12. Validación de registro, puntajes, filtros, tipo y tamaño del cuerpo de las solicitudes.
13. Respuestas privadas sin caché y errores sin detalles de la base de datos.
14. En navegador, salir o recargar el panel vuelve a pedir contraseña. Los perfiles de alumnos recordados siguen disponibles en ese dispositivo.

## Límites de esta validación

La prueba visual y las pruebas automatizadas utilizaron datos temporales simulados, no MySQL real. Los seis registros observados no se enviaron a Alwaysdata. No se publicó, hizo push ni modificó ninguna configuración de Vercel o Alwaysdata.

Antes de publicar, el usuario debe definir la contraseña privada, comprobar la conexión con su MySQL de prueba y seguir el despliegue coordinado y las verificaciones de `DESPLIEGUE-SEGURO.md`. Continúa pendiente rotar la contraseña de MySQL mencionada como expuesta en la conversación anterior.
