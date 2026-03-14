// PhotoCull Pro - App Engine
// Professional photo culling & export PWA

// --- Shared Utilities ---
/** Check if a file is a supported image type */
function isImageFile(file) {
    return file.type.startsWith('image/') ||
        /\.(jpg|jpeg|png|heic|webp)$/i.test(file.name);
}

/**
 * Get the short display name of a file.
 * When using "Open Folder", browsers expose the full relative path via
 * webkitRelativePath (e.g. "Shoot/SubAlbum/DSC_0012.jpg").
 * This helper strips everything but the bare filename so UIs and state
 * keys are always a clean, short string.
 */
function getShortName(file) {
    // Prefer the custom _shortName we may have set during import normalization
    if (file._shortName) return file._shortName;
    // For folder imports, webkitRelativePath gives e.g. "Shoot/DSC_001.jpg"
    if (file.webkitRelativePath && file.webkitRelativePath.length > 0) {
        const parts = file.webkitRelativePath.split('/');
        return parts[parts.length - 1];
    }
    return file.name;
}

/** Natural numeric filename comparator (DSC_1 < DSC_2 < DSC_10) */
function naturalSort(a, b) {
    return getShortName(a).localeCompare(getShortName(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Yield to main thread to prevent UI freezes & allow GC */
const yieldToMain = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Simple Polyfill for FileSaver.js saveAs */
function saveAs(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);
}

// --- App State ---
let state = {
    colorLabels: {}, // filename -> 'red'|'yellow'|'green'|'blue'|null
    captions: {}, // filename -> string
    globalByline: '',
    view: 'IMPORT',     // 'IMPORT', 'EXPLORER', 'CULLING', 'EXPORT'
    sortMode: 'FILENAME', // 'FILENAME' or 'TIME'
    filter: 0,          // 0(All), -1(Reject), 1-5(Stars)
    colorFilter: null,  // 'red', 'yellow', 'green', 'blue' or null
    gridCols: 3,
    ratings: {}, // filename -> rating (1-5, -1 for reject)
    selectedForExport: new Set(),
    zoomLevel: 1, // 1 = Contain, 2+ = Zoomed
    panX: 0,
    panY: 0,
    previews: {}, // filename -> blob URL (lightweight version)
    renderQueue: [], // files waiting to be rendered
    isRenderingBackground: false,
    directoryHandle: null, // stored handle for folder export
    isNavigating: false, // flag to prevent rapid navigation races
    isCompareMode: false,
    isLoupeActive: false,
    autoAdvance: true,
    _tempGridUrls: new Set(), // track temporary grid blob URLs for cleanup
    mediumPreviews: {}, // filename -> blob URL (medium res)
};

// --- Storage Logic ---
function savePersistence() {
    localStorage.setItem('photocull_ratings', JSON.stringify(state.ratings));
    localStorage.setItem('photocull_colorLabels', JSON.stringify(state.colorLabels));
    localStorage.setItem('photocull_captions', JSON.stringify(state.captions));
    localStorage.setItem('photocull_byline', state.globalByline);

    const data = {
        selectedForExport: Array.from(state.selectedForExport),
        gridCols: state.gridCols,
        filter: state.filter, // Changed from currentFilter to filter
        colorFilter: state.colorFilter,
        autoAdvance: state.autoAdvance
    };
    localStorage.setItem('photocull_pro_data', JSON.stringify(data));
}

function loadPersistence() {
    const r = localStorage.getItem('photocull_ratings');
    if (r) state.ratings = JSON.parse(r);

    const c = localStorage.getItem('photocull_colorLabels');
    if (c) state.colorLabels = JSON.parse(c);

    const caps = localStorage.getItem('photocull_captions');
    if (caps) state.captions = JSON.parse(caps);

    const by = localStorage.getItem('photocull_byline');
    if (by) state.globalByline = by || '';

    const saved = localStorage.getItem('photocull_pro_data');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            // state.ratings = data.ratings || {}; // Now loaded separately
            state.selectedForExport = new Set(data.selectedForExport || []);
            state.gridCols = data.gridCols || 3;
            state.filter = data.filter !== undefined ? data.filter : 0; // Changed from currentFilter to filter
            state.colorFilter = data.colorFilter !== undefined ? data.colorFilter : null;
            state.autoAdvance = data.autoAdvance !== undefined ? data.autoAdvance : true;

            // Apply loaded settings
            setGridCols(state.gridCols);
            if (elements.btnAutoAdvance) {
                elements.btnAutoAdvance.classList.toggle('active', state.autoAdvance);
            }
            showToast("Previous progress loaded! 💾", "success");
        } catch (e) {
            console.error("Failed to load data:", e);
        }
    }
}

function clearPersistence() {
    if (confirm("Clear all ratings and selections? This cannot be undone.")) {
        clearPreviewCaches();
        localStorage.removeItem('photocull_ratings');
        localStorage.removeItem('photocull_colorLabels');
        localStorage.removeItem('photocull_captions');
        state.ratings = {};
        state.colorLabels = {};
        state.captions = {};
        state.selectedForExport.clear();
        localStorage.removeItem('photocull_pro_data');
        showToast("Data cleared! 🧹", "success");
        if (state.view === 'PREVIEW' || state.view === 'EXPLORER') renderGrid();
        else if (state.view === 'CULLING') updateRatingUI(0);
    }
}

/** Helper to prevent memory leaks from blob URLs */
function clearPreviewCaches() {
    // Revoke all thumbnails
    Object.values(state.previews || {}).forEach(url => URL.revokeObjectURL(url));
    state.previews = {};

    // Revoke all medium-res previews
    Object.values(state.mediumPreviews || {}).forEach(url => URL.revokeObjectURL(url));
    state.mediumPreviews = {};

    // Revoke grid temporary URLs
    state._tempGridUrls.forEach(url => URL.revokeObjectURL(url));
    state._tempGridUrls.clear();
}

// --- DOM Elements ---
const elements = {
    pages: document.querySelectorAll('.page'),
    btnBack: document.getElementById('btn-back'),
    stepTitle: document.getElementById('step-title'),
    btnNext: document.getElementById('btn-next'),
    fileInput: document.getElementById('file-input'),
    folderInput: document.getElementById('folder-input'),
    viewImg: document.getElementById('view-img'),
    fileInfo: document.getElementById('view-filename'),
    exifInfo: document.getElementById('view-exif'),
    pillContainer: document.getElementById('rating-container'),
    gridView: document.getElementById('grid-view'),
    filterStatus: document.getElementById('filter-status'),
    exportModal: null, // No longer a modal - uses dedicated page
    folderNameInput: document.getElementById('folder-name'),
    exportMethod: document.getElementById('export-method'),
    qualityNum: document.getElementById('quality-num'),
    methodHint: document.getElementById('method-hint'),
    selectedPath: document.getElementById('selected-path'),
    mainExportBtn: document.getElementById('main-export-btn'),
    btnBrowse: document.getElementById('btn-browse'),
    resChoice: document.getElementById('res-choice'),
    renamePattern: document.getElementById('rename-pattern'),
    renamePreview: document.getElementById('rename-preview'),
    renderProgress: document.getElementById('render-progress'),
    exportStatsText: document.getElementById('export-stats-text'),
    compareBtn: document.getElementById('btn-compare'),
    viewportContainer: document.getElementById('viewport-container'),
    compareImg: document.getElementById('compare-img'),
    shortcutsModal: document.getElementById('shortcuts-modal'),
    histogramCanvas: document.getElementById('histogram-canvas'),
    exifExtended: document.getElementById('view-exif-extended'),
    ratingPop: document.getElementById('rating-pop'),
    btnAutoAdvance: document.getElementById('btn-autoadvance'),
    sideDrawer: document.getElementById('side-drawer'),
    drawerOverlay: document.getElementById('drawer-overlay'),
    statProgress: document.getElementById('stat-progress'),
    statRated: document.getElementById('stat-rated'),
    btnMenu: document.getElementById('btn-menu'),
    btnSort: document.getElementById('btn-sort'),
    captionInput: document.getElementById('caption-input'),
    globalByline: document.getElementById('global-byline'),
    includeSidecar: document.getElementById('include-sidecar'),
    embedMetadata: document.getElementById('embed-metadata'),
    btnLoupe: document.getElementById('btn-loupe'),
    selectionBar: document.getElementById('selection-bar'),
};

// --- Initialization ---
function init() {
    loadPersistence();
    setupEventListeners();
    updateUI();
}

function setupEventListeners() {
    elements.fileInput.onchange = handleFileUpload;
    elements.folderInput.onchange = handleFileUpload;

    // Drag & Drop
    const importCard = document.querySelector('.import-card');
    importCard.addEventListener('dragover', (e) => {
        e.preventDefault();
        importCard.classList.add('drag-over');
    });
    importCard.addEventListener('dragleave', () => importCard.classList.remove('drag-over'));
    importCard.addEventListener('drop', async (e) => {
        e.preventDefault();
        importCard.classList.remove('drag-over');
        let files = Array.from(e.dataTransfer.files).filter(isImageFile);

        if (files.length > 0) {
            await processFileBatch(files);
        }
    });

    // Gestures (HammerJS)
    const hammer = new Hammer(document.getElementById('culling-page'));
    hammer.get('pan').set({ direction: Hammer.DIRECTION_ALL });
    hammer.get('pinch').set({ enable: true });

    hammer.on('swipeleft', () => {
        if (state.zoomLevel === 1) navigatePhoto(1);
    });
    hammer.on('swiperight', (e) => {
        // Only open drawer if swiping from the very left edge (first 15% of screen)
        if (state.zoomLevel === 1 && e.center.x < window.innerWidth * 0.15) {
            toggleDrawer();
        } else if (state.zoomLevel === 1) {
            navigatePhoto(-1);
        }
    });

    hammer.on('doubletap', toggleZoom);
    hammer.on('pan', (e) => {
        if (state.isLoupeActive) applyLoupe(e);
    });

    // Panning Logic
    let lastPanX = 0;
    let lastPanY = 0;

    hammer.on('panstart', () => {
        if (state.zoomLevel > 1 && !state.isLoupeActive) {
            lastPanX = state.panX;
            lastPanY = state.panY;
        }
    });

    hammer.on('panmove', (e) => {
        if (state.zoomLevel > 1 && !state.isLoupeActive) {
            state.panX = lastPanX + e.deltaX;
            state.panY = lastPanY + e.deltaY;
            applyZoom(true);
        }
    });

    // Pinch Zoom Logic
    let startScale = 1;

    hammer.on('pinchstart', () => {
        startScale = state.zoomLevel;
    });

    hammer.on('pinchmove', (e) => {
        state.zoomLevel = Math.max(1, Math.min(5, startScale * e.scale));
        applyZoom(true);
    });

    hammer.on('pinchend', () => {
        if (state.zoomLevel < 1.1) {
            state.zoomLevel = 1;
            state.panX = 0;
            state.panY = 0;
        }
        applyZoom();
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        const key = e.key.toUpperCase();
        if (state.view === 'CULLING') {
            if (e.key === 'ArrowRight') navigatePhoto(1);
            if (e.key === 'ArrowLeft') navigatePhoto(-1);
            switch (key) {
                case '1': case '2': case '3': case '4': case '5':
                    setRating(parseInt(e.key));
                    break;
                case '0':
                    setRating(0);
                    break;
                case 'X':
                    setRating(-1);
                    break;
                case 'R':
                    setColorLabel('red');
                    break;
                case 'Y':
                    setColorLabel('yellow');
                    break;
                case 'G':
                    setColorLabel('green');
                    break;
                case 'B':
                    setColorLabel('blue');
                    break;
                case 'Z':
                    if (!state.isLoupeActive) toggleZoom();
                    break;
                case 'z': // Lowercase 'z' for hold-Z loupe
                    if (!state.isLoupeActive) {
                        state.isLoupeActive = true;
                        applyLoupe();
                    }
                    break;
            }
            if (key === 'C') toggleCompare();
            if (key === 'A') toggleAutoAdvance();
        }
        if (e.key === '?') toggleShortcuts();
        if (e.key === 'Escape') {
            closeExport();
            if (elements.shortcutsModal.style.display === 'flex') toggleShortcuts();
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'z') {
            state.isLoupeActive = false;
            resetZoom();
        }
    });

    // Update path display when folder name changes
    elements.folderNameInput.oninput = checkMethodSupport;

    // Loupe button
    if (elements.btnLoupe) {
        elements.btnLoupe.addEventListener('mousedown', () => {
            state.isLoupeActive = true;
            applyLoupe();
        });
        elements.btnLoupe.addEventListener('mouseup', () => {
            state.isLoupeActive = false;
            resetZoom();
        });
        elements.btnLoupe.addEventListener('mouseleave', () => { // In case mouseup outside button
            if (state.isLoupeActive) {
                state.isLoupeActive = false;
                resetZoom();
            }
        });
        elements.btnLoupe.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent default touch behavior like scrolling
            state.isLoupeActive = true;
            applyLoupe();
        }, { passive: false });
        elements.btnLoupe.addEventListener('touchend', () => {
            state.isLoupeActive = false;
            resetZoom();
        });
    }

    // ── Toggle: JS fallback for Android/iOS CSS :checked sibling issues ──────
    // On some mobile browsers (Android WebView, old iOS Safari), the CSS
    // `.toggle-checkbox:checked + .toggle-track` adjacent-sibling selector
    // does not reliably trigger visual updates even if the :checked state is
    // correct. We add/remove an `is-checked` class to the track as a JS
    // safety net so the toggle is always visually correct on mobile.
    const syncToggleVisual = (id) => {
        const cb = document.getElementById(id);
        if (!cb) return;
        const track = cb.nextElementSibling;
        if (track && track.classList.contains('toggle-track')) {
            track.classList.toggle('is-checked', cb.checked);
        }
    };

    ['embed-metadata', 'include-sidecar'].forEach(id => {
        const cb = document.getElementById(id);
        if (!cb) return;
        cb.addEventListener('change', () => syncToggleVisual(id));
        const toggleLabel = cb.closest('.toggle-label');
        if (toggleLabel) {
            toggleLabel.addEventListener('touchend', () => {
                requestAnimationFrame(() => syncToggleVisual(id));
            });
        }
        syncToggleVisual(id);
    });
}

// --- Navigation Logic ---
function switchView(view) {
    state.view = view;
    updateUI();
}

function updateUI() {
    // Show/Hide Pages
    elements.pages.forEach(p => p.classList.remove('active'));
    const pageId = state.view.toLowerCase() + '-page';
    const pageEl = document.getElementById(pageId);
    if (pageEl) pageEl.classList.add('active');

    // Back button: show everywhere except Import
    elements.btnBack.style.display = (state.view === 'IMPORT') ? 'none' : 'flex';

    // Sort button: Explorer only
    if (elements.btnSort) elements.btnSort.style.display = (state.view === 'EXPLORER') ? 'flex' : 'none';

    // Menu button: not in culling
    if (elements.btnMenu) elements.btnMenu.style.display = (state.view === 'CULLING') ? 'none' : 'flex';

    if (state.view === 'IMPORT') {
        elements.stepTitle.innerText = 'PhotoCull Pro';
    } else if (state.view === 'EXPLORER') {
        elements.stepTitle.innerText = `Library (${(state.rawFiles || []).length})`;
        renderGrid();
        updateStats();
        updateSelectionUI();
    } else if (state.view === 'CULLING') {
        const total = (state.rawFiles || []).length;
        elements.stepTitle.innerText = `${state.currentIndex + 1} / ${total}`;
        updateStats();
    } else if (state.view === 'EXPORT') {
        elements.stepTitle.innerText = 'Export';
        checkMethodSupport();
        updateSelectionUI();
    }
}

function toggleDrawer() {
    const isActive = elements.sideDrawer.classList.toggle('active');
    elements.drawerOverlay.classList.toggle('active', isActive);
}

function updateStats() {
    if (state.rawFiles.length === 0) return;
    const ratedCount = Object.keys(state.ratings).filter(id => state.ratings[id] !== 0).length;
    const progress = Math.round((ratedCount / state.rawFiles.length) * 100);

    if (elements.statProgress) elements.statProgress.innerText = `${progress}%`;
    if (elements.statRated) elements.statRated.innerText = ratedCount;
}

function goBack() {
    if (state.view === 'CULLING') switchView('EXPLORER');
    else if (state.view === 'EXPLORER') switchView('IMPORT');
    else if (state.view === 'EXPORT') switchView('EXPLORER');
}

function handleMainAction() {
    if (state.view === 'EXPLORER') switchView('EXPORT');
}

// --- Photo Logic ---
async function handleFileUpload(e) {
    let files = Array.from(e.target.files).filter(isImageFile);
    if (files.length === 0) return;
    await processFileBatch(files);
}

async function processFileBatch(files) {
    // Clear existing caches to free memory
    clearPreviewCaches();

    // Normalize short names first
    files.forEach(f => {
        const short = getShortName(f);
        if (f.name !== short) f._shortName = short;
    });

    // Prepare state
    state.rawFiles = files.sort(sortLogic);
    state.filter = 0;
    state.colorFilter = null;
    
    // Switch view immediately
    switchView('EXPLORER');
    
    // Start background scanning
    startMetadataScan(files);
}

/**
 * BACKGROUND METADATA & THUMBNAIL SCANNER
 * Implementation of requirement #4 from prdrev.md
 */
async function startMetadataScan(files) {
    const total = files.length;
    let done = 0;
    let cameraRatedCount = 0;
    const batchSize = 10;

    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);

        await Promise.all(batch.map(async (f) => {
            try {
                // 1. Scan Metadata (EXIF + XMP)
                const meta = await getExifMeta(f);
                f._date = meta.date;
                const key = getShortName(f);

                // Sync ratings if unrated
                const currentRating = state.ratings[key];
                const isUnrated = !currentRating || currentRating === 0;

                if (meta.rating !== null && isUnrated) {
                    state.ratings[key] = meta.rating;
                    cameraRatedCount++;
                }

                // 2. Generate 300px Thumbnail (Requirement #6)
                if (!state.previews[key]) {
                    state.previews[key] = await generateThumbnail(f);
                }
            } catch (err) {
                console.error("Background scan error for", f.name, err);
            }
        }));

        done += batch.length;
        
        // Progressively update UI
        elements.stepTitle.innerText = `Scanning ${done}/${total}...`;
        
        // Refresh grid at milestones to show new thumbs/ratings
        if (done % 50 === 0 || done === total) {
            renderGrid();
        }

        await yieldToMain();
    }

    elements.stepTitle.innerText = `Library (${total})`;
    savePersistence();

    if (cameraRatedCount > 0) {
        showToast(`📷 ${cameraRatedCount} camera ratings synced!`, "success");
    }
    
    // Final grid render to ensure everything is caught up
    renderGrid();
    
    // Start medium-res pre-rendering for culling
    startBackgroundRendering();
}

/**
 * THUMBNAIL PIPELINE (Requirement #6)
 * Generates 300px optimized blobs using createImageBitmap
 */
async function generateThumbnail(file) {
    try {
        const bitmap = await createImageBitmap(file, {
            resizeWidth: 600, // 2x for retina-like sharpness in 300px slot
            resizeQuality: 'medium'
        });

        const canvas = new OffscreenCanvas(300, 300);
        const ctx = canvas.getContext("2d");

        // Center crop and draw
        const scale = Math.max(300 / bitmap.width, 300 / bitmap.height);
        const w = bitmap.width * scale;
        const h = bitmap.height * scale;
        const x = (300 - w) / 2;
        const y = (300 - h) / 2;

        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, 300, 300);
        ctx.drawImage(bitmap, x, y, w, h);

        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
        bitmap.close();
        
        return URL.createObjectURL(blob);
    } catch (e) {
        console.warn("Thumbnail generation failed, falling back to original URL", e);
        return URL.createObjectURL(file);
    }
}

function sortLogic(a, b) {
    if (state.sortMode === 'TIME') {
        // _date is now a plain timestamp number (set by getExifMeta)
        const da = a._date || 0;
        const db = b._date || 0;
        if (da !== db) return da - db;
    }
    return naturalSort(a, b);
}

function toggleSort() {
    state.sortMode = state.sortMode === 'FILENAME' ? 'TIME' : 'FILENAME';
    state.rawFiles.sort(sortLogic);
    showToast(`Sorted by ${state.sortMode === 'TIME' ? 'Capture Time' : 'Filename'}`, "success");
    renderGrid();
    if (state.view === 'CULLING') showPhoto(state.currentIndex);
    updateUI();
}

/**
 * Extract Rating from XMP metadata block if present.
 * Modern cameras (Sony, Fujifilm, etc.) often store ratings in XMP:Rating.
 */
async function getXmpRating(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const buffer = e.target.result;
                const view = new Uint8Array(buffer);
                const text = new TextDecoder().decode(view);

                let match = text.match(/xmp:Rating=["']?(\d+)["']?/i);
                if (!match) match = text.match(/<xmp:Rating>(\d+)<\/xmp:Rating>/i);
                if (!match) match = text.match(/Rating=["']?(\d+)["']?/i);

                if (match && match[1]) {
                    const r = parseInt(match[1]);
                    if (r >= 1 && r <= 5) {
                        resolve(r);
                        return;
                    }
                }
                resolve(null);
            } catch (err) {
                resolve(null);
            }
        };
        reader.onerror = () => resolve(null);
        // Requirement #5: Partial file reading (64KB)
        reader.readAsArrayBuffer(file.slice(0, 65536));
    });
}

// Returns { date: <timestamp ms>, rating: <0-5 or null> }
// Reads DateTimeOriginal + the in-camera Rating / RatingPercent tag in a
// single EXIF.getData call so we don't pay the parsing cost twice.
async function getExifMeta(file) {
    // Requirement #5: Optimize by reading only the first part of the JPEG
    const partialFile = file.slice(0, 65536);
    
    return new Promise((resolve) => {
        let isResolved = false;

        // Safety timeout - if meta extraction takes > 3s, skip and resolve with defaults
        const timeout = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                console.warn(`[EXIF] Timeout reached for ${file.name}, skipping meta.`);
                resolve({ date: file.lastModified || Date.now(), rating: null });
            }
        }, 3000);

        const safeResolve = (data) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                resolve(data);
            }
        };

        try {
            // Some browsers/files cause EXIF.getData to never fire its callback
            EXIF.getData(partialFile, function () {
                try {
                    const allTags = EXIF.getAllTags(this) || {};

                    // --- Capture Date ---
                    let date = file.lastModified || Date.now();
                    const dateStr = allTags["DateTimeOriginal"];
                    if (dateStr) {
                        const parts = dateStr.split(/[: ]/);
                        const d = new Date(
                            parts[0], parts[1] - 1, parts[2],
                            parts[3], parts[4], parts[5]
                        );
                        if (!isNaN(d.getTime())) date = d.getTime();
                    }

                    // --- In-Camera Rating Search ---
                    let rating = null;

                    // 1. Standard / Windows Rating
                    if (allTags["Rating"] !== undefined) rating = parseInt(allTags["Rating"]);

                    // 2. RatingPercent
                    if (rating === null && allTags["RatingPercent"] !== undefined) {
                        const p = parseInt(allTags["RatingPercent"]);
                        if (p > 0) {
                            if (p <= 20) rating = 1;
                            else if (p <= 40) rating = 2;
                            else if (p <= 60) rating = 3;
                            else if (p <= 80) rating = 4;
                            else rating = 5;
                        }
                    }

                    // 3. MakerNote Fallbacks
                    if (rating === null) {
                        for (let key in allTags) {
                            if (key.toLowerCase().includes('rating') && typeof allTags[key] === 'number') {
                                const val = allTags[key];
                                if (val >= 1 && val <= 5) {
                                    rating = val;
                                    break;
                                }
                            }
                        }
                    }

                    if (rating !== null) {
                        safeResolve({ date, rating });
                    } else {
                        // --- 4. XMP Fallback ---
                        getXmpRating(file).then(xmpRating => {
                            safeResolve({ date, rating: xmpRating });
                        }).catch(() => {
                            safeResolve({ date, rating: null });
                        });
                    }
                } catch (innerErr) {
                    console.error("[EXIF Inner Error]", innerErr);
                    safeResolve({ date: file.lastModified || Date.now(), rating: null });
                }
            });

            // If the library immediately fails (e.g. non-image), fire a check
            // Note: EXIF.js doesn't have a specific 'failed' callback as of common versions
        } catch (err) {
            console.error("[EXIF Error]", err);
            safeResolve({ date: file.lastModified || Date.now(), rating: null });
        }
    });
}

// DEPRECATED: Replaced by generateThumbnail and background renderer pipeline
// async function renderSinglePreview(file) { ... }

/**
 * PRE-RENDER MEDIUM RES PREVIEW (Requirement #7)
 * Renders adjacent photos for instant navigation.
 */
async function startBackgroundRendering() {
    if (state.isRenderingBackground) return;
    state.isRenderingBackground = true;
    elements.renderProgress.style.opacity = '1';

    const total = state.rawFiles.length;

    while (true) {
        // PRIORITY LOGIC:
        // 1. Current Photo
        // 2. Next 3 photos (Prefetch zone)
        // 3. Previous 2 photos (Back-swipe zone)
        const buildPriorityList = () => {
            const list = [];
            const seen = new Set();
            const cur = state.currentIndex || 0;

            [cur, cur + 1, cur + 2, cur + 3, cur - 1, cur - 2].forEach(idx => {
                if (idx >= 0 && idx < total) {
                    const file = state.rawFiles[idx];
                    const key = getShortName(file);
                    // Use a separate key for medium res previews to avoid overwriting 300px thumbs
                    if (!state.mediumPreviews) state.mediumPreviews = {};
                    if (!state.mediumPreviews[key] && !seen.has(idx)) {
                        list.push(idx);
                        seen.add(idx);
                    }
                }
            });
            return list;
        };

        const priorityList = buildPriorityList();
        if (priorityList.length === 0) break;

        const nextToRenderIdx = priorityList[0];
        const file = state.rawFiles[nextToRenderIdx];
        const key = getShortName(file);

        try {
            const previewBlob = await processImage(file, 1600, 0.7);
            const url = URL.createObjectURL(previewBlob);
            state.mediumPreviews[key] = url;
        } catch (e) {
            console.error("Medium-res render failed", e);
        }

        const doneCount = Object.keys(state.mediumPreviews || {}).length;
        const progress = Math.round((doneCount / total) * 100);
        elements.renderProgress.style.width = `${progress}%`;

        // Yield between renders
        await yieldToMain();
    }

    state.isRenderingBackground = false;
    setTimeout(() => {
        if (!state.isRenderingBackground) elements.renderProgress.style.opacity = '0';
    }, 1000);
}

function showProcessing(show, text = "") {
    let overlay = document.getElementById('processing-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'processing-overlay';
        overlay.className = 'processing-overlay';
        overlay.innerHTML = `<div class="processing-spinner"></div><div id="processing-text"></div>`;
        document.body.appendChild(overlay);
    }
    overlay.style.display = show ? 'flex' : 'none';
    document.getElementById('processing-text').innerText = text;
}

function navigatePhoto(dir) {
    if (state.isNavigating) return;
    const newIndex = state.currentIndex + dir;
    if (newIndex >= 0 && newIndex < state.rawFiles.length) {
        state.isNavigating = true;
        if (navigator.vibrate) navigator.vibrate(10);
        showPhoto(newIndex);
        // Allow next navigation after a short buffer
        setTimeout(() => { state.isNavigating = false; }, 100);
    }
}

async function showPhoto(index) {
    state.currentIndex = index;
    state.zoomLevel = 1;
    state.panX = 0;
    state.panY = 0;
    applyZoom();

    const file = state.rawFiles[index];
    const key = getShortName(file);
    if (!state.mediumPreviews) state.mediumPreviews = {};
    let previewUrl = state.mediumPreviews[key];

    // If medium-res render hasn't reached this photo yet, prioritize it
    if (!previewUrl) {
        try {
            const mediumBlob = await processImage(file, 1600, 0.7);
            previewUrl = URL.createObjectURL(mediumBlob);
            state.mediumPreviews[key] = previewUrl;
        } catch (e) {
            previewUrl = URL.createObjectURL(file);
        }
    }

    elements.viewImg.src = previewUrl;
    elements.viewImg.onload = () => {
        if (state.view === 'CULLING') generateHistogram(elements.viewImg);
    };
    // Always show just the short filename — no folder path prefix
    elements.fileInfo.innerText = key;
    elements.stepTitle.innerText = `Culling (${index + 1}/${state.rawFiles.length}) ${state.isRenderingBackground ? '• ⚡' : ''}`;

    // Handle Compare Preload
    if (state.isCompareMode && index > 0) {
        const prevFile = state.rawFiles[index - 1];
        const prevKey = getShortName(prevFile);
        const prevUrl = state.mediumPreviews[prevKey] || state.previews[prevKey] || URL.createObjectURL(prevFile);
        elements.compareImg.src = prevUrl;
    }

    updateRatingUI(state.ratings[key] || 0);
    updateCaptionUI();
    loadExif(file);
}

function loadExif(file) {
    elements.exifInfo.innerText = "Loading metadata...";
    elements.exifExtended.innerText = "";
    EXIF.getData(file, function () {
        const model = EXIF.getTag(this, "Model") || "";
        const iso = EXIF.getTag(this, "ISOSpeedRatings");
        const f = EXIF.getTag(this, "FNumber");
        const s = EXIF.getTag(this, "ExposureTime");
        const focal = EXIF.getTag(this, "FocalLength");
        const lens = EXIF.getTag(this, "LensModel") || EXIF.getTag(this, "LensInfo") || "";

        if (iso) {
            // Guard against undefined/null shutter speed
            let shutterStr = "N/A";
            if (s != null) {
                shutterStr = s < 1 ? `1/${Math.round(1 / s)}` : `${s}`;
            }
            elements.exifInfo.innerText = `${model} • ISO ${iso} • f/${f} • ${shutterStr}s`;

            let extendedStr = "";
            if (focal) extendedStr += `${focal}mm`;
            if (lens) extendedStr += (extendedStr ? ` • ${lens}` : lens);
            elements.exifExtended.innerText = extendedStr;
        } else {
            elements.exifInfo.innerText = "Metadata unavailable (please use original camera JPEGs)";
        }
    });
}

function generateHistogram(imgEl) {
    if (!elements.histogramCanvas) return;
    // Guard: skip if the image hasn't actually loaded yet
    if (!imgEl.naturalWidth || imgEl.naturalWidth === 0) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 100;
    canvas.height = 100;
    ctx.drawImage(imgEl, 0, 0, 100, 100);

    const data = ctx.getImageData(0, 0, 100, 100).data;
    const hist = new Int32Array(256);
    for (let i = 0; i < data.length; i += 4) {
        // Luminosity formula
        const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        hist[gray]++;
    }

    const destCtx = elements.histogramCanvas.getContext('2d');
    const width = elements.histogramCanvas.width;
    const height = elements.histogramCanvas.height;
    destCtx.clearRect(0, 0, width, height);

    const maxVal = Math.max(...hist);
    destCtx.beginPath();
    destCtx.moveTo(0, height);

    for (let i = 0; i < 256; i++) {
        const x = (i / 255) * width;
        const y = height - (hist[i] / maxVal) * height;
        destCtx.lineTo(x, y);
    }

    destCtx.lineTo(width, height);
    destCtx.closePath();
    destCtx.fillStyle = 'hsla(35, 100%, 55%, 0.5)';
    destCtx.fill();
    destCtx.strokeStyle = 'var(--accent)';
    destCtx.stroke();
}

function setRating(val) {
    const file = state.rawFiles[state.currentIndex];
    const key = getShortName(file);

    // Toggle logic: if same rating clicked, remove it (0)
    if (state.ratings[key] === val) val = 0;

    state.ratings[key] = val;
    updateRatingUI(val);
    savePersistence();

    // Show Floating Pop Animation
    if (val !== 0) showRatingPop(val);

    // Haptic feedback for rating
    if (navigator.vibrate) {
        if (val === -1) navigator.vibrate([30, 30, 30]); // Distinct vibrate for REJECT
        else navigator.vibrate(val > 0 ? 50 : 20);
    }

    // Auto advance if rating > 0 or Reject (but not when clearing rating)
    if (state.autoAdvance && val !== 0 && state.currentIndex < state.rawFiles.length - 1) {
        setTimeout(() => navigatePhoto(1), 200);
    }
}

/**
 * Feature 1: Color Label System
 * Set or toggle a color label for the current photo
 */
function setColorLabel(color) {
    if (state.rawFiles.length === 0) return;
    const f = state.rawFiles[state.currentIndex];
    const key = getShortName(f);

    if (state.colorLabels[key] === color) {
        delete state.colorLabels[key]; // Toggle off
    } else {
        state.colorLabels[key] = color;
    }

    savePersistence();
    updateRatingUI(state.ratings[key] || 0); // Update UI to reflect color label change
}

/**
 * Feature 3: IPTC Caption Editor
 */
function setCaption(text) {
    if (state.rawFiles.length === 0) return;
    const f = state.rawFiles[state.currentIndex];
    const key = getShortName(f);
    if (!text || text.trim() === '') {
        delete state.captions[key];
    } else {
        state.captions[key] = text;
    }
    savePersistence();
}

function updateCaptionUI() {
    if (state.rawFiles.length === 0) return;
    const file = state.rawFiles[state.currentIndex];
    if (elements.captionInput) {
        elements.captionInput.value = state.captions[getShortName(file)] || '';
    }
}

function showRatingPop(val) {
    if (!elements.ratingPop) return;

    // Text: Reject is '✘', Star rating is '⭐ 5', etc.
    const text = val === -1 ? '✘' : `⭐ ${val}`;
    elements.ratingPop.innerText = text;

    // Change color for reject
    if (val === -1) {
        elements.ratingPop.style.color = "var(--error)";
        elements.ratingPop.style.textShadow = "0 0 40px rgba(255, 69, 58, 0.8)";
    } else {
        elements.ratingPop.style.color = "var(--accent)";
        elements.ratingPop.style.textShadow = "0 0 40px rgba(255, 159, 10, 0.8)";
    }

    // Reset animation
    elements.ratingPop.style.transition = "none";
    elements.ratingPop.style.opacity = "0";
    elements.ratingPop.style.transform = "scale(0.5)";

    // Force reflow
    void elements.ratingPop.offsetWidth;

    // Play pop
    elements.ratingPop.style.transition = "all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
    elements.ratingPop.style.opacity = "1";
    elements.ratingPop.style.transform = "scale(1)";

    // Fade out
    setTimeout(() => {
        elements.ratingPop.style.transition = "all 0.2s cubic-bezier(0.6, 0.04, 0.98, 0.335)";
        elements.ratingPop.style.opacity = "0";
        elements.ratingPop.style.transform = "scale(1.2)";
    }, 400);
}

function updateRatingUI(val) {
    const file = state.rawFiles[state.currentIndex];
    const key = getShortName(file);
    const currentRating = state.ratings[key] || 0;
    const currentColor = state.colorLabels[key] || null;

    const pillActive = (ratingVal) => currentRating === ratingVal ? 'active' : '';
    const colorActive = (colorVal) => currentColor === colorVal ? 'active' : '';

    // Star Rating Pills
    elements.pillContainer.innerHTML = `
        <div class="pill pill--reject ${pillActive(-1)}" onclick="setRating(-1)" role="button" aria-label="Reject photo" tabindex="0">✘</div>
        <div class="pill ${pillActive(1)}" onclick="setRating(1)" role="button" aria-label="Rate 1 star" tabindex="0">1</div>
        <div class="pill ${pillActive(2)}" onclick="setRating(2)" role="button" aria-label="Rate 2 stars" tabindex="0">2</div>
        <div class="pill ${pillActive(3)}" onclick="setRating(3)" role="button" aria-label="Rate 3 stars" tabindex="0">3</div>
        <div class="pill ${pillActive(4)}" onclick="setRating(4)" role="button" aria-label="Rate 4 stars" tabindex="0">4</div>
        <div class="pill ${pillActive(5)}" onclick="setRating(5)" role="button" aria-label="Rate 5 stars" tabindex="0">5</div>
    `;

    // Color Label Dots
    const colorLabelRow = document.createElement('div');
    colorLabelRow.className = 'color-label-row';
    colorLabelRow.innerHTML = `
        <div class="color-dot dot-red ${colorActive('red')}" onclick="setColorLabel('red')" title="Red (Urgent)"></div>
        <div class="color-dot dot-yellow ${colorActive('yellow')}" onclick="setColorLabel('yellow')" title="Yellow (Review)"></div>
        <div class="color-dot dot-green ${colorActive('green')}" onclick="setColorLabel('green')" title="Green (Approved)"></div>
        <div class="color-dot dot-blue ${colorActive('blue')}" onclick="setColorLabel('blue')" title="Blue (Personal)"></div>
    `;
    elements.pillContainer.appendChild(colorLabelRow);
}

function toggleZoom() {
    state.zoomLevel = state.zoomLevel === 1 ? 2.5 : 1;
    if (state.zoomLevel === 1) resetZoom();
    else {
        state.panX = 0;
        state.panY = 0;
        applyZoom();
    }
}

function resetZoom() {
    state.zoomLevel = 1;
    state.panX = 0;
    state.panY = 0;
    applyZoom();
}

function applyLoupe(e) {
    if (!state.isLoupeActive) return;

    const img = elements.viewImg;
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    const containerW = elements.viewportContainer.clientWidth;
    const containerH = elements.viewportContainer.clientHeight;

    if (!naturalW || naturalW === 0) return;

    // Calculate 1:1 scale relative to the image's natural size
    // We want the image to be displayed at its natural resolution.
    // The current image element might be scaled down to fit the container.
    // So, the loupeScale is the ratio of natural size to the *rendered* size.
    const renderedWidth = img.clientWidth;
    const loupeScale = naturalW / renderedWidth;

    state.zoomLevel = loupeScale;

    // Position at mouse if triggered by event, else center
    if (e && e.center) {
        const rect = img.getBoundingClientRect(); // Current rendered position of the image
        const mouseX = e.center.x;
        const mouseY = e.center.y;

        // Calculate the mouse position relative to the *natural* image coordinates
        // First, mouse position relative to the *rendered* image
        const mouseX_relative_rendered = mouseX - rect.left;
        const mouseY_relative_rendered = mouseY - rect.top;

        // Then, scale this to the natural image size
        const mouseX_relative_natural = mouseX_relative_rendered * loupeScale;
        const mouseY_relative_natural = mouseY_relative_rendered * loupeScale;

        // The pan should center the natural image point under the mouse.
        // The image is transformed by `translate(panX, panY) scale(zoomLevel)`.
        // We want the point (mouseX_relative_natural, mouseY_relative_natural) on the natural image
        // to appear at (mouseX, mouseY) on the screen.
        // The center of the viewport is (containerW/2, containerH/2).
        // The image's top-left corner (0,0) in its own coordinate system, when scaled,
        // will be at (panX, panY) in the viewport.
        // So, the point (mouseX_relative_natural, mouseY_relative_natural) on the natural image
        // will be at (panX + mouseX_relative_natural * state.zoomLevel, panY + mouseY_relative_natural * state.zoomLevel)
        // in the viewport.
        // We want this point to be at (mouseX, mouseY).
        // So, panX + mouseX_relative_natural * state.zoomLevel = mouseX
        // panY + mouseY_relative_natural * state.zoomLevel = mouseY
        // This is incorrect. The pan values are applied *before* scaling in the CSS transform.

        // Let's re-think:
        // The image is centered in the viewport by default.
        // When zoomed, the image's top-left corner is at (viewport_center_x - (scaled_img_width/2), viewport_center_y - (scaled_img_height/2)).
        // The panX/panY values are offsets from this centered position.
        // So, the actual top-left of the scaled image is:
        // `actual_img_left = (containerW - renderedWidth * loupeScale) / 2 + state.panX`
        // `actual_img_top = (containerH - renderedHeight * loupeScale) / 2 + state.panY`

        // We want the point on the *natural* image under the mouse to be visible.
        // The mouse is at (mouseX, mouseY) relative to the viewport.
        // The image's current (0,0) point (top-left of the *scaled* image) is at `rect.left`, `rect.top`.
        // The mouse's position relative to the *scaled* image's top-left is `mouseX - rect.left`, `mouseY - rect.top`.
        // To find the corresponding point on the *natural* image, we divide by the current scale.
        // `natural_point_x = (mouseX - rect.left) / state.zoomLevel`
        // `natural_point_y = (mouseY - rect.top) / state.zoomLevel`

        // Now, we want to set panX and panY such that this `natural_point` is centered in the viewport.
        // The center of the viewport is `containerW / 2`, `containerH / 2`.
        // The image's top-left corner (0,0) in its own coordinate system, when scaled by `state.zoomLevel`,
        // will be at `(containerW - naturalW * state.zoomLevel) / 2 + state.panX` (if image is centered)
        // No, the transform is `translate(panX, panY) scale(zoomLevel)`.
        // This means the image is first translated, then scaled.
        // So, the point `(x_img, y_img)` on the *original* image becomes `(x_img * scale + panX, y_img * scale + panY)` on screen.

        // We want `(natural_point_x * state.zoomLevel + state.panX)` to be `mouseX`
        // So, `state.panX = mouseX - (natural_point_x * state.zoomLevel)`
        // And `state.panY = mouseY - (natural_point_y * state.zoomLevel)`

        // Let's use the mouse position relative to the *center* of the image.
        const imgCenterX = rect.left + rect.width / 2;
        const imgCenterY = rect.top + rect.height / 2;

        const mouseOffsetFromImgCenter_X = mouseX - imgCenterX;
        const mouseOffsetFromImgCenter_Y = mouseY - imgCenterY;

        // The pan values are relative to the image's *initial* centered position.
        // When we apply a scale, the image grows from its center.
        // If the mouse is at (mouseX, mouseY) in the viewport, we want that point to be the new center of the view.
        // The image's current center is at (imgCenterX, imgCenterY).
        // We need to shift the image so that the point under the mouse moves to the center of the viewport.
        // The pan values are applied *before* scaling.
        // So, if we want to move the image by `deltaX`, `deltaY` *after* scaling,
        // we need to apply `deltaX / scale`, `deltaY / scale` *before* scaling.

        // The current mouse position relative to the viewport container's center
        const viewportCenterX = containerW / 2;
        const viewportCenterY = containerH / 2;

        const mouseX_relative_viewport_center = mouseX - viewportCenterX;
        const mouseY_relative_viewport_center = mouseY - viewportCenterY;

        // The image's current center is at (0,0) in its own coordinate system,
        // which is then translated by panX/panY and scaled.
        // The effective center of the image on screen is (panX, panY) if the image is initially at (0,0).
        // But the image is initially centered.
        // The `transform: translate(panX, panY) scale(scale)` means:
        // 1. Translate the image by (panX, panY)
        // 2. Scale it by `scale` around its *new* origin (which is its top-left after translation).
        // This is not what we want for intuitive panning.
        // We want `transform-origin: center center; transform: translate(panX, panY) scale(scale);`
        // Or `transform: scale(scale) translate(panX, panY);` which scales first, then translates.
        // The current `applyZoom` uses `translate(panX, panY) scale(scale)`.
        // This means panX/panY are in *viewport* pixels, and the scale is applied *after* the translation.

        // Let's assume the image is always centered in the viewport before any pan/zoom.
        // The image's top-left corner is at `(containerW - img.width) / 2`, `(containerH - img.height) / 2`.
        // When we zoom, the image scales around its center.
        // The `panX` and `panY` are offsets from this centered, scaled position.

        // To achieve 1:1 loupe at mouse position:
        // 1. Calculate the mouse position relative to the *image's current displayed pixels*.
        //    `mouse_img_x = mouseX - rect.left`
        //    `mouse_img_y = mouseY - rect.top`
        // 2. Calculate the corresponding pixel on the *natural* image.
        //    `natural_pixel_x = mouse_img_x / (rect.width / naturalW)`
        //    `natural_pixel_y = mouse_img_y / (rect.height / naturalH)`
        // 3. We want this `natural_pixel` to be at the *center* of the viewport.
        //    The image, when scaled by `loupeScale`, will have dimensions `naturalW * loupeScale`, `naturalH * loupeScale`.
        //    The top-left of this scaled image, if it were centered, would be:
        //    `centered_left = (containerW - naturalW * loupeScale) / 2`
        //    `centered_top = (containerH - naturalH * loupeScale) / 2`
        // 4. The `natural_pixel` is at `(natural_pixel_x * loupeScale, natural_pixel_y * loupeScale)` relative to the scaled image's top-left.
        // 5. We want this point to be at `(mouseX, mouseY)` in the viewport.
        //    So, `centered_left + natural_pixel_x * loupeScale + panX = mouseX`
        //    This is getting complicated due to the `transform` order.

        // Simpler approach:
        // The `panX` and `panY` are offsets from the *center* of the viewport.
        // If `state.zoomLevel = 1`, `panX = 0`, `panY = 0`, the image is centered.
        // When `state.zoomLevel > 1`, the image is scaled around its center.
        // `panX` and `panY` then shift this scaled image.
        // So, `elements.viewImg.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${scale})`;`
        // This means `panX` and `panY` are applied *before* scaling.

        // Let's use `transform-origin` to simplify.
        // If `transform-origin: 0 0; transform: scale(scale) translate(panX, panY);`
        // Then `(x_img * scale + panX * scale, y_img * scale + panY * scale)`
        // This is also not quite right.

        // The current `applyZoom` function:
        // `elements.viewImg.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${scale})`;`
        // This means the image is first translated by `panX`, `panY` (in viewport pixels),
        // then scaled by `scale` around its *new* top-left corner.
        // This is usually not the desired behavior for interactive zoom/pan.
        // It's more common to scale around the center, then translate.
        // Or scale around a specific point (e.g., mouse cursor).

        // Let's assume the current `applyZoom` works as intended for general zoom.
        // For loupe, we want the mouse position `(mouseX, mouseY)` to correspond to a specific `(natural_x, natural_y)` on the image.
        // The image is currently displayed at `rect.left, rect.top` with `rect.width, rect.height`.
        // The mouse is at `(mouseX, mouseY)` in viewport coordinates.
        // The mouse's position relative to the image's top-left is `(mouseX - rect.left, mouseY - rect.top)`.
        // This corresponds to a point on the *natural* image:
        // `natural_x_at_mouse = (mouseX - rect.left) * (naturalW / rect.width)`
        // `natural_y_at_mouse = (mouseY - rect.top) * (naturalH / rect.height)`

        // Now, we want to set `state.panX` and `state.panY` such that when the image is scaled by `loupeScale`,
        // this `(natural_x_at_mouse, natural_y_at_mouse)` point appears at `(mouseX, mouseY)` in the viewport.
        // The image's top-left corner (0,0) in its own coordinate system, when scaled and translated,
        // will be at `(state.panX, state.panY)` in the viewport.
        // So, the point `(natural_x_at_mouse, natural_y_at_mouse)` on the natural image will be at:
        // `screen_x = state.panX + natural_x_at_mouse * loupeScale`
        // `screen_y = state.panY + natural_y_at_mouse * loupeScale`
        // We want `screen_x = mouseX` and `screen_y = mouseY`.
        // Therefore:
        state.panX = mouseX - (natural_x_at_mouse * loupeScale);
        state.panY = mouseY - (natural_y_at_mouse * loupeScale);

    } else {
        // If no mouse event, center the loupe on the image
        state.panX = 0;
        state.panY = 0;
    }

    applyZoom();
}

function applyZoom(isPanning = false) {
    const scale = state.zoomLevel;

    // Boundary check for panning
    if (scale > 1) {
        const rect = elements.viewImg.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Calculate limit based on scaled dimensions
        const limitX = (rect.width - viewportWidth) / 2 / scale;
        const limitY = (rect.height - viewportHeight) / 2 / scale;

        // Clamp pan values
        if (limitX > 0) state.panX = Math.max(-limitX * scale, Math.min(limitX * scale, state.panX));
        else state.panX = 0;

        if (limitY > 0) state.panY = Math.max(-limitY * scale, Math.min(limitY * scale, state.panY));
        else state.panY = 0;
    }

    const transition = isPanning ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)';
    elements.viewImg.style.transition = transition;
    elements.viewImg.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${scale})`;
    elements.viewImg.style.cursor = scale > 1 ? 'move' : 'zoom-in';
}

// --- Preview & Grid ---
function toggleCompare() {
    state.isCompareMode = !state.isCompareMode;
    elements.compareBtn.classList.toggle('active', state.isCompareMode);
    elements.viewportContainer.classList.toggle('comparing', state.isCompareMode);

    if (state.isCompareMode) {
        showPhoto(state.currentIndex);
        showToast("Compare Mode: Active (Showing Current vs Previous)", "success");
    }
}

function toggleAutoAdvance() {
    state.autoAdvance = !state.autoAdvance;
    savePersistence();
    if (elements.btnAutoAdvance) {
        elements.btnAutoAdvance.classList.toggle('active', state.autoAdvance);
    }
    showToast(`Auto-Advance: ${state.autoAdvance ? "ON" : "OFF"}`, "success");
}

function toggleShortcuts() {
    const isOpen = elements.shortcutsModal.classList.contains('open');
    if (isOpen) {
        elements.shortcutsModal.classList.remove('open');
    } else {
        elements.shortcutsModal.classList.add('open');
    }
}

function setFilter(val) {
    state.filter = val;
    state.colorFilter = null;
    savePersistence();

    const ratingBar = document.getElementById('rating-filter-bar');
    if (ratingBar) {
        ratingBar.querySelectorAll('.chip').forEach(p => {
            const txt = p.innerText.trim();
            const isMatch = (val === 0 && txt === 'All') ||
                (val === -1 && txt === '✘') ||
                (val > 0 && txt === `★${val}`);
            p.classList.toggle('chip--active', isMatch);
        });
    }

    const colorBar = document.getElementById('color-filter-bar');
    if (colorBar) colorBar.querySelectorAll('.chip').forEach(p => p.classList.remove('chip--active'));

    if (navigator.vibrate) navigator.vibrate(10);
    renderGrid();
}

function setColorFilter(color) {
    if (state.colorFilter === color) {
        state.colorFilter = null;
    } else {
        state.colorFilter = color;
        state.filter = 0;
    }
    savePersistence();

    const ratingBar = document.getElementById('rating-filter-bar');
    if (ratingBar) {
        ratingBar.querySelectorAll('.chip').forEach(p => {
            p.classList.toggle('chip--active', state.colorFilter ? false : p.innerText.trim() === 'All');
        });
    }

    const colorBar = document.getElementById('color-filter-bar');
    if (colorBar) {
        colorBar.querySelectorAll('.chip').forEach(p => {
            p.classList.toggle('chip--active', p.dataset.color === state.colorFilter);
        });
    }

    if (navigator.vibrate) navigator.vibrate(10);
    renderGrid();
}


function setGridCols(n) {
    state.gridCols = n;
    savePersistence();
    document.documentElement.style.setProperty('--grid-cols', n);
    const gridBar = document.querySelectorAll('.filter-bar')[1];
    if (gridBar) {
        gridBar.querySelectorAll('.filter-pill').forEach(p => {
            p.classList.toggle('active', p.innerText.includes(n.toString()));
        });
    }
}

function renderGrid() {
    if (!elements.gridView) return;
    elements.gridView.innerHTML = '';

    // Clean up temporary grid blob URLs from previous render
    state._tempGridUrls.forEach(url => URL.revokeObjectURL(url));
    state._tempGridUrls.clear();

    const filtered = state.rawFiles.filter(f => {
        const key = getShortName(f);
        const r = state.ratings[key] || 0;
        const c = state.colorLabels[key] || null;
        if (state.colorFilter) return c === state.colorFilter;
        if (state.filter === 0) return true;
        return r === state.filter;
    });

    if (filtered.length === 0) {
        let msg = "";
        if (state.filter === 0 && !state.colorFilter) msg = "No photos imported.";
        else if (state.filter === -1) msg = "Great! No photos have been rejected.";
        else if (state.filter > 0) msg = `No photos with ⭐${state.filter} rating.`;
        else if (state.colorFilter) msg = `No photos with ${state.colorFilter} label.`;

        elements.gridView.innerHTML = `
            <div class="grid-empty-state">
                <div class="grid-empty-icon">📭</div>
                <h4>Filter Empty</h4>
                <p>${msg}</p>
            </div>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach((file, fIdx) => {
        const key = getShortName(file);
        const absIdx = state.rawFiles.findIndex(f => getShortName(f) === key);

        const item = document.createElement('div');
        const r = state.ratings[key] || 0;
        const c = state.colorLabels[key] || null;
        item.className = `grid-item ${state.selectedForExport.has(key) ? 'selected' : ''} ${r === -1 ? 'grid-item--rejected' : ''}`;

        const previewUrl = state.previews[key];
        let finalSrc = previewUrl;

        if (!previewUrl) {
            const tempUrl = URL.createObjectURL(file);
            state._tempGridUrls.add(tempUrl);
            finalSrc = tempUrl;
        }

        let badges = '';
        if (r !== 0) {
            const badgeText = r === -1 ? '✘' : `⭐ ${r}`;
            badges += `<div class="rating-badge">${badgeText}</div>`;
        }
        if (c) {
            badges += `<div class="color-badge color-badge--${c}"></div>`;
        }

        item.innerHTML = `
            <img loading="lazy" src="${finalSrc}" alt="${key}">
            <div class="grid-selection-hitbox" onclick="event.stopPropagation(); toggleFileSelection('${key}', this.parentElement)">
                <div class="grid-selection-dot"></div>
            </div>
            <div class="grid-item__overlay">
                <span class="grid-item__filename">${key}</span>
            </div>
            ${badges}
        `;

        item.onclick = () => {
            state.currentIndex = absIdx;
            showPhoto(absIdx);
            switchView('CULLING');
        };

        fragment.appendChild(item);
    });

    elements.gridView.appendChild(fragment);
    updateSelectionUI();
}

function toggleFileSelection(filename, itemEl) {
    if (state.selectedForExport.has(filename)) {
        state.selectedForExport.delete(filename);
        itemEl.classList.remove('selected');
    } else {
        state.selectedForExport.add(filename);
        itemEl.classList.add('selected');
    }
    updateSelectionUI();
    savePersistence();
}

function toggleSelectAllRated() {
    const ratedFiles = state.rawFiles.filter(f => {
        const r = state.ratings[getShortName(f)] || 0;
        return r > 0; // Only 1-5 stars. No rejects, no unrated.
    });

    if (ratedFiles.length === 0) {
        return showToast("No rated photos found to select.", "error");
    }

    const allRatedSelected = ratedFiles.every(f => state.selectedForExport.has(getShortName(f)));

    if (allRatedSelected) {
        ratedFiles.forEach(f => state.selectedForExport.delete(getShortName(f)));
        showToast("Deselected all rated photos.", "success");
    } else {
        ratedFiles.forEach(f => state.selectedForExport.add(getShortName(f)));
        showToast("Selected all rated photos (⭐1-5).", "success");
    }
    renderGrid();
}

function toggleSelectAll() {
    const filtered = state.rawFiles.filter(f => {
        const key = getShortName(f);
        const r = state.ratings[key] || 0;
        const c = state.colorLabels[key] || null;

        // If color filter is active
        if (state.colorFilter) {
            return c === state.colorFilter;
        }

        // Rating filter logic
        if (state.filter === 0) return r !== 0;
        return r === state.filter;
    });

    const allInFilterSelected = filtered.every(f => state.selectedForExport.has(getShortName(f)));

    if (allInFilterSelected) {
        filtered.forEach(f => state.selectedForExport.delete(getShortName(f)));
    } else {
        filtered.forEach(f => state.selectedForExport.add(getShortName(f)));
    }
    renderGrid();
}

function updateSelectionUI() {
    const count = state.selectedForExport.size;
    if (elements.filterStatus) elements.filterStatus.innerText = `${count} selected`;
    if (elements.exportStatsText) elements.exportStatsText.innerText = `${count} photo${count !== 1 ? 's' : ''} selected for export`;

    if (elements.selectionBar) {
        elements.selectionBar.classList.toggle('active', count > 0 && state.view === 'EXPLORER');
    }
}

// Feature 2: Batch Export by Rating
function quickExportByRating(minRating) {
    state.selectedForExport.clear();
    state.rawFiles.forEach(file => {
        const key = getShortName(file);
        const r = state.ratings[key] || 0;
        if (r >= minRating) state.selectedForExport.add(key);
    });

    const count = state.selectedForExport.size;
    if (count === 0) {
        showToast(`No photos found with ⭐${minRating}+ rating.`, "error");
        return;
    }

    showToast(`Quick Selected ${count} photos (⭐${minRating}+)`, "success");
    switchView('EXPORT');
}

function updateFilterStatus() {
    elements.filterStatus.innerText = `${state.selectedForExport.size} Selected`;
}

// --- UI Utilities ---
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;

    container.appendChild(toast);

    // Auto remove after 2.5s
    setTimeout(() => {
        toast.classList.add('hide');
        toast.addEventListener('animationend', () => toast.remove());
    }, 2500);
}

// --- Export Logic ---
function showExportForm() {
    if (navigator.vibrate) navigator.vibrate(30);
    switchView('EXPORT');
}

function closeExport() {
    if (elements.exportModal) elements.exportModal.style.display = 'none';

    // Instead of just closing, we return to the explorer view
    switchView('EXPLORER');

    // Reset export button to safe state
    if (elements.mainExportBtn) {
        elements.mainExportBtn.innerText = "Generate";
        elements.mainExportBtn.disabled = false;
        elements.mainExportBtn.style.background = "var(--accent)";
        elements.mainExportBtn.onclick = (e) => executeExport(e.target);
    }
}

function checkMethodSupport() {
    if (!elements.exportMethod) return;
    const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    // TRUE check: does this browser support the File System Access API?
    // Android Chrome 86+ = YES. iOS Safari = NO. Firefox = NO.
    const isSupported = 'showDirectoryPicker' in window;

    const currentMethod = elements.exportMethod.value;

    // Show Browse button whenever folder export is supported — includes Android Chrome!
    if (elements.btnBrowse) {
        elements.btnBrowse.style.display = (currentMethod === 'folder' && isSupported) ? 'flex' : 'none';
    }

    if (!elements.selectedPath) return;

    const subFolder = (elements.folderNameInput && elements.folderNameInput.value) || 'Selection';
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (currentMethod === 'zip') {
        elements.selectedPath.textContent = `📦 Will download as ${subFolder}.zip`;
        elements.selectedPath.style.color = 'var(--accent)';
    } else if (currentMethod === 'share') {
        elements.selectedPath.textContent = isMobile
            ? '📲 Ready to share via native share sheet'
            : '📲 Best used on mobile — share sheet will open';
        elements.selectedPath.style.color = '#2ec4b6';
    } else if (currentMethod === 'folder') {
        if (!isSupported) {
            // Browser doesn't support it at all (iOS Safari, Firefox, etc.)
            elements.selectedPath.textContent = '⚠️ Folder export not supported in this browser — use ZIP or Share';
            elements.selectedPath.style.color = 'var(--danger)';
        } else {
            // Supported! (Android Chrome, desktop Chrome/Edge)
            elements.selectedPath.textContent = state.directoryHandle
                ? `📁 ${state.directoryHandle.name} / ${subFolder}`
                : '— Tap "Choose Folder" to pick destination';
            elements.selectedPath.style.color = state.directoryHandle ? 'var(--accent)' : 'var(--text-dim)';
        }
    }

    if (elements.methodHint) {
        if (currentMethod === 'folder' && !isSupported) {
            elements.methodHint.style.display = 'block';
            elements.methodHint.innerText = isSecure
                ? 'Folder export requires Chrome or Edge (Android/Desktop). Try ZIP or Share instead.'
                : 'HTTPS is required for folder export.';
        } else {
            elements.methodHint.style.display = 'none';
        }
    }
    updateRenamePreview();
}

function updateRenamePreview() {
    if (!elements.renamePattern || !elements.folderNameInput || !elements.renamePreview) return;
    const pattern = elements.renamePattern.value;
    const project = elements.folderNameInput.value || "Selection";
    let example = "DSC_1234.jpg";

    if (pattern === 'project-seq') example = `${project}_001.jpg`;
    else if (pattern === 'project-num') example = `${project}_1234.jpg`;

    elements.renamePreview.innerText = `Sample: ${example}`;
}

function generateExportName(originalName, index, totalSelected) {
    if (!elements.renamePattern || !elements.folderNameInput) return originalName;
    const pattern = elements.renamePattern.value;
    const project = elements.folderNameInput.value || "Selection";
    if (pattern === 'original') return originalName;

    // Remove extension for formatting
    const dotIndex = originalName.lastIndexOf('.');
    const nameOnly = dotIndex !== -1 ? originalName.substring(0, dotIndex) : originalName;
    const ext = dotIndex !== -1 ? originalName.substring(dotIndex) : ".jpg";

    if (pattern === 'project-seq') {
        const seq = (index + 1).toString().padStart(3, '0');
        return `${project}_${seq}${ext}`;
    }

    if (pattern === 'project-num') {
        // Extract numbers from the original name (usually the last digits)
        const match = nameOnly.match(/(\d+)$/);
        const originalNum = match ? match[1] : (index + 1).toString();
        return `${project}_${originalNum}${ext}`;
    }

    return originalName;
}

async function pickExportFolder() {
    try {
        state.directoryHandle = await window.showDirectoryPicker();
        elements.selectedPath.innerText = "Target: " + state.directoryHandle.name;
    } catch (e) {
        console.log("Folder selection cancelled.", e);
    }
}

async function executeExport(btn) {
    let method, resSize, quality, folderName, originalText;

    try {
        method = elements.exportMethod ? elements.exportMethod.value : 'zip';
        resSize = elements.resChoice ? elements.resChoice.value : 'original';
        quality = elements.qualityNum ? (elements.qualityNum.value / 100) : 0.85;
        folderName = (elements.folderNameInput && elements.folderNameInput.value) ? elements.folderNameInput.value : "PhotoCull_Selection";

        // ── Guard: only block folder export if the browser doesn't support it ──
        // Android Chrome 86+ DOES support showDirectoryPicker — allow it!
        // Only iOS Safari, Firefox, etc. need to fall back to ZIP.
        if (method === 'folder' && !('showDirectoryPicker' in window)) {
            method = 'zip';
            if (elements.exportMethod) elements.exportMethod.value = 'zip';
            showToast('📦 Folder export not supported in this browser — switched to ZIP.', 'error');
            checkMethodSupport();
        }

        if (state.selectedForExport.size === 0) return showToast("Please select photos first.", "error");

        originalText = btn ? btn.innerText : "Generate";
        if (btn) {
            btn.innerText = "Processing...";
            btn.disabled = true;
        }
    } catch (setupError) {
        return showToast("Setup Error (Please report): " + setupError.message, "error");
    }

    const selectedCount = state.selectedForExport.size;

    // --- Visual Progress Bar ---
    let exportProgressBar = document.getElementById('export-progress-bar');
    if (!exportProgressBar) {
        exportProgressBar = document.createElement('div');
        exportProgressBar.id = 'export-progress-bar';
        exportProgressBar.className = 'export-progress-bar';
        exportProgressBar.innerHTML = `
            <div class="export-progress-bar__fill" id="export-progress-fill"></div>
            <span class="export-progress-bar__label" id="export-progress-label">Preparing…</span>
        `;
        document.querySelector('.export-cta')?.insertAdjacentElement('beforebegin', exportProgressBar);
    }
    const progressFill = document.getElementById('export-progress-fill');
    const progressLabel = document.getElementById('export-progress-label');
    exportProgressBar.style.display = 'block';

    const setProgress = (done, total, label) => {
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressLabel) progressLabel.innerText = label || `${done} / ${total}`;
        if (btn) btn.innerText = label || `${done}/${total}…`;
    };

    try {
        if (!state.rawFiles || state.rawFiles.length === 0) {
            throw new Error("Photo data not loaded. Please re-import your photos.");
        }

        const items = Array.from(state.selectedForExport);
        const embedMetadata = elements.embedMetadata ? elements.embedMetadata.checked : true;
        const includeSidecar = elements.includeSidecar ? elements.includeSidecar.checked : true;
        state.globalByline = elements.globalByline ? elements.globalByline.value : '';
        savePersistence();

        // ── Step 3A: PRE-CREATE folder handle BEFORE the loop ───────────────────
        let exportFolderHandle = null;
        if (method === 'folder') {
            if (!('showDirectoryPicker' in window)) {
                throw new Error("Folder export requires Chrome or Edge on Desktop.");
            }
            // Prompt once for the parent destination folder
            if (!state.directoryHandle) {
                setProgress(0, selectedCount, "Choosing destination folder…");
                state.directoryHandle = await window.showDirectoryPicker();
                checkMethodSupport();
            }
            // Auto-create the named subfolder (project name) — never fails if already exists
            setProgress(0, selectedCount, `Creating folder "${folderName}"…`);
            exportFolderHandle = await state.directoryHandle.getDirectoryHandle(folderName, { create: true });
        }

        // ── Generate caption sidecar content ───────────────────────────────────
        let captionContent = `PHOTO CULL PRO - EXPORT MANIFEST\n`;
        captionContent += `Project: ${folderName}\n`;
        captionContent += `Byline: ${state.globalByline}\n`;
        captionContent += `Date: ${new Date().toLocaleString()}\n`;
        captionContent += `------------------------------------------\n\n`;

        // Build caption lines upfront
        items.forEach((name, i) => {
            const renamed = generateExportName(name, i, selectedCount);
            const cap = state.captions[name];
            if (cap || state.globalByline) {
                captionContent += `File: ${renamed}\nOriginal: ${name}\nCaption: ${cap || '(No caption)'}\nByline: ${state.globalByline}\n\n`;
            }
        });

        // ── Step 5: PARALLEL BATCH PROCESSING ──────────────────────────────────
        // Process BATCH_SIZE files simultaneously. Significantly faster than
        // one-by-one, especially on multi-core devices.
        const BATCH_SIZE = 4;
        let zip = (method === 'zip') ? new JSZip() : null;
        const filesToShare = [];
        let doneCount = 0;

        for (let batchStart = 0; batchStart < items.length; batchStart += BATCH_SIZE) {
            const batch = items.slice(batchStart, batchStart + BATCH_SIZE);

            await Promise.all(batch.map(async (name, batchIdx) => {
                const globalIdx = batchStart + batchIdx;
                const file = state.rawFiles.find(f => getShortName(f) === name);
                if (!file) return;

                const renamed = generateExportName(name, globalIdx, selectedCount);
                const rating = state.ratings[name] || 0;
                const color = state.colorLabels[name] || null;
                const caption = state.captions[name] || '';

                try {
                    let processedBlob = await processImage(file, resSize, quality);

                    // Inject XMP metadata (Adobe Bridge/Lightroom compatibility)
                    if (embedMetadata) {
                        try {
                            processedBlob = await injectMetadata(processedBlob, rating, color, caption, state.globalByline);
                        } catch (metaErr) {
                            console.error("Metadata injection failed, skipping metadata:", metaErr);
                        }
                    }

                    if (method === 'zip' && zip) {
                        zip.file(renamed, processedBlob);
                    } else if (method === 'folder' && exportFolderHandle) {
                        const handle = await exportFolderHandle.getFileHandle(renamed, { create: true });
                        const writable = await handle.createWritable();
                        await writable.write(processedBlob);
                        await writable.close();
                    } else if (method === 'share') {
                        filesToShare.push(new File([processedBlob], renamed, { type: 'image/jpeg', lastModified: Date.now() }));
                    }
                } catch (errInner) {
                    console.error("Failed to process photo:", name, errInner);
                    showToast(`Skipped: ${name}`, "error");
                }
            }));

            doneCount += batch.length;
            setProgress(doneCount, selectedCount, `Rendered ${doneCount} / ${selectedCount}`);
            await yieldToMain(); // Let the UI breathe between batches
        }

        // ── Sidecar file ──────────────────────────────────────────────────────
        if (includeSidecar) {
            if (method === 'zip' && zip) {
                zip.file('_captions.txt', captionContent);
            } else if (method === 'folder' && exportFolderHandle) {
                const handle = await exportFolderHandle.getFileHandle('_captions.txt', { create: true });
                const writable = await handle.createWritable();
                await writable.write(captionContent);
                await writable.close();
            }
        }

        // ── Final step per method ──────────────────────────────────────────────
        if (method === 'folder') {
            setProgress(selectedCount, selectedCount, "Done!");
            showToast(`✅ ${selectedCount} photos saved to "${folderName}"`, "success");
            btn.innerText = originalText;
            btn.disabled = false;
            setTimeout(() => { exportProgressBar.style.display = 'none'; }, 2000);
            closeExport();

        } else if (method === 'share') {
            const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
            if (!navigator.share) {
                if (!isSecure) throw new Error("Sharing requires a secure connection (HTTPS). Please use ZIP method.");
                throw new Error("Your browser does not support direct sharing. Please use ZIP method.");
            }
            if (selectedCount > 25) {
                showToast("Note: Sharing >25 files at once often fails on iOS/Android. ZIP is recommended for large batches.", "warning");
            }
            if (filesToShare.length === 0) throw new Error("Render Failed: No photos were processed.");

            setProgress(selectedCount, selectedCount, "Ready to share!");

            // Two-step: render first, then require a fresh tap for share sheet
            btn.innerText = "OPEN SHARE SHEET 📲";
            btn.style.background = "#25D366";
            btn.style.boxShadow = "0 0 20px rgba(37, 211, 102, 0.4)";
            btn.disabled = false;

            btn.onclick = async (clickEvent) => {
                if (clickEvent) clickEvent.preventDefault();
                try {
                    btn.innerText = "Launching...";
                    btn.disabled = true;
                    const shareData = {
                        files: filesToShare,
                        title: 'PhotoCull Selection',
                        text: `Shared ${filesToShare.length} photos from PhotoCull Pro.`
                    };
                    if (navigator.canShare && !navigator.canShare(shareData)) {
                        throw new Error("Device limit: This batch is too large to share directly. Try fewer photos or use ZIP.");
                    }
                    await navigator.share(shareData);
                    showToast("Share sheet opened!", "success");
                    exportProgressBar.style.display = 'none';
                    closeExport();
                } catch (shareErr) {
                    console.error("Share API Error:", shareErr);
                    showToast(shareErr.message || "Share failed or cancelled.", "error");
                    btn.innerText = "RETRY SHARE 📲";
                    btn.disabled = false;
                }
            };
            return; // Exit — share requires a second tap

        } else {
            // ZIP method
            if (typeof JSZip === 'undefined') throw new Error("ZIP library not loaded. Please wait or refresh.");
            setProgress(selectedCount, selectedCount, "Generating ZIP…");
            btn.innerText = "Compressing ZIP…";
            const content = await zip.generateAsync({
                type: "blob",
                compression: "DEFLATE",
                compressionOptions: { level: 3 } // Fast compression
            });
            saveAs(content, `${folderName}.zip`);

            btn.innerText = originalText;
            btn.disabled = false;
        }
        closeExport();
    } catch (err) {
        showToast("Export Issue: " + err.message, "error");
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// --- Image Processing ---
async function processImage(file, resSize, quality) {
    try {
        if (resSize === 'original') return file;

        // Try using createImageBitmap first (modern fast approach)
        let bitmap = null;
        let imgWidth, imgHeight, imgSource;

        if (window.createImageBitmap) {
            bitmap = await createImageBitmap(file).catch(() => null);
        }

        if (bitmap) {
            imgWidth = bitmap.width;
            imgHeight = bitmap.height;
            imgSource = bitmap;
        } else {
            // FALLBACK: Classic Image element for resize & compress
            imgSource = await loadClassicImage(file);
            if (!imgSource) return file; // Ultimate fallback if both fail
            imgWidth = imgSource.width;
            imgHeight = imgSource.height;
        }

        let w = imgWidth;
        let h = imgHeight;

        // 'original-q' keeps full resolution, only applies quality compression
        if (resSize !== 'original-q') {
            const max = parseInt(resSize);
            if (w > h && w > max) { h = (max / w) * h; w = max; }
            else if (h > max) { w = (max / h) * w; h = max; }
        }

        let blob;
        // USE OFFSCREEN CANVAS IF SUPPORTED (FASTEST)
        if (window.OffscreenCanvas) {
            const off = new OffscreenCanvas(w, h);
            const octx = off.getContext('2d');
            octx.fillStyle = 'black';
            octx.fillRect(0, 0, w, h);
            octx.drawImage(imgSource, 0, 0, w, h);
            blob = await off.convertToBlob({ type: 'image/jpeg', quality: quality });
        } else {
            // FALLBACK TO REGULAR CANVAS
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(imgSource, 0, 0, w, h);
            blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
        }

        // Clean up memory
        if (bitmap && bitmap.close) bitmap.close();
        if (!bitmap && imgSource && imgSource._blobUrl) {
            URL.revokeObjectURL(imgSource._blobUrl);
        }

        return blob;
    } catch (e) {
        console.error("Rendering error:", e);
        return file;
    }
}

/**
 * Feature 4: XMP Metadata Injector
 * Injects Adobe-compatible ratings, labels, and captions directly into JPEG blob
 * without external libraries.
 */
async function injectMetadata(blob, rating, color, caption, byline) {
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    // Validate JPEG
    if (view.getUint16(0) !== 0xFFD8) return blob;

    // Map color labels to Adobe "Urgency" values
    // Bridge Labels: Red=1, Yellow=2, Green=3, Blue=4, Purple=5
    const colorMap = { 'red': 1, 'yellow': 2, 'green': 3, 'blue': 4 };
    const urgency = colorMap[color] || 0;

    // Sanitize XML characters
    const esc = (str) => str.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": "&apos;" }[c]));

    // Construct XMP Packet
    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c140">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmp:Rating="${rating > 0 ? rating : 0}"
    photoshop:Urgency="${urgency}">
   <dc:description>
    <rdf:Alt><rdf:li xml:lang="x-default">${esc(caption)}</rdf:li></rdf:Alt>
   </dc:description>
   <dc:creator><rdf:Seq><rdf:li>${esc(byline)}</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta><?xpacket end="w"?>`;

    const xmpHeader = "http://ns.adobe.com/xap/1.0/\0";
    const xmpBlob = new TextEncoder().encode(xmpHeader + xmp);
    const markerLength = xmpBlob.length + 2;

    // We inject right after the SOI (FF D8)
    const newBuffer = new Uint8Array(buffer.byteLength + markerLength + 2);
    newBuffer.set(new Uint8Array(buffer.slice(0, 2)), 0); // FF D8

    // APP1 Marker
    newBuffer[2] = 0xFF;
    newBuffer[3] = 0xE1;
    newBuffer[4] = (markerLength >> 8) & 0xFF;
    newBuffer[5] = markerLength & 0xFF;
    newBuffer.set(xmpBlob, 6);

    // Rest of image
    newBuffer.set(new Uint8Array(buffer.slice(2)), markerLength + 4);

    return new Blob([newBuffer], { type: 'image/jpeg' });
}

// Start the app
init();
