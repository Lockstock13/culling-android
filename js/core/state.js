/**
 * PhotoCull Pro - State Management Module
 */

export const state = {
    // Session Data
    rawFiles: [],
    currentIndex: 0,
    
    // Persisted Metadata
    ratings: {},       // filename -> rating (1-5, -1 for reject)
    colorLabels: {},   // filename -> color string
    captions: {},      // filename -> string
    globalByline: '',
    
    // UI State
    view: 'IMPORT',     
    sortMode: 'FILENAME',
    filter: 0,          
    colorFilter: null,  
    gridCols: 3,
    zoomLevel: 1,
    panX: 0,
    panY: 0,
    
    // Cache & Background Tasks
    previews: {},       // filename -> thumbnail blob URL (300px)
    mediumPreviews: {}, // filename -> preview blob URL (1600px)
    _tempGridUrls: new Set(),
    
    // Flags
    isRenderingBackground: false,
    isNavigating: false,
    isCompareMode: false,
    isLoupeActive: false,
    autoAdvance: true,
    directoryHandle: null,
};

export function savePersistence() {
    localStorage.setItem('photocull_ratings', JSON.stringify(state.ratings));
    localStorage.setItem('photocull_colorLabels', JSON.stringify(state.colorLabels));
    localStorage.setItem('photocull_captions', JSON.stringify(state.captions));
    localStorage.setItem('photocull_byline', state.globalByline);

    const data = {
        selectedForExport: Array.from(state.selectedForExport || []),
        gridCols: state.gridCols,
        filter: state.filter,
        colorFilter: state.colorFilter,
        autoAdvance: state.autoAdvance,
        sortMode: state.sortMode
    };
    localStorage.setItem('photocull_pro_data', JSON.stringify(data));
}

export function loadPersistence() {
    state.ratings = JSON.parse(localStorage.getItem('photocull_ratings') || '{}');
    state.colorLabels = JSON.parse(localStorage.getItem('photocull_colorLabels') || '{}');
    state.captions = JSON.parse(localStorage.getItem('photocull_captions') || '{}');
    state.globalByline = localStorage.getItem('photocull_byline') || '';

    const saved = localStorage.getItem('photocull_pro_data');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            state.selectedForExport = new Set(data.selectedForExport || []);
            state.gridCols = data.gridCols || 3;
            state.filter = data.filter !== undefined ? data.filter : 0;
            state.colorFilter = data.colorFilter !== undefined ? data.colorFilter : null;
            state.autoAdvance = data.autoAdvance !== undefined ? data.autoAdvance : true;
            state.sortMode = data.sortMode || 'FILENAME';
        } catch (e) {
            console.error("Failed to parse persistence:", e);
        }
    } else {
        state.selectedForExport = new Set();
    }
}

export function clearPreviewCaches() {
    Object.values(state.previews || {}).forEach(url => URL.revokeObjectURL(url));
    state.previews = {};

    Object.values(state.mediumPreviews || {}).forEach(url => URL.revokeObjectURL(url));
    state.mediumPreviews = {};

    state._tempGridUrls.forEach(url => URL.revokeObjectURL(url));
    state._tempGridUrls.clear();
}
