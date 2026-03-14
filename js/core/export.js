/**
 * PhotoCull Pro - Export Module
 * Full port from app.js — all export logic lives here.
 */
import { state } from './state.js';
import { getFileKey, getShortName, getFreshFile, yieldToMain } from './utils.js';
import { processImage } from './scanner.js';
import { elements } from '../ui/elements.js';

// ── Utility: showToast (re-imported indirectly via window to stay decoupled) ──
function showToast(message, type = 'success') {
    if (window._showToast) return window._showToast(message, type);
    // Fallback inline
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
    setTimeout(() => {
        toast.classList.add('hide');
        toast.addEventListener('animationend', () => toast.remove());
    }, 2500);
}

// ── savePersistence bridge ─────────────────────────────────────────────────
function persist() {
    if (state.savePersistence) state.savePersistence();
}

// ── Generate export filename based on pattern ──────────────────────────────
export function generateExportName(originalName, index, totalSelected) {
    // Extract basename first to ensure we never return a path
    const parts = (originalName || '').split(/[/\\]/);
    const basename = parts[parts.length - 1];

    if (!elements.renamePattern || !elements.folderNameInput) return basename;
    
    const pattern = elements.renamePattern.value;
    // Clean project name too - user might have manually typed a path or it could be a leftover
    const rawProject = elements.folderNameInput.value || 'Selection';
    const projectParts = rawProject.split(/[/\\]/);
    const project = projectParts[projectParts.length - 1] || 'Selection';

    if (pattern === 'original') return basename;

    const dotIndex = basename.lastIndexOf('.');
    const nameOnly = dotIndex !== -1 ? basename.substring(0, dotIndex) : basename;
    const ext = dotIndex !== -1 ? basename.substring(dotIndex) : '.jpg';

    if (pattern === 'project-seq') {
        const seq = (index + 1).toString().padStart(3, '0');
        return `${project}_${seq}${ext}`;
    }
    if (pattern === 'project-num') {
        const match = nameOnly.match(/(\d+)$/);
        const originalNum = match ? match[1] : (index + 1).toString();
        return `${project}_${originalNum}${ext}`;
    }
    return basename;
}

// ── Update rename preview in export form ──────────────────────────────────
export function updateRenamePreview() {
    if (!elements.renamePattern || !elements.folderNameInput || !elements.renamePreview) return;
    const pattern = elements.renamePattern.value;
    const rawProject = elements.folderNameInput.value || 'Selection';
    const projectParts = rawProject.split(/[/\\]/).filter(Boolean);
    const project = projectParts[projectParts.length - 1] || 'Selection';
    
    let example = 'DSC_1234.jpg';
    if (pattern === 'project-seq') example = `${project}_001.jpg`;
    else if (pattern === 'project-num') example = `${project}_1234.jpg`;
    elements.renamePreview.innerText = `Sample: ${example}`;
}

// ── Check browser support for folder export and update UI hints ───────────
export function checkMethodSupport() {
    if (!elements.exportMethod) return;
    const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    const isSupported = 'showDirectoryPicker' in window;
    const currentMethod = elements.exportMethod.value;

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
            elements.selectedPath.textContent = '⚠️ Folder export not supported in this browser — use ZIP or Share';
            elements.selectedPath.style.color = 'var(--danger)';
        } else {
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

// ── Pick export destination folder (File System Access API) ───────────────
export async function pickExportFolder() {
    try {
        state.directoryHandle = await window.showDirectoryPicker();
        if (elements.selectedPath) {
            elements.selectedPath.innerText = 'Target: ' + state.directoryHandle.name;
        }
        checkMethodSupport();
    } catch (e) {
        console.log('Folder selection cancelled.', e);
    }
}

// ── Metadata Injector (Adobe Bridge/Lightroom compatibility) ──────────────
export async function injectMetadata(blob, rating, color, caption, byline) {
    if (!blob || blob.size < 4) return blob; 

    // 1. Binary-safe Check SOI
    const prefixBuffer = await blob.slice(0, 2).arrayBuffer();
    const prefixView = new DataView(prefixBuffer);
    if (prefixView.getUint16(0) !== 0xFFD8) return blob;

    // 2. Prepare XMP Payload
    const colorMap = { 'red': 1, 'yellow': 2, 'green': 3, 'blue': 4 };
    const urgency = colorMap[color] || 0;
    const esc = (s) => (s || '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c140">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmp:Rating="${rating > 0 ? rating : 0}" photoshop:Urgency="${urgency}">
   <dc:creator><rdf:Seq><rdf:li>${esc(byline)}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(caption)}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta><?xpacket end="w"?>`;

    // 3. Binary Assembly (Avoid TextEncoder with null bytes)
    const xmpHeader = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0');
    const xmpBody = new TextEncoder().encode(xmp);
    const totalPayload = new Uint8Array(xmpHeader.length + xmpBody.length);
    totalPayload.set(xmpHeader);
    totalPayload.set(xmpBody, xmpHeader.length);

    const markerLength = totalPayload.length + 2;
    if (markerLength > 65535) return blob;

    const segmentHeader = new Uint8Array(4);
    segmentHeader[0] = 0xFF;
    segmentHeader[1] = 0xE1;
    segmentHeader[2] = (markerLength >> 8) & 0xFF;
    segmentHeader[3] = markerLength & 0xFF;

    // Assemble: [SOI] + [APP1 Segment] + [Rest of Body]
    return new Blob([blob.slice(0, 2), segmentHeader, totalPayload, blob.slice(2)], { type: 'image/jpeg' });
}

// ── Main Export Executor ───────────────────────────────────────────────────
// ── Main Export Executor ───────────────────────────────────────────────────
export async function executeExport(btn) {
    let method, resSize, quality, folderName, originalText;

    try {
        method = elements.exportMethod ? elements.exportMethod.value : 'zip';
        resSize = elements.resChoice ? elements.resChoice.value : 'original';
        quality = elements.qualityNum ? (elements.qualityNum.value / 100) : 0.85;
        const rawFolderName = (elements.folderNameInput && elements.folderNameInput.value)
            ? elements.folderNameInput.value
            : 'PhotoCull_Selection';
        
        folderName = rawFolderName.split(/[/\\\\]/).pop() || 'PhotoCull_Selection';
        const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';

        if (method === 'folder' && !('showDirectoryPicker' in window)) {
            method = 'zip';
            if (elements.exportMethod) elements.exportMethod.value = 'zip';
            showToast('📦 Folder export not supported — switched to ZIP.', 'error');
            checkMethodSupport();
        }

        if (method === 'share' && (!isSecure || !navigator.share)) {
            return showToast(isSecure
                ? 'Share not supported in this browser. Please use ZIP.'
                : 'Sharing requires HTTPS. Please use ZIP.', 'error');
        }

        if (method === 'zip' && (typeof JSZip === 'undefined' || typeof saveAs === 'undefined')) {
            return showToast('ZIP tools are not ready. Please refresh the page.', 'error');
        }

        if (state.selectedForExport.size === 0) {
            return showToast('Please select photos first.', 'error');
        }

        originalText = btn ? btn.innerText : 'Generate & Save';
        if (btn) {
            btn.innerText = 'Processing...';
            btn.disabled = true;
        }
    } catch (setupError) {
        return showToast('Setup Error: ' + setupError.message, 'error');
    }

    const selectedCount = state.selectedForExport.size;
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

    const resetBtn = () => {
        if (btn) {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.background = '';
            btn.style.boxShadow = '';
            btn.onclick = (e) => executeExport(e.currentTarget);
        }
    };

    try {
        if (!state.rawFiles || state.rawFiles.length === 0) {
            throw new Error('Photo data not loaded. Please re-import.');
        }

        // Optimization: Map for O(1) lookup
        const fileMap = new Map();
        state.rawFiles.forEach(f => fileMap.set(getFileKey(f), f));

        const items = Array.from(state.selectedForExport);
        const embedMetadata = elements.embedMetadata ? elements.embedMetadata.checked : true;
        const includeSidecar = elements.includeSidecar ? elements.includeSidecar.checked : true;
        state.globalByline = elements.globalByline ? elements.globalByline.value : '';
        persist();

        let exportFolderHandle = null;
        if (method === 'folder') {
            if (!state.directoryHandle) {
                state.directoryHandle = await window.showDirectoryPicker();
                checkMethodSupport();
            }
            exportFolderHandle = await state.directoryHandle.getDirectoryHandle(folderName, { create: true });
        }

        let captionContent = `PHOTO CULL PRO MANIFEST\nProject: ${folderName}\nDate: ${new Date().toLocaleString()}\n\n`;

        const BATCH_SIZE = 6;
        let zip = (method === 'zip') ? new JSZip() : null;
        const filesToShare = [];
        let doneCount = 0;

        for (let batchStart = 0; batchStart < items.length; batchStart += BATCH_SIZE) {
            const batch = items.slice(batchStart, batchStart + BATCH_SIZE);
            await Promise.all(batch.map(async (name, batchIdx) => {
                const globalIdx = batchStart + batchIdx;
                const file = fileMap.get(name);
                if (!file) return;

                const originalName = getShortName(file);
                const renamed = generateExportName(originalName, globalIdx, selectedCount);
                const rating = state.ratings[name] || 0;
                const color = state.colorLabels[name] || null;
                const caption = state.captions[name] || '';

                if (includeSidecar) {
                    captionContent += `File: ${renamed}\nCaption: ${caption || '-'}\nRating: ${rating}\n\n`;
                }

                try {
                    const freshFile = await getFreshFile(file);
                    let processedBlob = await processImage(freshFile, resSize, quality);
                    if (!processedBlob) throw new Error("Processing failed (empty result).");

                    if (embedMetadata) {
                        try {
                            processedBlob = await injectMetadata(processedBlob, rating, color, caption, state.globalByline);
                        } catch (mErr) { console.error('Meta error:', mErr); }
                    }

                    if (method === 'zip' && zip) {
                        zip.file(renamed, processedBlob);
                    } else if (method === 'folder' && exportFolderHandle) {
                        const h = await exportFolderHandle.getFileHandle(renamed, { create: true });
                        const w = await h.createWritable();
                        await w.write(processedBlob);
                        await w.close();
                    } else if (method === 'share') {
                        filesToShare.push(new File([processedBlob], renamed, { type: 'image/jpeg' }));
                    }
                } catch (errInner) {
                    console.error('File fail:', name, errInner);
                    showToast(`⚠️ Skipped: ${originalName} (${errInner.message})`, 'error');
                }
            }));
            doneCount += batch.length;
            setProgress(doneCount, items.length, `Rendered ${doneCount}/${items.length}`);
            await yieldToMain();
        }

        if (includeSidecar) {
            if (method === 'zip') zip.file('_manifest.txt', captionContent);
            else if (method === 'folder') {
                const h = await exportFolderHandle.getFileHandle('_manifest.txt', { create: true });
                const w = await h.createWritable();
                await w.write(captionContent);
                await w.close();
            }
        }

        if (method === 'folder') {
            showToast(`✅ Exported ${selectedCount} photos to folder.`, 'success');
        } else if (method === 'share') {
            if (btn) {
                btn.innerText = 'TAP TO SHARE 📲';
                btn.disabled = false;
                btn.onclick = async () => {
                    try {
                        if (navigator.canShare && !navigator.canShare({ files: filesToShare })) {
                            showToast('This batch is too large to share directly. Try fewer photos or ZIP.', 'error');
                            return;
                        }
                        await navigator.share({ files: filesToShare, title: folderName });
                        if (window.app && window.app.switchView) window.app.switchView('EXPLORER');
                    } catch (shareErr) {
                        console.error('Share Error:', shareErr);
                        showToast('Share cancelled or failed. Please try again or use ZIP.', 'error');
                    }
                };
            }
        } else {
            const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
            saveAs(content, `${folderName}.zip`);
            showToast(`✅ ZIP downloaded.`, 'success');
        }
        
        if (method !== 'share') {
             resetBtn();
             if (window.app && window.app.switchView) window.app.switchView('EXPLORER');
             setTimeout(() => { exportProgressBar.style.display = 'none'; }, 2000);
        }

    } catch (err) {
        console.error('Export Error:', err);
        showToast('Export Error: ' + err.message, 'error');
        resetBtn();
        if (exportProgressBar) exportProgressBar.style.display = 'none';
    }
}







