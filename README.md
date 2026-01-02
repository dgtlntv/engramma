# Engramma

A web-based design tokens editor and converter for building design systems. Create, preview, and export design tokens in standard formats with preview of colors, typography, spacing, and more.

![Engramma](./logo.png)

## Quick start

Open [engramma.dev](https://engramma.dev) and use the menu (top-left):

- **New Project** → start empty, or import your tokens
- **Export tokens** → copy JSON / CSS / SCSS output
- **Share URL** → copies a link that contains your current token data (handy for sharing a draft)

### Importing tokens

Menu → **New Project** → Import tab, then paste/upload:

- **JSON (DTCG 2025 specification)**: latest stable specification
- **JSON (DTCG 2022 draft)**: legacy, less strict format
- **CSS variables**: paste a `:root { --token-name: ... }` block and import

## What you can model

Engramma supports these token types:

- `color`
- `dimension` (px/rem)
- `duration` (ms/s)
- `number`
- `fontFamily`
- `fontWeight`
- `cubicBezier`
- `strokeStyle`
- `border`
- `shadow`
- `transition`
- `typography`
- `gradient`

## Aliases / references

Aliases enable a flexible, maintainable token system by creating semantic layers. Instead of scattering raw values throughout your tokens, you can:

- **Build semantic themes**: Map abstract properties (like a brand color) to meaningful UI concepts (like "background-primary"), making tokens reusable across products or brands
- **Support design variations**: Create multiple themes (dark mode, seasonal campaigns, sub-brands, white-label variants) by aliasing to different base values while keeping components unchanged
- **Reduce duplication**: Share common token values across your system without repeating them

Composite tokens can reference other tokens in their parts (e.g. color in shadow or gradient).

## Export formats

Menu → **Export tokens**:

- **JSON**: DTCG-shaped output (good for storing in git or feeding other tools)
- **CSS**: CSS custom properties (`--token-name: ...;`)
- **SCSS**: SCSS variables

If you use aliases, the exporters keep them as references/`var()` where possible instead of flattening everything.

## License

This project is licensed under the [MIT License](./LICENSE).
