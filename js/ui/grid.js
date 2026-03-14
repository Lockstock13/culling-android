/**
 * PhotoCull Pro - Grid Controller
 * Requirement #4: Avoid full grid re-renders
 */
import { state, touchPreview, scheduleSave } from '../core/state.js';
import { elements } from './elements.js';
import { getFileKey, getShortName } from '../core/utils.js';

const gridItemCache = new Map();

/**
 * Perform a full grid sync / filter
 */
export function renderGrid(isFullRebuild = false) {
    if (!elements.gridView) return;
    
    if (isFullRebuild) {
        elements.gridView.innerHTML = '';
        gridItemCache.clear();
    }

    const filtered = state.rawFiles.filter(f => {
        const key = getFileKey(f);
        const r = state.ratings[key] || 0;
        const c = state.colorLabels[key] || null;
        if (state.colorFilter) return c === state.colorFilter;
        if (state.filter === 0) return true;
        return r === state.filter;
    });

    if (filtered.length === 0) {
        let msg = "No photos found matching filter.";
        elements.gridView.innerHTML = `<div class="grid-empty-state"><h4>📭 ${msg}</h4></div>`;
        return;
    }

    // Identify which items should be visible
    const visibleKeys = new Set(filtered.map(f => getFileKey(f)));
    
    // We update the grid by showing/hiding existing elements
    // and creating missing ones
    const fragment = document.createDocumentFragment();
    
    // Clear parent to ensure order is preserved and no orphans
    elements.gridView.innerHTML = '';
    
    state.rawFiles.forEach((file, index) => {
        const key = getFileKey(file);
        const isVisible = visibleKeys.has(key);
        
        let item = gridItemCache.get(key);
        
        if (!item) {
            item = createGridItem(file, index);
            gridItemCache.set(key, item);
        }
        
        item.style.display = isVisible ? '' : 'none';
        
        // Final state sync for existing items
        if (isVisible) {
            syncGridItem(item, key);
        }
        
        // Append all items back to fragment
        fragment.appendChild(item);
    });

    if (fragment.childNodes.length > 0) {
        elements.gridView.appendChild(fragment);
    }
    
    updateSelectionUI();
}

/**
 * Incrementally update a specific grid item (e.g. after background scan)
 */
export function updateGridItem(key) {
    const item = gridItemCache.get(key);
    if (item) {
        syncGridItem(item, key);
    }
}

function createGridItem(file, index) {
    const key = getFileKey(file);
    const item = document.createElement('div');
    item.className = 'grid-item';
    item.dataset.key = key;
    const displayName = getShortName(file);
    
    item.innerHTML = `
        <img loading="lazy" src="" alt="${displayName}">
        <div class="grid-selection-hitbox" onclick="event.stopPropagation()">
            <div class="grid-selection-dot"></div>
        </div>
        <div class="grid-item__overlay">
            <span class="grid-item__filename">${displayName}</span>
        </div>
        <div class="badges-container"></div>
    `;

    // Click to select
    item.querySelector('.grid-selection-hitbox').onclick = (e) => {
        e.stopPropagation();
        toggleFileSelection(key);
    };

    // Click to cull
    item.onclick = () => {
        window.app.startCulling(index);
    };

    syncGridItem(item, key);
    return item;
}

function syncGridItem(item, key) {
    const r = state.ratings[key] || 0;
    const c = state.colorLabels[key] || null;
    const isSelected = state.selectedForExport.has(key);
    
    item.classList.toggle('selected', isSelected);
    item.classList.toggle('grid-item--rejected', r === -1);
    
    const img = item.querySelector('img');
    const previewUrl = state.previews[key];
    if (previewUrl && img.src !== previewUrl) {
        img.src = previewUrl;
        touchPreview(key);
    } else if (!previewUrl && !img.src) {
        // We set a temporary src only if no thumbnail exists yet
        // In a real high-perf app, we'd use a placeholder or the actual file URL
    }

    const badgeContainer = item.querySelector('.badges-container');
    let badgesHtml = '';
    if (r !== 0) {
        const badgeText = r === -1 ? '✘' : `⭐ ${r}`;
        const badgeClass = r === -1 ? 'rating-badge rating-badge--reject' : 'rating-badge';
        badgesHtml += `<div class="${badgeClass}">${badgeText}</div>`;
    }
    if (c) {
        badgesHtml += `<div class="color-badge color-badge--${c}"></div>`;
    }
    badgeContainer.innerHTML = badgesHtml;
}

export function updateSelectionUI() {
    const count = state.selectedForExport.size;
    if (elements.filterStatus) elements.filterStatus.innerText = `${count} selected`;
    if (elements.exportStatsText) elements.exportStatsText.innerText = `${count} selected for export`;
    if (elements.exportStatusText && count > 0) {
        elements.exportStatusText.innerText = 'Ready to export';
    }
    if (elements.selectionBar) {
        elements.selectionBar.classList.toggle('active', count > 0 && state.view === 'EXPLORER');
    }
}

function toggleFileSelection(key) {
    if (state.selectedForExport.has(key)) {
        state.selectedForExport.delete(key);
    } else {
        state.selectedForExport.add(key);
    }
    updateGridItem(key);
    updateSelectionUI();
    scheduleSave();
}
