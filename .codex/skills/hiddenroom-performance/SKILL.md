---
name: hiddenroom-performance
description: Hidden Room performance skill for optimizing the static site, global CSS, vanilla JS, media assets, Supabase queries, dashboard rendering, store/media/ticket pages, cloud operations, and mobile responsiveness. Use when reducing load time, layout shifts, asset weight, query cost, DOM work, or runtime jank.
---

# Hidden Room Performance

## Workflow

1. Identify whether the bottleneck is asset weight, CSS scope, JavaScript work, Supabase queries, or image/media loading.
2. Keep improvements compatible with static hosting and no build step.
3. Prefer route-local lazy work over global startup work in `site.js`.
4. Keep Supabase selects column-specific and filtered.
5. Avoid re-rendering large tables unnecessarily; preserve focused DOM updates where practical.
6. Validate visually on mobile width and desktop width after CSS or layout changes.

## Hotspots

- `styles.css` is large and global; scope new CSS carefully.
- `site.js` runs on many pages; keep global initialization lean.
- `portal/dashboard.js` renders many sections and tables; defer non-active work.
- Store validates cart against live products; keep select columns tight.
- Media CMS uploads and renders rich content; avoid loading full post content in list views.
- Assets under `assets/img`, `assets/sprites`, and `assets/sounds` affect first-load and game performance.

## Checks

- Check image dimensions/formats before replacing visual assets.
- Ensure responsive layout does not cause text overflow.
- Use browser devtools or local inspection for layout shift and network weight.
- Run `node --check` after JS changes.

## References

Read `references/performance-checklist.md` for module-specific optimization targets.
