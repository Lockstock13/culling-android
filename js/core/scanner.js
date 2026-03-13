/**
 * PhotoCull Pro - Metadata & Thumbnail Engine
 */
import { getShortName, yieldToMain, getFreshFile } from './utils.js';
import { state } from './state.js';

/**
 * Partial File Metadata Scanner (Requirement #3)
 * Reads only the first 64KB to extract EXIF and XMP.
 */
export async function getExifMeta(file) {
    const freshFile = await getFreshFile(file);
    const partialFile = freshFile.slice(0, 65536);
    
    return new Promise((resolve) => {
        let isResolved = false;
        const timeout = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                resolve({ date: file.lastModified || Date.now(), rating: null });
            }
        }, 3000);

        const safeResolve = (data) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                resolve(data);
            }
        };

        try {
            window.EXIF.getData(partialFile, function () {
                try {
                    const allTags = window.EXIF.getAllTags(this) || {};
                    let date = file.lastModified || Date.now();
                    const dateStr = allTags["DateTimeOriginal"];
                    if (dateStr) {
                        const parts = dateStr.split(/[: ]/);
                        const d = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
                        if (!isNaN(d.getTime())) date = d.getTime();
                    }

                    let rating = null;
                    if (allTags["Rating"] !== undefined) rating = parseInt(allTags["Rating"]);
                    
                    if (rating !== null) {
                        safeResolve({ date, rating });
                    } else {
                        getXmpRating(partialFile).then(xmpRating => {
                            safeResolve({ date, rating: xmpRating });
                        }).catch(() => safeResolve({ date, rating: null }));
                    }
                } catch (err) {
                    safeResolve({ date: file.lastModified || Date.now(), rating: null });
                }
            });
        } catch (err) {
            safeResolve({ date: file.lastModified || Date.now(), rating: null });
        }
    });
}

async function getXmpRating(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const text = new TextDecoder().decode(e.target.result);
                let match = text.match(/xmp:Rating=["']?(\d+)["']?/i);
                if (!match) match = text.match(/<xmp:Rating>(\d+)<\/xmp:Rating>/i);
                if (!match) match = text.match(/Rating=["']?(\d+)["']?/i);
                if (match && match[1]) {
                    const r = parseInt(match[1]);
                    if (r >= 1 && r <= 5) return resolve(r);
                }
                resolve(null);
            } catch (err) { resolve(null); }
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(blob);
    });
}

/**
 * Optimized Thumbnail Pipeline (Requirement #5)
 */
export async function generateThumbnail(file, size = 300) {
    try {
        const freshFile = await getFreshFile(file);
        const bitmap = await createImageBitmap(freshFile, {
            resizeWidth: size * 2,
            resizeQuality: 'medium'
        });

        const canvas = new OffscreenCanvas(size, size);
        const ctx = canvas.getContext("2d");

        const scale = Math.max(size / bitmap.width, size / bitmap.height);
        const w = bitmap.width * scale;
        const h = bitmap.height * scale;
        const x = (size - w) / 2;
        const y = (size - h) / 2;

        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(bitmap, x, y, w, h);

        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
        bitmap.close();
        
        return URL.createObjectURL(blob);
    } catch (e) {
        return URL.createObjectURL(file);
    }
}

/**
 * Optimized Image Processing for Previews and Export
 */
export async function processImage(file, resSize, quality) {
    try {
        const freshFile = await getFreshFile(file);
        if (resSize === 'original') return freshFile;

        let bitmap = null;
        let imgWidth, imgHeight, imgSource;

        if (window.createImageBitmap) {
            bitmap = await createImageBitmap(file).catch(() => null);
        }

        if (bitmap) {
            imgWidth = bitmap.width;
            imgHeight = bitmap.height;
            imgSource = bitmap;
        } else {
            imgSource = await loadClassicImage(file);
            if (!imgSource) return file;
            imgWidth = imgSource.width;
            imgHeight = imgSource.height;
        }

        let w = imgWidth;
        let h = imgHeight;

        if (resSize !== 'original-q') {
            const max = parseInt(resSize || 1600);
            if (w > h && w > max) { h = (max / w) * h; w = max; }
            else if (h > max) { w = (max / h) * w; h = max; }
        }

        let blob;
        if (window.OffscreenCanvas) {
            const off = new OffscreenCanvas(w, h);
            const octx = off.getContext('2d');
            octx.fillStyle = 'black';
            octx.fillRect(0, 0, w, h);
            octx.drawImage(imgSource, 0, 0, w, h);
            blob = await off.convertToBlob({ type: 'image/jpeg', quality: quality });
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(imgSource, 0, 0, w, h);
            blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
        }

        if (bitmap && bitmap.close) bitmap.close();
        return blob;
    } catch (e) {
        console.error("Rendering error:", e);
        return file;
    }
}

async function loadClassicImage(file) {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        img.src = url;
    });
}

/**
 * Concurrency-controlled Worker Queue (Requirement #2)
 */
export class WorkerQueue {
    constructor(concurrency = 10) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
    }

    async add(task) {
        if (this.running >= this.concurrency) {
            await new Promise(resolve => this.queue.push(resolve));
        }
        this.running++;
        try {
            return await task();
        } finally {
            this.running--;
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                next();
            }
        }
    }
}
