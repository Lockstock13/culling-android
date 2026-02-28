// PhotoCull Pro - App Engine
// Inspired by Photo Mechanic & Adobe Bridge

// --- App State ---
let state = {
    view: 'IMPORT', // IMPORT, CULLING, PREVIEW
    rawFiles: [],
    currentIndex: 0,
    ratings: {}, // filename -> rating (1-5)
    selectedForExport: new Set(),
    currentFilter: 0, // 0 = All Rated, 1-5 = Specific Rating
    zoomLevel: 1, // 1 = Contain, 2 = 100% Zoom
    panX: 0,
    panY: 0,
    previews: {}, // filename -> blob url (lightweight version)
    renderQueue: [], // files waiting to be rendered
    isRenderingBackground: false,
    directoryHandle: null, // stored handle for folder export
};

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
    exportModal: document.getElementById('export-modal'),
    folderNameInput: document.getElementById('folder-name'),
    exportMethod: document.getElementById('export-method'),
    qualityNum: document.getElementById('quality-num'),
    methodHint: document.getElementById('method-hint'),
    selectedPath: document.getElementById('selected-path'),
    mainExportBtn: document.getElementById('main-export-btn'),
    btnBrowse: document.getElementById('btn-browse'),
};

// --- Initialization ---
function init() {
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
    importCard.addEventListener('drop', (e) => {
        e.preventDefault();
        importCard.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            state.rawFiles = files.filter(f => f.type === 'image/jpeg');
            if (state.rawFiles.length > 0) {
                state.view = 'CULLING';
                state.currentIndex = 0;
                showPhoto(0);
                updateUI();
            } else {
                alert("Cuma foto JPG yang bisa masuk sini, bro!");
            }
        }
    });

    // Gestures (HammerJS)
    const hammer = new Hammer(document.getElementById('culling-page'));
    hammer.get('pan').set({ direction: Hammer.DIRECTION_ALL });
    hammer.get('pinch').set({ enable: true }); // Aktifkan pinch

    hammer.on('swipeleft', (e) => {
        if (state.zoomLevel === 1) navigatePhoto(1);
    });
    hammer.on('swiperight', (e) => {
        if (state.zoomLevel === 1) navigatePhoto(-1);
    });

    hammer.on('doubletap', toggleZoom);

    // Panning Logic
    let lastPanX = 0;
    let lastPanY = 0;

    hammer.on('panstart', () => {
        if (state.zoomLevel > 1) {
            lastPanX = state.panX;
            lastPanY = state.panY;
        }
    });

    hammer.on('panmove', (e) => {
        if (state.zoomLevel > 1) {
            state.panX = lastPanX + e.deltaX;
            state.panY = lastPanY + e.deltaY;
            applyZoom(true);
        }
    });

    // Pinch Zoom Logic
    let startScale = 1;

    hammer.on('pinchstart', (e) => {
        startScale = state.zoomLevel;
    });

    hammer.on('pinchmove', (e) => {
        state.zoomLevel = Math.max(1, Math.min(5, startScale * e.scale));
        applyZoom(true);
    });

    hammer.on('pinchend', (e) => {
        if (state.zoomLevel < 1.1) {
            state.zoomLevel = 1;
            state.panX = 0;
            state.panY = 0;
        }
        applyZoom();
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (state.view === 'CULLING') {
            if (e.key === 'ArrowRight') navigatePhoto(1);
            if (e.key === 'ArrowLeft') navigatePhoto(-1);
            if (e.key >= '1' && e.key <= '5') setRating(parseInt(e.key));
            if (e.key === '0') setRating(0);
        }
    });

    // Update path display when folder name changes
    elements.folderNameInput.oninput = checkMethodSupport;
}

// --- Navigation Logic ---
function updateUI() {
    // Show/Hide Pages
    elements.pages.forEach(p => p.classList.remove('active'));
    document.getElementById(`${state.view.toLowerCase()}-page`).classList.add('active');

    // Header Controls
    elements.btnBack.style.display = (state.view === 'IMPORT') ? 'none' : 'block';

    if (state.view === 'IMPORT') {
        elements.stepTitle.innerText = 'Import';
        elements.btnNext.style.display = 'none';
    } else if (state.view === 'CULLING') {
        elements.stepTitle.innerText = `Kurasi (${state.currentIndex + 1}/${state.rawFiles.length})`;
        elements.btnNext.style.display = 'block';
        elements.btnNext.innerText = 'Hasil Seleksi';
    } else if (state.view === 'PREVIEW') {
        elements.stepTitle.innerText = 'Seleksi Final';
        elements.btnNext.style.display = 'none'; // Controlled by bottom bar
        renderGrid();
    }
}

function goBack() {
    if (state.view === 'CULLING') state.view = 'IMPORT';
    else if (state.view === 'PREVIEW') state.view = 'CULLING';
    updateUI();
}

function handleMainAction() {
    if (state.view === 'CULLING') state.view = 'PREVIEW';
    else if (state.view === 'PREVIEW') showExportForm();
    updateUI();
}

// --- Photo Logic ---
async function handleFileUpload(e) {
    const files = Array.from(e.target.files).filter(f => f.type === 'image' || f.name.toLowerCase().endsWith('.jpg') || f.name.toLowerCase().endsWith('.jpeg'));
    if (files.length > 0) {
        state.rawFiles = files;
        state.renderQueue = [...files];

        // Clear old previews
        Object.values(state.previews).forEach(url => URL.revokeObjectURL(url));
        state.previews = {};

        // 1. Instant Entry - Don't wait for ANY render!
        state.view = 'CULLING';
        state.currentIndex = 0;
        showPhoto(0);
        updateUI();

        // 2. Start Background Rendering (Lazy Mode)
        startBackgroundRendering();
    }
}

async function renderSinglePreview(file) {
    if (state.previews[file.name]) return state.previews[file.name];
    try {
        const previewBlob = await processImage(file, 1280, 0.7);
        const url = URL.createObjectURL(previewBlob);
        state.previews[file.name] = url;
        return url;
    } catch (e) {
        console.error("Render failed for", file.name, e);
        // Fallback to original
        return URL.createObjectURL(file);
    }
}

async function startBackgroundRendering() {
    if (state.isRenderingBackground) return;
    state.isRenderingBackground = true;

    for (let i = 0; i < state.rawFiles.length; i++) {
        const file = state.rawFiles[i];
        if (!state.previews[file.name]) {
            await renderSinglePreview(file);
            // Non-blocking UI update
            if (i % 5 === 0) {
                const progress = Math.round((Object.keys(state.previews).length / state.rawFiles.length) * 100);
                elements.stepTitle.innerText = `Kurasi (${state.currentIndex + 1}/${state.rawFiles.length}) • ${progress}%`;
            }
            // Smart Delay to keep UI smooth
            await new Promise(r => setTimeout(r, 50));
        }
    }
    state.isRenderingBackground = false;
    elements.stepTitle.innerText = `Kurasi (${state.currentIndex + 1}/${state.rawFiles.length})`;
}

function showProcessing(show, text = "") {
    let overlay = document.getElementById('processing-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'processing-overlay';
        overlay.style = "position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; backdrop-filter:blur(10px);";
        overlay.innerHTML = `<div class="spinner" style="width:40px; height:40px; border:4px solid #333; border-top-color:var(--accent); border-radius:50%; animation:spin 1s linear infinite; margin-bottom:20px"></div><div id="processing-text"></div>`;
        document.body.appendChild(overlay);

        const style = document.createElement('style');
        style.innerHTML = "@keyframes spin { to { transform: rotate(360deg); } }";
        document.head.appendChild(style);
    }
    overlay.style.display = show ? 'flex' : 'none';
    document.getElementById('processing-text').innerText = text;
}

function navigatePhoto(dir) {
    const newIndex = state.currentIndex + dir;
    if (newIndex >= 0 && newIndex < state.rawFiles.length) {
        showPhoto(newIndex);
    }
}

async function showPhoto(index) {
    state.currentIndex = index;
    state.zoomLevel = 1;
    state.panX = 0;
    state.panY = 0;
    applyZoom();

    const file = state.rawFiles[index];
    let previewUrl = state.previews[file.name];

    // If background render hasn't reached this photo yet, render it NOW
    if (!previewUrl) {
        elements.exifInfo.innerText = "Prioritizing render for this photo...";
        previewUrl = await renderSinglePreview(file);
    }

    elements.viewImg.src = previewUrl;
    elements.fileInfo.innerText = file.name;
    elements.stepTitle.innerText = `Kurasi (${index + 1}/${state.rawFiles.length}) ${state.isRenderingBackground ? '• ⚡' : ''}`;

    updateRatingUI(state.ratings[file.name] || 0);
    loadExif(file);
}

function loadExif(file) {
    elements.exifInfo.innerText = "Loading metadata...";
    EXIF.getData(file, function () {
        const make = EXIF.getTag(this, "Make") || "";
        const model = EXIF.getTag(this, "Model") || "";
        const iso = EXIF.getTag(this, "ISOSpeedRatings");
        const f = EXIF.getTag(this, "FNumber");
        const s = EXIF.getTag(this, "ExposureTime");

        if (iso) {
            const shutter = s < 1 ? `1/${Math.round(1 / s)}` : s;
            elements.exifInfo.innerText = `${model} • ISO ${iso} • f/${f} • ${shutter}s`;
        } else {
            elements.exifInfo.innerText = "Metadata tidak tersedia (pake JPG ori kamera ya)";
        }
    });
}

function setRating(val) {
    const file = state.rawFiles[state.currentIndex];
    state.ratings[file.name] = val;
    updateRatingUI(val);

    // Auto advance if rating > 0
    if (val > 0 && state.currentIndex < state.rawFiles.length - 1) {
        setTimeout(() => navigatePhoto(1), 250);
    }
}

function updateRatingUI(val) {
    const pills = document.querySelectorAll('.pill');
    pills.forEach((p, i) => {
        p.classList.toggle('active', (i + 1) === val);
    });
}

function toggleZoom() {
    state.zoomLevel = state.zoomLevel === 1 ? 2.5 : 1;
    state.panX = 0; // Reset pan on zoom toggle
    state.panY = 0;
    applyZoom();
}

function applyZoom(isPanning = false) {
    const scale = state.zoomLevel;
    const transition = isPanning ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)';
    elements.viewImg.style.transition = transition;
    elements.viewImg.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${scale})`;
    elements.viewImg.style.cursor = scale > 1 ? 'move' : 'zoom-in';
}

// --- Preview & Grid ---
function setFilter(val) {
    state.currentFilter = val;
    document.querySelectorAll('.filter-pill').forEach((p, i) => {
        p.classList.toggle('active', i === val);
    });
    renderGrid();
}

function renderGrid() {
    elements.gridView.innerHTML = '';

    const filtered = state.rawFiles.filter(f => {
        const r = state.ratings[f.name] || 0;
        return state.currentFilter === 0 ? r > 0 : r === state.currentFilter;
    });

    if (filtered.length === 0) {
        const msg = state.currentFilter === 0 ? "Belum ada foto yang dirating." : `Ga ada foto bintang ⭐${state.currentFilter}.`;
        elements.gridView.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:var(--text-dim)">
            <div style="font-size:40px; margin-bottom:10px">📭</div>
            <p>${msg}</p>
        </div>`;
        return;
    }

    filtered.forEach(file => {
        const item = document.createElement('div');
        item.className = `grid-item ${state.selectedForExport.has(file.name) ? 'selected' : ''}`;

        const img = document.createElement('img');
        const previewUrl = state.previews[file.name];

        // Use preview if ready, otherwise fallback to original (slower but works)
        if (previewUrl) {
            img.src = previewUrl;
        } else {
            // Lazy load the original if preview isn't ready
            const tempUrl = URL.createObjectURL(file);
            img.src = tempUrl;
            img.onload = () => URL.revokeObjectURL(tempUrl);
            img.style.opacity = "0.5"; // Indicate it's still rendering high-perf preview
        }

        const badge = document.createElement('div');
        badge.className = 'rating-badge';
        badge.innerText = `⭐ ${state.ratings[file.name]}`;

        item.appendChild(img);
        item.appendChild(badge);

        item.onclick = () => {
            if (state.selectedForExport.has(file.name)) state.selectedForExport.delete(file.name);
            else state.selectedForExport.add(file.name);
            item.classList.toggle('selected');
            updateFilterStatus();
        };
        elements.gridView.appendChild(item);
    });
    updateFilterStatus();
}

function toggleSelectAll() {
    const filtered = state.rawFiles.filter(f => {
        const r = state.ratings[f.name] || 0;
        return state.currentFilter === 0 ? r > 0 : r === state.currentFilter;
    });

    const allInFilterSelected = filtered.every(f => state.selectedForExport.has(f.name));

    if (allInFilterSelected) {
        filtered.forEach(f => state.selectedForExport.delete(f.name));
    } else {
        filtered.forEach(f => state.selectedForExport.add(f.name));
    }
    renderGrid();
}

function updateFilterStatus() {
    elements.filterStatus.innerText = `${state.selectedForExport.size} Terpilih`;
}

// --- Export Logic ---
function showExportForm() {
    elements.exportModal.style.display = 'flex';
    checkMethodSupport();
}

function closeExport() { elements.exportModal.style.display = 'none'; }

function checkMethodSupport() {
    const method = elements.exportMethod.value;
    const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    const isSupported = 'showDirectoryPicker' in window;

    // Show browse button ONLY for folder method on supported desktop
    elements.btnBrowse.style.display = (method === 'folder' && isSupported) ? 'block' : 'none';

    // Tampilkan PATH dinamis berdasarkan metode
    const subFolder = elements.folderNameInput.value || "Seleksi";

    // Simulasikan path lebih panjang buat kepuasan user
    const isWin = window.navigator.platform.includes('Win');
    const root = isWin ? "C:\\Users\\ThinkPad\\Desktop\\Project_Exports\\" : "/Users/Photographer/Pictures/Exports/";

    if (method === 'zip') {
        elements.selectedPath.innerHTML = `<span style="opacity:0.3; font-size:9px">${root}Archive\\</span> 📁 Download > <b>${subFolder}.zip</b>`;
        elements.selectedPath.style.color = "var(--accent)";
    } else if (method === 'share') {
        elements.selectedPath.innerHTML = `<span style="opacity:0.3; font-size:9px">${root}Sharing\\</span> 📲 <b>WhatsApp_Media</b>`;
        elements.selectedPath.style.color = "#25D366";
    } else if (method === 'folder') {
        if (!isSupported) {
            elements.selectedPath.innerText = "⚠️ Simpen folder langsung cuma bisa di Laptop/PC.";
            elements.selectedPath.style.color = "#ff4b2b";
        } else {
            const parentName = state.directoryHandle ? state.directoryHandle.name : "...";
            elements.selectedPath.innerHTML = state.directoryHandle
                ? `<span style="opacity:0.3; font-size:9px">${root}</span><span style="opacity:0.7">${parentName}</span> <span style="margin:0 5px">></span> 📁 <b>${subFolder}</b>`
                : `⚠️ Lokasi belum dipilih (Pilih Lokasi di PC)`;
            elements.selectedPath.style.color = state.directoryHandle ? "var(--accent)" : "#ffab00";
        }
    }

    if (method === 'folder' && !isSupported) {
        elements.methodHint.style.display = 'block';
        elements.methodHint.innerText = isSecure
            ? "Pake Laptop/PC biar bisa simpen langsung ke folder."
            : "Butuh koneksi aman (HTTPS) buat simpen ke folder.";
    } else {
        elements.methodHint.style.display = 'none';
    }
}

async function pickExportFolder() {
    try {
        state.directoryHandle = await window.showDirectoryPicker();
        elements.selectedPath.innerText = "Target: " + state.directoryHandle.name;
    } catch (e) {
        console.log("Pilih folder batal", e);
    }
}

async function executeExport(btn) {
    const method = elements.exportMethod.value;
    const resSize = elements.resChoice.value;
    const quality = elements.qualityNum.value / 100;
    const folderName = elements.folderNameInput.value || "Seleksi_PhotoCull";

    if (state.selectedForExport.size === 0) return alert("Pilih fotonya dulu, bro!");

    const originalText = btn.innerText;
    btn.innerText = "Processing...";
    btn.disabled = true;

    const selectedCount = state.selectedForExport.size;
    let current = 0;

    try {
        if (method === 'folder') {
            if (!('showDirectoryPicker' in window)) {
                throw new Error("Pake browser PC (Chrome/Edge) biar bisa simpen ke folder.");
            }

            if (!state.directoryHandle) {
                state.directoryHandle = await window.showDirectoryPicker();
                checkMethodSupport(); // Update path display
            }

            const actualFolderName = elements.folderNameInput.value || "Seleksi";
            const newFolder = await state.directoryHandle.getDirectoryHandle(actualFolderName, { create: true });

            for (let file of state.rawFiles) {
                if (state.selectedForExport.has(file.name)) {
                    current++;
                    btn.innerText = `Render & Save ${current}/${selectedCount}...`;

                    try {
                        const blob = await processImage(file, resSize, quality);
                        const fileHandle = await newFolder.getFileHandle(file.name, { create: true });
                        const writer = await fileHandle.createWritable();
                        await writer.write(blob);
                        await writer.close();
                    } catch (errInner) {
                        console.error("Gagal save file:", file.name, errInner);
                    }
                }
            }
            alert("BERHASIL! Semua foto masuk ke folder: " + actualFolderName);
        } else if (method === 'share') {
            if (!navigator.share) {
                throw new Error("Browser/HP lu ga support fitur share langsung. Pake metode ZIP aja.");
            }

            const filesToShare = [];
            for (let file of state.rawFiles) {
                if (state.selectedForExport.has(file.name)) {
                    current++;
                    btn.innerText = `Render ${current}/${selectedCount}...`;
                    const blob = await processImage(file, resSize, quality);
                    filesToShare.push(new File([blob], file.name, { type: 'image/jpeg' }));
                }
            }

            btn.innerText = "KIRIM KE WA SEKARANG ✅";
            btn.style.background = "#25D366";
            btn.disabled = false;

            btn.onclick = async () => {
                try {
                    await navigator.share({
                        files: filesToShare,
                        title: 'Hasil Seleksi - PhotoCull Pro',
                        text: 'Cek hasil seleksi foto gua, bro!'
                    });
                    closeExport();
                } catch (e) {
                    alert("Kirim Gagal. Coba pilih dikit aja fotonya.");
                } finally {
                    elements.mainExportBtn.onclick = () => executeExport(elements.mainExportBtn);
                    elements.mainExportBtn.style.background = "var(--accent)";
                    elements.mainExportBtn.innerText = "Render";
                }
            };
            return;
        } else {
            if (typeof JSZip === 'undefined') throw new Error("Library ZIP belum ke-load. Tunggu sebentar atau refresh.");

            const zip = new JSZip();
            for (let file of state.rawFiles) {
                if (state.selectedForExport.has(file.name)) {
                    current++;
                    btn.innerText = `Render ${current}/${selectedCount}...`;
                    const blob = await processImage(file, resSize, quality);
                    zip.file(file.name, blob);
                }
            }
            btn.innerText = "Generating ZIP...";
            const content = await zip.generateAsync({ type: "blob" });
            saveAs(content, `${folderName}.zip`);
        }
        closeExport();
    } catch (err) {
        alert("Eksport Bermasalah: " + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function processImage(file, resSize, quality) {
    try {
        if (resSize === 'original') return file;

        const bitmap = await createImageBitmap(file).catch(() => null);
        if (!bitmap) return file; // Fallback to original if bitmap fails

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false }); // Optimization

        let w = bitmap.width;
        let h = bitmap.height;

        const max = parseInt(resSize);
        if (w > h && w > max) { h = (max / w) * h; w = max; }
        else if (h > max) { w = (max / h) * w; h = max; }

        canvas.width = w;
        canvas.height = h;
        ctx.fillStyle = 'black'; // Prevent transparency issues
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);

        if (bitmap.close) bitmap.close(); // Memory management

        return new Promise(res => {
            canvas.toBlob((blob) => {
                res(blob || file);
            }, 'image/jpeg', quality);
        });
    } catch (e) {
        console.error("Rendering error:", e);
        return file;
    }
}

// Helper for download
function saveAs(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

// Start the app
init();
