# JE · new site for yehoshuatherapy.co.il (approval draft)

A redesign of the Yehoshua Elisha store and clinic site, built around the Arnica cream.
Static HTML/CSS/JS with no build step. Open `index.html` in a browser.

| File | What |
| --- | --- |
| `index.html` | Home: Arnica hero with video, 3 products, interactive "where does it hurt?" body map, about, reviews, clinic, gift voucher |
| `arnica.html` | Arnica product page: gallery + video, pack selector (1 / 2 / home kit), sticky mobile buy bar, how to use, ingredients, reviews, FAQ |
| `audit.html` | Findings report on the current site (Apple HIG based), before/after, marketing assets, growth plan, approval checklist |
| `styles.css`, `app.js` | Shared styles (light + dark) and behaviour (cart drawer, body map, gallery, buy bar) |
| `assets/img` | Optimised product photos (WebP + JPEG), logo variants |
| `assets/video` | `arnica-reel.mp4` (9:16, 15s ad), `arnica-square.mp4` (1:1, 12s), `hero-loop.mp4` (16:9, 10s, no text) |
| `assets/ads` | Feed and story ad images |

## Checkout

Buttons add the real WooCommerce products (IDs: arnica 2676, foot cream 2282, home kit 4287).
On the live domain the cart posts each line to `/?wc-ajax=add_to_cart` and then opens `/checkout/`.
In the preview build the first cart line is handed to
`https://yehoshuatherapy.co.il/checkout/?add-to-cart=<id>&quantity=<n>` (verified to add to the store cart).

## Before going live

Items marked `לאישור המנהל` in the pages (delivery time, shelf life, the correct e-mail address) need confirmation.
See the checklist at the end of `audit.html`.
