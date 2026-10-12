# Finance & Crypto Portfolio Tracker

App personal para seguir dos carteras independientes, pensada para correr en un servidor casero dentro de la LAN:

- **Cripto**: saldos por moneda, intercambios (lo que entregás → lo que recibís, con comisión opcional), aportes y retiros, un objetivo en USDT y el gráfico de crecimiento.
- **CEDEARs / ETF**: compras y ventas con precio promedio ponderado, depósitos y retiros, dinero disponible en USD y ARS, peso de cada posición, historial y gráfico de crecimiento.

Diseño oscuro estilo app de inversiones. En **Cartera** cada sección muestra el total con la variación del día, un selector **ARS / USD** (conversión con el **dólar MEP** del día), el **gráfico de crecimiento**, un resumen con **invertido**, **rendimiento** y **disponible**, la lista de activos con su tendencia del día y un **gráfico de torta** de la distribución (por moneda en cripto, por instrumento en CEDEARs/ETF; top 5 + "Otros", cada activo con el mismo color en la torta y en la lista); tocando un activo se ve su detalle, el **gráfico intradía** y **Editar**. Además está la pestaña **Historial**, y en el celular el gráfico tiene su propia pestaña **Crecimiento**. Todo se puede **exportar a CSV** y la app se puede **instalar en el celular**.

Precios en vivo: **Binance** (cripto), **Yahoo Finance** (CEDEARs/ETF) y **DolarAPI** (dólar MEP). Ver [Precios y dólar MEP](#precios-y-dólar-mep).

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

En `docker-compose.yml` (sección `environment`) se eligen los proveedores de precios: `CRYPTO_PRICE_PROVIDER` (`binance` o `mock`), `MARKET_PRICE_PROVIDER` (`yahoo` o `mock`) y `FX_PROVIDER` (`dolarapi` o `mock`). `mock` = precios inventados, sin internet.

**No expongas el puerto a internet** (no hagas port forwarding en el router): la app no tiene login porque está pensada solo para la red local.

Actualizar a una versión nueva: `git pull && docker compose up -d --build`.

### Datos y backups

En `/srv/finance-crypto-portfolio/data/`:

- `portfolio.db` — la base SQLite (más `-wal`/`-shm`, que son parte de ella).
- `backups/portfolio-AAAA-MM-DD.db` — una copia consistente por día; se guardan las últimas 14 (`BACKUP_KEEP`).

Para restaurar: `docker compose down`, reemplazá `portfolio.db` por un backup (y borrá `portfolio.db-wal` / `portfolio.db-shm`), `docker compose up -d`.

## Cómo funciona

### Invertido y rendimiento
- **Invertido** = plata neta que pusiste (aportes/depósitos − retiros). **Rendimiento** = valor actual − invertido: lo que hizo el mercado (y las comisiones), nunca un depósito.
- CEDEARs/ETF: depósitos y retiros se cargan en **Nueva operación → Depósito / Retiro**.
- Cripto: **Nuevo movimiento → Aporte / Retiro** suma o resta monedas y las valúa en USDT en ese momento (precio de mercado, o lo que pagaste si lo indicás). Los intercambios y las correcciones de saldo no son aportes.
- Cripto no registraba aportes antes de esta función: lo invertido arranca en el valor del primer snapshot guardado (**invertido inicial**). Si sabés el número real, corregilo con el lápiz junto a "Invertido".
- El gráfico de crecimiento muestra el invertido como línea punteada y marca cada aporte o retiro, así un salto por un depósito no parece ganancia. Cada día se convierte con el dólar MEP de ese día (`fx_rates`; los días anteriores al primer MEP guardado usan el primero).

### Corregir datos cargados mal ("Editar")
- En Cartera, tocando un activo aparece **Editar**. Sirve para arreglar errores de carga **como si el dato siempre hubiera sido así**: no crea compras, ventas, aportes ni retiros nuevos en el historial.
- CEDEARs/ETF: cambiar el ticker o la moneda de la posición (se aplica a todas sus operaciones) y corregir cantidad, precio, comisión o fecha de cada operación.
- Cripto: renombrar la moneda (también en intercambios y aportes), corregir el saldo y editar cantidades y fechas de sus intercambios y aportes.
- **Disponible** (lápiz en el resumen de CEDEARs/ETF): pone el monto real en dólares y en pesos. La diferencia va al saldo inicial, así que lo invertido se mueve igual y **el rendimiento no cambia**.
- Los snapshots ya guardados también se corrigen, con los precios de cierre de cada día (Binance o Yahoo), para que el gráfico de crecimiento no muestre un salto. Si la API de precios no responde, la corrección del historial queda pendiente (`snapshot_repairs`) y se aplica sola cuando vuelve (se reintenta al arrancar y cada hora). El día de hoy siempre se recalcula en vivo.

### Cripto
- Los **saldos** se cargan a mano al empezar y se pueden corregir cuando quieras (Cartera → tocar la moneda → Editar).
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
- Sin precio de mercado, una posición se valúa a su costo.
- El **total de la cartera**, lo invertido y el rendimiento suman las dos monedas convertidas con el dólar MEP a la moneda elegida (ARS o USD); el **peso %** es sobre ese total. El **disponible** se muestra siempre como la plata real en cada moneda, sin convertir. Si todavía no hay cotización, cada moneda se muestra por separado.

### Variación del día
- En **Cartera** se ve cuánto subió o bajó cada posición y la cartera completa desde el cierre anterior (en cripto, respecto de hace 24 h).

### Crecimiento (snapshots diarios)
- Una vez por día se guarda el valor de cada cartera: **cripto a las 23:59** (en USDT) y **CEDEARs/ETF a las 17:30 de lunes a viernes** (cierre del mercado argentino a las 17:00 más la demora de las cotizaciones). Además, cada cambio actualiza el valor del día en el momento.
- Si el servidor estaba apagado a esa hora, al arrancar guarda el del día. Con precios desactualizados (API caída) no se guarda nada.
- CEDEARs/ETF guarda una serie por moneda (ARS y USD, cada una con posiciones + disponible); el gráfico las suma en la moneda elegida.
- Períodos **1M**, **3M**, **6M**, **1A** y **Todo** (aparecen a medida que hay historial). Arriba del gráfico: rendimiento del período (sin contar aportes), aportes netos e invertido.

## Precios y dólar MEP

Todo el acceso a precios pasa por **`server/src/prices/`**; el resto de la app no sabe de dónde vienen. Cada fuente es un proveedor intercambiable (contrato en `server/src/prices/index.js`) con un caché delante.

| Fuente | API | Cuándo se consulta |
|---|---|---|
| Cripto | Binance pública (`/api/v3/ticker/24hr` por par `<MONEDA>USDT`, sin API key). USDT = 1 USD | Al abrir la app, con caché de 3 minutos |
| CEDEARs / ETF | Yahoo Finance `v8/finance/chart/<TICKER>` con el ticker tal cual se cargó (ej. `AAPL.BA`) | Con el mercado abierto (lun a vie, 11:00 a 17:00), caché de 5 minutos. Cerrado, se muestra el último cierre sin volver a consultar |
| Dólar MEP | DolarAPI `/v1/dolares/bolsa` (compra, venta, hora) | Todos los días a las **10:30** (y al arrancar si falta el del día). Se usa la venta para convertir |

- **Yahoo Finance no tiene API oficial**: el endpoint puede cambiar o dejar de andar sin aviso. Está aislado en `server/src/prices/yahoo.js`; para reemplazarlo se escribe otro proveedor con el mismo contrato, se registra en `MARKET_PROVIDERS` y se elige con `MARKET_PRICE_PROVIDER`.
- Si una posición tiene precio en otra moneda (ej. `SPY` cargado en pesos), se convierte con el MEP.
- **Si una API falla** (timeout, error, límite de pedidos) la app sigue andando: muestra el último valor guardado con la etiqueta "Precio desactualizado desde …" y reintenta al minuto. Cada fuente falla por separado. Los últimos precios se guardan en la base (`price_cache`), así que también sobreviven a un reinicio.
- **Gráfico intradía**: tocando una moneda se ven las últimas 24 h (velas de 5 minutos de Binance); tocando un ticker, la sesión del día (o la última, con el mercado cerrado). La misma serie, resumida, es la tendencia de cada fila de la lista.

## Exportar a CSV

El botón **Exportar** (arriba a la derecha en cada sección) descarga un CSV con la cartera y el historial completo de esa sección: `cripto-AAAA-MM-DD.csv` o `cedears-AAAA-MM-DD.csv`. Está pensado para pasárselo a Claude: bloques con título, números con punto decimal y sin separador de miles, y una línea que avisa si los precios son simulados o están desactualizados.

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
| GET | `/api/crypto/holdings` | Saldos valuados, total, invertido, rendimiento, objetivo y MEP |
| PUT | `/api/crypto/holdings` | `{ asset, amount }` — crear/corregir saldo |
| DELETE | `/api/crypto/holdings/:asset` | Quitar una moneda |
| PUT | `/api/crypto/assets/:asset` | `{ asset }` — renombrar (corrección) |
| PUT | `/api/crypto/exchanges/:id`, `/api/crypto/flows/:id` | Corregir un intercambio o aporte |
| GET/POST | `/api/crypto/exchanges` | Listar / registrar intercambio |
| DELETE | `/api/crypto/exchanges/:id` | Borrar (revierte saldos) |
| GET/POST | `/api/crypto/flows` | Listar / registrar aporte o retiro (`{ type, asset, amount, valueUsdt?, executedAt }`) |
| DELETE | `/api/crypto/flows/:id` | Borrar (revierte el saldo) |
| GET/PUT | `/api/crypto/invested-opening` | Invertido inicial en USDT |
| PUT | `/api/crypto/goal` | `{ amount }` (null para quitarlo) |
| GET | `/api/crypto/growth?currency=USD\|ARS` | Valor e invertido por día + aportes |
| GET | `/api/crypto/export.csv` | Cartera + historial en CSV |
| GET | `/api/cedears/portfolio` | Posiciones, disponible y totales (con invertido y rendimiento) y MEP |
| GET/POST | `/api/cedears/operations` | Listar / registrar compra o venta |
| PUT | `/api/cedears/operations/:id` | Corregir una operación |
| PUT | `/api/cedears/positions` | `{ ticker, currency, newTicker, newCurrency }` — renombrar o cambiar de moneda |
| PUT | `/api/cedears/cash` | `{ USD, ARS }` — corregir el disponible |
| DELETE | `/api/cedears/operations/:id` | Borrar operación |
| GET/POST | `/api/cedears/cash-movements` | Listar / registrar depósito o retiro |
| DELETE | `/api/cedears/cash-movements/:id` | Borrar movimiento |
| GET | `/api/cedears/growth?currency=ARS\|USD` | Valor e invertido por día (ambas monedas sumadas) + depósitos |
| GET | `/api/cedears/export.csv` | Totales, cartera e historiales en CSV |
| GET | `/api/crypto/chart/:asset` | Precio de las últimas 24 h |
| GET | `/api/cedears/chart/:ticker` | Precio de la sesión del día |
| GET | `/api/crypto/sparklines`, `/api/cedears/sparklines` | Tendencia del día de cada activo |
| GET | `/api/fx/mep` | Dólar MEP guardado |
| GET | `/api/health` | Healthcheck |
