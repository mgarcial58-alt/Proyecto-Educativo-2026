# Contraseña docente, pruebas y despliegue

La actualización protege en Express tanto el panel docente como las consultas globales de alumnos y resultados. Los seis juegos conservan su registro de progreso mediante un acceso individual del estudiante. No cambia el esquema de MySQL ni borra datos existentes.

## 1. Configurar la contraseña en privado

Desde `backend`, en una terminal de tu equipo:

```powershell
npm.cmd run configurar-docente
```

Introduce una contraseña única de al menos 12 caracteres, con un máximo de 256 bytes, y repítela. No se muestra en pantalla ni se recibe como argumento. El script crea `backend/.env.auth` con:

| Variable | Uso |
| --- | --- |
| `DOCENTE_PASSWORD_HASH` | Hash de la contraseña; el servidor verifica la entrada con scrypt. |
| `STUDENT_TOKEN_SECRET` | Clave aleatoria que firma los accesos individuales de alumnos. |

El archivo es privado y está excluido de Git. El hash usa sal aleatoria de 16 bytes, clave derivada de 64 bytes y scrypt `N=32768, r=8, p=3`; es una combinación descrita en las [recomendaciones de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). La comparación se realiza en tiempo constante.

Para cambiar la contraseña, ejecuta de nuevo el script y reinicia el backend. Conserva la clave de alumnos existente para no invalidar sus accesos. Si la clave de alumnos se pierde, se cambia o se sospecha comprometida, reemplázala y reinicia: todos los alumnos necesitarán habilitar de nuevo su perfil desde el panel. Los resultados permanecen en MySQL.

El backend carga `.env` y `.env.auth`; las variables ya definidas por el alojamiento tienen prioridad. Si la contraseña sigue siendo la antigua en Alwaysdata, actualiza allí `DOCENTE_PASSWORD_HASH` y reinicia. Evita definir una misma variable con valores diferentes en varios lugares.

Los valores del archivo privado llevan comillas simples para conservar caracteres como `$`. Para copiarlos al campo de una variable del panel de alojamiento, copia **solo el valor**, sin comillas exteriores. Si usas un campo de varias líneas, sigue su formato y conserva todos los caracteres del hash. No pegues valores secretos en comandos de shell, en este chat, en GitHub ni en archivos del frontend.

## 2. Variables por entorno

Mantén las variables `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME` de tu base correspondiente. La copia local debe apuntar a una base de prueba. No uses los datos reales de producción para las pruebas automáticas o la demostración local.

Valores públicos recomendados para desarrollo, en `backend/.env`:

```dotenv
NODE_ENV=development
PORT=3001
IP=127.0.0.1
CORS_ORIGIN=http://localhost:5173
TRUST_PROXY=0
DOCENTE_SESSION_MINUTES=60
ESTUDIANTE_SESSION_DAYS=7
```

Para producción, conserva la dirección y el puerto que Alwaysdata asigna al sitio y configura:

```dotenv
NODE_ENV=production
CORS_ORIGIN=https://proyecto-educativo-2026.vercel.app
TRUST_PROXY=0
DOCENTE_SESSION_MINUTES=60
ESTUDIANTE_SESSION_DAYS=7
```

Agrega, en privado, `DOCENTE_PASSWORD_HASH`, `STUDENT_TOKEN_SECRET` y las variables de MySQL. No copies el `IP` o `PORT` local al sitio de Alwaysdata.

El frontend de Vercel solo necesita esta variable pública:

```dotenv
VITE_API_URL=https://explorayaprende2026.alwaysdata.net
```

No agregues la contraseña, el hash ni claves como variables `VITE_*`: Vite incorpora esas variables al código que descarga el navegador. Véase [variables y modos de Vite](https://github.com/vitejs/vite/blob/main/docs/guide/env-and-mode.md).

## 3. Permisos y sesiones

Todas las credenciales de acceso viajan en `Authorization: Bearer ...`, por HTTPS en producción. El frontend no envía cookies. Esto permite conectar Vercel con Alwaysdata sin depender de cookies de terceros. CORS limita qué orígenes puede usar el navegador, pero la autorización se comprueba por separado en cada ruta privada.

| Ruta | Acceso |
| --- | --- |
| `GET /api/salud` | Público; comprueba conexión a MySQL sin revelar credenciales. |
| `GET /api/actividades` | Público; devuelve el catálogo de seis actividades. |
| `POST /api/estudiantes` | Público; registra un alumno y devuelve únicamente su perfil y acceso individual. |
| `GET /api/mi-estudiante` | Acceso de alumno; devuelve su propio perfil. |
| `GET /api/mis-progresos` | Acceso de alumno; consulta sus propios resultados. |
| `POST /api/progresos` | Acceso de alumno; exige que `estudiante_id` corresponda a su credencial. |
| `POST /api/docentes/login` | Público, limitado; verifica `password` y emite una sesión docente. |
| `GET /api/docentes/sesion` | Sesión docente; comprueba su vigencia. |
| `POST /api/docentes/logout` | Sesión docente; revoca esa sesión en el servidor. |
| `GET /api/docentes/estudiantes` | Sesión docente; listado global de alumnos. |
| `GET /api/docentes/progresos` | Sesión docente; resultados, con filtro opcional `estudiante_id`. |
| `POST /api/docentes/estudiantes/:id/acceso` | Sesión docente; habilita un alumno existente en el dispositivo actual. |
| `GET /api/estudiantes` | Sesión docente; ruta antigua protegida. |
| `GET /api/progresos` | Sesión docente; ruta antigua protegida, incluso con `estudiante_id`. |

La sesión docente usa un token opaco aleatorio. El navegador lo conserva solo en memoria, nunca en `localStorage` o `sessionStorage`; el servidor conserva su hash. Al cerrar sesión se revoca; al recargar la página, vencer el plazo o reiniciar la API se debe entrar otra vez. La duración predeterminada es 60 minutos, configurable de 5 a 120 minutos. La interfaz elimina los datos docentes al cerrar sesión o detectar una sesión vencida.

Los accesos de alumnos están firmados, incluyen su identificador y vencen en siete días por defecto, configurables entre 1 y 30 días. El navegador puede recordar hasta 50 perfiles **de ese dispositivo**. Una credencial de alumno no permite entrar en las rutas docentes ni elegir arbitrariamente otro alumno. Los perfiles anteriores a esta actualización requieren habilitación docente; no se pueden recuperar solo indicando un nombre o identificador. En el panel, selecciona el alumno en “Filtrar por estudiante” y pulsa “Habilitar estudiante y cerrar sesión”. La aplicación cierra la sesión docente antes de entregar el juego al alumno. El número junto al nombre ayuda a distinguir nombres repetidos.

En equipos compartidos, quien tenga acceso al navegador puede usar los perfiles allí recordados. “Olvidar” elimina la credencial local de un perfil, pero no sus resultados en la base. Si el almacenamiento del navegador está bloqueado, el estudiante puede jugar durante esa visita y verá un aviso de que su acceso no se recordará. No compartas credenciales de alumno por URL o capturas. Los puntajes siguen siendo enviados por el juego: esta autenticación limita a quién pertenece el registro, pero no constituye un sistema contra trampas.

### Límites y configuración del proxy

El inicio de sesión permite hasta cinco intentos por dirección en 15 minutos y hasta 30 intentos globales en ese plazo; al alcanzar un límite responde `429` con tiempo de espera. También limita las verificaciones de contraseña simultáneas. No desactives estos límites para resolver errores de acceso.

La configuración inicial `TRUST_PROXY=0` no confía en encabezados reenviados. En Alwaysdata varios usuarios pueden verse como una misma dirección del proxy y compartir el límite. Antes de cambiarlo, verifica con Alwaysdata la cadena real de proxies y que no exista una ruta más corta de acceso a Node. Esta versión admite un número de saltos entre 0 y 5; configura únicamente un valor confirmado. No uses confianza ilimitada ni supongas que `X-Forwarded-For` es fiable. El [manual de Express sobre proxies](https://expressjs.com/en/guide/behind-proxies/) explica por qué una configuración incorrecta permite falsear la dirección del cliente.

Sesiones docentes y límites viven en la memoria de **un único proceso Node**. Un reinicio los vacía y exige nueva sesión docente. Si se ejecutan varias instancias, antes hay que trasladar sesiones y límites a un almacén compartido con expiración; esta versión está diseñada para una instancia.

## 4. Pruebas locales

Ejecuta en PowerShell:

```powershell
Set-Location 'C:\Users\DELL\Desktop\Proyecto-Educativo-2026-Etapa1\Proyecto-Educativo-2026\backend'
npm.cmd ci
npm.cmd test
Set-Location '..\frontend'
npm.cmd ci
npm.cmd run build
```

Las pruebas de API usan un adaptador de base simulado: verifican autenticación y autorización sin tocar la base real. Una compilación correcta tampoco sustituye probar el navegador y MySQL. Para la prueba manual, inicia API y frontend como indica el README y usa una base local de prueba:

1. Abre una ventana privada. Comprueba que ves el catálogo, puedes registrar un alumno y no ves un listado global de otros alumnos.
2. Completa y guarda las seis actividades: espacios, figuras, memoria, tablas, fracciones y decimales. Verifica un resultado de cada una en MySQL o en el panel docente.
3. Recarga y selecciona el alumno recordado. Comprueba que el acceso funciona y no crea un alumno duplicado. Prueba también olvidar su acceso local.
4. Entra en “Docentes” con una contraseña incorrecta y luego con la correcta. Comprueba filtros, actualización y habilitación de un alumno anterior en el dispositivo actual.
5. Cierra sesión. Al volver a “Docentes”, debe pedir la contraseña. Recargar la página también debe pedirla. Ningún dato docente debe reaparecer por una respuesta tardía.
6. Comprueba el vencimiento con una sesión de cinco minutos en el entorno local y restablece después 60 minutos. La API debe rechazar también el token vencido.
7. Sin autenticarte, comprueba que tanto las rutas antiguas como las nuevas de datos docentes responden `401`. No pegues tokens reales en comandos o historiales para probarlas.

Comprobación anónima sencilla, sin secretos:

```powershell
curl.exe -i http://localhost:3001/api/salud
curl.exe -i http://localhost:3001/api/estudiantes
curl.exe -i http://localhost:3001/api/progresos
curl.exe -i http://localhost:3001/api/docentes/estudiantes
curl.exe -i http://localhost:3001/api/docentes/progresos
curl.exe -i -H 'Origin: https://origen-no-autorizado.example' http://localhost:3001/api/actividades
```

Se espera `200` para salud con MySQL disponible, `401` en las cuatro consultas de datos y rechazo del origen desconocido. Los casos de token alterado, roles distintos, guardado a otro alumno y límites de login forman parte de la suite automatizada; repetir intentos en producción puede bloquear temporalmente a docentes reales.

## 5. Preparar GitHub sin publicar por accidente

Primero revisa los cambios en la carpeta real del proyecto:

```powershell
Set-Location 'C:\Users\DELL\Desktop\Proyecto-Educativo-2026-Etapa1\Proyecto-Educativo-2026'
git status --short
git diff --stat
git ls-files -- backend/.env backend/.env.auth backend/.env.local.backup frontend/.env frontend/.env.local
git check-ignore backend/.env backend/.env.auth
```

`git ls-files` no debe listar archivos privados; `git check-ignore` debe confirmar que `.env` y `.env.auth` se ignoran. Si aparece un secreto rastreado, detente antes de compartir: excluirlo ahora no lo elimina del historial. Si Git informa que la carpeta no es un árbol de trabajo, revisa su configuración o usa una copia nueva; no apliques `reset --hard`, `clean`, `checkout --force` ni borres `.git` para resolverlo.

Revisa el contenido antes de preparar el commit. Usa la selección de archivos de tu editor o comandos con rutas concretas; no incluyas archivos privados, `node_modules` ni `dist`. Los archivos `.env.example` contienen solo ejemplos y sí pueden versionarse.

Cuando el usuario autorice publicar, confirma la rama que Vercel usa para producción, crea el commit de los archivos revisados y súbelo a GitHub. **Un push a la rama conectada puede iniciar el despliegue automáticamente.** Vercel permite compilar una referencia de Git concreta y elegir el directorio raíz al importar el repositorio; consulta su [guía de despliegue desde Git](https://vercel.com/docs/git).

## 6. Actualizar el backend en Alwaysdata

Estos pasos se ejecutan solo después de autorizar el despliegue. Prepara backend y frontend como una misma actualización: el frontend antiguo usa listados públicos y guardados sin credencial que la nueva API rechazará. Habrá una breve transición hasta desplegar y recargar ambos. No vuelvas a abrir las rutas para sostener un frontend antiguo.

1. En Alwaysdata, anota el directorio actual, el comando y la versión desplegada; conserva esa carpeta y una copia de seguridad de MySQL. No importes `schema.sql` sobre la base existente.
2. Abre SSH con el usuario, servidor y huella que muestra **Remote access → SSH/SFTP**. Puedes usar una clave SSH; no escribas contraseñas o tokens en la URL de Git. Referencia: [acceso SSH de Alwaysdata](https://help.alwaysdata.com/en/docs/web-hosting/remote-access/ssh/).
3. Descarga desde GitHub una copia nueva del commit aprobado. Así conservas intacta la carpeta anterior. En una terminal Bash de Alwaysdata, este bloque pide los datos no secretos que debes obtener de tu proyecto:

```bash
read -r -p 'URL de GitHub del repositorio, sin tokens: ' repo_url
read -r -p 'Carpeta absoluta NUEVA para esta versión: ' release_dir
read -r -p 'Identificador del commit aprobado: ' release_commit
if [ -e "$release_dir" ]; then
  printf '%s\n' 'La carpeta ya existe. Elige una carpeta nueva.'
else
  git clone -- "$repo_url" "$release_dir" &&
  cd "$release_dir" &&
  git checkout --detach "$release_commit" &&
  cd backend &&
  npm ci --omit=dev &&
  npm test
fi
```

4. Desde el `backend` de esa copia, ejecuta `npm run configurar-docente` en SSH para elegir la contraseña en privado, o transfiere el archivo privado de configuración mediante SFTP y restringe su acceso. Para mantener los accesos de alumnos en una actualización posterior, conserva exactamente el `STUDENT_TOKEN_SECRET` de producción; no lo sustituyas por el de pruebas locales. No dejes el archivo bajo un directorio servido como contenido estático.
5. En **Web → Sites**, edita el sitio de la API existente. Usa tipo **Node.js**, Node.js 24, directorio de trabajo `backend` dentro de la copia nueva y comando `node src/index.js`. Conserva la dirección y el puerto asignados por Alwaysdata; el código usa sus variables `IP` y `PORT`. Véase [configuración oficial de Node.js](https://help.alwaysdata.com/en/docs/web-hosting/languages/nodejs/configuration/).
6. Conserva las variables de MySQL y agrega las de producción de la sección 2. Puedes definir los dos secretos en el ambiente del sitio, copiándolos en privado del archivo generado; tienen prioridad sobre los archivos. No los dupliques con valores contradictorios. Mantén HTTPS forzado y una única instancia.
7. Guarda y reinicia el sitio. Consulta los registros si no arranca, sin compartir valores de entorno. Comprueba [salud de la API](https://explorayaprende2026.alwaysdata.net/api/salud) y las rutas privadas sin autenticación.

El antecedente del proyecto indica que la contraseña de MySQL se compartió anteriormente. **Su rotación sigue pendiente**: cambia la contraseña del usuario de base en Alwaysdata, actualiza `DB_PASSWORD` en el sitio y reinicia coordinadamente. No copies aquí la nueva contraseña. Esta implementación no cambia esa contraseña por sí misma.

## 7. Actualizar el frontend en Vercel

En el proyecto de Vercel ya conectado con GitHub, verifica:

| Configuración | Valor |
| --- | --- |
| Framework | Vite |
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm ci` o el valor automático compatible con `package-lock.json` |
| `VITE_API_URL` | `https://explorayaprende2026.alwaysdata.net` |

Publica el commit aprobado y espera a que la compilación termine. Los cambios de variables requieren un nuevo despliegue; no modifican una compilación ya publicada. Consulta [Vite en Vercel](https://vercel.com/docs/frameworks/frontend/vite) y [variables de entorno de Vercel](https://vercel.com/docs/environment-variables).

El dominio autorizado en el backend debe ser exactamente `https://proyecto-educativo-2026.vercel.app`, sin barra final ni rutas. Si pruebas una vista previa de Vercel, agrega temporalmente **esa URL exacta** a `CORS_ORIGIN`, separada por coma, y reinicia la API. No autorices `*` ni todos los subdominios de Vercel. Elimina la URL temporal al terminar. `frontend/vercel.json` incluye una política CSP que permite conectar únicamente con la API de Alwaysdata indicada: si cambias el dominio de la API, actualiza tanto `VITE_API_URL` como `connect-src` en ese archivo y vuelve a desplegar.

Recarga completamente la aplicación al terminar el despliegue para sustituir el frontend antiguo. Una pestaña abierta antes de la actualización puede requerir recarga y habilitación del alumno. Los resultados que ya estaban guardados se conservan.

## 8. Comprobación después de publicar

- La API y el frontend usan HTTPS y muestran la versión recién desplegada.
- En ventana privada, abrir `/api/estudiantes`, `/api/progresos`, `/api/docentes/estudiantes` y `/api/docentes/progresos` devuelve `401` sin listar alumnos ni puntajes.
- El catálogo muestra las seis actividades y un alumno de prueba puede completar y guardar cada una. En el panel docente aparecen los seis registros esperados.
- Contraseña incorrecta no permite entrar; la correcta sí. Cerrar sesión y volver a abrir el panel exige contraseña. Recargar también la exige.
- El alumno antiguo puede habilitarse desde el panel, conserva sus resultados y no necesita un registro duplicado.
- No hay errores CORS en el dominio autorizado; un origen ajeno es rechazado.
- Los secretos no aparecen en GitHub ni en archivos del frontend. La sesión docente no se guarda en el almacenamiento del navegador.
- Tras reiniciar la API, las sesiones docentes anteriores dejan de servir. Los accesos de alumno siguen vigentes si se conservó su clave y no han vencido.

Si falla la publicación, conserva los registros y la versión anterior para diagnosticar. Volver al backend anterior reabriría sus endpoints sin autenticación; no lo hagas como una corrección automática. Corrige la versión protegida o coordina una ventana de mantenimiento.
