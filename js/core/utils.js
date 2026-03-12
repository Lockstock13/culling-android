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
    if (file.webkitRelativePath && file.webkitRelativePath.length > 0) {
        const parts = file.webkitRelativePath.split('/');
        return parts[parts.length - 1];
    }
    return file.name;
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
