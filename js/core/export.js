/**
 * PhotoCull Pro - Export Module
 * Full port from app.js — all export logic lives here.
 */
import { state } from './state.js';
import { getShortName } from './utils.js';
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
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    if (view.getUint16(0) !== 0xFFD8) return blob;

    const colorMap = { 'red': 1, 'yellow': 2, 'green': 3, 'blue': 4 };
    const urgency = colorMap[color] || 0;
    const esc = (str) => str.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

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

    const xmpHeader = 'http://ns.adobe.com/xap/1.0/\0';
    const xmpBlob = new TextEncoder().encode(xmpHeader + xmp);
    const markerLength = xmpBlob.length + 2;

    const newBuffer = new Uint8Array(buffer.byteLength + markerLength + 2);
    newBuffer.set(new Uint8Array(buffer.slice(0, 2)), 0); // FF D8

    newBuffer[2] = 0xFF;
    newBuffer[3] = 0xE1;
    newBuffer[4] = (markerLength >> 8) & 0xFF;
    newBuffer[5] = markerLength & 0xFF;
    newBuffer.set(xmpBlob, 6);
    newBuffer.set(new Uint8Array(buffer.slice(2)), markerLength + 4);

    return new Blob([newBuffer], { type: 'image/jpeg' });
}

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
        
        // Final safety check for the folder/project name itself
        const folderParts = rawFolderName.split(/[/\\]/);
        folderName = folderParts[folderParts.length - 1] || 'PhotoCull_Selection';

        // Fallback to ZIP if folder export is not supported
        if (method === 'folder' && !('showDirectoryPicker' in window)) {
            method = 'zip';
            if (elements.exportMethod) elements.exportMethod.value = 'zip';
            showToast('📦 Folder export not supported — switched to ZIP.', 'error');
            checkMethodSupport();
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

    // ── Progress bar ───────────────────────────────────────────────────────
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
            throw new Error('Photo data not loaded. Please re-import your photos.');
        }

        const items = Array.from(state.selectedForExport);
        const embedMetadata = elements.embedMetadata ? elements.embedMetadata.checked : true;
        const includeSidecar = elements.includeSidecar ? elements.includeSidecar.checked : true;
        state.globalByline = elements.globalByline ? elements.globalByline.value : '';
        persist();

        // ── Pre-create folder handle BEFORE the processing loop ────────────
        let exportFolderHandle = null;
        if (method === 'folder') {
            if (!('showDirectoryPicker' in window)) {
                throw new Error('Folder export requires Chrome or Edge on Desktop/Android.');
            }
            if (!state.directoryHandle) {
                setProgress(0, selectedCount, 'Choosing destination folder…');
                state.directoryHandle = await window.showDirectoryPicker();
                checkMethodSupport();
            }
            setProgress(0, selectedCount, `Creating folder "${folderName}"…`);
            exportFolderHandle = await state.directoryHandle.getDirectoryHandle(folderName, { create: true });
        }

        // ── Build sidecar manifest ─────────────────────────────────────────
        let captionContent = `PHOTO CULL PRO - EXPORT MANIFEST\n`;
        captionContent += `Project: ${folderName}\n`;
        captionContent += `Byline: ${state.globalByline}\n`;
        captionContent += `Date: ${new Date().toLocaleString()}\n`;
        captionContent += `------------------------------------------\n\n`;
        items.forEach((name, i) => {
            const renamed = generateExportName(name, i, selectedCount);
            const cap = state.captions[name];
            if (cap || state.globalByline) {
                captionContent += `File: ${renamed}\nOriginal: ${name}\nCaption: ${cap || '(No caption)'}\nByline: ${state.globalByline}\n\n`;
            }
        });

        // ── Parallel batch processing ──────────────────────────────────────
        const BATCH_SIZE = 6; // Increased for better throughput
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

                    if (embedMetadata) {
                        try {
                            processedBlob = await injectMetadata(processedBlob, rating, color, caption, state.globalByline);
                        } catch (metaErr) {
                            console.error('Metadata injection failed, skipping metadata:', metaErr);
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
                    console.error('Failed to process photo:', name, errInner);
                    showToast(`Skipped: ${name}`, 'error');
                }
            }));

            doneCount += batch.length;
            setProgress(doneCount, selectedCount, `Rendered ${doneCount} / ${selectedCount}`);
            await new Promise(r => setTimeout(r, 0)); // Yield to UI
        }

        // ── Sidecar file ──────────────────────────────────────────────────
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

        // ── Finalize per method ────────────────────────────────────────────
        if (method === 'folder') {
            setProgress(selectedCount, selectedCount, 'Done!');
            showToast(`✅ ${selectedCount} photos saved to "${folderName}"`, 'success');
            setTimeout(() => { exportProgressBar.style.display = 'none'; }, 2000);
            resetBtn();
            if (window.app && window.app.switchView) window.app.switchView('EXPLORER');

        } else if (method === 'share') {
            const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
            if (!navigator.share) {
                if (!isSecure) throw new Error('Sharing requires HTTPS. Please use ZIP method.');
                throw new Error('Your browser does not support direct sharing. Please use ZIP method.');
            }
            if (selectedCount > 25) {
                showToast('Note: Sharing >25 files at once often fails on iOS/Android. ZIP is recommended for large batches.', 'warning');
            }
            if (filesToShare.length === 0) throw new Error('Render Failed: No photos were processed.');

            setProgress(selectedCount, selectedCount, 'Ready to share!');

            // Two-step: render first, then require a fresh tap for share sheet
            if (btn) {
                btn.innerText = 'OPEN SHARE SHEET 📲';
                btn.style.background = '#25D366';
                btn.style.boxShadow = '0 0 20px rgba(37, 211, 102, 0.4)';
                btn.disabled = false;
                btn.onclick = async (clickEvent) => {
                    if (clickEvent) clickEvent.preventDefault();
                    try {
                        btn.innerText = 'Launching...';
                        btn.disabled = true;
                        const shareData = {
                            files: filesToShare,
                            title: 'PhotoCull Selection',
                            text: `Shared ${filesToShare.length} photos from PhotoCull Pro.`
                        };
                        if (navigator.canShare && !navigator.canShare(shareData)) {
                            throw new Error('Device limit: Batch too large to share directly. Try fewer photos or use ZIP.');
                        }
                        await navigator.share(shareData);
                        showToast('Share sheet opened!', 'success');
                        exportProgressBar.style.display = 'none';
                        if (window.app && window.app.switchView) window.app.switchView('EXPLORER');
                    } catch (shareErr) {
                        console.error('Share API Error:', shareErr);
                        showToast(shareErr.message || 'Share failed or cancelled.', 'error');
                        btn.innerText = 'RETRY SHARE 📲';
                        btn.disabled = false;
                    }
                };
            }
            return; // Exit — share requires a second tap

        } else {
            // ZIP method
            if (typeof JSZip === 'undefined') throw new Error('ZIP library not loaded. Please wait or refresh.');
            setProgress(selectedCount, selectedCount, 'Generating ZIP…');
            if (btn) btn.innerText = 'Compressing ZIP…';

            const content = await zip.generateAsync({
                type: 'blob',
                compression: 'STORE' // Changed to STORE for instant ZIP creation (JPGs are already compressed)
            });

            // saveAs from FileSaver.js
            saveAs(content, `${folderName}.zip`);

            setProgress(selectedCount, selectedCount, 'Done!');
            setTimeout(() => { exportProgressBar.style.display = 'none'; }, 2000);
            resetBtn();
            if (window.app && window.app.switchView) window.app.switchView('EXPLORER');
        }

    } catch (err) {
        console.error('Export error:', err);
        showToast('Export Issue: ' + err.message, 'error');
        resetBtn();
        if (exportProgressBar) exportProgressBar.style.display = 'none';
    }
}
