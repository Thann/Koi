/**
 * A wave simulation shader
 * @param {WebGLRenderingContext} gl A WebGL rendering context
 * @constructor
 */
const Waves = function(gl) {
    this.gl = gl;
    this.programDistort = new Shader(
        gl,
        this.SHADER_DISTORT_VERTEX,
        this.SHADER_DISTORT_FRAGMENT,
        ["scale", "background", "waterBack", "waterFront", "depth", "size", "waterSize", "time"],
        ["position"]);
    this.programPropagate = new Shader(
        gl,
        this.SHADER_PROPAGATE_VERTEX,
        this.SHADER_PROPAGATE_FRAGMENT,
        ["size", "scale", "damping"],
        ["position"]);
};

Waves.prototype.DAMPING = .995;
Waves.prototype.DEPTH = 0.1;

Waves.prototype.SHADER_DISTORT_VERTEX = `#version 100
uniform mediump float scale;
uniform mediump vec2 size;

attribute vec2 position;

void main() {
  gl_Position = vec4(vec2(2.0, -2.0) * position / size * scale + vec2(-1.0, 1.0), 0.0, 1.0);
}
`;

Waves.prototype.SHADER_DISTORT_FRAGMENT = `#version 100
uniform sampler2D background;
uniform sampler2D waterBack;
uniform sampler2D waterFront;
uniform mediump float depth;
uniform mediump vec2 size;
uniform mediump vec2 waterSize;
uniform mediump float time;

mediump float get(mediump vec2 delta) {
  mediump vec2 uv = gl_FragCoord.xy / size + delta / waterSize;
  
  return mix(texture2D(waterBack, uv).r, texture2D(waterFront, uv).r, time) * 6.0 - 3.0;
}

void main() {
  mediump float dyx = get(vec2(1.0, 0.0)) - get(vec2(-1.0, 0.0));
  mediump float dyz = get(vec2(0.0, 1.0)) - get(vec2(0.0, -1.0));
  mediump vec3 normal = cross(
    normalize(vec3(2.0, dyx, 0.0)),
    normalize(vec3(0.0, dyz, 2.0)));
  mediump vec2 displacement = depth * normal.xz / size;
  mediump float shiny = dot(normalize(vec3(1.0, 0.0, 1.0)), normal);
  
  if (shiny < 0.0)
    shiny *= 0.5;
  else {
    if (shiny > 0.5) // TODO: Specular hack
      shiny *= 1.5;
  }
  
  mediump vec4 filter = vec4(0.93, 0.98, 1.0, 1.0) * vec4(0.92, 0.97, 1.0, 1.0);
  mediump vec4 sky = vec4(0.88, 0.96, 1.0, 1.0);
  
  mediump vec4 pixel = texture2D(background, gl_FragCoord.xy / size - displacement);
  
  if (pixel.a == 0.0)
    pixel = vec4(1.0);
  
  gl_FragColor = mix(
    filter * pixel,
    sky,
    shiny);
}
`;

Waves.prototype.SHADER_PROPAGATE_VERTEX = `#version 100
uniform mediump vec2 size;
uniform mediump float scale;

attribute vec2 position;

void main() {
  gl_Position = vec4(vec2(2.0, -2.0) * position / size * scale + vec2(-1.0, 1.0), 0.0, 1.0);
}
`;

Waves.prototype.SHADER_PROPAGATE_FRAGMENT = `#version 100
uniform sampler2D source;
uniform mediump vec2 size;
uniform mediump float damping;

void main() {
  mediump vec2 uv = gl_FragCoord.xy / size;
  mediump vec2 step = vec2(1.0 / size.x, 1.0 / size.y);
  mediump vec3 state = texture2D(source, uv).rgb;
  mediump float hLeft = texture2D(source, vec2(uv.x - step.x, uv.y)).r;
  mediump float hRight = texture2D(source, vec2(uv.x + step.x, uv.y)).r;
  mediump float hUp = texture2D(source, vec2(uv.x, uv.y - step.y)).r;
  mediump float hDown = texture2D(source, vec2(uv.x, uv.y + step.y)).r;
  mediump float momentum = (state.g + state.b) * 2.0 - 1.0;
  mediump float newHeight = (hLeft + hUp + hRight + hDown) - 2.0;
  
  gl_FragColor = vec4(
    ((newHeight - momentum) * damping) * 0.5 + 0.5,
    state.r,
    0.0,
    0.0);
}
`;

/**
 * Propagate the waves on a water plane
 * @param {WaterPlane} water A water plane
 * @param {WavePainter} wavePainter A wave painter to render wave influences
 * @param {Mesh} mesh A mesh containing all water pixels
 */
Waves.prototype.propagate = function(water, wavePainter, mesh) {
    this.programPropagate.use();

    water.flip();
    water.getFront().target();

    this.gl.clearColor(0.5, 0.5, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.gl.uniform2f(this.programPropagate.uSize, water.width, water.height);
    this.gl.uniform1f(this.programPropagate.uScale, water.SCALE);
    this.gl.uniform1f(this.programPropagate.uDamping, this.DAMPING);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, mesh.vertices);
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, mesh.indices);

    this.gl.enableVertexAttribArray(this.programPropagate.aPosition);
    this.gl.vertexAttribPointer(this.programPropagate.aPosition, 2, this.gl.FLOAT, false, 8, 0);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, water.getBack().texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);

    this.gl.drawElements(this.gl.TRIANGLES, mesh.indexCount, this.gl.UNSIGNED_SHORT, 0);

    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

    wavePainter.applyInfluences(water);
};

/**
 * Render waves
 * @param {WebGLTexture} background A background texture
 * @param {Mesh} mesh A mesh containing all water pixels
 * @param {WaterPlane} water A water plane to shade the background with
 * @param {Number} width The background width in pixels
 * @param {Number} height The background height in pixels
 * @param {Number} scale The render scale
 * @param {Number} time The interpolation factor
 */
Waves.prototype.render = function(
    background,
    mesh,
    water,
    width,
    height,
    scale,
    time) {
    this.programDistort.use();

    this.gl.uniform1f(this.programDistort.uScale, scale);
    this.gl.uniform1i(this.programDistort.uBackground, 0);
    this.gl.uniform1i(this.programDistort.uWaterBack, 1);
    this.gl.uniform1i(this.programDistort.uWaterFront, 2);
    this.gl.uniform1f(this.programDistort.uDepth, this.DEPTH * scale);
    this.gl.uniform2f(this.programDistort.uSize, width, height);
    this.gl.uniform2f(this.programDistort.uWaterSize, water.width, water.height); // TODO: Use inverse dimensions
    this.gl.uniform1f(this.programDistort.uTime, time);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, mesh.vertices);
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, mesh.indices);

    this.gl.enableVertexAttribArray(this.programDistort.aPosition);
    this.gl.vertexAttribPointer(this.programDistort.aPosition, 2, this.gl.FLOAT, false, 8, 0);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, background);
    this.gl.activeTexture(this.gl.TEXTURE1);
    this.gl.bindTexture(this.gl.TEXTURE_2D, water.getBack().texture);
    this.gl.activeTexture(this.gl.TEXTURE2);
    this.gl.bindTexture(this.gl.TEXTURE_2D, water.getFront().texture);

    this.gl.drawElements(this.gl.TRIANGLES, mesh.indexCount, this.gl.UNSIGNED_SHORT, 0);
};

/**
 * Free all resources maintained by this object
 */
Waves.prototype.free = function() {
    this.programDistort.free();
    this.programPropagate.free();
};