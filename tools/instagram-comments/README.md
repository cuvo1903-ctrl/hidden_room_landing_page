# Instagram Comments Scraper

Herramienta local del ERP para extraer comentarios visibles de un post o reel público con una sesión persistente de Chromium.

```powershell
npm install
npx playwright install chromium
npm run instagram:login
npm run instagram:scraper
```

Después abre `Portal > ERP > Instagram Comments Scraper`, pega el enlace y ejecuta el scraping. Los archivos se guardan en `tools/instagram-comments/output/comments.json` y `comments.csv`.

La sesión vive en `tools/instagram-comments/.profile/` y está ignorada por Git. No compartas esa carpeta. Instagram cambia su HTML con frecuencia; si deja de detectar comentarios, habrá que ajustar los selectores.
