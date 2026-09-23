# Finance & Crypto Portfolio Tracker

App personal para seguir dos carteras independientes, pensada para correr en un servidor casero dentro de la LAN:

- **Cripto**: saldos por moneda, historial de intercambios (lo que entregás → lo que recibís, con comisión opcional), un objetivo en USDT y el gráfico de crecimiento.
- **CEDEARs / ETF**: compras y ventas con precio promedio ponderado, dinero disponible en USD y ARS, peso de cada posición, historial y gráfico de crecimiento.

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
- El **peso %** y el total se consolidan en USD usando el tipo de cambio USD/ARS que da el proveedor de precios. Sin precio de mercado, una posición se valúa a su costo.

### Crecimiento (snapshots diarios)
- Cada hora (`SNAPSHOT_INTERVAL_MINUTES`) y después de cada cambio se actualiza el valor **del día** de cada cartera; el último valor del día queda como su cierre. Al arrancar el servidor se toma uno a los pocos segundos, así que un reinicio no hace perder el día.
- Cripto se guarda en USDT; CEDEARs/ETF en USD (posiciones + dinero disponible).
- El gráfico muestra vista **Diaria** (últimos 90 días) y agrega **Semanal**, **Mensual** y **Anual** a medida que hay al menos dos períodos de historial.

## Conectar las APIs de precios

Todo el acceso a precios pasa por **`server/src/prices/`**; el resto de la app no sabe de dónde vienen.

1. Implementar el proveedor siguiendo el contrato documentado en `server/src/prices/index.js`:
   - Cripto → `server/src/prices/binance.js` (`getUsdtPrices(assets)`).
   - CEDEARs/ETF → `server/src/prices/market.js` (`getPrices(items)` y `getUsdArsRate()`).
   Ambos archivos tienen un `TODO(precios)` con la implementación sugerida.
2. En `docker-compose.yml`: `CRYPTO_PRICE_PROVIDER: binance` y `MARKET_PRICE_PROVIDER: real`.
3. `docker compose up -d --build`. La etiqueta "Precios simulados" desaparece sola.

Si un proveedor falla, la app sigue funcionando: muestra un aviso, los valores sin precio aparecen como "Sin precio" y el snapshot del día no se actualiza hasta que vuelvan los precios.

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
| GET | `/api/cedears/portfolio` | Posiciones, disponible y totales |
| GET/POST | `/api/cedears/operations` | Listar / registrar compra o venta |
| DELETE | `/api/cedears/operations/:id` | Borrar operación |
| GET/POST | `/api/cedears/cash-movements` | Listar / registrar depósito o retiro |
| DELETE | `/api/cedears/cash-movements/:id` | Borrar movimiento |
| GET | `/api/cedears/growth` | Series para el gráfico |
| GET | `/api/health` | Healthcheck |
