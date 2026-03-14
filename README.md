# PhotoCull Pro — v6.0.0-PRO

> **Professional photo culling, rating, and export — entirely in your browser. No uploads. No servers. No subscriptions.**

PhotoCull Pro is a high-performance Progressive Web App (PWA) built for photographers who need to cull hundreds of RAW previews or JPEGs fast — on desktop *and* mobile — with full metadata support and flexible export options.

---

## ✨ What's New in v6.0.0-PRO

| Area | Change |
|---|---|
| 📷 **XMP Rating** | Support for reading camera ratings from XMP metadata (Sony, Fujifilm, Nikon fallback) |
| 🏷️ **Metadata Sync** | Ratings, colors, and captions are now **embedded** directly into JPEGs on export |
| ⚡ **Turbo Scan** | High-concurrency metadata processing — 10× faster scanning and zero hanging |
| 🛡️ **Safety Guard** | 3s timeout for EXIF extraction ensures corrupt files never block your import |
| 🎨 **Branding** | Pixel-perfect SVG PWA icon — matches the premium app experience exactly |
| 📦 **Export UX** | Independent toggles for Embed Metadata and Sidecar Manifest generation |

---

## ⚡ Core Features

### 1. Smart Import
- **Drag-and-Drop** or tap **Select Photos** / **Open Folder**
- Supports **JPG, PNG, WEBP, HEIC**
- EXIF date scanning for intelligent chronological sorting
- Long folder paths stripped to clean bare filenames — no visual clutter
- Preserves original File objects in memory — zero re-upload

### 2. High-Performance Rendering Engine
- **Priority-first rendering**: current photo → next 3 → previous 2 → background
- **OffscreenCanvas + createImageBitmap**: modern hardware-accelerated decoding, no UI freeze
- **Smart prefetching**: adjacent photos pre-rendered so swipe is instant
- Real-time render progress bar in the header

### 3. Professional Culling Workflow
- **1–5 Star Rating** with a single keypress or tap
- **Reject (✘)** tagging for instant discard marking
- **Auto-Advance**: moves to next photo automatically after rating — frictionless rapid-fire culling
- **Compare Mode (C)**: side-by-side current vs. previous photo
- **Live Luminosity Histogram**: real-time exposure check on every frame
- **EXIF Inspector**: Camera model, ISO, aperture, shutter speed, focal length, lens model
- **Floating Rating Pop**: non-intrusive center animation confirms your rating keystroke
- **Haptic feedback** on mobile per rating level

### 4. Color Label System
Four professional color labels per photo (Red, Yellow, Green, Blue), compatible with Adobe Bridge / Lightroom XMP metadata. Labels embed on export via XMP injection.

### 5. Library / Explorer View
- Filterable grid by **rating** (All, ✘, ★1–★5) and **color label** (R, Y, G, B)
- **Mobile 2-row filter toolbar** — rating chips on row 1, color chips + actions on row 2
- Selection dot on every thumbnail; multi-select with a tap
- **All Rated** — selects every 1–5 star photo in one tap
- **Quick Export 4★+** — jump straight to export with all 4 or 5 star photos selected
- Selection island (floating bar) shows count + clear/export actions

### 6. Flexible Export Engine
#### Export Methods
| Method | Platform | Notes |
|---|---|---|
| 📦 Download as ZIP | All | Single archive download, fast parallel compression |
| 📁 Export to Folder | Desktop (Chrome/Edge) | Auto-creates subfolder named after Project Name |
| 📲 Share to Mobile App | Android / iOS | Opens native share sheet (WhatsApp, Files, etc.) |

#### Export Options
- **Resolution**: Original, 2500px, 1920px, 1280px, 800px
- **JPEG Quality**: Slider 10–100%
- **Filename Pattern**: Keep Original · Project + Sequence (`Wedding_001.jpg`) · Project + Number (`Wedding_4832.jpg`)
- **IPTC Caption + Byline**: Written to XMP sidecar and injected directly into JPEG binary
- **XMP Metadata**: Star rating, color label embedded for Lightroom / Bridge compatibility
- **Captions Sidecar**: Optional `_captions.txt` manifest included in export

#### Performance
- **Parallel batch processing** — 4 images simultaneously via `Promise.all()`
- **DEFLATE level 3** for ZIP — fast compression without sacrificing speed
- Animated progress bar with "Rendered N / Total" counter

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|:---|:---|
| `1` – `5` | Set star rating |
| `0` | Clear rating |
| `X` | Reject photo (✘) |
| `←` / `→` | Navigate photos |
| `A` | Toggle Auto-Advance |
| `C` | Toggle Compare Mode |
| `Z` | Toggle 100% Zoom |
| `L` | Toggle Loupe (1:1 magnifier) |
| `?` | Open Shortcuts HUD |
| `Esc` | Close modals / exit export |

---

## 📱 Mobile Gestures

| Gesture | Action |
|:---|:---|
| Swipe left / right | Navigate photos |
| Pinch | Zoom in / out |
| Pan (zoomed) | Pan the image |
| Left-edge swipe | Open side drawer |
| Tap rating pill | Rate current photo |
| Tap color dot | Set / toggle color label |

---

## 🛠️ Technical Details

| Detail | Value |
|:---|:---|
| **Architecture** | Vanilla JavaScript + HTML5 + CSS3 (no framework) |
| **PWA** | Service Worker + `manifest.json` — installable, works offline |
| **Image Engine** | `createImageBitmap` + `OffscreenCanvas` → Canvas `toBlob()` |
| **Metadata** | `exif-js` for reading, custom XMP binary injection for writing |
| **Archiving** | JSZip 3.10 with DEFLATE level 3 |
| **Gestures** | HammerJS 2.0 — swipe, pinch, pan |
| **State** | In-memory JS object + `localStorage` persistence |
| **Privacy** | Zero network uploads — all processing is 100% local |
| **Supported browsers** | Chrome 90+, Edge 90+, Safari 15+, Firefox 89+ |

---

## 📂 Project Structure

```
Culling-android/
├── index.html       # App shell — all pages rendered as sections
├── js/              # Modular engine (import, culling, export, state)
├── styles.css       # Full design system + responsive mobile CSS
├── manifest.json    # PWA manifest (name, icons, display)
└── sw.js            # Service Worker for offline caching
```

---

## 🚀 Getting Started

### Run locally
```bash
npx serve -l 3000
# Open http://localhost:3000
```

### Install as PWA (Android / iOS)
1. Open `http://your-server/` in Chrome (Android) or Safari (iOS)
2. Tap the browser menu → **Add to Home Screen**
3. Launch from your home screen — runs fullscreen, works offline

---

## 🎨 Design System

- **Dark Mode only** — optimised for low-light shooting environments
- **HSL colour palette** — carefully tuned amber accent (`hsl(35, 100%, 58%)`) on near-black backgrounds
- **Glassmorphism surfaces** — `backdrop-filter: blur()` panels for depth
- **Inter typeface** — variable weight from Google Fonts
- **Micro-animations** — spring-physics transitions, rating pop, shimmer progress bar
- **Safe-area aware** — `env(safe-area-inset-*)` ensures nothing clips behind phone notches or home bars

---

© 2026 PhotoCull Pro. Built for photographers, by photographers.  
All image processing happens locally — your photos never leave your device.

