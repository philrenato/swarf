/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

// swarf: words written into a machine file as comments: plain ASCII, no brackets or apostrophes
// (a parser that strips ' comments first would cut a bracketed line in half). Used on the main
// thread (the notes at the head of the file) and in the worker (a bit's name on its tool line).
const ASCII = { '›': '>', '–': '-', '—': '-', '×': 'x', '’': '', '‘': '', '“': '"', '”': '"', '°': ' deg', '…': '...' };

export function asciiNote(v) {
    return String(v || '').replace(/[‘-›°×–—]/g, c => ASCII[c] != null ? ASCII[c] : ' ')
        .replace(/[^\x20-\x7e]/g, ' ').replace(/['()]/g, '').replace(/\s+/g, ' ').trim();
}
