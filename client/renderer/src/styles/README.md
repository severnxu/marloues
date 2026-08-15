# Renderer CSS Architecture

Renderer styles are organized by responsibility, not by recovered cascade
position.

1. `index.css` owns Tailwind's low-priority layer.
2. `tokens.css` owns the semantic design system and theme values.
3. `legacy-tokens.css` temporarily supports component styles that have not been
   migrated. New code must never reference it.
4. `components/index.css` is the global component-style manifest.
5. New component-local styles use adjacent CSS Modules.

## Semantic Tokens

Product code consumes stable names such as:

- `--surface-navigation`, `--surface-workspace`, `--surface-elevated`
- `--text-1`, `--text-2`, `--text-3`
- `--border-subtle`, `--border`, `--border-strong`
- `--shell-divider`, `--shell-divider-active`
- `--motion-fast`, `--motion-normal`, `--motion-shell`
- `--primary-sidebar-width`, `--auxiliary-sidebar-width`

Theme values live only in `tokens.css`. The default block is dark; light and
warm override the same semantic contract. Dark and light are the frozen
Workbench baselines. Warm remains supported but is not part of pixel review.

Do not create per-declaration variables, generated hashes, or component tokens
for layout values such as `display`, `opacity`, `border: 0`, or `flex`.
Component-specific custom properties are allowed only when they represent a
real reusable concept, and their names must be readable.

## Component Ownership

Each global selector has one owner file under `components/`. Files are imported
in dependency order: foundation, Workbench shell, business views, overlays,
then notifications. A component may consume shared semantic tokens but must not
patch selectors owned by another component.

New React components should prefer an adjacent `ComponentName.module.css`.
Global CSS remains appropriate for long-lived class contracts shared by the
Workbench and existing business views.

## Legacy Migration

`legacy-tokens.css` is quarantine for the former automatic token extraction.
It contains only `--component-*` and `--theme-*` definitions. Every migrated
component must:

1. replace those references with semantic tokens or direct non-paint values;
2. remove recovered numeric cascade layers;
3. delete its now-unused legacy token definitions;
4. add the file to `migratedComponentFiles` in the CSS architecture check.

The compatibility file is deleted when its last reference is gone. Do not add
new entries to it.

Run `npm run check:css` after every style change.
