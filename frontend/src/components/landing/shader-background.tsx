import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * The hero's living background: a WebGL fragment shader ported from
 * `stitch-ui/shader/code.html`, wrapped so the whole lifecycle — context acquisition, resize,
 * the animation loop, and teardown — belongs to one component (design.md, "WebGL background as
 * a self-contained component with a scripted reduced-motion path").
 *
 * Two behaviours are not optional, per the concept-landing-page spec's "Motion is decorative and
 * interruptible" requirement:
 *
 * 1. Reduced motion is checked in script, before any canvas or animation frame exists — a CSS
 *    media query can zero out a transition's duration, but it cannot stop a running
 *    `requestAnimationFrame` loop. When `usePrefersReducedMotion()` is true, no canvas is even
 *    mounted; only the static gradient underneath ever renders.
 * 2. The loop suspends — not just slows — when the hero is scrolled out of view or the tab is
 *    hidden, via one `IntersectionObserver` and one `visibilitychange` listener. A full-viewport
 *    fragment shader is a real battery cost on a phone; there is no reason to pay it for a tab
 *    the user isn't looking at.
 *
 * A static gradient div sits underneath the canvas unconditionally. It is what renders during
 * reduced motion, before WebGL initializes, and permanently if WebGL is unavailable or the
 * context is lost — so there is never an empty hero, only ever a degraded one.
 *
 * The shader's own colour constants (parchment, signal blue, cerulean) are GLSL literals, not
 * CSS custom properties — WebGL cannot read those — but they were chosen in the reference to
 * match this app's own token values, so the canvas and the surrounding page agree without the
 * two being wired together.
 */
export function ShaderBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [contextFailed, setContextFailed] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const gl = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    if (gl === null) {
      setContextFailed(true);
      return;
    }
    // Narrowed once: `experimental-webgl` types as `RenderingContext`, which lacks the GL
    // methods used below despite being the same object at runtime in the browsers that expose it.
    const context = gl as WebGLRenderingContext;

    const program = createProgram(context);
    if (program === null) {
      setContextFailed(true);
      return;
    }

    context.useProgram(program);
    const positionBuffer = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      context.STATIC_DRAW,
    );
    const positionLocation = context.getAttribLocation(program, "a_position");
    context.enableVertexAttribArray(positionLocation);
    context.vertexAttribPointer(positionLocation, 2, context.FLOAT, false, 0, 0);

    const timeUniform = context.getUniformLocation(program, "u_time");
    const resolutionUniform = context.getUniformLocation(program, "u_resolution");
    const mouseUniform = context.getUniformLocation(program, "u_mouse");

    // Capped rather than the raw `devicePixelRatio`: an uncapped 3x-DPR phone panel triples the
    // fragment count for a background element nobody examines pixel-close.
    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    function syncSize() {
      if (canvas === null) return;
      // Math.ceil, not Math.round: this is a decorative canvas's backing-store size, not a
      // money value (the "no float rounding" lint rule bans Math.round file-wide regardless),
      // and rounding up avoids a thin unfilled seam at the edge that truncating down could leave.
      const width = Math.ceil(canvas.clientWidth * devicePixelRatio) || 1;
      const height = Math.ceil(canvas.clientHeight * devicePixelRatio) || 1;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    syncSize();
    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(canvas);

    const mouse = { x: canvas.width / 2, y: canvas.height / 2 };
    function handleMouseMove(event: MouseEvent) {
      if (canvas === null) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const nx = (event.clientX - rect.left) / rect.width;
      const ny = 1 - (event.clientY - rect.top) / rect.height;
      mouse.x = nx * canvas.width;
      mouse.y = ny * canvas.height;
    }
    window.addEventListener("mousemove", handleMouseMove);

    let running = false;
    let frameId: number | null = null;

    function render(timeMs: number) {
      if (!running || canvas === null) return;
      context.viewport(0, 0, canvas.width, canvas.height);
      if (timeUniform !== null) context.uniform1f(timeUniform, timeMs * 0.001);
      if (resolutionUniform !== null) {
        context.uniform2f(resolutionUniform, canvas.width, canvas.height);
      }
      if (mouseUniform !== null) context.uniform2f(mouseUniform, mouse.x, mouse.y);
      context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
      frameId = window.requestAnimationFrame(render);
    }

    function start() {
      if (running) return;
      running = true;
      frameId = window.requestAnimationFrame(render);
    }

    function stop() {
      running = false;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
    }

    let isIntersecting = false;
    const intersectionObserver = new IntersectionObserver((entries) => {
      isIntersecting = entries[0]?.isIntersecting ?? false;
      if (isIntersecting && document.visibilityState === "visible") start();
      else stop();
    });
    intersectionObserver.observe(canvas);

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") stop();
      else if (isIntersecting) start();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    function handleContextLost(event: Event) {
      event.preventDefault();
      stop();
      setContextFailed(true);
    }
    canvas.addEventListener("webglcontextlost", handleContextLost);

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      // Release owned resources rather than forcing context loss: under StrictMode's
      // dev-only double-invoke (mount -> cleanup -> mount), an explicit
      // WEBGL_lose_context.loseContext() call here would leave the canvas's one-and-only
      // WebGL context permanently lost for the immediately following remount, since a
      // canvas can never get a second context. That made the shader silently fail to
      // (re)compile and fall back to the static gradient in every dev run.
      context.deleteProgram(program);
      context.deleteBuffer(positionBuffer);
    };
  }, [prefersReducedMotion]);

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div
        aria-hidden="true"
        className="from-linen via-parchment to-secondary/40 absolute inset-0 bg-gradient-to-br"
      />
      {!prefersReducedMotion && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className={cn(
            "absolute inset-0 h-full w-full transition-opacity duration-700",
            contextFailed ? "opacity-0" : "opacity-100",
          )}
        />
      )}
    </div>
  );
}

const VERTEX_SHADER = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// Ported verbatim from stitch-ui/shader/code.html. Colour constants match this app's own
// parchment/signal-blue/cerulean tokens; see the component doc comment above.
const FRAGMENT_SHADER = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_texCoord;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,
                      0.366025403784439,
                     -0.577350269189626,
                      0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
        + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 p = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);

    vec2 mouseNorm = (u_mouse.xy / u_resolution.xy) - 0.5;
    p += mouseNorm * 0.15;

    float t = u_time * 0.22;

    float n1 = snoise(p * 1.8 + vec2(t * 0.4, -t * 0.3));
    float n2 = snoise(p * 3.6 - vec2(t * 0.2, t * 0.5) + vec2(n1 * 0.6));
    float n3 = snoise(p * 6.2 + vec2(n2 * 0.4, t * 0.3));

    float contour = sin((p.y * 12.0 + n1 * 3.5 + n2 * 1.8) * 3.14159);
    float lines = smoothstep(0.88, 0.96, abs(contour));

    vec2 gridUV = fract(p * 8.0);
    float grid = (step(0.97, gridUV.x) + step(0.97, gridUV.y)) * 0.06;

    vec3 colParchment = vec3(0.996, 1.0, 0.988);
    vec3 colSignalBlue = vec3(0.255, 0.631, 0.812);
    vec3 colCerulean = vec3(0.02, 0.45, 0.72);
    vec3 colSolarGlow = vec3(0.98, 0.75, 0.42);
    vec3 colDeepSlate = vec3(0.12, 0.14, 0.22);

    float radial = length(p - vec2(0.35, -0.1));
    float aura = exp(-radial * 1.6);

    vec3 bg = colParchment;

    float waveGlow = smoothstep(-0.4, 0.8, n1 + n2 * 0.6);
    bg = mix(bg, colSignalBlue * 1.15, waveGlow * 0.38 * aura);
    bg = mix(bg, colCerulean * 1.25, smoothstep(0.2, 0.9, n2) * 0.42 * aura);

    float solarStream = smoothstep(0.3, 0.8, n3) * smoothstep(-0.2, 0.6, n1);
    bg = mix(bg, colSolarGlow, solarStream * 0.32);

    bg = mix(bg, colDeepSlate, lines * 0.22);
    bg += vec3(grid) * colSignalBlue;

    float edgeVignette = smoothstep(1.3, 0.2, length(uv - 0.5));
    bg = mix(colParchment, bg, edgeVignette);

    gl_FragColor = vec4(bg, 1.0);
}`;

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (vertexShader === null || fragmentShader === null) return null;

  const program = gl.createProgram();
  if (program === null) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}
