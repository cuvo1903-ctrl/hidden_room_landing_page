# Mysauth ORBIT for Hidden Room

Primera beta del mapa de relaciones comunidad-artistas. Procesa comentarios exportados a Markdown completamente en el navegador: no sube el archivo a un servidor.

## Ejecutar

Instala las dependencias e inicia el servidor local:

```powershell
npm install
npm run dev
```

Abre `http://127.0.0.1:8765/mysauth_orbit/`.

Las dependencias de visualizacion (Cytoscape.js, Graphology, Louvain y cose-bilkent) se cargan desde CDN, por lo que la primera carga necesita conexion a internet.

## Formato del archivo

Usa uno o varios archivos `.md` con bloques como:

```markdown
### @autor

2026-07-09T00:30:10+0000

> @artista texto opcional

---
```

El parser normaliza handles a minusculas, extrae todas las menciones del texto citado y omite por completo los comentarios sin menciones. Los handles configurados en **Handles ignorados** tampoco generan relaciones.

## Uso

1. Arrastra uno o varios `.md` al panel **Fuente** o haz clic para seleccionarlos.
2. Ajusta Top artistas, peso minimo y actividad minima de autores.
3. Activa **Solo embajadores** para ver autores que apoyan tres o mas artistas.
4. Usa el buscador para enfocar un usuario y sus conexiones.
5. Usa **Recalcular layout** para formar nuevamente las islas.
6. Pulsa **Exportar PNG**. Se descargara `orbit-hidden-room-graph.png` con fondo oscuro y titulo.

Los perfiles se calculan sobre el dataset valido completo; los filtros afectan unicamente al grafo visible.

## Modelo de perfiles

ORBIT ya no usa un score unico para comunidad. Cada usuario tiene dimensiones independientes que describen su papel dentro del ecosistema Hidden Room.

### Super Fan

- `superfan_score = total_mentions_made`
- Detecta usuarios que comentan o apoyan mucho, aunque sea a uno o pocos artistas.
- Se muestra con estrellas por percentil.
- Color: rojo.

### Ambassador

- `ambassador_score = artists_supported * 100 + total_mentions_made`
- La diversidad pesa mucho mas que repetir comentarios.
- Se muestra con estrellas por percentil.
- Color: azul.

### Bridge

- `bridge_score` se calcula con una aproximacion artista-artista.
- Para cada usuario se revisan los pares de artistas que conecta.
- Si esos artistas casi nunca comparten supporters, el valor sube.
- Si ademas caen en clusters Louvain distintos, el par recibe un boost.
- Color: verde.

### Community Leader

- Reservado para futuras fuentes: commerce, attendance, studio, media, trust e influence.
- Por ahora se muestra como `N/D`.
- Color: dorado.

## Tablas

La pantalla inferior muestra cuatro lecturas separadas:

- Top Super Fans
- Top Ambassadors
- Top Bridges
- Top Community Leaders

No hay ranking unico: ORBIT debe describir si una persona es fan fuerte, ambassador moderado, bridge potente o leader pendiente de datos.

## Artistas y conexiones

Los artistas mantienen metricas propias:

- `total_mentions`: menciones totales recibidas.
- `unique_authors`: autores unicos que mencionaron al artista.
- `conversion_potential = unique_authors / total_mentions`.

Las conexiones autor-artista mantienen:

- `weight`: numero de menciones de un autor hacia un artista. A mayor peso, linea mas gruesa.
