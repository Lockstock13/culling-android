/**
 * PhotoCull Pro - Culling View Module
 */
import { state } from '../core/state.js';
import { elements } from './elements.js';
import { getShortName, showToast } from '../core/utils.js';
import { processImage } from '../core/scanner.js';

import { resetZoom } from './zoom.js';

export async function showPhoto(index) {
    state.currentIndex = index;
    resetZoom();
    
    const file = state.rawFiles[index];
    const key = getShortName(file);
    
    // Medium-res pre-render if not available
    if (!state.mediumPreviews[key]) {
        try {
            const mediumBlob = await processImage(file, 1600, 0.7);
            state.mediumPreviews[key] = URL.createObjectURL(mediumBlob);
        } catch (e) {
            state.mediumPreviews[key] = URL.createObjectURL(file);
        }
    }
    
    const previewUrl = state.mediumPreviews[key];
    
    elements.viewImg.src = previewUrl;
    elements.fileInfo.innerText = key;
    elements.stepTitle.innerText = `Culling (${index + 1}/${state.rawFiles.length})`;
    
    elements.viewImg.onload = () => {
        generateHistogram(elements.viewImg);
    };

    if (state.isCompareMode && index > 0) {
        const prevFile = state.rawFiles[index - 1];
        const prevKey = getShortName(prevFile);
        const prevUrl = state.mediumPreviews[prevKey] || state.previews[prevKey] || URL.createObjectURL(prevFile);
        elements.compareImg.src = prevUrl;
    }

    updateRatingUI();
    loadExif(file);
}

export function setRating(val) {
    const file = state.rawFiles[state.currentIndex];
    const key = getShortName(file);
    
    if (state.ratings[key] === val) val = 0;
    state.ratings[key] = val;
    
    updateRatingUI();
    state.savePersistence();
    
    if (state.autoAdvance && val !== 0 && state.currentIndex < state.rawFiles.length - 1) {
        setTimeout(() => window.app.navigatePhoto(1), 200);
    }
}

export function updateRatingUI() {
    const file = state.rawFiles[state.currentIndex];
    const key = getShortName(file);
    const r = state.ratings[key] || 0;
    
    elements.pillContainer.querySelectorAll('.pill').forEach(p => {
        let val;
        if (p.classList.contains('pill--reject')) val = -1;
        else val = parseInt(p.innerText);
        p.classList.toggle('active', r === val);
    });
}

function loadExif(file) {
    elements.exifInfo.innerText = "Scanning...";
    // Re-use logic from app.js but simplified
    window.EXIF.getData(file, function() {
        const model = window.EXIF.getTag(this, "Model") || "";
        const iso = window.EXIF.getTag(this, "ISOSpeedRatings");
        const f = window.EXIF.getTag(this, "FNumber");
        const s = window.EXIF.getTag(this, "ExposureTime");
        
        if (iso) {
            const shutter = s < 1 ? `1/${Math.round(1/s)}` : `${s}`;
            elements.exifInfo.innerText = `${model} • ISO ${iso} • f/${f} • ${shutter}s`;
        } else {
            elements.exifInfo.innerText = "Metadata unavailable";
        }
    });
}

function generateHistogram(imgEl) {
    if (!elements.histogramCanvas || !imgEl.naturalWidth) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 100;
    canvas.height = 100;
    ctx.drawImage(imgEl, 0, 0, 100, 100);

    const data = ctx.getImageData(0, 0, 100, 100).data;
    const hist = new Int32Array(256);
    for (let i = 0; i < data.length; i += 4) {
        const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        hist[gray]++;
    }

    const destCtx = elements.histogramCanvas.getContext('2d');
    const w = elements.histogramCanvas.width;
    const h = elements.histogramCanvas.height;
    destCtx.clearRect(0, 0, w, h);

    const maxVal = Math.max(...hist);
    destCtx.beginPath();
    destCtx.moveTo(0, h);
    for (let i = 0; i < 256; i++) {
        const x = (i / 255) * w;
        const y = h - (hist[i] / maxVal) * h;
        destCtx.lineTo(x, y);
    }
    destCtx.lineTo(w, h);
    destCtx.closePath();
    destCtx.fillStyle = 'hsla(35, 100%, 55%, 0.5)';
    destCtx.fill();
    destCtx.strokeStyle = 'var(--accent)';
    destCtx.stroke();
}
