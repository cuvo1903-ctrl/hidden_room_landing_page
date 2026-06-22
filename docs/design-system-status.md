# Hidden Room Design System — estado final

Fecha de cierre: 21 de junio de 2026.

## Módulos migrados

- Home.
- Media público.
- Media Admin/CMS.
- Kairen.
- Store.
- Tickets.

Todos cargan `styles.css` y utilizan componentes opt-in `hr-*` para layout, tipografía, controles, cards, estados o tablas según corresponda.

## Alcance pendiente

- Portal: migración profunda de vistas, tablas complejas, bottom navigation y sheet “Más”.
- Minijuegos: migración interna; actualmente solo comparten el chrome global cuando aplica.
- Revisión de accesibilidad manual con teclado y lector de pantalla.
- Pruebas end-to-end autenticadas para CMS, checkout y validación de tickets.
- Eliminación futura de aliases y CSS legado, únicamente después de estabilizar Portal.

## Riesgos conocidos

- Portal todavía combina estilos locales con tokens globales.
- Algunos componentes dinámicos conservan clases locales de composición para no afectar su lógica.
- Las vistas autenticadas requieren datos y permisos reales para una validación visual completa.
- Los estilos de impresión de Tickets deben revisarse después de cualquier cambio global en cards o tablas.

## Pruebas rápidas

```powershell
node --check site.js
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

Validar en anchos aproximados de 390 px, 768 px y 1440 px. Para Tickets, comprobar además creación, QR, validación e impresión.
