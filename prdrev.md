
Your task is to refactor an existing JavaScript photo-culling web application to improve performance, architecture clarity, and mobile responsiveness without breaking existing functionality.

Important rules:

1. Do NOT rewrite the entire app unless necessary.
2. Preserve existing features and behavior.
3. Focus on improving performance bottlenecks.
4. Maintain readability and modularity.

The application currently performs these tasks:

* Import large photo folders (500–3000 images)
* Read EXIF metadata including camera rating
* Display an explorer grid
* Allow culling (rating / reject)
* Export selected photos

Current issues:

* Import feels slow because metadata scanning blocks UI
* Explorer appears only after metadata scan finishes
* Thumbnail generation may be inefficient
* UI may freeze during large imports

Your refactor goals:

1. NON-BLOCKING IMPORT

The explorer UI must appear immediately after file selection.

New flow:

Import → register files → show explorer → metadata scan in background

Users must be able to start culling before metadata scanning finishes.

2. BACKGROUND METADATA SCANNING

Implement an async worker queue:

* concurrency: 8–12
* scan metadata progressively
* update file state incrementally

Do not block the main UI thread.

3. PARTIAL EXIF READING

Do NOT read the full file.

Instead read only the first 64KB:

file.slice(0, 65536)

Extract:

* capture time
* rating
* camera info (if available)

4. PROGRESSIVE UI UPDATES

When metadata arrives:

* update rating
* update sorting if necessary
* update only affected thumbnails

Avoid full grid re-render.

5. THUMBNAIL PIPELINE

Implement efficient thumbnail generation:

File → createImageBitmap → resize to ~300px → cache

Prefer:

* OffscreenCanvas if available
* fallback to Canvas

Cache thumbnails to avoid regeneration.

6. UI THREAD YIELDING

Long loops must yield to the browser.

Use:

await new Promise(requestAnimationFrame)

Avoid blocking loops.

7. MOBILE PERFORMANCE

Ensure the application remains smooth on:

* Android Chrome
* iOS Safari
* Desktop browsers

Large tasks must be chunked into small async batches.

8. CODE ORGANIZATION

If necessary, split logic into modules:

* importEngine
* metadataScanner
* thumbnailEngine
* stateManager

Avoid monolithic files.

9. OUTPUT FORMAT

Return:

1. Explanation of changes
2. Refactored code
3. Performance improvements expected

The final result should make importing thousands of photos feel fast and responsive.

You are allowed to reorganize the architecture if necessary,
but you must preserve all existing features.

Focus heavily on performance optimization for large photo datasets (1000–5000 images).