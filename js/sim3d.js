/* =====================================================================
 * Simulação 3D aplicada: (1) travessia de pedestres com cancela,
 * (2) cancela de estacionamento com o código original do vídeo.
 * Unidade da cena: 1 = 1 metro.
 * ===================================================================== */
(function () {
  'use strict';
  const K = window.K3;
  const SIM = {};
  let st, rootT, rootE, app = 'travessia', pickT = [], pickE = [];
  let night = false, autoRotate = false;
  const hooks = { pressButton: () => {}, warn: () => {} };
  const W = {
    cars: [], peds: [], trafficOn: true, autoPeds: true, nextSpawn: { A: 2, B: 4 }, nextPed: 3,
    eCars: [], eAuto: true, eNext: 2, lights: {}, lamps: [], dayObjs: {}
  };
  const LANES = { A: { z: 1.75, dir: 1 }, B: { z: -1.75, dir: -1 } };
  const STOP_S = -4.9, CAR_HALF = 2.1, ZONE = { x: 2.3, z: 3.5 };
  const CAR_COLORS = [0xd6dde2, 0x2b2f36, 0xb3282d, 0x2457a6, 0x8a9199, 0xe8c547, 0x2f6b4f, 0xf2f2f2, 0x5a2d82];
  const SHIRT = [0xe46a4b, 0x3f8fd8, 0x4bbf7a, 0xe0b23c, 0x9a6bd8, 0xd8d8d8, 0x2c3e50, 0xd85a8c];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];

  function tag(obj, id, list, ref) { obj.userData.part = id; if (ref) obj.userData.ref = ref; list.push(obj); return obj; }

  /* ===================== CENÁRIO DA TRAVESSIA ===================== */
  function buildStreet() {
    const g = rootT;
    const asphalt = K.mat(0x2a2f33, { roughness: 0.95 });
    const road = K.box(140, 0.05, 7, asphalt); road.position.y = 0.0; road.receiveShadow = true; g.add(road);
    const walkM = K.mat(0x8d9296, { roughness: 0.9 });
    for (const s of [1, -1]) {
      const sw = K.box(140, 0.16, 4.5, walkM); sw.position.set(0, 0.08, s * 5.75); sw.receiveShadow = true; g.add(sw);
      const curb = K.box(140, 0.18, 0.18, K.mat(0xb9bdc0)); curb.position.set(0, 0.09, s * 3.55); g.add(curb);
      const grass = K.box(140, 0.1, 30, K.mat(0x22382b, { roughness: 1 })); grass.position.set(0, 0.03, s * 23); grass.receiveShadow = true; g.add(grass);
    }
    const white = K.mat(0xeeeeee, { roughness: 0.7 });
    // faixa de pedestres (zebra) — tag para hover
    const zebra = new THREE.Group();
    for (let i = 0; i < 7; i++) { const b = K.box(4, 0.02, 0.5, white); b.position.set(0, 0.035, -3 + i * 1.0); b.receiveShadow = true; zebra.add(b); }
    g.add(tag(zebra, 'faixa', pickT));
    // linhas de retenção e eixo
    const sl1 = K.box(0.4, 0.02, 3.4, white); sl1.position.set(-5.3, 0.035, 1.75); g.add(sl1);
    const sl2 = K.box(0.4, 0.02, 3.4, white); sl2.position.set(5.3, 0.035, -1.75); g.add(sl2);
    const yel = K.mat(0xe0b020);
    for (let x = -68; x < 68; x += 4) { if (Math.abs(x) < 6) continue; const d = K.box(2, 0.02, 0.12, yel); d.position.set(x + 1, 0.035, 0); g.add(d); }
    // prédios ao fundo
    const bm = [0x34424a, 0x3b4a52, 0x2e3a41, 0x46555c];
    for (let i = -6; i <= 6; i++) {
      for (const s of [1, -1]) {
        const h = rnd(6, 18), w = rnd(6, 9), d = rnd(6, 9);
        const b = K.box(w, h, d, K.mat(pickOne(bm), { roughness: 0.9 }));
        b.position.set(i * 11 + rnd(-1, 1), h / 2, s * (17 + d / 2)); b.castShadow = true; b.receiveShadow = true; g.add(b);
        // janelas (acendem à noite)
        const wm = new THREE.MeshStandardMaterial({ color: 0x1a2328, emissive: 0xffd28a, emissiveIntensity: 0 });
        const win = K.box(w * 0.8, h * 0.7, 0.05, wm); win.position.set(b.position.x, h * 0.5, s * 17 - s * 0.03); g.add(win);
        W.lamps.push({ windows: wm });
      }
    }
    // árvores
    for (let x = -50; x <= 50; x += 12) {
      for (const s of [1, -1]) {
        if (Math.abs(x) < 9) continue;
        const t = new THREE.Group();
        const tr = K.cyl(0.15, 0.2, 2, K.mat(0x5a4030)); tr.position.y = 1; t.add(tr);
        const cr = K.sph(1.3, K.mat(0x2f6b3f, { roughness: 0.9 })); cr.position.y = 2.8; cr.scale.y = 1.2; t.add(cr);
        t.position.set(x + rnd(-1, 1), 0.16, s * 7.2); K.shadow(t); g.add(t);
      }
    }
    // postes de iluminação
    for (const p of [[-12, 7.3, -1], [12, -7.3, 1]]) {
      const pole = new THREE.Group();
      const m = K.cyl(0.08, 0.1, 7, K.mat(0x4b5359)); m.position.y = 3.5; pole.add(m);
      const arm = K.box(2.2, 0.08, 0.08, K.mat(0x4b5359)); arm.position.set(0, 7, 0); arm.rotation.y = Math.PI / 2; pole.add(arm);
      const headM = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffe2a8, emissiveIntensity: 0 });
      const head = K.box(0.5, 0.15, 0.25, headM); head.position.set(0, 6.9, p[2] * 1.0); pole.add(head);
      const light = new THREE.PointLight(0xffd9a0, 0, 22, 1.6); light.position.set(0, 6.6, p[2] * 1.0); pole.add(light);
      pole.position.set(p[0], 0.16, p[1]); K.shadow(pole); g.add(pole);
      W.lamps.push({ headM, light });
    }
  }

  function lampMat(color) { return new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: color, emissiveIntensity: 0, roughness: 0.3 }); }
  function iconTex(kind, color) {
    return K.canvasTex(128, 128, (c) => {
      c.fillStyle = '#0b0d0e'; c.fillRect(0, 0, 128, 128); c.fillStyle = color; c.strokeStyle = color; c.lineCap = 'round';
      c.beginPath(); c.arc(64, 26, 11, 0, Math.PI * 2); c.fill(); c.lineWidth = 14;
      if (kind === 'stop') { c.beginPath(); c.moveTo(64, 44); c.lineTo(64, 84); c.moveTo(64, 84); c.lineTo(52, 118); c.moveTo(64, 84); c.lineTo(76, 118); c.moveTo(44, 50); c.lineTo(44, 80); c.moveTo(84, 50); c.lineTo(84, 80); c.stroke(); }
      else { c.beginPath(); c.moveTo(62, 44); c.lineTo(58, 82); c.lineTo(40, 116); c.moveTo(58, 82); c.lineTo(82, 112); c.moveTo(60, 54); c.lineTo(84, 72); c.moveTo(60, 54); c.lineTo(40, 76); c.stroke(); }
    });
  }

  function buildSignals() {
    const g = rootT;
    const poleM = K.mat(0x3d454b, { metalness: 0.4, roughness: 0.5 });
    const headM = K.mat(0x15181a, { roughness: 0.6 });
    // semáforos dos veículos
    const mkCar = (x, z, faceX, key) => {
      const s = new THREE.Group();
      const pole = K.cyl(0.08, 0.09, 3.0, poleM); pole.position.y = 1.5; s.add(pole);
      const head = K.box(0.4, 1.1, 0.4, headM); head.position.y = 3.3; s.add(head);
      const visor = K.box(0.02, 1.05, 0.44, K.mat(0x0c0d0e)); visor.position.set(faceX * 0.21, 3.3, 0); s.add(visor);
      const L = {};
      [['r', 0xff2a2a, 3.65], ['y', 0xffb000, 3.3], ['g', 0x2aff6a, 2.95]].forEach(([k, c, y]) => {
        const m = lampMat(c); const l = K.sph(0.12, m); l.position.set(faceX * 0.22, y, 0); s.add(l);
        const gl = K.glow(c, 1.4); gl.position.set(faceX * 0.32, y, 0); s.add(gl);
        L[k] = { m, gl };
      });
      s.position.set(x, 0.16, z); K.shadow(s); g.add(tag(s, 'semaforoVeic', pickT));
      W.lights[key] = L;
    };
    mkCar(-6.0, 4.0, -1, 'carA'); mkCar(6.0, -4.0, 1, 'carB');
    // semáforos de pedestre (com botão)
    const mkPed = (x, z, faceZ, key) => {
      const s = new THREE.Group();
      const pole = K.cyl(0.07, 0.08, 2.6, poleM); pole.position.y = 1.3; s.add(pole);
      const head = K.box(0.38, 0.78, 0.3, headM); head.position.y = 2.75; s.add(head);
      const L = {};
      [['r', 0xff2a2a, 2.95, 'stop'], ['g', 0x2aff6a, 2.55, 'walk']].forEach(([k, c, y, ic]) => {
        const m = new THREE.MeshStandardMaterial({ map: iconTex(ic, '#3a4044'), emissive: c, emissiveIntensity: 0, emissiveMap: iconTex(ic, '#ffffff'), color: 0xffffff });
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), m);
        p.position.set(0, y, faceZ * 0.16); if (faceZ < 0) p.rotation.y = Math.PI; s.add(p);
        const gl = K.glow(c, 1.2); gl.position.set(0, y, faceZ * 0.3); s.add(gl);
        L[k] = { m, gl };
      });
      s.position.set(x, 0.16, z); K.shadow(s); g.add(tag(s, 'semaforoPed', pickT));
      W.lights[key] = L;
      // caixa do botão no próprio poste, virada para quem espera deste lado
      const bx = new THREE.Group();
      const box = K.box(0.22, 0.32, 0.14, K.mat(0xf0c020, { roughness: 0.5 })); bx.add(box);
      const btnM = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xff6a00, emissiveIntensity: 0 });
      const b = K.cyl(0.05, 0.05, 0.04, btnM); b.rotation.x = Math.PI / 2; b.position.z = -faceZ * 0.08; bx.add(b);
      bx.position.set(x, 1.25, z - faceZ * 0.1); K.shadow(bx); g.add(tag(bx, 'botao', pickT));
      W.lights[key].btn = btnM;
    };
    mkPed(2.5, -4.0, 1, 'pedS');   // visto por quem está no lado +z
    mkPed(-2.5, 4.0, -1, 'pedN');  // visto por quem está no lado −z

    // cancelas (um servo por faixa, mesmo sinal D9)
    const mkBarrier = (x, z, rotY, key) => {
      const s = new THREE.Group();
      const house = K.box(0.45, 1.0, 0.45, K.mat(0xf0c020, { roughness: 0.5 })); house.position.y = 0.5; s.add(house);
      const stripe = K.box(0.47, 0.12, 0.47, K.mat(0x111111)); stripe.position.y = 0.75; s.add(stripe);
      const yaw = new THREE.Group(); yaw.position.y = 0.95; yaw.rotation.y = rotY; s.add(yaw);
      const pivot = new THREE.Group(); pivot.position.x = 0.0; yaw.add(pivot);
      const tex = K.canvasTex(512, 32, (c) => { for (let i = 0; i < 10; i++) { c.fillStyle = i % 2 ? '#f6f6f6' : '#d63030'; c.fillRect(i * 51.2, 0, 51.2, 32); } });
      const arm = K.box(3.4, 0.1, 0.08, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 })); arm.position.x = 1.85; pivot.add(arm);
      const tipM = lampMat(0xff2a2a); const tip = K.sph(0.06, tipM); tip.position.x = 3.5; pivot.add(tip);
      pivot.rotation.z = Math.PI / 2;
      s.position.set(x, 0.16, z); K.shadow(s); g.add(tag(s, 'cancela', pickT));
      W.lights[key] = { pivot, tipM };
    };
    mkBarrier(-4.6, 3.75, Math.PI / 2, 'barA');
    mkBarrier(4.6, -3.75, -Math.PI / 2, 'barB');

    // pórtico com o HC-SR04 a 3,5 m, olhando para baixo
    const gan = new THREE.Group();
    const p1 = K.cyl(0.1, 0.12, 4.0, poleM); p1.position.set(0, 2.0, -4.7); gan.add(p1);
    const arm = K.box(0.12, 0.12, 4.8, poleM); arm.position.set(0, 3.95, -2.35); gan.add(arm);
    g.add(gan);
    const sens = new THREE.Group();
    const pcb = K.box(0.45, 0.04, 0.2, K.mat(0x1f5fae)); sens.add(pcb);
    for (const sx of [-0.13, 0.13]) { const t = K.cyl(0.08, 0.08, 0.12, K.mat(0xd2d6da, { metalness: 0.85, roughness: 0.3 })); t.position.set(sx, -0.08, 0); sens.add(t); }
    const hous = K.box(0.55, 0.2, 0.3, new THREE.MeshStandardMaterial({ color: 0x9aa4aa, transparent: true, opacity: 0.35 })); hous.position.y = 0.06; sens.add(hous);
    sens.position.set(0, 3.5, 0); K.shadow(sens); g.add(tag(sens, 'sensor', pickT));
    // cone de detecção (visual)
    const coneM = new THREE.MeshBasicMaterial({ color: 0x6fd6d2, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 3.45, 48, 1, true), coneM);
    cone.position.set(0, 3.45 / 2 + 0.03, 0); cone.scale.set(ZONE.x, 1, ZONE.z); cone.raycast = () => {}; g.add(cone);
    const footM = new THREE.MeshBasicMaterial({ color: 0x6fd6d2, transparent: true, opacity: 0.12, depthWrite: false });
    const foot = new THREE.Mesh(new THREE.CircleGeometry(1, 48), footM); foot.rotation.x = -Math.PI / 2; foot.position.y = 0.05; foot.scale.set(ZONE.x, ZONE.z, 1); foot.raycast = () => {}; g.add(foot);
    W.lights.cone = { coneM, footM };

    // gabinete do controlador (Arduino)
    const cab = new THREE.Group();
    const cb = K.box(0.7, 1.2, 0.45, K.mat(0x8d969c, { metalness: 0.5, roughness: 0.4 })); cb.position.y = 0.6 + 0.16; cab.add(cb);
    const ledM = new THREE.MeshStandardMaterial({ color: 0x113311, emissive: 0x30ff70, emissiveIntensity: 2 });
    const led = K.box(0.06, 0.06, 0.02, ledM); led.position.set(0.2, 1.15 + 0.16, 0.235); cab.add(led);
    const plate = K.label('ARDUINO · FreeRTOS', { size: 0.13, bg: 'rgba(0,0,0,.6)', font: '600 40px "JetBrains Mono", monospace' }); plate.position.set(0, 1.0 + 0.16, 0.3); cab.add(plate);
    cab.position.set(-1.8, 0, -5.2); K.shadow(cab); g.add(tag(cab, 'controlador', pickT));
    W.lights.cabLed = ledM;
  }

  /* ---------- carros ---------- */
  function makeCar(color, long) {
    const g = new THREE.Group();
    const bodyM = K.mat(color, { metalness: 0.35, roughness: 0.35 });
    if (long) {
      const cab = K.box(2.3, 1.9, 2.2, K.mat(0xe0e4e8, { roughness: 0.4 })); cab.position.set(3.4, 1.35, 0); g.add(cab);
      const glass = K.box(0.05, 0.7, 1.9, K.mat(0x1d2a33, { metalness: 0.6, roughness: 0.15 })); glass.position.set(4.56, 1.75, 0); g.add(glass);
      const tr = K.box(5.6, 2.4, 2.3, K.mat(color, { roughness: 0.5 })); tr.position.set(-2.2, 1.6, 0); g.add(tr);
      const chassis = K.box(9.0, 0.3, 1.2, K.mat(0x222222)); chassis.position.set(0.2, 0.45, 0); g.add(chassis);
      for (const x of [3.6, 1.0, -3.6, -4.4]) for (const z of [-1.0, 1.0]) { const w = K.cyl(0.42, 0.42, 0.3, K.mat(0x151515), 16); w.rotation.x = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w); }
      g.userData.len = 9.4; g.userData.gap = [0.6, 2.25];   // intervalo entre cabine e baú (sensor "vê" através)
    } else {
      const body = K.box(4.2, 0.7, 1.8, bodyM); body.position.y = 0.6; g.add(body);
      const cabin = K.box(2.2, 0.6, 1.6, K.mat(0x1d2a33, { metalness: 0.6, roughness: 0.15 })); cabin.position.set(-0.2, 1.22, 0); g.add(cabin);
      const roof = K.box(1.9, 0.06, 1.55, bodyM); roof.position.set(-0.25, 1.55, 0); g.add(roof);
      for (const x of [1.35, -1.35]) for (const z of [-0.85, 0.85]) { const w = K.cyl(0.33, 0.33, 0.24, K.mat(0x151515), 16); w.rotation.x = Math.PI / 2; w.position.set(x, 0.33, z); g.add(w); }
      g.userData.len = 4.2;
    }
    const L = g.userData.len / 2;
    const hlM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 0.2 });
    const tlM = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2020, emissiveIntensity: 0.3 });
    const glows = [];
    for (const z of [-0.6, 0.6]) {
      const hl = K.box(0.05, 0.15, 0.35, hlM); hl.position.set(L + 0.02, 0.7, z); g.add(hl);
      const tl = K.box(0.05, 0.15, 0.35, tlM); tl.position.set(-L - 0.02, 0.7, z); g.add(tl);
      const gl = K.glow(0xfff2c8, 2.2); gl.position.set(L + 0.3, 0.7, z); g.add(gl); glows.push(gl);
    }
    g.userData.hl = glows; g.userData.tlM = tlM;
    K.shadow(g);
    return g;
  }

  function spawnCar(lane) {
    const ln = LANES[lane];
    const list = W.cars.filter(c => c.lane === lane);
    const last = list.reduce((m, c) => (c.s < m.s ? c : m), { s: 999 });
    if (last.s < -45) return;
    const mesh = makeCar(pickOne(CAR_COLORS));
    const car = { lane, s: -60, v: rnd(8, 11), vmax: rnd(9, 12.5), mesh, len: 4.2, why: 'trafegando', id: Math.random() };
    mesh.position.set(car.s * ln.dir, 0, ln.z); mesh.rotation.y = ln.dir > 0 ? 0 : Math.PI;
    rootT.add(tag(mesh, 'carro', pickT, car)); W.cars.push(car);
  }

  /* ---------- pedestres ---------- */
  function makePerson(kind) {
    const g = new THREE.Group();
    const shirt = K.mat(kind === 'idoso' ? 0x8a7a6a : pickOne(SHIRT), { roughness: 0.8 });
    const pants = K.mat(pickOne([0x2b3440, 0x3c3c3c, 0x51483c, 0x1f3550]), { roughness: 0.9 });
    const skin = K.mat(pickOne([0xf1c7a5, 0xd9a47c, 0xa8724c, 0x6e4a32]), { roughness: 0.8 });
    const legs = [];
    for (const z of [-0.09, 0.09]) { const lp = new THREE.Group(); lp.position.set(0, 0.85, z); const l = K.box(0.13, 0.85, 0.13, pants); l.position.y = -0.42; lp.add(l); g.add(lp); legs.push(lp); }
    const torso = K.box(0.26, 0.6, 0.4, shirt); torso.position.y = 1.15; g.add(torso);
    const head = K.sph(0.13, skin); head.position.y = 1.6; g.add(head);
    if (kind === 'idoso') {
      const hair = K.sph(0.135, K.mat(0xdddddd)); hair.position.set(-0.02, 1.64, 0); hair.scale.set(1, 0.6, 1); g.add(hair);
      const cane = K.cyl(0.015, 0.015, 0.95, K.mat(0x4a3020)); cane.position.set(0.25, 0.48, 0.25); g.add(cane);
    }
    g.userData.legs = legs; K.shadow(g);
    return g;
  }
  function spawnPed(kind) {
    kind = kind || 'normal';
    const side = Math.random() < 0.5 ? 1 : -1;
    const from = Math.random() < 0.5 ? -1 : 1;
    const mesh = makePerson(kind);
    const p = {
      kind, side, x: from * rnd(16, 26), z: side * rnd(4.6, 6.0), mesh, phase: 'chegando',
      speed: kind === 'idoso' ? 0.55 : rnd(1.15, 1.5), walkSpeed: kind === 'idoso' ? 0.6 : 1.3,
      waitX: rnd(-1.4, 1.4), anim: Math.random() * 6, pressed: false, waitedSince: 0, stopT: kind === 'parado' ? 22 : 0, id: Math.random()
    };
    if (kind !== 'normal') { p.x = from * rnd(4, 6); }
    mesh.position.set(p.x, 0.16, p.z);
    rootT.add(tag(mesh, 'pedestre', pickT, p)); W.peds.push(p);
    return p;
  }
  SIM.spawnPed = spawnPed;

  function onRoad(p) { return Math.abs(p.z) < 3.55 && Math.abs(p.x) < 3; }
  function inZone(p) { return Math.abs(p.x) <= ZONE.x && Math.abs(p.z) <= ZONE.z; }

  /* ===================== CENÁRIO DO ESTACIONAMENTO ===================== */
  const E = { sensorX: -0.8, laneZ: 0, gateX: 0, armAng: 0, pivot: null, warnT: 0 };
  function buildParking() {
    const g = rootE;
    const asphalt = K.mat(0x2b3034, { roughness: 0.95 });
    const lane = K.box(90, 0.05, 3.4, asphalt); g.add(lane); lane.receiveShadow = true;
    const lot = K.box(40, 0.05, 30, K.mat(0x30363a, { roughness: 0.95 })); lot.position.set(25, 0, 0); lot.receiveShadow = true; g.add(lot);
    const white = K.mat(0xe8e8e8);
    for (let i = 0; i < 8; i++) for (const s of [1, -1]) { const l = K.box(0.1, 0.02, 5, white); l.position.set(10 + i * 3, 0.03, s * 9); g.add(l); }
    const ground = K.box(120, 0.04, 80, K.mat(0x22382b, { roughness: 1 })); ground.position.set(0, -0.03, 0); ground.receiveShadow = true; g.add(ground);
    for (const s of [1, -1]) { const c = K.box(40, 0.2, 0.25, K.mat(0xb9bdc0)); c.position.set(-25, 0.1, s * 1.85); g.add(c); }
    // ilha da cancela e cabine
    const isl = K.box(4, 0.2, 1.4, K.mat(0x9aa0a4)); isl.position.set(0, 0.1, -2.6); g.add(isl);
    const booth = new THREE.Group();
    const bb = K.box(1.6, 2.4, 1.2, K.mat(0xdfe3e6, { roughness: 0.5 })); bb.position.y = 1.4; booth.add(bb);
    const bw = K.box(1.5, 0.8, 0.04, K.mat(0x1d2a33, { metalness: 0.6, roughness: 0.15 })); bw.position.set(0, 1.8, 0.61); booth.add(bw);
    const sign = K.label('ESTACIONAMENTO', { size: 0.35, bg: 'rgba(25,167,169,.95)', color: '#031314', font: '700 44px "Barlow Condensed", sans-serif' }); sign.position.set(0, 2.95, 0); booth.add(sign);
    booth.position.set(1.4, 0, -3.0); K.shadow(booth); g.add(tag(booth, 'cabine', pickE));
    // cancela (servo 0° = fechada, 90° = aberta, como no vídeo)
    const bar = new THREE.Group();
    const house = K.box(0.45, 1.0, 0.45, K.mat(0xf0c020, { roughness: 0.5 })); house.position.y = 0.7; bar.add(house);
    const yaw = new THREE.Group(); yaw.position.y = 1.15; yaw.rotation.y = -Math.PI / 2; bar.add(yaw);
    const pivot = new THREE.Group(); yaw.add(pivot);
    const tex = K.canvasTex(512, 32, (c) => { for (let i = 0; i < 10; i++) { c.fillStyle = i % 2 ? '#f6f6f6' : '#d63030'; c.fillRect(i * 51.2, 0, 51.2, 32); } });
    const arm = K.box(3.4, 0.1, 0.08, new THREE.MeshStandardMaterial({ map: tex })); arm.position.x = 1.85; pivot.add(arm);
    bar.position.set(E.gateX, 0.0, -2.2); K.shadow(bar); g.add(tag(bar, 'cancelaEst', pickE)); E.pivot = pivot;
    // poste do sensor no lado oposto, na altura do para-choque
    const sp = new THREE.Group();
    const post = K.cyl(0.06, 0.06, 0.9, K.mat(0x3d454b)); post.position.y = 0.45; sp.add(post);
    const hc = K.box(0.2, 0.1, 0.45, K.mat(0x1f5fae)); hc.position.set(0, 0.55, -0.08); sp.add(hc);
    for (const z of [-0.13, 0.13]) { const t = K.cyl(0.08, 0.08, 0.1, K.mat(0xd2d6da, { metalness: 0.8 })); t.rotation.x = Math.PI / 2; t.position.set(0, 0.55, z * 1 - 0.16); sp.add(t); }
    sp.position.set(E.sensorX, 0.1, 2.0); K.shadow(sp); g.add(tag(sp, 'sensorEst', pickE));
    const beamM = new THREE.MeshBasicMaterial({ color: 0x6fd6d2, transparent: true, opacity: 0.25, depthWrite: false });
    const beam = K.box(0.04, 0.04, 1, beamM); beam.position.set(E.sensorX, 0.65, 0); beam.raycast = () => {}; g.add(beam);
    E.beam = beam; E.beamM = beamM;
    // controlador do vídeo
    const ctrl = new THREE.Group();
    const cb = K.box(0.5, 0.7, 0.35, K.mat(0x8d969c, { metalness: 0.5 })); cb.position.y = 0.55; ctrl.add(cb);
    ctrl.position.set(-1.6, 0.1, -2.6); K.shadow(ctrl); g.add(tag(ctrl, 'controladorEst', pickE));
  }

  function spawnECar(long) {
    const last = W.eCars.reduce((m, c) => (c.x < m.x ? c : m), { x: 999 });
    if (last.x < -30) return;
    const mesh = makeCar(long ? 0x2457a6 : pickOne(CAR_COLORS), long);
    const len = mesh.userData.len;
    const car = { x: -45, v: long ? 6 : 8, vmax: long ? 6 : 8.5, mesh, len, long, why: 'chegando', id: Math.random() };
    mesh.position.set(car.x, 0, 0); rootE.add(tag(mesh, 'carroEst', pickE, car)); W.eCars.push(car);
  }

  /* ===================== API ===================== */
  SIM.init = function () {
    st = K.stage(null, { fov: 42, bg: 0x9fb8c6, far: 600 });
    const { scene, camera, controls } = st;
    scene.fog = new THREE.Fog(0x9fb8c6, 60, 180);
    camera.position.set(-15, 12, 17); controls.target.set(0, 1, 0); controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 5; controls.maxDistance = 80; controls.update();
    const hemi = new THREE.HemisphereLight(0xdfefff, 0x3a4a3a, 0.75); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.1); sun.position.set(-20, 35, 15); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, far: 120 }); scene.add(sun);
    W.dayObjs = { hemi, sun };
    rootT = new THREE.Group(); rootE = new THREE.Group(); scene.add(rootT); scene.add(rootE);
    buildStreet(); buildSignals(); buildParking();
    rootE.visible = false;
    for (let i = 0; i < 3; i++) { spawnCar('A'); W.cars[W.cars.length - 1].s = -40 + i * 14; }
    spawnCar('B');
    return st;
  };
  SIM.mount = (host) => st.mount(host);
  SIM.hooks = hooks;
  SIM.setApp = function (a) {
    app = a; rootT.visible = a === 'travessia'; rootE.visible = a === 'estac';
    if (a === 'estac') { st.camera.position.set(-15, 10, 15); st.controls.target.set(1.5, 0.8, 0); }
    else { st.camera.position.set(-15, 12, 17); st.controls.target.set(0, 1, 0); }
    st.controls.update();
  };
  SIM.app = () => app;
  SIM.setTraffic = v => { W.trafficOn = v; };
  SIM.setAutoPeds = v => { W.autoPeds = v; };
  SIM.setAutoCars = v => { W.eAuto = v; };
  SIM.spawnCarE = () => spawnECar(false);
  SIM.spawnTruck = () => spawnECar(true);
  SIM.setAutoRotate = v => { autoRotate = v; st.controls.autoRotate = v; st.controls.autoRotateSpeed = 0.6; };
  SIM.setNight = function (v) {
    if (night === v) return; night = v;
    const bg = v ? 0x0b1624 : 0x9fb8c6;
    st.scene.background.setHex(bg); st.scene.fog.color.setHex(bg);
    W.dayObjs.hemi.intensity = v ? 0.18 : 0.75; W.dayObjs.sun.intensity = v ? 0.12 : 1.1;
    W.dayObjs.sun.color.setHex(v ? 0x9db4ff : 0xfff3e0);
    W.lamps.forEach(l => { if (l.headM) l.headM.emissiveIntensity = v ? 2 : 0; if (l.light) l.light.intensity = v ? 2.2 : 0; if (l.windows) l.windows.emissiveIntensity = v && Math.random() < 0.6 ? 0.5 : 0; });
    st.renderer.toneMappingExposure = v ? 1.25 : 1.05;
  };

  // Distância que o HC-SR04 do pórtico leria (cm). null = sem eco.
  SIM.distanceTravessia = function () {
    const occ = W.peds.some(p => inZone(p) && p.phase !== 'chegando');
    return (occ ? 180 : 350) + rnd(-1.5, 1.5);
  };
  SIM.zoneCount = () => W.peds.filter(p => inZone(p)).length;
  SIM.distanceEstac = function () {
    for (const c of W.eCars) {
      const front = c.x + c.len / 2, rear = c.x - c.len / 2;
      if (E.sensorX <= front && E.sensorX >= rear) {
        if (c.long && c.mesh.userData.gap) {
          const gp = c.mesh.userData.gap; const lx = E.sensorX - c.x;
          if (lx > gp[0] && lx < gp[1]) continue;   // o feixe passa pelo vão entre cabine e baú
        }
        return 100 + rnd(-2, 2);
      }
    }
    return 380 + rnd(-2, 2);
  };

  /* ---------- passo da simulação ---------- */
  SIM.step = function (dt, fw, fwE) {
    if (app === 'travessia') stepTravessia(dt, fw); else stepEstac(dt, fwE);
  };

  let barrierAng = 0;
  function stepTravessia(dt, fw) {
    const o = fw.out, now = performance.now() / 1000;
    // luzes
    const bf = fw.tempos.brilho / 255;
    for (const k of ['carA', 'carB']) {
      const L = W.lights[k];
      const set = (l, v) => { l.m.emissiveIntensity = v * 3.2; l.gl.material.opacity = v * 0.9; };
      set(L.r, o.carR / 255); set(L.y, o.carY / 255); set(L.g, o.carG / 255);
    }
    for (const k of ['pedS', 'pedN']) {
      const L = W.lights[k];
      L.r.m.emissiveIntensity = o.pedR * 2.2 * (0.45 + 0.55 * bf); L.r.gl.material.opacity = o.pedR * 0.8 * (0.5 + 0.5 * bf);
      L.g.m.emissiveIntensity = o.pedG * 2.2 * (0.45 + 0.55 * bf); L.g.gl.material.opacity = o.pedG * 0.8 * (0.5 + 0.5 * bf);
      L.btn.emissiveIntensity = fw.pedidoPendente ? 1.5 + Math.sin(now * 8) : (fw.btnPedNivel === 0 ? 3 : 0);
    }
    // cancela: alvo do firmware; braço real mais lento que o SG90 (≈ 1,2 s)
    const target = o.servo;
    const stepA = 75 * dt; barrierAng += Math.max(-stepA, Math.min(stepA, target - barrierAng));
    for (const k of ['barA', 'barB']) {
      const B = W.lights[k]; B.pivot.rotation.z = (90 - barrierAng) * Math.PI / 180;
      B.tipM.emissiveIntensity = barrierAng > 5 ? (Math.sin(now * 10) > 0 ? 3 : 0.2) : 0;
    }
    const occ = SIM.zoneCount() > 0;
    W.lights.cone.coneM.opacity = !fw.sensorOk ? 0.02 : occ ? 0.16 : 0.07;
    W.lights.cone.footM.opacity = !fw.sensorOk ? 0.03 : occ ? 0.28 : 0.12;
    W.lights.cone.coneM.color.setHex(!fw.sensorOk ? 0xef4f4f : occ ? 0xf3b324 : 0x6fd6d2);
    W.lights.cone.footM.color.copy(W.lights.cone.coneM.color);
    W.lights.cabLed.emissive.setHex(fw.sensorOk ? 0x30ff70 : 0xff3030);

    // ---------- carros ----------
    if (W.trafficOn) {
      for (const lane of ['A', 'B']) {
        W.nextSpawn[lane] -= dt;
        if (W.nextSpawn[lane] <= 0) { spawnCar(lane); W.nextSpawn[lane] = night ? rnd(6, 12) : rnd(2.5, 6); }
      }
    }
    const barrierOpen = barrierAng < 12;
    const green = o.carG > 0, yellow = o.carY > 0;
    for (const lane of ['A', 'B']) {
      const ln = LANES[lane];
      const list = W.cars.filter(c => c.lane === lane).sort((a, b) => b.s - a.s);
      list.forEach((c, i) => {
        const front = c.s + CAR_HALF;
        let obst = 1e9; c.why = 'trafegando';
        if (i > 0) { const lead = list[i - 1]; const d = lead.s - CAR_HALF - 1.8; if (d < obst) { obst = d; c.why = 'seguindo o carro da frente'; } }
        if (front < STOP_S + 0.05) {
          const brakeDist = c.v * c.v / (2 * 4.5);
          const canGo = (green || (yellow && STOP_S - front < brakeDist * 0.7)) && barrierOpen;
          if (!canGo && STOP_S < obst) { obst = STOP_S; c.why = !barrierOpen ? 'parado: cancela abaixada' : yellow ? 'freando no amarelo' : 'parado no vermelho'; }
        }
        // segurança: nunca avança sobre pedestre na faixa
        const pedAhead = W.peds.some(p => onRoad(p) && Math.sign(p.z) === Math.sign(ln.z) && Math.abs(p.z) > 0.1);
        if (pedAhead && front < -2.3 && front > -14) { if (-2.6 < obst) { obst = -2.6; c.why = 'freando: pedestre na faixa'; } }
        const gap = obst - front;
        const vt = gap > 50 ? c.vmax : Math.min(c.vmax, Math.sqrt(Math.max(0, 2 * 4 * (gap - 0.4))));
        if (vt > c.v) c.v = Math.min(vt, c.v + 2.6 * dt); else c.v = Math.max(vt, c.v - 9 * dt);
        if (gap < 0.05) c.v = 0;
        c.s += c.v * dt;
        c.mesh.position.x = c.s * ln.dir;
        const brake = c.v < 0.5 || vt < c.v - 0.2;
        c.mesh.userData.tlM.emissiveIntensity = brake ? 2.5 : (night ? 0.8 : 0.3);
        c.mesh.userData.hl.forEach(gl => { gl.material.opacity = night ? 0.9 : 0; });
      });
    }
    W.cars = W.cars.filter(c => { if (c.s > 62) { rootT.remove(c.mesh); return false; } return true; });

    // ---------- pedestres ----------
    if (W.autoPeds) { W.nextPed -= dt; if (W.nextPed <= 0) { if (W.peds.length < 9) spawnPed('normal'); W.nextPed = night ? rnd(14, 24) : rnd(6, 13); } }
    const pedGreen = fw.estado === 3;
    W.peds.forEach(p => {
      let moving = false, sp = 0;
      if (p.phase === 'chegando') {
        const tx = p.waitX, tz = p.side * 4.05;
        const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
        if (d < 0.08) { p.phase = 'aguardando'; p.waitedSince = fw.t; }
        else { sp = Math.min(p.walkSpeed, d / dt); p.x += dx / d * sp * dt; p.z += dz / d * sp * dt; moving = true; p.mesh.rotation.y = Math.atan2(-dz, dx); }
      } else if (p.phase === 'aguardando') {
        p.mesh.rotation.y = Math.atan2(p.side, 0) ;
        if (!p.pressed && (!fw.pedidoPendente || Math.random() < 0.004)) {
          if (fw.estado === 0 || fw.estado === 4 || fw.estado === 5 || Math.random() < 0.01) { p.pressed = true; p.pressedAt = fw.t; hooks.pressButton(p); }
        }
        if (pedGreen && fw.t - fw.inicioFase < fw.tempos.pedVerde - 2500) { p.phase = 'atravessando'; p.startT = fw.t; }
      } else if (p.phase === 'atravessando') {
        const tz = -p.side * 4.05;
        if (p.kind === 'parado' && p.stopT > 0 && Math.abs(p.z) < 0.6) { p.stopT -= dt; p.mesh.rotation.y += dt * 0.6; }
        else {
          const dz = tz - p.z;
          if (Math.abs(dz) < 0.08) { p.phase = 'saindo'; p.exitDir = Math.random() < 0.5 ? -1 : 1; }
          else { sp = p.speed; p.z += Math.sign(dz) * sp * dt; moving = true; p.mesh.rotation.y = Math.atan2(-Math.sign(dz), 0); }
        }
      } else if (p.phase === 'saindo') {
        const tz = -p.side * 5.3;
        if (Math.abs(p.z - tz) > 0.05) p.z += Math.sign(tz - p.z) * p.walkSpeed * dt;
        p.x += p.exitDir * p.walkSpeed * dt; sp = p.walkSpeed; moving = true;
        p.mesh.rotation.y = Math.atan2(0, p.exitDir) + (p.exitDir < 0 ? 0 : 0);
        p.mesh.rotation.y = p.exitDir > 0 ? 0 : Math.PI;
      }
      p.mesh.position.set(p.x, 0.16, p.z);
      if (moving) { p.anim += dt * sp * 6; const a = Math.sin(p.anim) * 0.5; p.mesh.userData.legs[0].rotation.z = a; p.mesh.userData.legs[1].rotation.z = -a; }
      else { p.mesh.userData.legs[0].rotation.z = 0; p.mesh.userData.legs[1].rotation.z = 0; }
    });
    W.peds = W.peds.filter(p => { if (Math.abs(p.x) > 30) { rootT.remove(p.mesh); return false; } return true; });
  }

  function stepEstac(dt, fw) {
    const now = performance.now() / 1000;
    // braço: 0° fechado, 90° aberto (lógica do vídeo); motor de cancela ≈ 75°/s
    const target = fw.out.servo;
    const s = 75 * dt; E.armAng += Math.max(-s, Math.min(s, target - E.armAng));
    E.pivot.rotation.z = E.armAng * Math.PI / 180;
    const d = SIM.distanceEstac();
    const hit = d < 200;
    E.beam.scale.z = (hit ? 1.0 : 3.8); E.beam.position.z = 2.0 - (hit ? 1.0 : 3.8) / 2;
    E.beamM.color.setHex(!fw.sensorConectado ? 0xef4f4f : hit ? 0xf3b324 : 0x6fd6d2);
    E.beamM.opacity = fw.sensorConectado ? 0.35 : 0.08;
    if (W.eAuto) { W.eNext -= dt; if (W.eNext <= 0) { spawnECar(Math.random() < 0.15); W.eNext = rnd(6, 11); } }
    const list = W.eCars.slice().sort((a, b) => b.x - a.x);
    let under = false;
    list.forEach((c, i) => {
      const front = c.x + c.len / 2;
      let obst = 1e9; c.why = 'chegando';
      if (i > 0) { const lead = list[i - 1]; const dd = lead.x - lead.len / 2 - 1.5; if (dd < obst) { obst = dd; c.why = 'na fila'; } }
      const stopX = E.gateX - 0.45;
      if (front < stopX + 0.05 && E.armAng < 75) { if (stopX < obst) { obst = stopX; c.why = 'aguardando a cancela abrir'; } }
      else if (front >= stopX + 0.05) c.why = 'passando pela cancela';
      const gap = obst - front;
      const vt = gap > 50 ? c.vmax : Math.min(c.vmax, Math.sqrt(Math.max(0, 2 * 3 * (gap - 0.2))));
      if (vt > c.v) c.v = Math.min(vt, c.v + (c.long ? 1.2 : 2.2) * dt); else c.v = Math.max(vt, c.v - 8 * dt);
      if (gap < 0.03) c.v = 0;
      c.x += c.v * dt; c.mesh.position.x = c.x;
      c.mesh.userData.tlM.emissiveIntensity = c.v < 0.4 ? 2.5 : 0.3;
      const rear = c.x - c.len / 2;
      if (rear < E.gateX && front > E.gateX) under = true;
    });
    if (under && fw.out.servo === 0 && E.armAng < 60) {
      if (now - E.warnT > 2) { E.warnT = now; hooks.warn('A cancela desceu sobre o veículo: o sensor não o detectou neste instante.'); }
    }
    W.eCars = W.eCars.filter(c => { if (c.x > 40) { rootE.remove(c.mesh); return false; } return true; });
  }

  /* ---------- seleção e textos ao vivo ---------- */
  SIM.pick = ev => st.pick(ev, app === 'travessia' ? pickT : pickE);
  const NAMES = {
    faixa: 'Faixa de pedestres', semaforoVeic: 'Semáforo dos veículos', semaforoPed: 'Semáforo do pedestre', botao: 'Botão de pedestre',
    cancela: 'Cancela (servo SG90)', sensor: 'Sensor HC-SR04 (pórtico)', controlador: 'Gabinete do controlador', carro: 'Veículo', pedestre: 'Pedestre',
    cabine: 'Cabine do estacionamento', cancelaEst: 'Cancela (servo do vídeo)', sensorEst: 'HC-SR04 do estacionamento', controladorEst: 'Arduino com o código do vídeo', carroEst: 'Veículo'
  };
  SIM.nameOf = id => NAMES[id] || id;

  SIM.live = function (hit, fw, fwE) {
    const id = hit.id, ref = hit.obj.userData.ref;
    const fase = () => '<span class="chip st-' + fw.estado + '">' + fw.nomeEstado + '</span>';
    const rest = () => { const p = fw.phaseInfo(); return p.estado === 0 && !fw.pedidoPendente ? 'aguardando pedido' : 'restam ' + (Math.max(0, p.dur - p.dt) / 1000).toFixed(1) + ' s'; };
    switch (id) {
      case 'semaforoVeic': {
        const cor = fw.out.carG ? 'VERDE (D3)' : fw.out.carY ? 'AMARELO (D5)' : 'VERMELHO (D11)';
        return 'Aceso: <b>' + cor + '</b> com PWM ' + fw.tempos.brilho + '/255' + (fw.modoNoturno ? ' (modo noturno, menos ofuscamento)' : '') + '.<br>Fase ' + fase() + ' · ' + rest() + '.' +
          (fw.estado === 0 ? '<br>Verde há ' + ((fw.t - fw.inicioFase) / 1000).toFixed(1) + ' s; mínimo de ' + fw.tempos.verdeMin / 1000 + ' s antes de atender um pedido.' : '');
      }
      case 'semaforoPed':
        return (fw.out.pedG ? '<b class="t-on">Verde (D13)</b>: pode atravessar, buzzer com bipe lento.' : fw.estado === 4 ? '<b class="t-warn">Vermelho piscando a 2 Hz (D12)</b>: termine a travessia, bipe rápido.' : '<b class="t-err">Vermelho (D12)</b>: aguarde.') +
          '<br>Fase ' + fase() + ' · ' + rest() + '.';
      case 'botao':
        return 'D2 ligado à interrupção INT0. ISR chamada ' + fw.stats.isr + '× (bounce filtrado ' + fw.stats.bounceFiltrado + '×).<br>' +
          (fw.pedidoPendente ? '<b class="t-on">Pedido registrado</b>: a FSM atende assim que o verde mínimo acabar.' : [1, 2, 3].includes(fw.estado) ? 'Travessia em andamento: novos toques são ignorados com segurança.' : 'Sem pedido pendente. A luz laranja acende quando um pedido é registrado.');
      case 'sensor': {
        if (!fw.sensorOk) return '<b class="t-err">Sem eco há ' + fw.falhas + ' leituras.</b> O firmware marcou FALHA: ignora extensões e mantém o ciclo só por tempo.';
        const n = SIM.zoneCount();
        return 'Polling a cada 100 ms. Leitura: <b>' + fw.distanciaCm.toFixed(0) + ' cm</b> (chão ≈ 350 cm, pessoa ≈ 180 cm).<br>' +
          (n ? '<b class="t-warn">' + n + ' pessoa(s) na zona</b>: se o piscante acabar agora, ganha extensão (' + fw.extensoes + '/2 usadas).' : 'Zona livre: nenhuma extensão necessária.');
      }
      case 'cancela':
        return 'Servo no D9 · alvo ' + fw.servoAlvo + '°, braço em ' + Math.round(barrierAng) + '°.<br>' +
          (barrierAng > 80 ? '<b class="t-err">Abaixada</b>: bloqueia os carros durante a travessia.' : barrierAng < 5 ? '<b class="t-on">Levantada</b>: carros liberados.' : '<b class="t-warn">Em movimento</b>: ' + (fw.servoAlvo ? 'descendo no vermelho geral.' : 'subindo na fase LIBERANDO.'));
      case 'controlador': {
        const tk = ['FSM', 'SENS', 'IN', 'SIG', 'LOG'].map(k => (fw.t - fw.taskRuns[k] < 150 ? '<b class="t-on">' + k + '</b>' : k)).join(' · ');
        return 'Arduino Uno + FreeRTOS. Tarefas ativas agora: ' + tk + '.<br>Fase ' + fase() + ' · modo ' + (fw.modoNoturno ? 'NOTURNO' : 'DIURNO') + ' · LED ' + (fw.sensorOk ? '<b class="t-on">verde</b> (sensor ok)' : '<b class="t-err">vermelho</b> (sensor em falha)') + '.';
      }
      case 'faixa':
        return 'Zona monitorada pelo HC-SR04 (área destacada). ' + SIM.zoneCount() + ' pessoa(s) sobre a faixa agora.<br>Pedestres só começam a atravessar no verde; quem chega no piscante espera o próximo ciclo.';
      case 'carro':
        return 'Velocidade: <b>' + (ref.v * 3.6).toFixed(0) + ' km/h</b> · ' + ref.why + '.<br>Obedece ao semáforo e à cancela; também freia se houver pedestre na faixa.';
      case 'pedestre': {
        const k = ref.kind === 'idoso' ? 'Pedestre idoso (0,55 m/s)' : ref.kind === 'parado' ? 'Pessoa que para no meio da faixa' : 'Pedestre (' + ref.speed.toFixed(2) + ' m/s)';
        let s = '';
        if (ref.phase === 'chegando') s = 'Indo para a faixa.';
        else if (ref.phase === 'aguardando') s = 'Aguardando há ' + ((fw.t - ref.waitedSince) / 1000).toFixed(1) + ' s' + (ref.pressed ? '; apertou o botão.' : '; pedido já registrado por outra pessoa.');
        else if (ref.phase === 'atravessando') s = (ref.stopT > 0 && Math.abs(ref.z) < 0.6 ? '<b class="t-warn">Parado na faixa</b>' : 'Atravessando') + ', faltam ' + (Math.abs(-ref.side * 4.05 - ref.z)).toFixed(1) + ' m' + (inZone(ref) ? ' (na zona do sensor)' : '') + '.';
        else s = 'Travessia concluída.';
        return '<b>' + k + '</b><br>' + s;
      }
      case 'cancelaEst':
        return 'Código do vídeo: <code>servo.write(' + fwE.servo + ')</code> → braço em ' + Math.round(E.armAng) + '°.<br>' + (fwE.servo ? '<b class="t-on">Aberta</b>: última leitura menor que ' + fwE.threshold + ' cm.' : '<b>Fechada</b>: nada perto do sensor.');
      case 'sensorEst':
        return fwE.sensorConectado ? 'Feixe na altura do para-choque. Última leitura: <b>' + fwE.distance.toFixed(1) + ' cm</b> (limiar ' + fwE.threshold + ' cm). Atualiza a cada ~0,5 s por causa do <code>delay(500)</code>.' :
          '<b class="t-err">Desconectado.</b> <code>pulseIn()</code> espera 1 s e devolve 0 → 0 cm → a cancela abre sozinha (falha insegura do código original).';
      case 'controladorEst':
        return 'Executa o <code>loop()</code> do vídeo (nº ' + fwE.loops + '). Durante o <code>delay(500)</code> nada é lido: um veículo pode passar entre duas leituras.';
      case 'cabine': return 'Cabine do operador. A cancela é comandada só pelo sensor, sem ticket nem segundo laço.';
      case 'carroEst': return (ref.long ? '<b>Caminhão com baú</b> (vão entre cabine e baú). ' : '') + 'Velocidade ' + (ref.v * 3.6).toFixed(0) + ' km/h · ' + ref.why + '.';
    }
    return '';
  };

  SIM.render = function () { st.controls.update(); st.renderer.render(st.scene, st.camera); };
  SIM.stage = () => st;
  window.Sim3D = SIM;
})();
