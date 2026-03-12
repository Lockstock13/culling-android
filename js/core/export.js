/**
 * PhotoCull Pro - Export Module
 */
import { state } from './state.js';
import { getShortName } from './utils.js';

/**
 * Metadata Injector (Adobe Bridge/Lightroom compatibility)
 */
export async function injectMetadata(blob, rating, color, caption, byline) {
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    if (view.getUint16(0) !== 0xFFD8) return blob;

    const colorMap = { 'red': 1, 'yellow': 2, 'green': 3, 'blue': 4 };
    const urgency = colorMap[color] || 0;
    const esc = (str) => str.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": "&apos;" }[c]));

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

    const xmpHeader = "http://ns.adobe.com/xap/1.0/\0";
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

// ... Additional export functions (executeExport) would be ported here
