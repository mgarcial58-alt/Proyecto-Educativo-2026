# Explora y Aprende 2026

Seis juegos educativos con React/Vite, API Node.js/Express y resultados en MySQL. El panel docente valida una contraseña en el backend. Los estudiantes pueden registrarse y jugar sin conocer esa contraseña.

## Empezar en Windows

Usa Node.js 24 y una base de datos **local de prueba**. Si ya tienes `backend/.env`, conserva sus valores y comprueba que no apunten a producción antes de probar. La configuración de autenticación se guarda aparte.

En PowerShell:

```powershell
Set-Location 'C:\Users\DELL\Desktop\Proyecto-Educativo-2026-Etapa1\Proyecto-Educativo-2026\backend'
npm.cmd ci
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
npm.cmd run configurar-docente
```

El último comando pide y confirma la contraseña con entrada oculta; usa una frase única de al menos 12 caracteres. No la escribas en el chat ni como argumento de un comando. Genera `backend/.env.auth`, excluido de Git. No envíes ese archivo ni lo incluyas en capturas.

Edita `backend/.env` en tu editor con los datos de MySQL local. Para una instalación local nueva, importa `database/schema.sql` en una base vacía. **Esta mejora no requiere migración ni volver a importar el esquema en la base existente.**

Inicia la API:

```powershell
npm.cmd run dev
```

En otra terminal:

```powershell
Set-Location 'C:\Users\DELL\Desktop\Proyecto-Educativo-2026-Etapa1\Proyecto-Educativo-2026\frontend'
npm.cmd ci
npm.cmd run dev
```

Abre [la aplicación local](http://localhost:5173). La API local usa `http://localhost:3001`. Si el puerto del frontend cambia, agrega ese origen exacto a `CORS_ORIGIN` y reinicia la API.

## Usar la aplicación

- **Estudiante nuevo:** regístralo y elige uno de los seis juegos. Su acceso individual se recuerda en ese navegador durante siete días por defecto.
- **Estudiante que ya jugó en ese navegador:** selecciónalo en la lista de este dispositivo. La aplicación comprueba su acceso con el servidor.
- **Estudiante antiguo o en otro dispositivo:** entra como docente, selecciona su nombre en el filtro y pulsa “Habilitar estudiante y cerrar sesión”. Se conservan sus resultados anteriores. El nombre o el número de alumno por sí solos no dan acceso a su perfil.
- **Docente:** pulsa “Docentes”, introduce la contraseña y consulta o filtra los resultados. Usa “Cerrar sesión” al terminar.

La sesión docente vence en 60 minutos por defecto; salir del panel o recargar la página requiere volver a entrar. La lista global de alumnos ya no es pública. En un equipo compartido, pulsa “Olvidar” junto al perfil local al terminar; no borra sus resultados en MySQL. Si el navegador bloquea el almacenamiento, aún se puede jugar durante esa visita y la aplicación avisa que no recordará el perfil.

## Comprobar los cambios

```powershell
Set-Location 'C:\Users\DELL\Desktop\Proyecto-Educativo-2026-Etapa1\Proyecto-Educativo-2026\backend'
npm.cmd test
Set-Location '..\frontend'
npm.cmd run build
```

Las pruebas de la API usan una base simulada y no escriben en MySQL. La compilación comprueba el frontend. La revisión manual con MySQL y las comprobaciones tras publicar están en [la guía de despliegue](documentacion/DESPLIEGUE-SEGURO.md).

## Publicación

Consulta [DESPLIEGUE-SEGURO.md](documentacion/DESPLIEGUE-SEGURO.md) para configurar Alwaysdata, actualizar desde GitHub, compilar en Vercel y comprobar los permisos. Un `git push` a una rama conectada con Vercel puede publicar automáticamente; realiza esos pasos solo después de aprobar la publicación.

Sitios del proyecto: [frontend](https://proyecto-educativo-2026.vercel.app) y [API](https://explorayaprende2026.alwaysdata.net/api/salud). Que esos enlaces funcionen no confirma que ya tengan esta actualización.
