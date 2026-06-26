# Hidden Room Design System — estado final

Fecha de actualización: 26 de junio de 2026.

## Módulos migrados

- Home.
- Media público.
- Media Admin/CMS.
- Kairen.
- Store.
- Tickets.
- Portal shell.
- Portal vistas internas y tablas, con `db-*` conservado como capa de compatibilidad.

Todos cargan `styles.css` y utilizan componentes opt-in `hr-*` para layout, tipografía, controles, cards, estados, filtros o tablas según corresponda.

## Estado del Portal

- La navegación, drawer, bottom nav, paneles, formularios, filtros, badges, estados vacíos, modales y tablas ya adoptan tokens/clases `hr-*` de forma visual.
- `dashboard.js` conserva lógica, consultas Supabase, columnas, nombres de campos, IDs y `data-*`.
- Las clases `db-*` siguen activas para compatibilidad y composición específica del dashboard.
- El CSS local del Portal queda como bridge/adaptador, no como fuente primaria de identidad visual.

## Limpieza realizada

- Se eliminaron reglas redundantes del bridge del Portal que repetían estilos ya cubiertos por `styles.css` o por adaptadores previos.
- Se mantuvieron adaptadores `db-*` necesarios para no cambiar apariencia ni romper vistas dinámicas.
- No se eliminaron reglas ligadas a tablas editables, membresías, modales o composición específica del dashboard cuando podían afectar comportamiento visual.

## Alcance pendiente

- Minijuegos: migración interna; actualmente solo comparten el chrome global cuando aplica.
- Revisión manual autenticada del Portal con datos reales y permisos por rol.
- Revisión de accesibilidad con teclado y lector de pantalla.
- Pruebas end-to-end autenticadas para CMS, checkout, validación de tickets y Portal.
- Eliminación futura de aliases y CSS legado cuando el Portal lleve más tiempo estable.

## Riesgos conocidos

- Portal todavía conserva composición `db-*` para no romper lógica ni vistas dinámicas.
- Las vistas autenticadas requieren datos y permisos reales para una validación visual completa.
- Las tablas editables del Portal mantienen reglas específicas para celdas, inputs compactos y membresías.
- Los estilos de impresión de Tickets deben revisarse después de cualquier cambio global en cards o tablas.

## Pruebas rápidas

```powershell
node --check site.js
node --check portal/dashboard.js
node --check media/admin.js
node --check kairen/kairen.js
node --check store/store.js
node --check tickets/tickets.js
```

Servir el repositorio con cualquier servidor estático y revisar:

- `/`
- `/media/`
- `/media/admin.html`
- `/kairen/`
- `/store/`
- `/tickets/`
- `/portal/`
- `/portal/dashboard.html`

Validar en anchos aproximados de 390 px, 768 px y 1440 px. Para Tickets, comprobar además creación, QR, validación e impresión. Para Portal, revisar al menos un usuario cliente, colaborador y admin.
