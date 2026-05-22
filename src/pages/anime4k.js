// Anime4K WebGL Renderer
// Real-time anime-style video enhancement using GLSL shaders
// Based on Anime4K v4.0 algorithm by bloc97 (https://github.com/bloc97/Anime4K)

const Anime4KRenderer = (() => {
  const VERTEX_SHADER = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `

  const FRAG_LUMINANCE = `
    precision highp float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    void main() {
      vec3 rgb = texture2D(u_texture, v_texCoord).rgb;
      float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(lum, 0.0, 0.0, 1.0);
    }
  `

  const FRAG_PUSH = `
    precision highp float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform vec2 u_texelSize;

    float getLum(vec2 coord) {
      return texture2D(u_texture, coord).r;
    }

    float pushDirection(vec2 d) {
      float m2 = getLum(v_texCoord + d * -2.0);
      float m1 = getLum(v_texCoord + d * -1.0);
      float c  = getLum(v_texCoord);
      float p1 = getLum(v_texCoord + d * 1.0);
      float p2 = getLum(v_texCoord + d * 2.0);

      float g1 = m1 - m2, g2 = c - m1, g3 = p1 - c, g4 = p2 - p1;

      float str = abs(g2 - g3);
      float flat = abs(g1) + abs(g4) + 0.001;

      if (str < flat * 0.25) return 0.0;

      float push = clamp((g2 - g3) * 0.5, -0.5, 0.5);
      return push;
    }

    void main() {
      vec2 dH = vec2(u_texelSize.x, 0.0);
      vec2 dV = vec2(0.0, u_texelSize.y);
      vec2 dD = vec2(u_texelSize.x, u_texelSize.y);
      vec2 dA = vec2(u_texelSize.x, -u_texelSize.y);

      float c = getLum(v_texCoord);
      float push = 0.0;
      push += pushDirection(dH);
      push += pushDirection(dV);
      push += pushDirection(dD);
      push += pushDirection(dA);

      float result = c + push * 0.2;
      gl_FragColor = vec4(result, 0.0, 0.0, 1.0);
    }
  `

  const FRAG_COMPOSITE = `
    precision highp float;
    varying vec2 v_texCoord;
    uniform sampler2D u_original;
    uniform sampler2D u_enhanced;
    void main() {
      vec3 original = texture2D(u_original, v_texCoord).rgb;
      float origLum = dot(original, vec3(0.2126, 0.7152, 0.0722));
      float enhancedLum = texture2D(u_enhanced, v_texCoord).r;
      float ratio = origLum > 0.001 ? enhancedLum / origLum : 1.0;
      vec3 result = clamp(original * ratio, 0.0, 1.0);
      gl_FragColor = vec4(result, 1.0);
    }
  `

  const PUSH_ITERATIONS = 4

  class Renderer {
    constructor(canvas, video) {
      this.canvas = canvas
      this.video = video
      this.gl = null
      this.enabled = false
      this.rafId = null

      this.programs = {}
      this.textures = {}
      this.framebuffers = {}
      this.buffers = {}

      this.videoWidth = 0
      this.videoHeight = 0
      this.ready = false

      this._initGL()
    }

    _initGL() {
      const gl = this.canvas.getContext('webgl', {
        preserveDrawingBuffer: false,
        antialias: false,
        powerPreference: 'high-performance'
      })
      if (!gl) {
        console.error('[Anime4K] WebGL not available')
        return
      }
      this.gl = gl

      const ext = gl.getExtension('OES_texture_float')
      if (!ext) {
        console.warn('[Anime4K] OES_texture_float not available, falling back to UNSIGNED_BYTE')
      }

      this._setupGeometry()
      this._compileShaders()
    }

    _setupGeometry() {
      const gl = this.gl
      const vertices = new Float32Array([
        -1, -1,  0, 0,
         1, -1,  1, 0,
        -1,  1,  0, 1,
         1,  1,  1, 1
      ])
      const buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
      this.buffers.quad = { buf, numComponents: 2, stride: 16, texOffset: 8 }
    }

    _compileShader(type, source) {
      const gl = this.gl
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('[Anime4K] Shader error:', gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }
      return shader
    }

    _createProgram(vsSource, fsSource) {
      const gl = this.gl
      const vs = this._compileShader(gl.VERTEX_SHADER, vsSource)
      const fs = this._compileShader(gl.FRAGMENT_SHADER, fsSource)
      if (!vs || !fs) return null

      const prog = gl.createProgram()
      gl.attachShader(prog, vs)
      gl.attachShader(prog, fs)
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('[Anime4K] Link error:', gl.getProgramInfoLog(prog))
        gl.deleteProgram(prog)
        return null
      }
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      return prog
    }

    _compileShaders() {
      this.programs.luminance = this._createProgram(VERTEX_SHADER, FRAG_LUMINANCE)
      this.programs.push = this._createProgram(VERTEX_SHADER, FRAG_PUSH)
      this.programs.composite = this._createProgram(VERTEX_SHADER, FRAG_COMPOSITE)

      this.ready = !!(this.programs.luminance && this.programs.push && this.programs.composite)
      if (this.ready) {
        console.log('[Anime4K] Shaders compiled successfully')
      }
    }

    _createTexture(w, h, useFloat) {
      const gl = this.gl
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const fmt = useFloat && gl.getExtension('OES_texture_float') ? gl.FLOAT : gl.UNSIGNED_BYTE
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, fmt, null)
      return tex
    }

    _createFramebuffer(tex) {
      const gl = this.gl
      const fb = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      return fb
    }

    _ensureTextures(w, h) {
      if (this.videoWidth === w && this.videoHeight === h) return
      this.videoWidth = w
      this.videoHeight = h
      this.canvas.width = w
      this.canvas.height = h

      const gl = this.gl
      const oldTex = this.textures

      this.textures = {
        video: this._createTexture(w, h, false),
        lum: this._createTexture(w, h, true),
        ping: this._createTexture(w, h, true),
        pong: this._createTexture(w, h, true)
      }
      this.framebuffers = {
        lum: this._createFramebuffer(this.textures.lum),
        ping: this._createFramebuffer(this.textures.ping),
        pong: this._createFramebuffer(this.textures.pong)
      }

      // Clean old textures
      Object.values(oldTex).forEach(t => t && gl.deleteTexture(t))
    }

    _draw(program, uniforms, targetFb) {
      const gl = this.gl
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFb || null)

      gl.useProgram(program)

      const posLoc = gl.getAttribLocation(program, 'a_position')
      const texLoc = gl.getAttribLocation(program, 'a_texCoord')
      const quad = this.buffers.quad
      gl.bindBuffer(gl.ARRAY_BUFFER, quad.buf)
      gl.enableVertexAttribArray(posLoc)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, quad.stride, 0)
      gl.enableVertexAttribArray(texLoc)
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, quad.stride, quad.texOffset)

      let texUnit = 0
      for (const [name, val] of Object.entries(uniforms)) {
        const loc = gl.getUniformLocation(program, name)
        if (loc === null) continue
        if (name.startsWith('u_tex')) {
          gl.activeTexture(gl.TEXTURE0 + texUnit)
          gl.bindTexture(gl.TEXTURE_2D, val)
          gl.uniform1i(loc, texUnit)
          texUnit++
        } else if (Array.isArray(val)) {
          gl[`uniform${val.length}fv`](loc, val)
        } else {
          gl.uniform1f(loc, val)
        }
      }

      gl.viewport(0, 0, this.videoWidth, this.videoHeight)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    _uploadVideo() {
      const gl = this.gl
      gl.bindTexture(gl.TEXTURE_2D, this.textures.video)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video)
    }

    render() {
      if (!this.ready || !this.enabled) return

      const vw = this.video.videoWidth
      const vh = this.video.videoHeight
      if (!vw || !vh) return

      this._ensureTextures(vw, vh)
      this._uploadVideo()

      const texelSize = [1.0 / vw, 1.0 / vh]

      // Pass 1: RGB → Luminance
      this._draw(this.programs.luminance, {}, this.framebuffers.lum)

      // Pass 2-N: Push iterations (ping-pong, starting from lum)
      for (let i = 0; i < PUSH_ITERATIONS; i++) {
        const src = i === 0 ? this.textures.lum
          : (i % 2 === 0 ? this.textures.pong : this.textures.ping)
        const dst = i % 2 === 0 ? this.framebuffers.ping : this.framebuffers.pong
        this._draw(this.programs.push, { u_texture: src, u_texelSize: texelSize }, dst)
      }

      // Composite: original RGB + enhanced luminance
      // After push passes: even PUSH_ITERATIONS → pong, odd → ping
      const finalLum = PUSH_ITERATIONS % 2 === 1 ? this.textures.ping : this.textures.pong
      this._draw(this.programs.composite, {
        u_original: this.textures.video,
        u_enhanced: finalLum
      }, null)
    }

    start() {
      if (!this.ready) {
        console.warn('[Anime4K] Renderer not ready, cannot start')
        return
      }
      this.enabled = true
      this.canvas.style.display = 'block'
      this._loop()
    }

    stop() {
      this.enabled = false
      if (this.rafId) {
        cancelAnimationFrame(this.rafId)
        this.rafId = null
      }
      this.canvas.style.display = 'none'

      // Clear canvas
      const gl = this.gl
      if (gl) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.clearColor(0, 0, 0, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
    }

    _loop() {
      if (!this.enabled) return
      this.render()
      this.rafId = requestAnimationFrame(() => this._loop())
    }

    resize() {
      if (!this.canvas) return
      const rect = this.canvas.parentElement.getBoundingClientRect()
      this.canvas.style.width = rect.width + 'px'
      this.canvas.style.height = rect.height + 'px'
    }

    destroy() {
      this.stop()
      const gl = this.gl
      if (!gl) return
      Object.values(this.textures).forEach(t => gl.deleteTexture(t))
      Object.values(this.framebuffers).forEach(fb => gl.deleteFramebuffer(fb))
      Object.values(this.buffers).forEach(b => b.buf && gl.deleteBuffer(b.buf))
      Object.values(this.programs).forEach(p => gl.deleteProgram(p))
    }
  }

  return { Renderer }
})()
