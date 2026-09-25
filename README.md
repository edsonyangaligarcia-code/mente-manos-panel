# Mente & Manos — Panel de control

Panel web para reemplazar el uso diario de `MyM.xlsx`.

## Qué incluye esta versión

- Dashboard con facturación, resultado real, Ads +18%, conversaciones, compradores, conversión real, ROAS y S/ por conversación.
- Registro de venta con campaña de origen, upsell Sí/No, oferta, monto negociado real y seguimiento.
- Registro diario de conversaciones + gasto por campaña.
- Estadísticas por campaña y por día.
- Proyección al subir presupuesto publicitario.
- Meta mensual de S/10,000 configurable.
- Importación del historial de `MyM.xlsx` (276 ventas y 123 filas campaña/día incluidas en el paquete).
- Modo local inmediato y soporte Supabase para sincronización entre dispositivos.
- PWA: al publicarlo puedes agregarlo a la pantalla de inicio del celular.

## 1. Probarlo ahora mismo

Abre `index.html` en el navegador. Si no hay Supabase configurado, funciona en **modo local** y carga automáticamente el historial migrado.

> En modo local los datos quedan en ese navegador. Usa `Configuración > Exportar copia JSON` como backup.

## 2. Conectarlo a Supabase (gratis)

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor** y ejecuta completo `supabase_schema.sql`.
3. En Supabase ve a **Project Settings > API**.
4. Copia **Project URL** y la **anon / publishable key**.
5. Edita `config.js`:

```js
window.MYM_CONFIG = {
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseAnonKey: "TU-ANON-KEY",
  storageMode: "auto"
};
```

6. Abre la web. Te aparecerá inicio de sesión.
7. Crea tu cuenta y entra.
8. En **Configuración > Importar historial de MyM.xlsx**, carga el historial incluido a tu cuenta.

La anon key puede estar en el frontend: la protección de tus datos depende de las políticas RLS incluidas en `supabase_schema.sql`. Nunca uses una `service_role` key en esta web.

## 3. Publicarlo gratis con GitHub Pages

1. Crea un repositorio público, por ejemplo `mente-manos-panel`.
2. Sube el contenido de esta carpeta a la raíz del repositorio.
3. Ve a **Settings > Pages**.
4. En **Build and deployment**, selecciona `Deploy from a branch`.
5. Elige rama `main` y carpeta `/ (root)`.
6. GitHub te dará una dirección similar a `https://tuusuario.github.io/mente-manos-panel/`.

Después puedes abrirla en Android/Chrome y usar **Agregar a pantalla de inicio**.

## Cómo se calculan las métricas

- **Compradores** = número de transacciones pagadas registradas.
- **Conversión real** = compradores / conversaciones.
- **Ads reales** = gasto Meta × (1 + recargo configurado). Por defecto, 18%.
- **ROAS** = facturación / gasto registrado en Meta.
- **ROAS real** = facturación / Ads reales.
- **Resultado real** = facturación − Ads reales.
- **Facturación/chat** = facturación / conversaciones.
- **CPA real** = Ads reales / compradores.

El campo `Upsell` es independiente del monto. Puede ser S/29.90, S/25, S/15.90 u otro valor negociado. El panel siempre usa el **monto realmente cobrado**.

## Importación histórica

El archivo `historical-data.js` contiene los datos extraídos de `MyM.xlsx` hasta el 24-sep-2026.

El Excel antiguo no guardaba por separado, en todos los casos, `Opción 1 / Combo / VIP`. Por eso la migración conserva lo que sí sabemos:

- fecha y hora;
- producto/campaña registrada;
- Upsell Sí/No;
- precio original cuando existe;
- monto vendido real;
- seguimiento Sí/No;
- descuento.

Solo se etiqueta `VIP FULL` automáticamente cuando el registro histórico está marcado como upsell y el monto fue exactamente S/29.90. Otros upsells negociados quedan como `UPSELL PERSONALIZADO`, sin inventar información.

## Archivos

- `index.html` — interfaz.
- `styles.css` — diseño responsive.
- `app.js` — cálculos, formularios, dashboard y almacenamiento.
- `config.js` — conexión Supabase.
- `historical-data.js` — historial migrado.
- `supabase_schema.sql` — tablas + seguridad RLS.
- `manifest.json`, `sw.js`, `icon.svg` — instalación tipo app/PWA.
