/**
 * PhotoCull Pro - Shared Utilities
 */

/** Check if a file is a supported image type */
export function isImageFile(file) {
    return file.type.startsWith('image/') ||
        /\.(jpg|jpeg|png|heic|webp)$/i.test(file.name);
}

/** Get the short display name of a file */
export function getShortName(file) {
    if (file._shortName) return file._shortName;
    const rawPath = (file.webkitRelativePath && file.webkitRelativePath.length > 0) 
        ? file.webkitRelativePath 
        : (file.name || '');
    
    // Split by both forward and backslashes and filter out empty strings (trailing slashes)
    const parts = rawPath.split(/[/\\]/).filter(p => p.trim().length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : file.name;
}

/** Natural numeric filename comparator */
export function naturalSort(a, b) {
    return getShortName(a).localeCompare(getShortName(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Yield to main thread to allow UI updates and event processing */
export const yieldToMain = () => new Promise(resolve => {
    requestAnimationFrame(() => {
        setTimeout(resolve, 0);
    });
});

/** Simple Toast Utility */
export function showToast(message, type = 'success') {
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

/** JIT File Resolver for File System Access API */
export async function getFreshFile(fileOrHandle) {
    if (!fileOrHandle) return fileOrHandle;
    if (fileOrHandle instanceof File) return fileOrHandle;
    if (fileOrHandle._handle) return await fileOrHandle._handle.getFile();
    return fileOrHandle;
}
