/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { THREE } from '../ext/three.js';

const _vec = new THREE.Vector3();

/**
 * 3D Bitmap Text Renderer using font atlas.
 * Creates a texture atlas from specified characters and renders text using
 * individual character meshes with shared geometries and material.
 */
class Text3D {
    /**
     * Create a 3D text renderer.
     * @param {object} options - Configuration options
     * @param {string} options.chars - Characters to include in atlas (default: '0123456789-XY')
     * @param {number} options.charSize - Size of each character in atlas texture (default: 64)
     * @param {number} options.kerning - Character spacing multiplier (default: 0.5, lower = tighter)
     * @param {number} options.scaleX - Default horizontal scale (default: 1.0)
     * @param {number} options.scaleY - Default vertical scale (default: 1.0)
     * @param {string} options.fontFamily - CSS font family string (default: 'sans-serif')
     */
    constructor(options = {}) {
        this.chars = options.chars || '0123456789-XY';
        this.charSize = options.charSize || 64;
        this.kerning = options.kerning !== undefined ? options.kerning : 0.5;
        this.scaleX = options.scaleX !== undefined ? options.scaleX : 1.0;
        this.scaleY = options.scaleY !== undefined ? options.scaleY : 1.0;
        this.fontFamily = options.fontFamily || "sans-serif";
        this.atlas = null;
        this.geometries = {}; // Cached geometries per character
        this.material = null; // Shared material for all characters
        this._initialize();
    }

    /**
     * Initialize atlas, geometries, and material.
     * @private
     */
    _initialize() {
        this._createAtlas();
        this._createGeometries();
        this._createMaterial();
    }

    /**
     * Create bitmap font atlas texture.
     * @private
     */
    _createAtlas() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const charSize = this.charSize;

        canvas.width = charSize * this.chars.length;
        canvas.height = charSize;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `bold ${charSize * 0.8}px ${this.fontFamily}`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const uvMap = {};
        for (let i = 0; i < this.chars.length; i++) {
            const char = this.chars[i];
            ctx.fillText(char, i * charSize + charSize/2, charSize/2);
            uvMap[char] = {
                uStart: i / this.chars.length,
                uEnd: (i + 1) / this.chars.length
            };
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;

        this.atlas = { texture, uvMap, canvas };

        if (self.debug) {
            console.log('Text3D atlas created', {
                width: canvas.width,
                height: canvas.height,
                chars: this.chars.length
            });
        }
    }

    /**
     * Create cached geometries for each character.
     * Each character gets one geometry with UVs mapped to atlas position.
     * These geometries are reused across all labels.
     * @private
     */
    _createGeometries() {
        const { uvMap } = this.atlas;

        for (let char of this.chars) {
            const uvData = uvMap[char];
            if (!uvData) continue;

            // Create unit-sized plane (will be scaled when used)
            const geometry = new THREE.PlaneGeometry(1, 1);
            const uvAttr = geometry.attributes.uv;

            // Set UV coordinates to sample this character from atlas
            uvAttr.setXY(0, uvData.uStart, 0); // bottom-left
            uvAttr.setXY(1, uvData.uEnd, 0);   // bottom-right
            uvAttr.setXY(2, uvData.uStart, 1); // top-left
            uvAttr.setXY(3, uvData.uEnd, 1);   // top-right

            this.geometries[char] = geometry;
        }
    }

    /**
     * Create shared material for all characters.
     * @private
     */
    _createMaterial() {
        this.material = new THREE.MeshBasicMaterial({
            map: this.atlas.texture,
            transparent: true,
            opacity: 0.5, // swarf: ruler/grid labels at 50% (markup Apr 15)
            depthWrite: false,
            side: THREE.DoubleSide
        });
        // labels are almost always all one color; cloning the material per
        // character meant every glyph on screen cost its own draw call and a
        // full shader program switch
        this._matByColor = new Map();
    }

    /**
     * Shared material for a given color.
     * @private
     */
    _materialFor(color) {
        const c = typeof color === 'string' ? new THREE.Color(color) : new THREE.Color(color);
        const key = c.getHex();
        let mat = this._matByColor.get(key);
        if (!mat) {
            mat = this.material.clone();
            mat.color = c;
            this._matByColor.set(key, mat);
        }
        return mat;
    }

    /**
     * Append one string of text to a vertex accumulator.
     * @private
     */
    _emit(out, text, size, align, kerning, scaleX, scaleY, matrix) {
        const { uvMap } = this.atlas;
        const spacing = kerning !== undefined ? kerning : this.kerning;
        const sx = scaleX !== undefined ? scaleX : this.scaleX;
        const sy = scaleY !== undefined ? scaleY : this.scaleY;
        const charSpacing = size * spacing * sx;
        const totalWidth = text.length * charSpacing;
        const hw = size * sx / 2;
        const hh = size * sy / 2;

        let startX = 0;
        if (align === 'center') startX = -totalWidth / 2;
        else if (align === 'right') startX = -totalWidth;

        const v = _vec;
        for (let i = 0; i < text.length; i++) {
            const uv = uvMap[text[i]];
            if (!uv) {
                if (self.debug) console.warn('Text3D: Character not in atlas:', text[i]);
                continue;
            }
            const cx = startX + i * charSpacing + charSpacing / 2;
            // corners in the same order PlaneGeometry uses, so winding and the
            // vertically flipped atlas UVs match the old per-character meshes
            const corner = [
                [cx - hw,  hh, uv.uStart, 0],
                [cx - hw, -hh, uv.uStart, 1],
                [cx + hw,  hh, uv.uEnd,   0],
                [cx - hw, -hh, uv.uStart, 1],
                [cx + hw, -hh, uv.uEnd,   1],
                [cx + hw,  hh, uv.uEnd,   0],
            ];
            for (const [x, y, u, w] of corner) {
                v.set(x, y, 0);
                if (matrix) v.applyMatrix4(matrix);
                out.pos.push(v.x, v.y, v.z);
                out.uv.push(u, w);
            }
        }
    }

    /**
     * Build a single mesh holding many labels.
     *
     * @param {Array} labels - [{ text, size, align, kerning, scaleX, scaleY, matrix }]
     * @param {string|number} color - shared color for the whole set
     * @returns {THREE.Mesh|null} one mesh, one draw call, or null if empty
     */
    createLabelSet(labels, color = 0x333333) {
        const out = { pos: [], uv: [] };
        for (const l of labels) {
            this._emit(out, l.text, l.size, l.align, l.kerning, l.scaleX, l.scaleY, l.matrix);
        }
        if (!out.pos.length) return null;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
        const mesh = new THREE.Mesh(geo, this._materialFor(color));
        mesh.matrixAutoUpdate = false;
        return mesh;
    }

    /**
     * Create a 3D text label.
     * @param {string} text - Text to render
     * @param {number} size - Character height in world units
     * @param {string|number} color - Text color (CSS string or hex number)
     * @param {string} align - Horizontal alignment ('left', 'center', 'right')
     * @param {number} kerning - Optional kerning override for this label
     * @param {number} scaleX - Optional horizontal scale override for this label
     * @param {number} scaleY - Optional vertical scale override for this label
     * @returns {THREE.Group} Group containing character meshes
     */
    createLabel(text, size, color = 0x333333, align = 'center', kerning, scaleX, scaleY) {
        const group = new THREE.Group();
        const mesh = this.createLabelSet(
            [{ text, size, align, kerning, scaleX, scaleY }], color);
        if (mesh) group.add(mesh);
        return group;
    }

    /**
     * Update kerning for future labels.
     * @param {number} kerning - New kerning value
     */
    setKerning(kerning) {
        this.kerning = kerning;
    }

    /**
     * Update horizontal scale for future labels.
     * @param {number} scaleX - New horizontal scale value
     */
    setScaleX(scaleX) {
        this.scaleX = scaleX;
    }

    /**
     * Update vertical scale for future labels.
     * @param {number} scaleY - New vertical scale value
     */
    setScaleY(scaleY) {
        this.scaleY = scaleY;
    }

    /**
     * Update both scales for future labels.
     * @param {number} scaleX - New horizontal scale value
     * @param {number} scaleY - New vertical scale value
     */
    setScale(scaleX, scaleY) {
        this.scaleX = scaleX;
        this.scaleY = scaleY;
    }

    /**
     * Clean up resources.
     */
    dispose() {
        // Dispose texture
        if (this.atlas && this.atlas.texture) {
            this.atlas.texture.dispose();
        }

        // Dispose geometries
        for (let char in this.geometries) {
            this.geometries[char].dispose();
        }

        // Dispose material
        if (this.material) {
            this.material.dispose();
        }
        for (const mat of this._matByColor?.values() ?? []) {
            mat.dispose();
        }
        this._matByColor?.clear();
    }
}

export { Text3D };
