/* Utilitários 3D compartilhados (Three.js r128). */
(function () {
  'use strict';
  const K = {};

  K.mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.05 }, o || {}));
  K.box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  K.cyl = (rt, rb, h, m, seg) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 24), m);
  K.sph = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), m);
  K.at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };
  K.shadow = (obj, cast, recv) => { obj.traverse(o => { if (o.isMesh) { o.castShadow = cast !== false; o.receiveShadow = !!recv; } }); return obj; };

  // Textura de canvas com função de desenho
  K.canvasTex = (w, h, draw) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw(g, w, h);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  };

  // Brilho radial (sprite aditivo) para LEDs e lâmpadas
  let glowTex = null;
  K.glowTexture = () => {
    if (glowTex) return glowTex;
    glowTex = K.canvasTex(128, 128, (g) => {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)');
      gr.addColorStop(0.6, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    });
    return glowTex;
  };
  K.glow = (color, size) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTexture(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    s.scale.set(size, size, 1); s.userData.base = size; s.raycast = () => {}; return s;
  };

  // Rótulo de texto como sprite
  K.label = (text, opts) => {
    const o = Object.assign({ size: 1, color: '#e4eef0', bg: 'rgba(10,19,22,.82)', font: '600 44px "IBM Plex Sans", sans-serif' }, opts || {});
    const tmp = document.createElement('canvas').getContext('2d'); tmp.font = o.font;
    const w = Math.ceil(tmp.measureText(text).width) + 40, h = 72;
    const tex = K.canvasTex(w, h, (g) => {
      g.fillStyle = o.bg; g.beginPath(); if (g.roundRect) g.roundRect(0, 0, w, h, 14); else g.rect(0, 0, w, h); g.fill();
      g.font = o.font; g.fillStyle = o.color; g.textBaseline = 'middle'; g.fillText(text, 20, h / 2 + 2);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(o.size * w / h, o.size, 1); s.raycast = () => {}; return s;
  };

  // Palco: renderizador, cena, câmera, controles e redimensionamento
  K.stage = (host, opts) => {
    const o = Object.assign({ fov: 40, near: 0.1, far: 500, bg: 0x0c171b }, opts || {});
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(o.bg);
    const camera = new THREE.PerspectiveCamera(o.fov, 1, o.near, o.far);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    const st = { renderer, scene, camera, controls, host: null };
    st.mount = (h) => {
      if (st.host === h) return; st.host = h; h.appendChild(renderer.domElement); st.resize();
    };
    st.resize = () => {
      if (!st.host) return;
      const w = st.host.clientWidth || 1, hh = st.host.clientHeight || 1;
      renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.updateProjectionMatrix();
    };
    if (window.ResizeObserver) new ResizeObserver(() => st.resize()).observe(document.body);
    window.addEventListener('resize', st.resize);
    if (host) st.mount(host);

    // seleção por raio: devolve o primeiro ancestral com userData.part
    const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
    st.pick = (ev, roots) => {
      const r = renderer.domElement.getBoundingClientRect();
      v2.x = ((ev.clientX - r.left) / r.width) * 2 - 1; v2.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(v2, camera);
      const hits = ray.intersectObjects(roots, true);
      for (const h of hits) {
        let ob = h.object;
        while (ob && !(ob.userData && ob.userData.part)) ob = ob.parent;
        if (ob && ob.visible !== false) return { obj: ob, id: ob.userData.part, point: h.point };
      }
      return null;
    };
    return st;
  };

  // Posiciona a dica (tooltip) perto do cursor sem sair da área
  K.placeTip = (tip, host, ev) => {
    const r = host.getBoundingClientRect();
    let x = ev.clientX - r.left + 16, y = ev.clientY - r.top + 16;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > r.width - 8) x = ev.clientX - r.left - tw - 16;
    if (y + th > r.height - 8) y = Math.max(8, r.height - th - 8);
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = y + 'px';
  };

  window.K3 = K;
})();
