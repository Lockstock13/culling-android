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
    resChoice: document.getElementById('res-choice'),
    qualityNum: document.getElementById('quality-num'),
    methodHint: document.getElementById('method-hint'),
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

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (state.view === 'CULLING') {
            if (e.key === 'ArrowRight') navigatePhoto(1);
            if (e.key === 'ArrowLeft') navigatePhoto(-1);
            if (e.key >= '1' && e.key <= '5') setRating(parseInt(e.key));
            if (e.key === '0') setRating(0);
        }
    });
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
    const files = Array.from(e.target.files).filter(f => f.type === 'image/jpeg');
    if (files.length > 0) {
        state.rawFiles = files;

        // Show processing overlay
        showProcessing(true, `Menyiapkan ${files.length} foto...`);

        // Clear old previews
        Object.values(state.previews).forEach(url => URL.revokeObjectURL(url));
        state.previews = {};

        // Generate fast previews (1280px is enough for culling screen)
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const previewBlob = await processImage(file, 1280, 0.7); // Light & Fast
            state.previews[file.name] = URL.createObjectURL(previewBlob);

            if (i % 5 === 0) {
                showProcessing(true, `Rendering: ${i + 1}/${files.length}`);
            }
        }

        showProcessing(false);
        state.view = 'CULLING';
        state.currentIndex = 0;
        showPhoto(0);
        updateUI();
    }
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
    const previewUrl = state.previews[file.name];

    // Use the lightweight preview for culling to keep it fast
    elements.viewImg.src = previewUrl;
    elements.fileInfo.innerText = file.name;
    elements.stepTitle.innerText = `Kurasi (${index + 1}/${state.rawFiles.length})`;

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
        img.src = state.previews[file.name]; // Use the same lightweight preview for grid thumbnails

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

    if (method === 'folder' && !isSupported) {
        elements.methodHint.style.display = 'block';
        elements.methodHint.innerText = isSecure
            ? "⚠️ Browser HP ga support pilih folder (pake ZIP aja)."
            : "⚠️ Butuh HTTPS buat simpen langsung ke folder.";
    } else {
        elements.methodHint.style.display = 'none';
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

    try {
        if (method === 'folder' && 'showDirectoryPicker' in window) {
            const handle = await window.showDirectoryPicker();
            const newFolder = await handle.getDirectoryHandle(folderName, { create: true });

            for (let file of state.rawFiles) {
                if (state.selectedForExport.has(file.name)) {
                    const blob = await processImage(file, resSize, quality);
                    const fileHandle = await newFolder.getFileHandle(file.name, { create: true });
                    const writer = await fileHandle.createWritable();
                    await writer.write(blob);
                    await writer.close();
                }
            }
            alert("Selesai! Semua foto masuk ke folder: " + folderName);
        } else if (method === 'share') {
            if (!navigator.share) {
                throw new Error("Browser/HP lu ga support fitur share langsung. Pake metode ZIP aja.");
            }

            const filesToShare = [];
            for (let file of state.rawFiles) {
                if (state.selectedForExport.has(file.name)) {
                    const blob = await processImage(file, resSize, quality);
                    const sharedFile = new File([blob], file.name, { type: 'image/jpeg' });
                    filesToShare.push(sharedFile);
                }
            }

            if (filesToShare.length > 30) {
                const confirmShare = confirm("Lu mau kirim " + filesToShare.length + " foto sekaligus? WhatsApp mungkin bakal nge-lag. Lanjut?");
                if (!confirmShare) {
                    btn.innerText = originalText;
                    btn.disabled = false;
                    return;
                }
            }

            if (navigator.canShare && navigator.canShare({ files: filesToShare })) {
                await navigator.share({
                    files: filesToShare,
                    title: 'Hasil Seleksi - PhotoCull Pro',
                    text: 'Cek hasil kurasi foto gua, bro!'
                });
            } else {
                throw new Error("File kegedean atau format ga dukung buat share langsung. Coba kirim dikit-dikit atau pake ZIP.");
            }
        } else {
            const zip = new JSZip();
            for (let file of state.rawFiles) {
                if (state.selectedForExport.has(file.name)) {
                    const blob = await processImage(file, resSize, quality);
                    zip.file(file.name, blob);
                }
            }
            const content = await zip.generateAsync({ type: "blob" });
            saveAs(content, `${folderName}.zip`);
        }
        closeExport();
    } catch (err) {
        alert("Export Gagal: " + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function processImage(file, resSize, quality) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let w = bitmap.width;
    let h = bitmap.height;

    if (resSize !== 'original') {
        const max = parseInt(resSize);
        if (w > h && w > max) { h = (max / w) * h; w = max; }
        else if (h > max) { w = (max / h) * w; h = max; }
    }

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
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
