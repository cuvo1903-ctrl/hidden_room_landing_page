# Performance Checklist

## Static Pages

- Keep critical page startup small.
- Avoid adding global event listeners unless needed on all pages.
- Use `loading="lazy"` for non-critical images where markup allows.
- Prefer WebP assets already used in `assets/img`.

## CSS

- Add shared primitives to `styles.css` only when reused.
- Add module-specific CSS to the module stylesheet.
- Avoid selectors that force broad recalculation on frequent state changes.

## Supabase

- Select only needed columns.
- Use `.limit()`, `.eq()`, `.in()`, and explicit `.order()` as appropriate.
- Avoid fetching full content for list screens when summary columns are enough.
- Keep admin dashboards from loading unrelated sections before they are active unless current patterns require it.

## Dashboard

- Reuse state caches where data is already loaded.
- Avoid repeated `innerHTML` rebuilds for high-frequency interactions.
- Keep filters local and cheap.

## Games

- Keep game assets preloaded intentionally.
- Avoid layout work inside animation loops.
- Use canvas dimensions and CSS constraints that do not shift during play.
