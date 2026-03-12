/**
 * PhotoCull Pro - Main Application Entry Point
 * Refactored for High Performance and Modularity
 */
import { state, loadPersistence, savePersistence, clearPreviewCaches } from './core/state.js';
import { elements } from './ui/elements.js';
import { isImageFile, getShortName, showToast, yieldToMain, naturalSort } from './core/utils.js';
import { getExifMeta, generateThumbnail, WorkerQueue, processImage } from './core/scanner.js';
import { renderGrid, updateGridItem, updateSelectionUI } from './ui/grid.js';
import { showPhoto, setRating, updateRatingUI } from './ui/culling.js';
import { toggleZoom, applyZoom, applyLoupe, resetZoom } from './ui/zoom.js';

/**
 * REFACTORED CONCURRENCY (Requirement #2)
 */
const scannerQueue = new WorkerQueue(12);

/**
 * BRIDGE FOR INLINE HTML CALLS
 */
window.app = {
    switchView: (v) => switchView(v),
    goBack: () => goBack(),
    toggleDrawer: () => toggleDrawer(),
    toggleShortcuts: () => toggleShortcuts(),
    setFilter: (v) => { state.filter = v; state.colorFilter = null; renderGrid(); },
    setColorFilter: (c) => { state.colorFilter = (state.colorFilter === c ? null : c); state.filter = 0; renderGrid(); },
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
    clearPersistence: () => { if(confirm("Clear all?")) { localStorage.clear(); location.reload(); } },
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
};

// Global compatibility layer
Object.assign(window, window.app);

function init() {
    loadPersistence();
    setupEventListeners();
    updateUI();
    state.savePersistence = savePersistence;
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
 * NON-BLOCKING IMPORT ENGINE (Requirement #1)
 */
async function handleFileUpload(e) {
    const files = Array.from(e.target.files).filter(isImageFile);
    if (files.length === 0) return;

    clearPreviewCaches();
    
    files.forEach(f => {
        f._shortName = getShortName(f);
    });

    state.rawFiles = files.sort((a, b) => naturalSort(a, b));
    
    switchView('EXPLORER');
    renderGrid(true); 

    startBackgroundScan(files);
}

async function startBackgroundScan(files) {
    let processed = 0;
    const total = files.length;
    
    for (const file of files) {
        scannerQueue.add(async () => {
            try {
                const meta = await getExifMeta(file);
                file._date = meta.date;
                const key = getShortName(file);
                
                if (meta.rating !== null && !state.ratings[key]) {
                    state.ratings[key] = meta.rating;
                }
                
                if (!state.previews[key]) {
                    state.previews[key] = await generateThumbnail(file);
                }
                
                processed++;
                elements.stepTitle.innerText = `Library (${processed}/${total})`;
                updateGridItem(key);
                
                // Requirement #6: UI Thread Yielding
                if (processed % 20 === 0) await yieldToMain();
            } catch (err) { console.error(err); }
        });
    }
}

function switchView(v) {
    state.view = v;
    updateUI();
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
        // Preload next medium res (Requirement #7)
        const nextIdx = newIdx + dir;
        if (nextIdx >= 0 && nextIdx < state.rawFiles.length) {
            const nextFile = state.rawFiles[nextIdx];
            const nextKey = getShortName(nextFile);
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
    state.rawFiles.sort((a,b) => {
        if (state.sortMode === 'TIME') return (a._date || 0) - (b._date || 0);
        return naturalSort(a,b);
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
        showToast("Compare Mode: Active", "success");
    }
}

function handleKeyboard(e) {
    if (state.view === 'CULLING') {
        if (e.key === 'ArrowRight') navigatePhoto(1);
        if (e.key === 'ArrowLeft') navigatePhoto(-1);
        if (['1','2','3','4','5'].includes(e.key)) setRating(parseInt(e.key));
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
    }
    
    if (state.view === 'CULLING') {
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
