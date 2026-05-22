// Anime4K WebGL Renderer
// Real-time anime-style video enhancement using GLSL shaders
// Based on Anime4K v4.0 algorithm by bloc97 (https://github.com/bloc97/Anime4K)

var Anime4KRenderer = (() => {
  const VERTEX_SHADER = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `

  // Extract luminance from RGB video frame
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

  // Push shader — reconstructs thin lines by detecting edges in 4 directions
  const FRAG_PUSH = `
    precision highp float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform vec2 u_stepSize;

    float getLum(vec2 coord) {
      return texture2D(u_texture, coord).r;
    }

    float pushDirection(vec2 d) {
      float m2 = getLum(v_texCoord + d * -2.0);
      float m1 = getLum(v_texCoord + d * -1.0);
      float c  = getLum(v_texCoord);
      float p1 = getLum(v_texCoord + d * 1.0);
      float p2 = getLum(v_texCoord + d * 2.0);

      // How similar are the immediate neighbors (small = both on same side of edge)
      float neighborSim = abs(m1 - p1) + 0.0001;
      // How much center deviates from neighbor average (large = center is on the edge)
      float centerDev = abs(c * 2.0 - m1 - p1);
      // Gradient consistency in outer region (small = flat background, this is a thin line)
      float outerFlat = abs(m2 - m1) + abs(p2 - p1);

      // Only push when center clearly stands out and surroundings are flat
      if (centerDev < neighborSim * 0.15 || centerDev < outerFlat * 0.25) return 0.0;

      // Push center AWAY from neighbor average → increases edge contrast
      float target = (m1 + p1) * 0.5;
      return clamp((c - target) * 0.4, -0.09, 0.09);
    }

    void main() {
      vec2 dH = vec2(u_stepSize.x, 0.0);
      vec2 dV = vec2(0.0, u_stepSize.y);
      vec2 dD = vec2(u_stepSize.x, u_stepSize.y);
      vec2 dA = vec2(u_stepSize.x, -u_stepSize.y);

      float c = getLum(v_texCoord);
      float push = 0.0;
      push += pushDirection(dH);
      push += pushDirection(dV);
      push += pushDirection(dD);
      push += pushDirection(dA);

      gl_FragColor = vec4(c + push, 0.0, 0.0, 1.0);
    }
  `

  // Composite: blend enhanced luminance detail back into original RGB
  const FRAG_COMPOSITE = `
    precision highp float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texOriginal;
    uniform sampler2D u_texEnhanced;
    void main() {
      vec3 original = texture2D(u_texOriginal, v_texCoord).rgb;
      float origLum = dot(original, vec3(0.2126, 0.7152, 0.0722));
      float enhancedLum = texture2D(u_texEnhanced, v_texCoord).r;

      // Detail = what the push algorithm added to luminance
      float detail = enhancedLum - origLum;

      // Soft clamp to prevent halos
      detail = clamp(detail, -0.22, 0.22);

      // Blend detail back into original color
      float strength = 0.55;
      vec3 result = original + detail * strength;
      result = clamp(result, 0.0, 1.0);

      gl_FragColor = vec4(result, 1.0);
    }
  `

  // Tuning knobs
  const PUSH_ITERATIONS = 2
  const MAX_PROCESSING_SIZE = 1920

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
      this.procWidth = 0
      this.procHeight = 0
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

      gl.canvas.addEventListener('webglcontextlost', () => {
        console.error('[Anime4K] WebGL context lost')
        this.stop()
      })

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
      this.buffers.quad = { buf, stride: 16, texOffset: 8 }
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
      if (this.ready) console.log('[Anime4K] Shaders compiled')
    }

    _createTexture(w, h) {
      const gl = this.gl
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      return tex
    }

    _createFramebuffer(tex) {
      const gl = this.gl
      const fb = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      return fb
    }

    _computeProcSize(vw, vh) {
      const maxDim = Math.max(vw, vh)
      if (maxDim <= MAX_PROCESSING_SIZE) return { w: vw, h: vh }
      const scale = MAX_PROCESSING_SIZE / maxDim
      return { w: Math.round(vw * scale), h: Math.round(vh * scale) }
    }

    _ensureTextures(vw, vh) {
      if (this.videoWidth === vw && this.videoHeight === vh) return
      this.videoWidth = vw
      this.videoHeight = vh

      const proc = this._computeProcSize(vw, vh)
      this.procWidth = proc.w
      this.procHeight = proc.h
      console.log('[Anime4K] Video: %dx%d → Process: %dx%d', vw, vh, proc.w, proc.h)

      this.canvas.width = vw
      this.canvas.height = vh

      const gl = this.gl
      const oldTex = this.textures

      this.textures = {
        video: this._createTexture(vw, vh),
        lum: this._createTexture(proc.w, proc.h),
        ping: this._createTexture(proc.w, proc.h),
        pong: this._createTexture(proc.w, proc.h)
      }
      this.framebuffers = {
        lum: this._createFramebuffer(this.textures.lum),
        ping: this._createFramebuffer(this.textures.ping),
        pong: this._createFramebuffer(this.textures.pong)
      }

      Object.values(oldTex).forEach(t => t && gl.deleteTexture(t))
    }

    _draw(program, uniforms, targetFb, vpW, vpH) {
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

      gl.viewport(0, 0, vpW, vpH)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    _uploadVideo() {
      const gl = this.gl
      gl.bindTexture(gl.TEXTURE_2D, this.textures.video)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video)
      } catch (e) {
        console.error('[Anime4K] Video upload failed:', e.message)
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    }

    render() {
      if (!this.ready || !this.enabled) return

      const vw = this.video.videoWidth
      const vh = this.video.videoHeight
      if (!vw || !vh) return

      this._ensureTextures(vw, vh)
      this._uploadVideo()

      const pw = this.procWidth
      const ph = this.procHeight
      const stepSize = [1.0 / pw, 1.0 / ph]

      // Pass 1: RGB → Luminance (video res → proc res)
      this._draw(this.programs.luminance, {}, this.framebuffers.lum, pw, ph)

      // Pass 2-5: Push iterations (proc res, ping-pong)
      for (let i = 0; i < PUSH_ITERATIONS; i++) {
        const src = i === 0 ? this.textures.lum
          : (i % 2 === 0 ? this.textures.pong : this.textures.ping)
        const dst = i % 2 === 0 ? this.framebuffers.ping : this.framebuffers.pong
        this._draw(this.programs.push, { u_texture: src, u_stepSize: stepSize }, dst, pw, ph)
      }

      // Pass 6: Composite → canvas (full video res output)
      const finalLum = PUSH_ITERATIONS % 2 === 1 ? this.textures.ping : this.textures.pong
      this._draw(this.programs.composite, {
        u_texOriginal: this.textures.video,
        u_texEnhanced: finalLum
      }, null, vw, vh)
    }

    start() {
      if (!this.ready) {
        console.warn('[Anime4K] Renderer not ready')
        return
      }
      this.enabled = true
      this.canvas.style.display = 'block'
      this._lastVideoTime = -1
      this._loop()
    }

    stop() {
      this.enabled = false
      if (this.rafId) {
        cancelAnimationFrame(this.rafId)
        this.rafId = null
      }
      this.canvas.style.display = 'none'
      const gl = this.gl
      if (gl) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.clearColor(0, 0, 0, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
    }

    _loop() {
      if (!this.enabled) return
      this.rafId = requestAnimationFrame(() => this._loop())

      // Only render when video has advanced to a new frame
      if (this._lastVideoTime === this.video.currentTime) return
      this._lastVideoTime = this.video.currentTime

      this.render()
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
