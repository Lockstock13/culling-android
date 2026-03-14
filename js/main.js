/**
 * PhotoCull Pro - Main Application Entry Point
 * Refactored for High Performance and Modularity
 */
import { state, loadPersistence, savePersistence, clearPreviewCaches } from './core/state.js';
import { elements } from './ui/elements.js';
import { isImageFile, getShortName, getFileKey, showToast, yieldToMain, naturalSort } from './core/utils.js';
import { getExifMeta, generateThumbnail, WorkerQueue, processImage } from './core/scanner.js';
import { renderGrid, updateGridItem, updateSelectionUI } from './ui/grid.js';
import { showPhoto, setRating, updateRatingUI } from './ui/culling.js';
import { toggleZoom, applyZoom, applyLoupe, resetZoom } from './ui/zoom.js';
import {
    executeExport,
    checkMethodSupport,
    updateRenamePreview,
    pickExportFolder,
    injectMetadata,
} from './core/export.js';

/**
 * REFACTORED CONCURRENCY
 */
const scannerQueue = new WorkerQueue(12);

/**
 * Expose showToast globally so export.js can use it via window._showToast
 */
window._showToast = showToast;

/**
 * BRIDGE FOR INLINE HTML CALLS
 */
window.app = {
    switchView: (v) => switchView(v),
    goBack: () => goBack(),
    toggleDrawer: () => toggleDrawer(),
    toggleShortcuts: () => toggleShortcuts(),
    setFilter: (v) => setFilter(v),
    setColorFilter: (c) => setColorFilter(c),
    toggleSelectAllRated: () => toggleSelectAllRated(),
    toggleSelectAll: () => toggleSelectAll(),
    quickExportByRating: (r) => quickExportByRating(r),
    startCulling: (idx) => {
        state.currentIndex = idx;
        switchView('CULLING');
        showPhoto(idx);
    },
    navigatePhoto: (dir) => navigatePhoto(dir),
    setRating: (v) => setRating(v),
    toggleAutoAdvance: () => { state.autoAdvance = !state.autoAdvance; showToast(`Auto-Advance: ${state.autoAdvance ? 'ON' : 'OFF'}`); },
    clearPersistence: () => { if (confirm('Clear all?')) { localStorage.clear(); location.reload(); } },
    toggleSort: () => toggleSort(),

    // Zoom & Loupe
    toggleZoom: () => toggleZoom(),
    toggleLoupe: () => {
        state.isLoupeActive = !state.isLoupeActive;
        elements.btnLoupe.classList.toggle('active', state.isLoupeActive);
        if (!state.isLoupeActive) resetZoom();
        else applyLoupe();
    },
    toggleCompare: () => toggleCompare(),

    // Export
    executeExport: (btn) => executeExport(btn),
    checkMethodSupport: () => checkMethodSupport(),
    updateRenamePreview: () => updateRenamePreview(),
    pickExportFolder: () => pickExportFolder(),
};

// Global compatibility layer — all window.app methods also accessible as globals
Object.assign(window, window.app);

// Additional globals that are called inline from HTML
window.setCaption = setCaption;
window.executeExport = executeExport;
window.checkMethodSupport = checkMethodSupport;
window.updateRenamePreview = updateRenamePreview;
window.pickExportFolder = pickExportFolder;
window.handleDirectoryPicker = handleDirectoryPicker;

function init() {
    loadPersistence();
    setupEventListeners();
    updateUI();
    state.savePersistence = savePersistence;
}

async function handleDirectoryPicker() {
    // 1. Check for API support (requires HTTPS or Localhost)
    if (!window.showDirectoryPicker) {
        console.warn("showDirectoryPicker not supported, falling back to traditional input.");
        if (elements.folderInput) elements.folderInput.click();
        else showToast('Folder access not supported in this browser. Use "Select Photos".', 'error');
        return;
    }

    try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' }).catch(e => {
            if (e.name === 'AbortError') return null;
            throw e;
        });
        if (!dirHandle) return;

        clearPreviewCaches();
        state.directoryHandle = dirHandle;
        
        if (elements.folderNameInput) {
            elements.folderNameInput.value = dirHandle.name;
        }

        const files = [];
        await collectDirFiles(dirHandle, '', files);

        if (files.length === 0) {
            return showToast('No supported photos found in this folder.', 'error');
        }

        assignUniqueKeys(files);
        state.rawFiles = files.sort((a, b) => naturalSort(a, b));
        switchView('EXPLORER');
        renderGrid(true);
        startBackgroundScan(files);
        
        if (window.updateRenamePreview) window.updateRenamePreview();
    } catch (err) {
        console.error('Directory access failed:', err);
        showToast('Failed to access folder: ' + err.message, 'error');
    }
}

async function collectDirFiles(dirHandle, prefix, files) {
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && isImageFile(entry.name)) {
            try {
                const file = await entry.getFile();
                file._handle = entry;
                file._shortName = entry.name;
                file._relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
                files.push(file);
            } catch (cfErr) {
                console.warn(`Skipping file ${entry.name}:`, cfErr);
            }
        } else if (entry.kind === 'directory') {
            const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
            await collectDirFiles(entry, nextPrefix, files);
        }
    }
}

function setupEventListeners() {
    elements.fileInput.onchange = handleFileUpload;
    elements.folderInput.onchange = handleFileUpload;

    const importCard = document.querySelector('.import-card');
    if (importCard) {
        importCard.addEventListener('dragover', (e) => { e.preventDefault(); importCard.classList.add('drag-over'); });
        importCard.addEventListener('dragleave', () => importCard.classList.remove('drag-over'));
        importCard.addEventListener('drop', async (e) => {
            e.preventDefault();
            importCard.classList.remove('drag-over');
            handleFileUpload({ target: { files: e.dataTransfer.files } });
        });
    }
    document.addEventListener('keydown', handleKeyboard);
    setupGestures();
}

function setupGestures() {
    const hammer = new Hammer(document.getElementById('culling-page'));
    hammer.get('pan').set({ direction: Hammer.DIRECTION_ALL });
    hammer.get('pinch').set({ enable: true });

    hammer.on('swipeleft', () => {
        if (state.zoomLevel === 1) navigatePhoto(1);
    });
    hammer.on('swiperight', (e) => {
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
            resetZoom();
        }
        applyZoom();
    });
}

/**
 * NON-BLOCKING IMPORT ENGINE
 */
async function handleFileUpload(e) {
    const files = Array.from(e.target.files).filter(isImageFile);
    if (files.length === 0) return;

    clearPreviewCaches();

    // Auto-set Project Name from folder name if possible
    const firstFile = files[0];
    if (firstFile.webkitRelativePath) {
        const parts = firstFile.webkitRelativePath.split(/[/\\]/);
        if (parts.length > 1) {
            const folderName = parts[0];
            if (elements.folderNameInput) {
                elements.folderNameInput.value = folderName;
                // Trigger preview update
                if (window.updateRenamePreview) window.updateRenamePreview();
            }
        }
    }

    assignUniqueKeys(files);

    state.rawFiles = files.sort((a, b) => naturalSort(a, b));

    switchView('EXPLORER');
    renderGrid(true);

    startBackgroundScan(files);
}

function assignUniqueKeys(files) {
    const nameCounts = new Map();
    files.forEach((f) => {
        const basePath = (f.webkitRelativePath && f.webkitRelativePath.length > 0)
            ? f.webkitRelativePath
            : (f._relativePath || f.name || '');
        const displayName = getShortName({ name: basePath, webkitRelativePath: basePath });
        nameCounts.set(displayName, (nameCounts.get(displayName) || 0) + 1);
    });

    const seen = new Map();
    files.forEach((f) => {
        const basePath = (f.webkitRelativePath && f.webkitRelativePath.length > 0)
            ? f.webkitRelativePath
            : (f._relativePath || f.name || '');
        const count = seen.get(basePath) || 0;
        seen.set(basePath, count + 1);
        f._key = count === 0 ? basePath : `${basePath}__dup${count + 1}`;
        if (!f._shortName) f._shortName = getShortName({ name: basePath, webkitRelativePath: basePath });

        // Best-effort migration from legacy short-name keys
        const legacyKey = f._shortName;
        if (nameCounts.get(legacyKey) === 1) {
            if (state.ratings[legacyKey] !== undefined && state.ratings[f._key] === undefined) {
                state.ratings[f._key] = state.ratings[legacyKey];
            }
            if (state.colorLabels[legacyKey] !== undefined && state.colorLabels[f._key] === undefined) {
                state.colorLabels[f._key] = state.colorLabels[legacyKey];
            }
            if (state.captions[legacyKey] !== undefined && state.captions[f._key] === undefined) {
                state.captions[f._key] = state.captions[legacyKey];
            }
            if (state.selectedForExport.has(legacyKey)) {
                state.selectedForExport.add(f._key);
            }
        }
    });

    savePersistence();
}

async function startBackgroundScan(files) {
    let processed = 0;
    const total = files.length;

    for (const file of files) {
        scannerQueue.add(async () => {
            try {
                const meta = await getExifMeta(file);
                file._date = meta.date;
                const key = getFileKey(file);

                if (meta.rating !== null && !state.ratings[key]) {
                    state.ratings[key] = meta.rating;
                }

                if (!state.previews[key]) {
                    state.previews[key] = await generateThumbnail(file);
                }

                processed++;
                elements.stepTitle.innerText = `Library (${processed}/${total})`;
                updateGridItem(key);

                if (processed % 20 === 0) await yieldToMain();
            } catch (err) { console.error(err); }
        });
    }
}

function switchView(v) {
    state.view = v;
    updateUI();
    if (v === 'EXPORT') {
        checkMethodSupport();
        updateRenamePreview();
        // Sync byline field with state
        if (elements.globalByline && state.globalByline) {
            elements.globalByline.value = state.globalByline;
        }
        // Update export stats
        updateSelectionUI();
    }
}

function updateUI() {
    elements.pages.forEach(p => p.classList.toggle('active', p.id === `${state.view.toLowerCase()}-page`));
    elements.btnBack.style.display = (state.view === 'IMPORT') ? 'none' : 'flex';

    if (state.view === 'EXPLORER') {
        elements.stepTitle.innerText = `Library (${state.rawFiles.length})`;
        renderGrid();
        updateStats();
        updateSelectionUI();
    }
}

function updateStats() {
    const ratedCount = Object.keys(state.ratings).filter(id => state.ratings[id] !== 0).length;
    const progress = Math.round((ratedCount / state.rawFiles.length) * 100) || 0;
    if (elements.statProgress) elements.statProgress.innerText = `${progress}%`;
    if (elements.statRated) elements.statRated.innerText = ratedCount;
}

function navigatePhoto(dir) {
    const newIdx = state.currentIndex + dir;
    if (newIdx >= 0 && newIdx < state.rawFiles.length) {
        showPhoto(newIdx);
        // Preload next medium res
        const nextIdx = newIdx + dir;
        if (nextIdx >= 0 && nextIdx < state.rawFiles.length) {
            const nextFile = state.rawFiles[nextIdx];
            const nextKey = getFileKey(nextFile);
            if (!state.mediumPreviews[nextKey]) {
                processImage(nextFile, 1600, 0.7).then(blob => {
                    state.mediumPreviews[nextKey] = URL.createObjectURL(blob);
                });
            }
        }
    }
}

function goBack() {
    if (state.view === 'CULLING') switchView('EXPLORER');
    else if (state.view === 'EXPLORER') switchView('IMPORT');
    else if (state.view === 'EXPORT') switchView('EXPLORER');
}

function toggleDrawer() {
    elements.sideDrawer.classList.toggle('active');
    elements.drawerOverlay.classList.toggle('active');
}

function toggleShortcuts() {
    elements.shortcutsModal.classList.toggle('open');
}

function toggleSort() {
    state.sortMode = state.sortMode === 'FILENAME' ? 'TIME' : 'FILENAME';
    state.rawFiles.sort((a, b) => {
        if (state.sortMode === 'TIME') return (a._date || 0) - (b._date || 0);
        return naturalSort(a, b);
    });
    renderGrid(true);
    showToast(`Sorted by ${state.sortMode}`);
}

function toggleCompare() {
    state.isCompareMode = !state.isCompareMode;
    elements.compareBtn.classList.toggle('active', state.isCompareMode);
    elements.viewportContainer.classList.toggle('comparing', state.isCompareMode);

    if (state.isCompareMode) {
        showPhoto(state.currentIndex);
        showToast('Compare Mode: Active', 'success');
    }
}

/**
 * CAPTION — called from culling page textarea
 */
function setCaption(value) {
    const file = state.rawFiles[state.currentIndex];
    if (!file) return;
    const key = getFileKey(file);
    state.captions[key] = value;
    savePersistence();
}

/**
 * FILTER — with chip highlighting
 */
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

function setColorFilter(c) {
    state.colorFilter = (state.colorFilter === c ? null : c);
    state.filter = 0;
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

/**
 * SELECTION helpers
 */
function toggleSelectAllRated() {
    const ratedFiles = state.rawFiles.filter(f => {
        const r = state.ratings[getFileKey(f)] || 0;
        return r > 0;
    });
    if (ratedFiles.length === 0) {
        return showToast('No rated photos found to select.', 'error');
    }
    const allRatedSelected = ratedFiles.every(f => state.selectedForExport.has(getFileKey(f)));
    if (allRatedSelected) {
        ratedFiles.forEach(f => state.selectedForExport.delete(getFileKey(f)));
        showToast('Deselected all rated photos.', 'success');
    } else {
        ratedFiles.forEach(f => state.selectedForExport.add(getFileKey(f)));
        showToast('Selected all rated photos (⭐1-5).', 'success');
    }
    renderGrid();
    savePersistence();
}

function toggleSelectAll() {
    const filtered = state.rawFiles.filter(f => {
        const key = getFileKey(f);
        const r = state.ratings[key] || 0;
        const c = state.colorLabels[key] || null;
        if (state.colorFilter) return c === state.colorFilter;
        if (state.filter === 0) return true;
        return r === state.filter;
    });
    const allSelected = filtered.every(f => state.selectedForExport.has(getFileKey(f)));
    if (allSelected) {
        filtered.forEach(f => state.selectedForExport.delete(getFileKey(f)));
    } else {
        filtered.forEach(f => state.selectedForExport.add(getFileKey(f)));
    }
    renderGrid();
    savePersistence();
}

function quickExportByRating(minRating) {
    state.selectedForExport.clear();
    state.rawFiles.forEach(file => {
        const key = getFileKey(file);
        const r = state.ratings[key] || 0;
        if (r >= minRating) state.selectedForExport.add(key);
    });
    const count = state.selectedForExport.size;
    if (count === 0) {
        showToast(`No photos found with ⭐${minRating}+ rating.`, 'error');
        return;
    }
    showToast(`Quick Selected ${count} photos (⭐${minRating}+)`, 'success');
    switchView('EXPORT');
    savePersistence();
}

function handleKeyboard(e) {
    if (state.view === 'CULLING') {
        if (e.key === 'ArrowRight') navigatePhoto(1);
        if (e.key === 'ArrowLeft') navigatePhoto(-1);
        if (['1', '2', '3', '4', '5'].includes(e.key)) setRating(parseInt(e.key));
        if (e.key === 'x' || e.key === 'X') setRating(-1);
        if (e.key === '0') setRating(0);
        if (e.key.toLowerCase() === 'a') window.app.toggleAutoAdvance();
        if (e.key.toLowerCase() === 'c') window.app.toggleCompare();

        // Loupe & Zoom Keys
        if (e.key.toLowerCase() === 'z') {
            if (!e.shiftKey) {
                if (!state.isLoupeActive) {
                    state.isLoupeActive = true;
                    elements.btnLoupe.classList.add('active');
                    applyLoupe();
                }
            } else {
                toggleZoom();
            }
        }

        document.addEventListener('keyup', (e) => {
            if (e.key.toLowerCase() === 'z' && state.isLoupeActive) {
                state.isLoupeActive = false;
                elements.btnLoupe.classList.remove('active');
                resetZoom();
            }
        }, { once: true });
    }

    if (e.key === '?') toggleShortcuts();
    if (e.key === 'Escape') goBack();
}

init();


