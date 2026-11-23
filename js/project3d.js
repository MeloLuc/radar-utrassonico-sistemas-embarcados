/* =====================================================================
 * Bancada 3D (estilo Wokwi): Arduino Uno, protoboard, HC-SR04, servo,
 * LEDs, resistores, botões, buzzer e jumpers, todos clicáveis.
 * Unidade da cena: 1 = 1 cm.
 * ===================================================================== */
(function () {
  'use strict';
  const K = window.K3;
  const P = {};
  let st, root, parts = {}, wires = [], pickables = [], helper = null, selHelper = null;
  const vis = { leds: {}, glows: {}, servoArm: null, servoAng: 0, caps: {}, buzzerRing: null, obstacle: null, obstacleLabel: null, waves: [], boardLeds: {}, echoWire: null };
  let variant = 'completo';

  const A = new THREE.Vector3(-4.5, 0, 0.5);   // centro do Arduino
  const B = new THREE.Vector3(5.2, 0, 0.5);    // centro da protoboard
  const H = new THREE.Vector3(-4.6, 0, -6.6);  // centro do HC-SR04
  const SV = new THREE.Vector3(1.6, 0, -6.4);  // centro do servo
  const BOARD_TOP = 0.46, HEADER_TOP = 1.3, BB_TOP = 0.9;

  /* ---------- pinos do Arduino (coordenadas do mundo) ---------- */
  const PIN = {};
  (function () {
    for (let i = 0; i <= 7; i++) PIN['D' + i] = [3.0 - i * 0.254, -2.42];
    for (let i = 8; i <= 13; i++) PIN['D' + i] = [0.808 - (i - 8) * 0.254, -2.42];
    PIN.GNDT = [0.808 - 6 * 0.254, -2.42];
    ['NC', 'IOREF', 'RESET', '3V3', '5V', 'GND1', 'GND2', 'VIN'].forEach((n, i) => { PIN[n] = [-1.27 + i * 0.254, 2.42]; });
  })();
  const pinPos = (n) => new THREE.Vector3(A.x + PIN[n][0], HEADER_TOP, A.z + PIN[n][1]);
  const bbHole = (lx, lz) => new THREE.Vector3(B.x + lx, BB_TOP + 0.01, B.z + lz);

  function tag(obj, id) { obj.userData.part = id; parts[id] = parts[id] || []; parts[id].push(obj); pickables.push(obj); return obj; }

  /* ---------- Arduino Uno ---------- */
  function buildArduino() {
    const g = new THREE.Group(); g.position.copy(A);
    const pcb = K.mat(0x0b6a8c, { roughness: 0.45 });
    const board = K.box(6.86, 0.16, 5.33, pcb); board.position.y = 0.38; g.add(board);
    const top = K.canvasTex(1372, 1066, (c, w, h) => {
      c.fillStyle = '#0b6a8c'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(120,210,230,.22)'; c.lineWidth = 3;
      for (let i = 0; i < 26; i++) { c.beginPath(); const y = 230 + i * 26; c.moveTo(380, y); c.lineTo(620 + (i % 5) * 40, y); c.lineTo(720 + (i % 7) * 30, y - 60); c.stroke(); }
      c.fillStyle = '#e8f6fa'; c.textBaseline = 'middle';
      c.font = 'bold 150px Arial'; c.fillText('UNO', 820, 470);
      c.font = 'bold 60px Arial'; c.fillText('ARDUINO', 800, 590);
      c.beginPath(); c.lineWidth = 12; c.strokeStyle = '#e8f6fa';
      c.arc(650, 390, 46, 0, Math.PI * 2); c.moveTo(788, 390); c.arc(742, 390, 46, 0, Math.PI * 2); c.stroke();
      c.font = 'bold 34px Arial'; c.fillText('DIGITAL (PWM~)', 560, 105);
      c.font = 'bold 26px Arial';
      for (let i = 0; i <= 13; i++) {
        const p = PIN['D' + i]; const x = (p[0] + 3.43) / 6.86 * w;
        c.save(); c.translate(x, 160); c.rotate(-Math.PI / 2); c.fillText(([3, 5, 6, 9, 10, 11].includes(i) ? '~' : '') + i, 0, 0); c.restore();
      }
      c.save(); c.translate((PIN.GNDT[0] + 3.43) / 6.86 * w, 175); c.rotate(-Math.PI / 2); c.fillText('GND', 0, 0); c.restore();
      ['IOREF', 'RESET', '3.3V', '5V', 'GND', 'GND', 'VIN'].forEach((t, i) => {
        const x = (PIN[['IOREF', 'RESET', '3V3', '5V', 'GND1', 'GND2', 'VIN'][i]][0] + 3.43) / 6.86 * w;
        c.save(); c.translate(x, h - 150); c.rotate(-Math.PI / 2); c.fillText(t, 0, 0); c.restore();
      });
      c.font = 'bold 34px Arial'; c.fillText('POWER', 440, h - 60); c.fillText('ANALOG IN', 880, h - 60);
      c.font = 'bold 26px Arial'; c.fillText('ON', 1180, 360); c.fillText('L', 470, 300); c.fillText('TX', 470, 360); c.fillText('RX', 470, 410);
    });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(6.86, 5.33), new THREE.MeshStandardMaterial({ map: top, roughness: 0.5 }));
    label.rotation.x = -Math.PI / 2; label.position.y = BOARD_TOP + 0.002; g.add(label);
    // cabeçalhos
    const hdr = K.mat(0x111417, { roughness: 0.8 });
    const hd1 = K.box(8 * 0.254, 0.85, 0.26, hdr); hd1.position.set((3.0 + 1.222) / 2, BOARD_TOP + 0.42, -2.42); g.add(hd1);
    const hd2 = K.box(10 * 0.254, 0.85, 0.26, hdr); hd2.position.set((0.808 + -1.478) / 2, BOARD_TOP + 0.42, -2.42); g.add(hd2);
    const hd3 = K.box(8 * 0.254, 0.85, 0.26, hdr); hd3.position.set(-0.381, BOARD_TOP + 0.42, 2.42); g.add(hd3);
    const hd4 = K.box(6 * 0.254, 0.85, 0.26, hdr); hd4.position.set(1.905, BOARD_TOP + 0.42, 2.42); g.add(hd4);
    // furos dos cabeçalhos
    const holeM = K.mat(0x050505);
    Object.keys(PIN).forEach(k => { const p = PIN[k]; const hb = K.box(0.1, 0.02, 0.1, holeM); hb.position.set(p[0], HEADER_TOP + 0.001, p[1]); g.add(hb); });
    // USB-B e jack
    const metal = K.mat(0xc9ced3, { metalness: 0.8, roughness: 0.3 });
    const usb = K.box(1.6, 1.1, 1.2, metal); usb.position.set(-3.1, BOARD_TOP + 0.55, -1.3); g.add(usb);
    const jack = K.box(1.4, 1.1, 0.9, K.mat(0x15171a)); jack.position.set(-3.0, BOARD_TOP + 0.55, 1.6); g.add(jack);
    // ATmega328P (DIP-28)
    const chip = K.box(3.6, 0.35, 0.95, K.mat(0x1a1b1e, { roughness: 0.5 })); chip.position.set(1.2, BOARD_TOP + 0.3, 1.25); g.add(chip);
    for (let i = 0; i < 14; i++) for (const s of [-1, 1]) { const l = K.box(0.08, 0.2, 0.12, metal); l.position.set(-0.45 + i * 0.254, BOARD_TOP + 0.12, 1.25 + s * 0.52); g.add(l); }
    const chipTxt = K.canvasTex(512, 136, (c, w, h) => { c.fillStyle = '#1a1b1e'; c.fillRect(0, 0, w, h); c.fillStyle = '#9aa'; c.font = 'bold 44px Arial'; c.fillText('ATMEGA328P', 70, 80); });
    const ct = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.9), new THREE.MeshBasicMaterial({ map: chipTxt })); ct.rotation.x = -Math.PI / 2; ct.position.set(1.2, BOARD_TOP + 0.48, 1.25); g.add(ct);
    // ATmega16U2, cristal, botão reset, capacitores
    const u2 = K.box(0.7, 0.12, 0.7, K.mat(0x1a1b1e)); u2.position.set(-1.6, BOARD_TOP + 0.06, -1.2); g.add(u2);
    const xt = K.box(0.9, 0.3, 0.35, metal); xt.position.set(-0.6, BOARD_TOP + 0.15, 0.2); g.add(xt);
    const rb = K.box(0.55, 0.3, 0.55, K.mat(0xb8bcc0)); rb.position.set(-2.6, BOARD_TOP + 0.15, -2.3); g.add(rb);
    const rbc = K.cyl(0.16, 0.16, 0.12, K.mat(0xd04a3a)); rbc.position.set(-2.6, BOARD_TOP + 0.36, -2.3); g.add(rbc);
    for (const p of [[-2.2, 0.7], [-1.7, 0.7]]) { const cap = K.cyl(0.3, 0.3, 0.7, K.mat(0x2b2f36)); cap.position.set(p[0], BOARD_TOP + 0.35, p[1]); g.add(cap); }
    // LEDs da placa
    const mkLed = (name, color, x, z) => {
      const m = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: color, emissiveIntensity: 0 });
      const b = K.box(0.18, 0.08, 0.1, m); b.position.set(x, BOARD_TOP + 0.04, z); g.add(b);
      const gl = K.glow(color, 0.9); gl.position.set(x, BOARD_TOP + 0.2, z); g.add(gl);
      vis.boardLeds[name] = { m, gl };
    };
    mkLed('L', 0xffa020, -1.0, -1.25); mkLed('TX', 0xffa020, -1.0, -0.95); mkLed('RX', 0xffa020, -1.0, -0.7); mkLed('ON', 0x30ff70, 2.4, -0.55);
    // apoios
    for (const p of [[-3, -2.2], [3, -2.2], [-3, 2.2], [3, 2.2]]) { const s = K.cyl(0.15, 0.15, 0.3, K.mat(0x99a)); s.position.set(p[0], 0.15, p[1]); g.add(s); }
    K.shadow(g, true, true);
    root.add(tag(g, 'arduino'));

    // cabo USB
    const cg = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(A.x - 4.0, BOARD_TOP + 0.55, A.z - 1.3), new THREE.Vector3(A.x - 6.5, 0.7, A.z - 1.0),
      new THREE.Vector3(A.x - 8.5, 0.35, A.z + 2.5), new THREE.Vector3(A.x - 9.0, 0.3, A.z + 9)]);
    cg.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.22, 10), K.mat(0x22272c, { roughness: 0.7 })));
    const plug = K.box(1.2, 0.95, 1.0, K.mat(0x2a2f35)); plug.position.set(A.x - 4.2, BOARD_TOP + 0.55, A.z - 1.3); cg.add(plug);
    K.shadow(cg); root.add(tag(cg, 'usb'));
  }

  /* ---------- protoboard ---------- */
  const COLS = []; for (let i = 0; i < 30; i++) COLS.push(-3.683 + i * 0.254);
  const ROWS_T = [-1.4, -1.146, -0.892, -0.638, -0.384, 0.384, 0.638, 0.892, 1.146, 1.4];
  const RAILS = [-2.35, -2.096, 2.096, 2.35];
  function buildBreadboard() {
    const g = new THREE.Group(); g.userData.completo = true;
    const tex = K.canvasTex(1640, 1100, (c, w, h) => {
      c.fillStyle = '#eceee8'; c.fillRect(0, 0, w, h);
      const X = x => (x + 4.1) / 8.2 * w, Z = z => (z + 2.75) / 5.5 * h;
      c.fillStyle = '#d6d9d2'; c.fillRect(0, Z(-0.12), w, Z(0.12) - Z(-0.12));
      c.lineWidth = 5;
      c.strokeStyle = '#d64545'; c.beginPath(); c.moveTo(X(-3.8), Z(-2.55)); c.lineTo(X(3.8), Z(-2.55)); c.moveTo(X(-3.8), Z(2.55)); c.lineTo(X(3.8), Z(2.55)); c.stroke();
      c.strokeStyle = '#3d6fd6'; c.beginPath(); c.moveTo(X(-3.8), Z(-1.85)); c.lineTo(X(3.8), Z(-1.85)); c.moveTo(X(-3.8), Z(1.85)); c.lineTo(X(3.8), Z(1.85)); c.stroke();
      c.fillStyle = '#3a3d3a';
      const hs = 0.11 / 8.2 * w;
      COLS.forEach((x, i) => {
        ROWS_T.forEach(z => c.fillRect(X(x) - hs / 2, Z(z) - hs / 2, hs, hs));
        if (i % 6 !== 5) RAILS.forEach(z => c.fillRect(X(x) - hs / 2, Z(z) - hs / 2, hs, hs));
      });
      c.fillStyle = '#8a8d88'; c.font = 'bold 22px Arial';
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].forEach((l, i) => c.fillText(l, X(-4.0), Z(ROWS_T[i]) + 8));
      for (let i = 0; i < 30; i += 5) c.fillText(String(i + 1), X(COLS[i]) - 8, Z(-1.62));
      c.fillStyle = '#d64545'; c.font = 'bold 30px Arial'; c.fillText('+', X(3.9) - 6, Z(-2.35) + 10); c.fillStyle = '#3d6fd6'; c.fillText('−', X(3.9) - 6, Z(-2.096) + 10);
    });
    const body = K.box(8.2, 0.9, 5.5, [K.mat(0xdfe2dc), K.mat(0xdfe2dc), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }), K.mat(0xdfe2dc), K.mat(0xdfe2dc), K.mat(0xdfe2dc)]);
    body.position.set(B.x, 0.45, B.z); g.add(body);
    K.shadow(g, true, true);
    root.add(tag(g, 'protoboard'));
  }

  /* ---------- LEDs, resistores, botões, buzzer ---------- */
  const LED_X = { ledCarR: COLS[4], ledCarY: COLS[8], ledCarG: COLS[12], ledPedR: COLS[18], ledPedG: COLS[22] };
  const LED_COL = { ledCarR: 0xff3030, ledCarY: 0xffb000, ledCarG: 0x30ff60, ledPedR: 0xff3030, ledPedG: 0x30ff60 };
  function buildLed(id) {
    const g = new THREE.Group(); g.userData.completo = true;
    const lx = LED_X[id], c = LED_COL[id];
    const legM = K.mat(0xb8bec4, { metalness: 0.8, roughness: 0.3 });
    // anodo na linha "d" (z=-0.638), catodo na linha "b" (z=-1.146)
    const zA = -0.638, zC = -1.146, zm = (zA + zC) / 2;
    for (const z of [zA, zC]) { const l = K.cyl(0.025, 0.025, 0.45, legM, 6); l.position.set(B.x + lx, BB_TOP + 0.22, B.z + z); g.add(l); }
    const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.05, transparent: true, opacity: 0.88, roughness: 0.25 });
    const rim = K.cyl(0.29, 0.29, 0.08, m); rim.position.set(B.x + lx, BB_TOP + 0.48, B.z + zm); g.add(rim);
    const body = K.cyl(0.25, 0.25, 0.42, m); body.position.set(B.x + lx, BB_TOP + 0.72, B.z + zm); g.add(body);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m); dome.position.set(B.x + lx, BB_TOP + 0.93, B.z + zm); g.add(dome);
    const gl = K.glow(c, 2.6); gl.position.set(B.x + lx, BB_TOP + 0.9, B.z + zm); g.add(gl);
    vis.leds[id] = m; vis.glows[id] = gl;
    K.shadow(g); root.add(tag(g, id));
    // resistor do catodo até o barramento − superior
    const r = new THREE.Group(); r.userData.completo = true;
    const z1 = -1.4, z2 = -2.096, rl = Math.abs(z2 - z1);
    for (const z of [z1, z2]) { const l = K.cyl(0.022, 0.022, 0.3, legM, 6); l.position.set(B.x + lx + 0.254, BB_TOP + 0.15, B.z + z); r.add(l); }
    const rb = K.cyl(0.1, 0.1, rl * 0.7, K.mat(0xd9c39a)); rb.rotation.x = Math.PI / 2; rb.position.set(B.x + lx + 0.254, BB_TOP + 0.3, B.z + (z1 + z2) / 2); r.add(rb);
    [0xd02020, 0xd02020, 0x6b3a1e, 0xc9a43a].forEach((bc, i) => {
      const band = K.cyl(0.106, 0.106, 0.045, K.mat(bc)); band.rotation.x = Math.PI / 2;
      band.position.set(B.x + lx + 0.254, BB_TOP + 0.3, B.z + z1 - 0.12 - i * 0.09); r.add(band);
    });
    const wl = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(B.x + lx, BB_TOP + 0.02, B.z + zC), new THREE.Vector3(B.x + lx + 0.254, BB_TOP + 0.02, B.z + z1)), 2, 0.03, 6), legM);
    r.add(wl);
    K.shadow(r); root.add(tag(r, 'resistor'));
  }
  const BTN_X = { btnPed: COLS[3], btnModo: COLS[10] };
  function buildButton(id, capColor) {
    const g = new THREE.Group(); g.userData.completo = true;
    const x = B.x + BTN_X[id] + 0.254, z = B.z;
    const base = K.box(1.2, 0.35, 1.2, K.mat(0x1b1d20)); base.position.set(x, BB_TOP + 0.18, z); g.add(base);
    const plate = K.box(1.22, 0.04, 1.22, K.mat(0x9aa0a6, { metalness: 0.7 })); plate.position.set(x, BB_TOP + 0.37, z); g.add(plate);
    const cap = K.cyl(0.38, 0.38, 0.3, K.mat(capColor, { roughness: 0.4 })); cap.position.set(x, BB_TOP + 0.52, z); g.add(cap);
    vis.caps[id] = cap; cap.userData.y0 = cap.position.y;
    K.shadow(g); root.add(tag(g, id));
  }
  function buildBuzzer() {
    const g = new THREE.Group(); g.userData.completo = true;
    const x = B.x + COLS[26], z = B.z + 0.9;
    const b = K.cyl(0.6, 0.6, 0.85, K.mat(0x17191b, { roughness: 0.5 })); b.position.set(x, BB_TOP + 0.43, z); g.add(b);
    const hole = K.cyl(0.12, 0.12, 0.02, K.mat(0x000000)); hole.position.set(x, BB_TOP + 0.87, z); g.add(hole);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 40), new THREE.MeshBasicMaterial({ color: 0x9b8cff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, BB_TOP + 0.9, z); ring.raycast = () => {}; g.add(ring);
    vis.buzzerRing = ring;
    const plus = K.label('+', { size: 0.35, bg: 'rgba(0,0,0,0)' }); plus.position.set(x - 0.35, BB_TOP + 0.95, z - 0.35); g.add(plus);
    K.shadow(g); root.add(tag(g, 'buzzer'));
  }

  /* ---------- HC-SR04 (deitado, olhando para cima) ---------- */
  function buildHC() {
    const g = new THREE.Group(); g.position.copy(H);
    const pcbTex = K.canvasTex(900, 400, (c, w, h) => {
      c.fillStyle = '#1f5fae'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e8f0ff'; c.font = 'bold 40px Arial'; c.fillText('HC-SR04', 360, 60);
      c.font = 'bold 30px Arial'; ['Vcc', 'Trig', 'Echo', 'Gnd'].forEach((t, i) => c.fillText(t, 330 + i * 60 - 5, 360, 58));
      c.fillText('T', 140, 210); c.fillText('R', 740, 210);
    });
    const pcb = K.box(4.5, 0.16, 2.0, [K.mat(0x1f5fae), K.mat(0x1f5fae), new THREE.MeshStandardMaterial({ map: pcbTex }), K.mat(0x1f5fae), K.mat(0x1f5fae), K.mat(0x1f5fae)]);
    pcb.position.y = 0.6; g.add(pcb);
    const metal = K.mat(0xd2d6da, { metalness: 0.85, roughness: 0.3 });
    const meshTex = K.canvasTex(256, 256, (c) => { c.fillStyle = '#2a2d30'; c.fillRect(0, 0, 256, 256); c.strokeStyle = '#4a4f55'; c.lineWidth = 3; for (let i = 0; i < 256; i += 14) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 256); c.moveTo(0, i); c.lineTo(256, i); c.stroke(); } });
    for (const sx of [-1.3, 1.3]) {
      const t = K.cyl(0.8, 0.8, 1.2, metal, 32); t.position.set(sx, 1.28, 0); g.add(t);
      const m = K.cyl(0.66, 0.66, 0.02, new THREE.MeshStandardMaterial({ map: meshTex })); m.position.set(sx, 1.89, 0); g.add(m);
    }
    const xt = K.box(0.7, 0.25, 0.3, metal); xt.position.set(0, 0.8, -0.55); g.add(xt);
    const hdr = K.box(1.1, 0.25, 0.25, K.mat(0x111417)); hdr.position.set(0, 0.6, 1.05); g.add(hdr);
    const gold = K.mat(0xd8b24a, { metalness: 0.8, roughness: 0.3 });
    [-0.381, -0.127, 0.127, 0.381].forEach(px => { const p = K.box(0.06, 0.06, 0.6, gold); p.position.set(px, 0.6, 1.4); g.add(p); });
    for (const p of [[-2, -0.8], [2, -0.8], [-2, 0.8], [2, 0.8]]) { const s = K.cyl(0.12, 0.12, 0.55, K.mat(0x99a)); s.position.set(p[0], 0.27, p[1]); g.add(s); }
    K.shadow(g); root.add(tag(g, 'hcsr04'));

    // obstáculo (a "mão" que o slider aproxima) e ondas
    const ob = new THREE.Group();
    const obm = K.box(4.2, 0.25, 2.4, new THREE.MeshStandardMaterial({ color: 0x6fd6d2, transparent: true, opacity: 0.35, roughness: 0.4 }));
    ob.add(obm);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(obm.geometry), new THREE.LineBasicMaterial({ color: 0x6fd6d2 }));
    ob.add(edge);
    ob.position.set(H.x, 6, H.z); obm.raycast = () => {}; edge.raycast = () => {};
    root.add(ob); vis.obstacle = ob;
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40), new THREE.MeshBasicMaterial({ color: 0x6fd6d2, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      w.rotation.x = -Math.PI / 2; w.raycast = () => {}; root.add(w); vis.waves.push({ m: w, t: 1 + i });
    }
  }

  /* ---------- servo SG90 com braço de cancela ---------- */
  function buildServo() {
    const g = new THREE.Group(); g.position.copy(SV);
    const blue = new THREE.MeshStandardMaterial({ color: 0x2c63c8, transparent: true, opacity: 0.9, roughness: 0.35 });
    const body = K.box(2.3, 2.2, 1.2, blue); body.position.y = 1.1; g.add(body);
    const ears = K.box(3.3, 0.12, 1.2, blue); ears.position.y = 1.55; g.add(ears);
    const hub = K.cyl(0.55, 0.55, 0.3, blue); hub.rotation.x = Math.PI / 2; hub.position.set(-0.55, 1.6, 0.75); g.add(hub);
    const lab = K.canvasTex(512, 256, (c) => { c.fillStyle = '#2c63c8'; c.fillRect(0, 0, 512, 256); c.fillStyle = '#fff'; c.font = 'bold 70px Arial'; c.fillText('SG90', 150, 150); c.font = '30px Arial'; c.fillText('MICRO SERVO 9g', 120, 205); });
    const lp = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.0), new THREE.MeshBasicMaterial({ map: lab, transparent: true, opacity: 0.95 })); lp.position.set(0.1, 0.75, 0.61); g.add(lp);
    // pivô + chifre + braço listrado
    const pivot = new THREE.Group(); pivot.position.set(-0.55, 1.6, 0.95); g.add(pivot);
    const horn = K.box(1.6, 0.26, 0.1, K.mat(0xf2f2f2)); horn.position.x = 0.5; pivot.add(horn);
    const hc = K.cyl(0.22, 0.22, 0.14, K.mat(0xf2f2f2)); hc.rotation.x = Math.PI / 2; pivot.add(hc);
    const stripes = K.canvasTex(512, 32, (c) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#f4f4f4' : '#d63a3a'; c.fillRect(i * 64, 0, 64, 32); } });
    const arm = K.box(5.2, 0.28, 0.14, new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.5 })); arm.position.set(3.0, 0, 0.1); pivot.add(arm);
    vis.servoArm = pivot;
    K.shadow(g); root.add(tag(g, 'servo'));
  }

  /* ---------- jumpers ---------- */
  function wire(a, b, color, label, opts) {
    const o = Object.assign({ completo: true, video: false, lift: null }, opts || {});
    const d = a.distanceTo(b), lift = o.lift != null ? o.lift : 0.8 + d * 0.12;
    const up = Math.max(a.y, b.y) + lift;
    const pts = [a.clone(), new THREE.Vector3(a.x, a.y + 0.5, a.z), new THREE.Vector3(a.x + (b.x - a.x) * 0.25, up, a.z + (b.z - a.z) * 0.25),
      new THREE.Vector3(a.x + (b.x - a.x) * 0.75, up, a.z + (b.z - a.z) * 0.75), new THREE.Vector3(b.x, b.y + 0.5, b.z), b.clone()];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.055, 8), K.mat(color, { roughness: 0.45 }));
    const g = new THREE.Group(); g.add(m);
    const tipM = K.mat(0x222222);
    for (const p of [a, b]) { const t = K.box(0.12, 0.35, 0.12, tipM); t.position.set(p.x, p.y + 0.18, p.z); g.add(t); }
    g.userData.wireLabel = label; g.userData.completo = o.completo; g.userData.video = o.video;
    K.shadow(g); root.add(tag(g, 'jumpers')); wires.push(g);
    return g;
  }
  function buildWires() {
    const anode = id => bbHole(LED_X[id], -0.384);
    wire(pinPos('D11'), anode('ledCarR'), 0xe03a3a, 'D11 → LED vermelho dos veículos (PWM)');
    wire(pinPos('D5'), anode('ledCarY'), 0xf0b020, 'D5 → LED amarelo dos veículos (PWM)');
    wire(pinPos('D3'), anode('ledCarG'), 0x2fb35a, 'D3 → LED verde dos veículos (PWM)');
    wire(pinPos('D12'), anode('ledPedR'), 0xb02828, 'D12 → LED vermelho do pedestre');
    wire(pinPos('D13'), anode('ledPedG'), 0x22d07a, 'D13 → LED verde do pedestre');
    wire(pinPos('D2'), bbHole(BTN_X.btnPed, -0.892), 0x9b6cff, 'D2 (INT0) → botão de pedestre');
    wire(pinPos('D4'), bbHole(BTN_X.btnModo, -0.892), 0x38b6ff, 'D4 → botão de modo (polling)');
    wire(pinPos('D8'), bbHole(COLS[25], 1.4), 0xb85cff, 'D8 → buzzer (+)');
    wire(pinPos('GNDT'), bbHole(COLS[0], -2.096), 0x1a1a1a, 'GND → barramento − da protoboard');
    // jumpers curtos na protoboard
    wire(bbHole(BTN_X.btnPed + 0.762, 0.892), bbHole(BTN_X.btnPed + 0.762, 2.096), 0x1a1a1a, 'Botão de pedestre → GND', { lift: 0.3 });
    wire(bbHole(BTN_X.btnModo + 0.762, 0.892), bbHole(BTN_X.btnModo + 0.762, 2.096), 0x1a1a1a, 'Botão de modo → GND', { lift: 0.3 });
    wire(bbHole(COLS[27], 1.4), bbHole(COLS[27], 2.096), 0x1a1a1a, 'Buzzer (−) → GND', { lift: 0.3 });
    wire(bbHole(COLS[29], -2.096), bbHole(COLS[29], 2.096), 0x1a1a1a, 'Liga os dois barramentos GND', { lift: 0.6 });
    // HC-SR04 (igual ao vídeo)
    const hp = px => new THREE.Vector3(H.x + px, 0.6, H.z + 1.7);
    wire(pinPos('D6'), hp(-0.127), 0x2fb35a, 'D6 → TRIG do HC-SR04', { video: true });
    vis.echoWire = wire(pinPos('D7'), hp(0.127), 0x3a6fe0, 'D7 → ECHO do HC-SR04', { video: true });
    wire(pinPos('5V'), hp(-0.381), 0xe03a3a, '5V → VCC do HC-SR04', { video: true });
    wire(pinPos('GND1'), hp(0.381), 0x1a1a1a, 'GND → GND do HC-SR04', { video: true });
    // servo
    const sp = i => new THREE.Vector3(SV.x - 1.25, 0.5, SV.z + 0.2 * i - 0.2);
    wire(pinPos('D9'), sp(0), 0xff8a1e, 'D9 → sinal do servo (laranja)', { video: true });
    wire(pinPos('5V'), sp(1), 0xe03a3a, '5V → V+ do servo (vermelho)', { video: true });
    wire(pinPos('GND2'), sp(2), 0x6b3a1e, 'GND → GND do servo (marrom)', { video: true });
  }

  /* ---------- API ---------- */
  P.init = function (host) {
    st = K.stage(host, { fov: 38, bg: 0x0c171b });
    const { scene, camera, controls } = st;
    camera.position.set(1.5, 15.5, 11.5); controls.target.set(0.8, 0, -1.6); controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 6; controls.maxDistance = 60; controls.update();
    scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x0b1418, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.95); sun.position.set(8, 22, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18 }); scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), K.mat(0x0f1e23, { roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(80, 80, 0x1b333b, 0x14272e); grid.position.y = 0.01; scene.add(grid);
    root = new THREE.Group(); scene.add(root);
    buildArduino(); buildBreadboard();
    Object.keys(LED_X).forEach(buildLed);
    buildButton('btnPed', 0xf2c230); buildButton('btnModo', 0x2f7bf0);
    buildBuzzer(); buildHC(); buildServo(); buildWires();
    helper = new THREE.BoxHelper(undefined, 0x6fd6d2); helper.visible = false; helper.raycast = () => {}; scene.add(helper);
    selHelper = new THREE.BoxHelper(undefined, 0xf3b324); selHelper.visible = false; selHelper.raycast = () => {}; scene.add(selHelper);
    return st;
  };

  P.setVariant = function (v) {
    variant = v;
    root.children.forEach(ch => {
      const id = ch.userData.part;
      if (!id) return;
      if (v === 'video') {
        const keep = id === 'arduino' || id === 'hcsr04' || id === 'servo' || id === 'usb' || (id === 'jumpers' && ch.userData.video);
        ch.visible = keep;
      } else ch.visible = true;
    });
    if (vis.obstacle) vis.obstacle.visible = true;
    P.hover(null); P.select(null);
  };

  P.pick = (ev) => st.pick(ev, pickables);

  function groupFor(id, obj) { return obj || (parts[id] && parts[id][0]); }
  P.hover = function (hit) {
    if (!hit) { helper.visible = false; return; }
    helper.setFromObject(hit.obj); helper.visible = true;
  };
  P.select = function (id) {
    if (!id || !parts[id]) { selHelper.visible = false; return; }
    const g = parts[id].find(o => o.visible !== false) || parts[id][0];
    selHelper.setFromObject(groupFor(id, g)); selHelper.visible = true;
  };

  // Sincroniza o 3D com as saídas do firmware
  P.update = function (fw, dt, running, extra) {
    const now = performance.now() / 1000;
    const o = fw && fw.out ? fw.out : {};
    const lvl = {
      ledCarR: (o.carR || 0) / 255, ledCarY: (o.carY || 0) / 255, ledCarG: (o.carG || 0) / 255,
      ledPedR: o.pedR ? (fw.modoNoturno ? 0.55 : 1) : 0, ledPedG: o.pedG ? (fw.modoNoturno ? 0.55 : 1) : 0
    };
    Object.keys(vis.leds).forEach(id => {
      const L = running && variant === 'completo' ? (lvl[id] || 0) : 0;
      vis.leds[id].emissiveIntensity = 0.05 + L * 2.2;
      vis.glows[id].material.opacity = Math.min(1, L * 1.1);
      const s = vis.glows[id].userData.base * (0.6 + L * 0.7); vis.glows[id].scale.set(s, s, 1);
    });
    const bl = vis.boardLeds;
    const setB = (n, v) => { bl[n].m.emissiveIntensity = v * 3; bl[n].gl.material.opacity = v; };
    setB('ON', running ? 1 : 0);
    setB('L', running && variant === 'completo' && o.pedG ? 1 : 0);
    setB('TX', running && extra && now - extra.lastTx < 0.06 ? 1 : 0);
    setB('RX', running && extra && now - extra.lastRx < 0.06 ? 1 : 0);
    // servo: SG90 gira ~600°/s
    const target = running ? (o.servo || 0) : vis.servoAng;
    const step = 600 * dt;
    vis.servoAng += Math.max(-step, Math.min(step, target - vis.servoAng));
    vis.servoArm.rotation.z = (90 - vis.servoAng) * Math.PI / 180;
    // botões
    if (fw && variant === 'completo') {
      const cp = vis.caps;
      cp.btnPed.position.y = cp.btnPed.userData.y0 - (fw.btnPedNivel === 0 ? 0.12 : 0);
      cp.btnModo.position.y = cp.btnModo.userData.y0 - (fw.btnModoNivel === 0 ? 0.12 : 0);
    }
    // buzzer
    const bz = running && o.buzzer;
    vis.buzzerRing.material.opacity = bz ? 0.9 : Math.max(0, vis.buzzerRing.material.opacity - dt * 4);
    const rs = bz ? 1 + ((now * 6) % 1) * 1.4 : vis.buzzerRing.scale.x; vis.buzzerRing.scale.set(rs, rs, rs);
    // obstáculo + ondas
    const d = extra ? extra.distance : 350;
    const yObs = 2.1 + (d / 400) * 7;
    vis.obstacle.position.y += (yObs - vis.obstacle.position.y) * Math.min(1, dt * 10);
    const connected = !(fw && fw.sensorConectado === false);
    if (vis.echoWire) vis.echoWire.visible = connected && (variant === 'completo' || vis.echoWire.userData.video);
    const lastPing = fw ? (fw.taskRuns.SENS != null ? fw.taskRuns.SENS : fw.taskRuns.LOOP) : -1e9;
    if (running && fw && connected && fw.t - lastPing < 30 && !vis._pinged) {
      vis._pinged = true; const w = vis.waves.find(x => x.t >= 1); if (w) w.t = 0;
    }
    if (fw && fw.t - lastPing >= 30) vis._pinged = false;
    vis.waves.forEach(w => {
      if (w.t < 1) {
        w.t += dt * 2.2;
        const y = 1.95 + (vis.obstacle.position.y - 1.95) * Math.min(1, w.t);
        w.m.position.set(H.x + (w.t < 0.5 ? -1.3 : 1.3), y, H.z);
        const sc = 1 + w.t * 1.2; w.m.scale.set(sc, sc, sc);
        w.m.material.opacity = 0.8 * (1 - w.t);
      } else w.m.material.opacity = 0;
    });
    if (helper.visible) helper.update();
  };

  P.render = function () { st.controls.update(); st.renderer.render(st.scene, st.camera); };
  P.stage = () => st;
  P.variant = () => variant;
  window.Project3D = P;
})();
