# Mysauth ORBIT for Hidden Room

Primera beta del mapa de relaciones comunidad-artistas. Procesa comentarios
exportados a Markdown completamente en el navegador: no sube el archivo a un
servidor.

## Ejecutar

Instala las dependencias e inicia el servidor local:

```powershell
npm install
npm run dev
```

Abre `http://127.0.0.1:8765/mysauth_orbit/`.

Las dependencias de visualizacion (Cytoscape.js y cose-bilkent) se cargan desde
CDN, por lo que la primera carga necesita conexion a internet.

## Formato del archivo

Usa un archivo `.md` con bloques como:

```markdown
### @autor

2026-07-09T00:30:10+0000

> @artista texto opcional

---
```

El parser normaliza handles a minusculas, extrae todas las menciones del texto
citado y omite por completo los comentarios sin menciones. Los handles
configurados en **Handles ignorados** tampoco generan relaciones.

## Uso

1. Arrastra un `.md` al panel **Fuente** o haz clic para seleccionarlo.
2. Ajusta Top artistas, peso minimo y actividad minima de autores.
3. Activa **Solo embajadores** para ver autores que apoyan tres o mas artistas.
4. Usa **Recalcular layout** para formar nuevamente las islas.
5. Pulsa **Exportar PNG**. Se descargara
   `orbit-hidden-room-graph.png` con fondo oscuro y titulo.

La pantalla inferior incluye Top Artists, Top Ambassadors y Strongest
Connections. Los rankings se calculan sobre el dataset completo; los filtros
afectan unicamente al grafo.
