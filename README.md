# ⚖️ Balance & Precios - Gestor de Artículos de Importación (RMB ¥ ⇄ EUR €)

Una aplicación web moderna, rápida y completa diseñada para importar artículos de China (AliExpress, 1688, Taobao, proveedores directos), calcular costes reales de compra, registrar precios de mercado de la competencia para calcular la media, fijar el precio de venta final, medir márgenes de beneficio y exportar directamente a **LibreOffice Calc**.

---

## 🚀 Cómo Iniciar la Aplicación

Tienes dos opciones muy sencillas:

### Opción 1: Con el lanzador rápido (Recomendada)
Haz doble clic en el archivo **`iniciar.bat`**.
Esto iniciará el servidor local integrado con Python y abrirá automáticamente la aplicación en tu navegador web predeterminado (`http://localhost:8000`).

### Opción 2: Abrir directamente
Haz doble clic en el archivo **`index.html`** para abrirlo en cualquier navegador (Chrome, Edge, Firefox, etc.).

---

## ✨ Funcionalidades Principales

### 1. 📷 Fotografías de Artículos
- **Subida de archivos locales**: Arrastra o selecciona fotos directamente desde tu ordenador (JPG, PNG, WEBP, GIF). Las fotos se almacenan de forma permanente y optimizada en tu navegador.
- **Enlaces / URL Web**: Pega directamente el enlace de la imagen de AliExpress, 1688, Taobao o cualquier web y visualízala al instante.
- **Visor a pantalla completa (Lightbox)**: Haz clic sobre cualquier imagen para verla en gran detalle.

### 2. 💱 Conversión de Divisas (Renminbi ¥ RMB ⇄ Euro €)
- **Cálculo bidireccional instantáneo**: Escribe el precio en RMB y te muestra el equivalente en Euros en tiempo real (o viceversa).
- **Actualización en vivo**: Botón para consultar la cotización oficial del Banco Central Europeo / mercado con un solo clic.
- **Ajuste manual**: Puedes personalizar la tasa si tu pasarela de pago o banco te aplica una comisión de cambio diferente.
- **Calculadora rápida flotante**: Herramienta en la barra superior para hacer conversiones rápidas de ¥ a € mientras navegas por catálogos chinos.

### 3. 📦 Número de Artículos (Cantidad / Lote) y Multiplicación Automática
- Al registrar o editar cualquier artículo, puedes indicar el **número de unidades** que compras o tienes (ej: 10, 50, 100 uds).
- La aplicación calcula automáticamente:
  - **Inversión Total del Lote**: Coste Unitario × Cantidad.
  - **Facturación / Venta Total Potencial**: Precio Venta Unitario × Cantidad.
  - **Beneficio Neto Total Limpio**: Ganancia Unitaria × Cantidad.
- En las tarjetas y en la tabla verás el desglose unitario y el total del lote con el distintivo `📦 X uds`.
- Las métricas superiores (Inversión Total, Facturación y Beneficio) suman automáticamente las cuentas de todas las unidades.

### 4. 📊 Lista de Precios de Mercado y Cálculo de la Media
- Añade tantas referencias de precios de competidores o plataformas como desees (ej. Amazon, Wallapop, Vinted, eBay, tienda local).
- Cálculo automático en tiempo real de:
  - **Media de mercado (€)**.
  - **Precio mínimo detectado**.
  - **Precio máximo detectado**.
- Botón **"🎯 Aplicar como Precio Final"** para fijar la media calculada como tu precio de venta con un solo clic.

### 4. 💰 Precio de Venta Final y Rentabilidad
- Introduce tu precio de venta final y la aplicación calcula al segundo:
  - **Beneficio Neto (€)**: Ganancia limpia por cada unidad vendida.
  - **Margen sobre Venta (%)**: Porcentaje del precio que representa tu ganancia.
  - **Retorno de Inversión (ROI %)**: Multiplicador del capital invertido.
  - **Comparativa inteligente**: Te indica si tu precio es más competitivo o está por encima de la media de mercado.

### 5. 📑 Exportación para LibreOffice Calc
Haz clic en el menú **"📊 Exportar a Calc"** en la barra superior para descargar tus datos en:
- **📄 LibreOffice Calc (`.ods`)**: Formato nativo OpenDocument Spreadsheet de LibreOffice Calc, con anchos de columna ajustados y datos numéricos formateados.
- **📗 Formato Excel / Calc (`.xlsx`)**: Compatible tanto con LibreOffice Calc como con Microsoft Excel.
- **📑 Formato CSV (`.csv`)**: Delimitado con formato europeo para abrir directamente en hojas de cálculo.

### 6. 🔒 Almacenamiento Seguro (IndexedDB) y Respaldo
- Tus datos y fotos se guardan en la base de datos local de tu navegador (**IndexedDB**), sin límites molestos de almacenamiento y sin enviar nada a servidores externos (100% privado y seguro).
- **Copia de seguridad (.json)**: En el botón 💾 puedes descargar una copia completa de tu catálogo para no perderlo nunca o restaurarlo en otro ordenador.

---

## 💡 Mejoras y Funciones Adicionales Incluidas

1. **Calculadora de Coste Real Unitario**:
   - Campos opcionales para:
     - **Coste de envío por unidad (€)**.
     - **Aranceles / Aduana / IVA de importación (%)**.
     - **Comisiones de plataforma de venta (%)** (ej. 5% de Wallapop, 15% de Amazon).
2. **Dashboard de Métricas Globales**:
   - Tarjetas superiores que calculan en vivo:
     - Total de artículos.
     - Inversión total estimada.
     - Facturación potencial total.
     - Beneficio neto acumulado y margen medio del catálogo.
3. **Filtros y Búsqueda**:
   - Buscador por texto en tiempo real.
   - Filtro por categorías dinámicas.
   - Filtro por estado: *💡 En estudio*, *📦 Comprado / En camino*, *🏷️ En venta (Stock)*, *✅ Vendido*, *❌ Descartado*.
   - Ordenar por margen, beneficio, coste o nombre.
4. **Vistas Conmutables y Diseño 100% Responsive**:
   - **Móviles y Tablets**: Optimizado para pantallas táctiles de cualquier tamaño (smartphones de 320px a 768px y tablets).
   - **Botón Flotante Rápido (FAB)**: En dispositivos móviles aparece un botón circular flotante `+` en la esquina inferior para registrar artículos cómodamente con una sola mano.
   - **Formulario App-Experience**: En móviles, los modales se abren a pantalla completa con cabeceras y botones de guardado fijos para facilitar la navegación táctil y evitar zooms accidentales.
   - **Vista Cuadrícula y Tabla**: Tarjetas adaptadas a columna completa en móviles y tabla con deslizamiento horizontal suave.

5. **Tema Claro y Oscuro**:
   - Botón 🌙 / ☀️ para alternar entre modo oscuro y claro según tu preferencia.

---

## 🛠️ Tecnologías Empleadas
- **HTML5 Semántico + CSS3 Moderno** (variables CSS, flexbox/grid, modo oscuro, responsive).
- **JavaScript ES6+** modular y sin dependencias de Node.js.
- **IndexedDB**: Motor de base de datos local en el navegador.
- **SheetJS (xlsx.full.min.js)**: Integrado localmente para garantizar exportación a `.ods` y `.xlsx` 100% offline.
- **Python 3**: Servidor local ligero integrado.
