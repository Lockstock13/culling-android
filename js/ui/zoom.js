/**
 * PhotoCull Pro - Zoom & Pan Module
 */
import { state } from '../core/state.js';
import { elements } from './elements.js';

export function toggleZoom() {
    state.zoomLevel = state.zoomLevel === 1 ? 2.5 : 1;
    if (state.zoomLevel === 1) resetZoom();
    else {
        state.panX = 0;
        state.panY = 0;
        applyZoom();
    }
}

export function resetZoom() {
    state.zoomLevel = 1;
    state.panX = 0;
    state.panY = 0;
    applyZoom();
}

export function applyLoupe(e) {
    if (!state.isLoupeActive) return;

    const img = elements.viewImg;
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    const containerW = elements.viewportContainer.clientWidth;
    const containerH = elements.viewportContainer.clientHeight;

    if (!naturalW || naturalW === 0) return;

    const renderedWidth = img.clientWidth;
    const loupeScale = naturalW / renderedWidth;

    state.zoomLevel = loupeScale;

    if (e && e.center) {
        const rect = img.getBoundingClientRect();
        const mouseX = e.center.x;
        const mouseY = e.center.y;

        const natural_x_at_mouse = (mouseX - rect.left) * (naturalW / rect.width);
        const natural_y_at_mouse = (mouseY - rect.top) * (naturalH / rect.height);

        state.panX = mouseX - (natural_x_at_mouse * loupeScale);
        state.panY = mouseY - (natural_y_at_mouse * loupeScale);
    } else {
        state.panX = 0;
        state.panY = 0;
    }

    applyZoom();
}

export function applyZoom(isPanning = false) {
    const scale = state.zoomLevel;

    if (scale > 1) {
        const rect = elements.viewImg.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const limitX = (rect.width - viewportWidth) / 2 / scale;
        const limitY = (rect.height - viewportHeight) / 2 / scale;

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
