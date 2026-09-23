# Finance & Crypto Portfolio Tracker

App personal para seguir dos carteras independientes, pensada para correr en un servidor casero dentro de la LAN:

- **Cripto**: saldos por moneda, historial de intercambios (lo que entregás → lo que recibís, con comisión opcional), un objetivo en USDT y el gráfico de crecimiento.
- **CEDEARs / ETF**: compras y ventas con precio promedio ponderado, dinero disponible en USD y ARS, peso de cada posición, historial y gráfico de crecimiento. Pesos y dólares se muestran por separado, sin tipo de cambio.

Las dos secciones tienen las mismas pestañas (**Cartera**, **Historial**, **Crecimiento**), muestran la variación del día y se pueden **exportar a CSV**. La app se puede **instalar en el celular**.

> **Pendiente:** la conexión con las APIs de precios de mercado (Binance para cripto y la que corresponda para CEDEARs/ETF). Mientras tanto la app usa **precios simulados** (la UI lo avisa con la etiqueta "Precios simulados"). Ver [Conectar las APIs de precios](#conectar-las-apis-de-precios).

## Stack

| Parte | Elección | Por qué |
|---|---|---|
| Backend | Node.js 24 + Fastify | Liviano y rápido; un solo proceso |
| Base de datos | SQLite (better-sqlite3), modo WAL | Embebida, un archivo, cero mantenimiento |
| Frontend | Preact + Vite, CSS propio, gráfico SVG propio | ~15 KB gzip de JS, sin librerías de UI ni de gráficos |
| Deploy | Un solo contenedor con Docker Compose | Límite de 256 MB de RAM y media CPU |

## Deploy en el servidor (Ubuntu + Docker Compose)

```bash
git clone https://github.com/ElJm4esHD/finance-crypto-portfolio.git
cd finance-crypto-portfolio

# Carpeta de datos persistentes (el contenedor corre como UID 1000)
sudo mkdir -p /srv/finance-crypto-portfolio/data
sudo chown -R 1000:1000 /srv/finance-crypto-portfolio

docker compose up -d --build
```

Después entrá desde cualquier dispositivo de la LAN a `http://<ip-del-servidor>:8080`.

Si el puerto 8080 ya lo usa otra app: `docker compose down`, elegí uno libre (`sudo ss -tlnp | grep ':8100 '` no debe mostrar nada), `echo "PORT=8100" > .env` y `docker compose up -d`.

Variables que se pueden cambiar con un archivo `.env` al lado de `docker-compose.yml`:

| Variable | Default | Para qué |
|---|---|---|
| `PORT` | `8080` | Puerto en el host |
| `DATA_PATH` | `/srv/finance-crypto-portfolio/data` | Carpeta de datos en el host |
| `PUID` / `PGID` | `1000` | Usuario con el que corre el contenedor (dueño de `DATA_PATH`) |

**No expongas el puerto a internet** (no hagas port forwarding en el router): la app no tiene login porque está pensada solo para la red local.

Actualizar a una versión nueva: `git pull && docker compose up -d --build`.

### Datos y backups

En `/srv/finance-crypto-portfolio/data/`:

- `portfolio.db` — la base SQLite (más `-wal`/`-shm`, que son parte de ella).
- `backups/portfolio-AAAA-MM-DD.db` — una copia consistente por día; se guardan las últimas 14 (`BACKUP_KEEP`).

Para restaurar: `docker compose down`, reemplazá `portfolio.db` por un backup (y borrá `portfolio.db-wal` / `portfolio.db-shm`), `docker compose up -d`.

## Cómo funciona

### Cripto
- Los **saldos** se cargan a mano al empezar y se pueden corregir cuando quieras (lápiz en cada moneda).
- Cada **intercambio** resta lo que entregás, suma lo que recibís y descuenta la comisión en la moneda que indiques. No se calcula ningún tipo de cambio: se guarda lo que declarás.
- Si un intercambio dejaría un saldo en negativo, se rechaza con un mensaje claro (suele significar que falta corregir un saldo).
- **Borrar** un intercambio revierte su efecto sobre los saldos.

### CEDEARs / ETF
- Una posición se identifica por **ticker + moneda** (`AAPL.BA` en ARS y `AAPL` en USD son posiciones distintas). El ticker se guarda tal cual se escribe, en mayúsculas.
- **Compra**: recalcula el precio promedio `(cant_vieja × prom_viejo + cant_nueva × precio) / cant_total` y resta `cantidad × precio + comisión` del disponible en esa moneda. Si no alcanza el disponible, se rechaza: primero hay que cargar un depósito.
- **Venta**: baja la cantidad (el promedio no cambia) y suma `cantidad × precio − comisión` al disponible. No se puede vender más de lo que se tiene.
- Las posiciones vendidas por completo quedan visibles en 0 como "Cerrada".
- Posiciones y dinero disponible se **recalculan desde el historial**, así que borrar una operación o un depósito deja todo consistente (si el borrado dejaría algo en negativo, se rechaza).
- El dinero disponible se lleva **en centavos**: gastar exactamente lo que hay deja 0 (nunca "-0,00") y cualquier compra, venta o retiro que lo dejaría por debajo de 0 se rechaza.
- Además del historial puede haber un **saldo inicial** por moneda (setting `cedears_opening_cash_<moneda>`): se usó una sola vez para reemplazar los depósitos y retiros de prueba por el disponible real (migración v3).
- **Sin tipo de cambio**: el total de la cartera se muestra en pesos y en dólares por separado (posiciones de esa moneda + disponible en esa moneda). Las posiciones se agrupan por moneda y el **peso %** es dentro de su moneda. Sin precio de mercado, una posición se valúa a su costo.

### Variación del día
- En **Cartera** se ve cuánto subió o bajó cada posición y la cartera completa desde el cierre anterior (en cripto, respecto de hace 24 h). Sale del `previousClose` que da el proveedor de precios: con los precios simulados ya se ve; con las APIs reales queda funcionando sin tocar nada más.

### Crecimiento (snapshots diarios)
- Cada hora (`SNAPSHOT_INTERVAL_MINUTES`) y después de cada cambio se actualiza el valor **del día** de cada cartera; el último valor del día queda como su cierre. Al arrancar el servidor se toma uno a los pocos segundos, así que un reinicio no hace perder el día.
- Cripto se guarda en USDT. CEDEARs/ETF guarda una serie por moneda (ARS y USD, cada una con posiciones + disponible) y el gráfico tiene un selector de moneda.
- El gráfico muestra vista **Diaria** (últimos 90 días) y agrega **Semanal**, **Mensual** y **Anual** a medida que hay al menos dos períodos de historial.

## Conectar las APIs de precios

Todo el acceso a precios pasa por **`server/src/prices/`**; el resto de la app no sabe de dónde vienen.

1. Implementar el proveedor siguiendo el contrato documentado en `server/src/prices/index.js`. Los dos devuelven cotizaciones `{ price, previousClose }` con `getQuotes(...)`:
   - Cripto → `server/src/prices/binance.js` (precios en USDT; `previousClose` = precio de hace 24 h).
   - CEDEARs/ETF → `server/src/prices/market.js` (precio en la moneda de la posición y cierre del día anterior).
   Ambos archivos tienen un `TODO(precios)` con la implementación sugerida.
2. En `docker-compose.yml`: `CRYPTO_PRICE_PROVIDER: binance` y `MARKET_PRICE_PROVIDER: real`.
3. `docker compose up -d --build`. La etiqueta "Precios simulados" desaparece sola.

Si un proveedor falla, la app sigue funcionando: muestra un aviso, los valores sin precio aparecen como "Sin precio" y el snapshot del día no se actualiza hasta que vuelvan los precios.

## Exportar a CSV

El botón **Exportar** (arriba a la derecha en cada sección) descarga un CSV con la cartera y el historial completo de esa sección: `cripto-AAAA-MM-DD.csv` o `cedears-AAAA-MM-DD.csv`. Está pensado para pasárselo a Claude: bloques con título, números con punto decimal y sin separador de miles, y una línea que avisa si los precios son simulados.

## Instalar en el celular

La app es una PWA. En el celular se ve con barra de pestañas abajo y botón "+" flotante.

Chrome solo la **instala como app** si se sirve por **HTTPS con un certificado válido**. Entrando por `http://<ip>:<puerto>`, o con el flag `unsafely-treat-insecure-origin-as-secure`, solo crea un acceso directo que abre dentro de Chrome. Para tener HTTPS sin exponer nada a internet se usa [Tailscale](https://tailscale.com):

1. En el servidor (una sola vez):
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh   # si no está instalado
   sudo tailscale up
   sudo tailscale serve --bg 8100                      # el puerto de PORT en .env
   tailscale serve status                              # muestra la URL https://<servidor>.<tu-red>.ts.net
   ```
   Si pide habilitar HTTPS o MagicDNS, abrí el link que imprime y aceptá. La configuración sobrevive a reinicios.
2. En el celular: instalá la app de Tailscale, entrá con la misma cuenta y dejala conectada.
3. Abrí la URL `https://…ts.net` en Chrome → ⋮ → **Instalar app**.

Si en el celular todo se ve chiquito "como en la compu", Chrome está pidiendo el sitio de escritorio. La app lo avisa; se desactiva en ⋮ → **Sitio de escritorio**.

## Desarrollo

Requiere Node.js 22+.

```bash
# Backend (http://localhost:8080) — datos en ./server/data
cd server && npm install && npm run dev

# Frontend con recarga en caliente (http://localhost:5173, usa el backend de arriba)
cd web && npm install && npm run dev

# Tests del backend
cd server && npm test

# Datos de demo (saldos, operaciones y ~14 meses de historial) en una base aparte
cd server && DATA_DIR=./demo-data npm run seed:demo && DATA_DIR=./demo-data npm start
```

El script de demo se niega a correr sobre una base que ya tiene datos.

### API

| Método | Ruta | |
|---|---|---|
| GET | `/api/crypto/holdings` | Saldos valuados, total y objetivo |
| PUT | `/api/crypto/holdings` | `{ asset, amount }` — crear/corregir saldo |
| DELETE | `/api/crypto/holdings/:asset` | Quitar una moneda |
| GET/POST | `/api/crypto/exchanges` | Listar / registrar intercambio |
| DELETE | `/api/crypto/exchanges/:id` | Borrar (revierte saldos) |
| PUT | `/api/crypto/goal` | `{ amount }` (null para quitarlo) |
| GET | `/api/crypto/growth` | Series para el gráfico |
| GET | `/api/crypto/export.csv` | Cartera + historial en CSV |
| GET | `/api/cedears/portfolio` | Posiciones, disponible y totales |
| GET/POST | `/api/cedears/operations` | Listar / registrar compra o venta |
| DELETE | `/api/cedears/operations/:id` | Borrar operación |
| GET/POST | `/api/cedears/cash-movements` | Listar / registrar depósito o retiro |
| DELETE | `/api/cedears/cash-movements/:id` | Borrar movimiento |
| GET | `/api/cedears/growth` | Series para el gráfico (una por moneda) |
| GET | `/api/cedears/export.csv` | Totales, cartera e historiales en CSV |
| GET | `/api/health` | Healthcheck |
