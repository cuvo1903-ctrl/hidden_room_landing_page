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

Las dependencias de visualización (Cytoscape.js y cose-bilkent) se cargan desde
CDN, por lo que la primera carga necesita conexión a internet.

## Formato del archivo

Usa un archivo `.md` con bloques como:

```markdown
### @autor

2026-07-09T00:30:10+0000

> @artista texto opcional

---
```

El parser normaliza handles a minúsculas, extrae todas las menciones del texto
citado y omite por completo los comentarios sin menciones. Los handles
configurados en **Handles ignorados** tampoco generan relaciones.

## Uso

1. Arrastra un `.md` al panel **Fuente** o haz clic para seleccionarlo.
2. Ajusta Top artistas, peso mínimo y actividad mínima de autores.
3. Activa **Solo embajadores** para ver autores que apoyan tres o más artistas.
4. Usa **Recalcular layout** para formar nuevamente las islas.
5. Pulsa **Exportar PNG**. Se descargará
   `orbit-hidden-room-graph.png` con fondo oscuro y título.

La pantalla inferior incluye Top Artists, Top Ambassadors y Strongest
Connections. Los rankings se calculan sobre el dataset válido completo; los filtros
afectan únicamente al grafo.

## Métricas

### Artistas

- `total_mentions`: menciones totales recibidas.
- `unique_authors`: autores únicos que mencionaron al artista.
- `combined_score`: score de ranking combinado entre menciones totales y autores únicos.
- `conversion_potential`: `unique_authors / total_mentions`; ayuda a distinguir conversación distribuida vs. conversación concentrada.

### Comunidad / autores

- `ambassador_score`: `artists_supported * 10 + total_mentions_made`.
- `bridge_score`: `artists_supported * unique_artist_clusters`; sube cuando un usuario conecta artistas de islas Louvain distintas.
- `spam_score`: `total_mentions_made / artists_supported`; alto puede indicar superfans o spam cuando hay poca diversidad.
- `artists_supported`: artistas distintos mencionados.
- `total_mentions_made`: menciones totales hechas.

### Conexiones

- `weight`: número de menciones de un autor hacia un artista. A mayor peso, línea más gruesa.
