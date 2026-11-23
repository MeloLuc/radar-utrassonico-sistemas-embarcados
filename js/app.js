/* =====================================================================
 * Aplicação: rotas, laço principal, painéis, monitor serial, modal de
 * código, plano de testes e diagramas da apresentação.
 * ===================================================================== */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const FW = window.FW, PARTS = window.PARTS;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtClock = ms => { const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000; return String(m).padStart(2, '0') + ':' + s.toFixed(3).padStart(6, '0'); };

  /* ===================== estado global ===================== */
  const S = {
    view: 'inicio', variant: 'completo', projRunning: false, simPaused: false, speed: 1, simApp: 'travessia',
    sound: false, hoverProj: null, hoverSim: null, lastEv: null, lastEvSim: null, selected: null,
    tx: { proj: 0, sim: 0 }, rx: { proj: 0, sim: 0 }
  };
  let projFW = new FW.TravessiaFirmware();
  const simFW = new FW.TravessiaFirmware();
  const simFWE = new FW.VideoFirmware(150);

  /* ===================== 3D ===================== */
  const proj = window.Project3D, sim = window.Sim3D;
  let has3D = true;
  try { proj.init($('#proj3d')); sim.init(); } catch (e) { has3D = false; console.error(e); }
  if (!has3D) {
    $$('.canvas-host, .hero-3d').forEach(h => { const p = document.createElement('p'); p.style.cssText = 'padding:24px;color:var(--dim)'; p.textContent = 'Não foi possível iniciar o WebGL neste navegador. O conteúdo da apresentação continua disponível.'; h.appendChild(p); });
  }

  /* ===================== monitor serial ===================== */
  function serial(outEl) {
    return {
      add(line) {
        const d = document.createElement('div'); d.className = line.kind || ''; d.textContent = line.text;
        const stick = outEl.scrollTop + outEl.clientHeight >= outEl.scrollHeight - 30;
        outEl.appendChild(d);
        while (outEl.childNodes.length > 300) outEl.removeChild(outEl.firstChild);
        if (stick) outEl.scrollTop = outEl.scrollHeight;
      },
      clear() { outEl.textContent = ''; }
    };
  }
  const projSerial = serial($('#projSerialOut')), simSerial = serial($('#simSerialOut'));
  function wireProjFW() {
    if (!projFW._wired) { projFW._wired = true; projFW.on('log', l => { projSerial.add(l); S.tx.proj = performance.now() / 1000; }); }
    projFW.distanceProvider = () => Number($('#distSlider').value);
  }
  wireProjFW();
  simFW.distanceProvider = () => sim.distanceTravessia();
  simFWE.distanceProvider = () => sim.distanceEstac();
  simFW.on('log', l => { if (S.simApp === 'travessia') simSerial.add(l); });
  simFWE.on('log', l => { if (S.simApp === 'estac') simSerial.add(l); });
  const note = (ser, text) => ser.add({ text: '# ' + text, kind: 'muted' });

  sim.hooks.pressButton = () => simFW.pressPedButton();
  sim.hooks.warn = (msg) => { note(simSerial, msg); flashHud(msg); };

  /* ===================== rotas ===================== */
  const VIEWS = ['inicio', 'projeto', 'simulacao', 'apresentacao'];
  function route() {
    let v = (location.hash || '#inicio').slice(1);
    if (!VIEWS.includes(v)) v = 'inicio';
    S.view = v;
    VIEWS.forEach(n => $('#view-' + n).classList.toggle('active', n === v));
    $$('.nav a').forEach(a => a.setAttribute('aria-current', a.dataset.view === v ? 'page' : 'false'));
    if (!has3D) return;
    if (v === 'inicio') { sim.setApp('travessia'); sim.mount($('#hero3d')); sim.setAutoRotate(true); sim.stage().camera.position.set(-19, 13, 19); }
    if (v === 'simulacao') { sim.mount($('#sim3d')); sim.setAutoRotate(false); sim.setApp(S.simApp); }
    if (v === 'projeto') proj.stage().resize();
    requestAnimationFrame(() => { proj.stage().resize(); sim.stage().resize(); });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ===================== PROJETO ===================== */
  function buildBOM() {
    const ul = $('#bom'); ul.textContent = '';
    Object.keys(PARTS).forEach(id => {
      const p = PARTS[id];
      const inVideo = !!p.video;
      const li = document.createElement('li');
      if (S.variant === 'video' && !inVideo) li.className = 'off';
      const b = document.createElement('button'); b.type = 'button'; b.dataset.part = id;
      b.innerHTML = '<span class="q">' + (S.variant === 'video' && id === 'jumpers' ? 7 : p.qtd) + '×</span><span class="n">' + esc(p.nome) + '<span class="c">' + esc(p.cat) + (p.pino != null ? ' · D' + p.pino : '') + '</span></span>';
      b.addEventListener('click', () => openInfo(id));
      li.appendChild(b); ul.appendChild(li);
    });
    $('#bomTitle').textContent = S.variant === 'video' ? 'Circuito do vídeo' : 'Sistema completo';
    markBOM();
  }
  function markBOM() { $$('#bom button').forEach(b => b.classList.toggle('sel', b.dataset.part === S.selected)); }

  function setVariant(v) {
    S.variant = v;
    $('#varCompleto').setAttribute('aria-pressed', v === 'completo');
    $('#varVideo').setAttribute('aria-pressed', v === 'video');
    stopProj();
    projFW = v === 'video' ? new FW.VideoFirmware(50) : new FW.TravessiaFirmware();
    wireProjFW();
    projSerial.clear();
    if (has3D) proj.setVariant(v);
    $('#ctrlTravessia').querySelectorAll('#btnD2, #btnD4').forEach(b => { b.hidden = v === 'video'; });
    $('#btnSensorFault').setAttribute('aria-pressed', 'false');
    buildBOM(); closeInfo();
  }

  function startProj() {
    projFW.reset(); wireProjFW();
    projFW.sensorConectado = $('#btnSensorFault').getAttribute('aria-pressed') !== 'true';
    projSerial.clear();
    S.projRunning = true;
    const b = $('#projRun'); b.classList.remove('primary'); b.classList.add('stop');
    b.innerHTML = '<svg viewBox="0 0 14 14"><rect x="2.5" y="2.5" width="9" height="9" fill="currentColor"/></svg><span>Parar simulação</span>';
  }
  function stopProj() {
    S.projRunning = false;
    const b = $('#projRun'); b.classList.add('primary'); b.classList.remove('stop');
    b.innerHTML = '<svg viewBox="0 0 14 14"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg><span>Iniciar simulação</span>';
    $('#projTip').hidden = true;
  }
  $('#projRun').addEventListener('click', () => S.projRunning ? stopProj() : startProj());
  $('#projReset').addEventListener('click', () => { if (S.projRunning) startProj(); else { projFW.reset(); wireProjFW(); projSerial.clear(); } });
  $('#varCompleto').addEventListener('click', () => setVariant('completo'));
  $('#varVideo').addEventListener('click', () => setVariant('video'));
  const setCtrlOpen = open => { $('#projCtrl').classList.toggle('collapsed', !open); $('#projCtrlToggle').setAttribute('aria-expanded', open); };
  $('#projCtrlToggle').addEventListener('click', () => setCtrlOpen($('#projCtrl').classList.contains('collapsed')));
  if (window.innerWidth < 820) setCtrlOpen(false);
  $('#distSlider').addEventListener('input', e => { $('#distVal').textContent = e.target.value + ' cm'; });
  $('#btnD2').addEventListener('click', () => { if (!S.projRunning) startProj(); projFW.pressPedButton(); });
  $('#btnD4').addEventListener('click', () => { if (!S.projRunning) startProj(); projFW.tapModeButton(); });
  $('#btnSensorFault').addEventListener('click', e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', on); e.currentTarget.textContent = on ? 'Reconectar sensor' : 'Desconectar sensor';
    projFW.sensorConectado = !on;
  });
  $('#projSerialClear').addEventListener('click', () => projSerial.clear());
  $('#projSerialToggle').addEventListener('click', e => { const s = $('#projSerial'); s.classList.toggle('collapsed'); e.currentTarget.textContent = s.classList.contains('collapsed') ? 'Expandir' : 'Recolher'; });
  $('#projSerialForm').addEventListener('submit', e => {
    e.preventDefault(); const inp = $('#projSerialInput'); const v = inp.value.trim(); if (!v) return;
    projSerial.add({ text: '> ' + v, kind: 'tx' }); S.rx.proj = performance.now() / 1000;
    if (S.variant === 'video') note(projSerial, 'o código do vídeo não lê a UART: comando sem efeito');
    else { if (!S.projRunning) startProj(); projFW.sendUart(v); }
    inp.value = '';
  });
  $('#projCode').addEventListener('click', () => openCode(S.variant === 'video' ? 'video' : 'travessia'));

  // som do buzzer (Web Audio, só depois de um clique)
  let actx = null, osc = null, gain = null;
  $('#projSound').addEventListener('click', e => {
    S.sound = !S.sound; e.currentTarget.setAttribute('aria-pressed', S.sound); e.currentTarget.textContent = 'Som: ' + (S.sound ? 'ligado' : 'desligado');
    if (S.sound && !actx) {
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        osc = actx.createOscillator(); gain = actx.createGain(); osc.type = 'square'; osc.frequency.value = 2300; gain.gain.value = 0;
        osc.connect(gain); gain.connect(actx.destination); osc.start();
      } catch (err) { S.sound = false; }
    }
  });
  function buzz(on) { if (gain) gain.gain.setTargetAtTime(S.sound && on ? 0.04 : 0, actx.currentTime, 0.005); }

  // hover e clique na bancada
  const projHost = $('#proj3d'), projTip = $('#projTip');
  let downAt = null;
  projHost.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  projHost.addEventListener('pointermove', e => {
    if (!has3D || e.target.closest('.float-ctrl')) { projTip.hidden = true; proj.hover(null); return; }
    S.lastEv = e;
    const hit = proj.pick(e);
    S.hoverProj = hit; proj.hover(hit);
    projHost.style.cursor = hit ? 'pointer' : '';
    renderProjTip();
  });
  projHost.addEventListener('pointerleave', () => { S.hoverProj = null; proj.hover(null); projTip.hidden = true; });
  projHost.addEventListener('click', e => {
    if (!has3D || e.target.closest('.float-ctrl')) return;
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const hit = proj.pick(e); if (!hit) return;
    const p = PARTS[hit.id];
    if (S.projRunning && S.variant === 'completo' && p && p.clicavel) {
      if (hit.id === 'btnPed') projFW.pressPedButton(); else projFW.tapModeButton();
      return;
    }
    openInfo(hit.id);
  });
  function renderProjTip() {
    const hit = S.hoverProj;
    if (!hit || !S.lastEv) { projTip.hidden = true; return; }
    const p = PARTS[hit.id];
    let title = p ? p.nome : hit.id, body;
    if (hit.id === 'jumpers' && hit.obj.userData.wireLabel) title = hit.obj.userData.wireLabel;
    if (S.projRunning && p && p.live) body = p.live(projFW, S.variant);
    else body = '<span class="sub">' + (p ? esc(p.funcao) : '') + '</span><br><span class="sub">Clique para ver os detalhes. Inicie a simulação para ver o que a peça está fazendo.</span>';
    projTip.innerHTML = '<h4>' + esc(title) + '</h4>' + body;
    projTip.hidden = false;
    window.K3.placeTip(projTip, projHost, S.lastEv);
  }

  // painel de detalhes
  function openInfo(id) {
    const p = PARTS[id]; if (!p) return;
    S.selected = id; markBOM(); if (has3D) proj.select(id);
    $('#infoCat').textContent = p.cat + (p.grupo ? ' · ' + p.grupo : '') + ' · ' + p.qtd + '×';
    $('#infoName').textContent = p.nome;
    const file = S.variant === 'video' ? 'video' : 'travessia';
    const ref = p.code && p.code[file];
    $('#infoBody').innerHTML =
      '<div><h3>Para que serve</h3><p>' + esc(p.funcao) + '</p></div>' +
      '<div><h3>Como funciona no projeto</h3><p>' + esc(p.como) + '</p></div>' +
      '<div><h3>Ligação</h3><div class="pins">' + esc(p.ligacao) + '</div></div>' +
      '<div><h3>Especificação</h3><table class="spec">' + p.specs.map(r => '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>').join('') + '</table></div>' +
      '<div><h3>Agora na simulação</h3><div class="live-box" id="infoLive"></div></div>' +
      (ref ? '<button class="btn" id="infoCode"><svg viewBox="0 0 14 14"><path d="M5 3 1 7l4 4M9 3l4 4-4 4" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>Ver o trecho no código</button>' : '');
    if (ref) $('#infoCode').addEventListener('click', () => openCode(file, ref));
    $('#info').hidden = false;
    updateInfoLive();
    requestAnimationFrame(() => proj.stage().resize());
  }
  function updateInfoLive() {
    const el = $('#infoLive'); if (!el || !S.selected) return;
    const p = PARTS[S.selected];
    el.innerHTML = S.projRunning && p.live ? p.live(projFW, S.variant) : '<span class="t-off">Simulação parada. Clique em "Iniciar simulação" para ver esta peça em funcionamento.</span>';
  }
  function closeInfo() { $('#info').hidden = true; S.selected = null; markBOM(); if (has3D) proj.select(null); requestAnimationFrame(() => proj.stage().resize()); }
  $('#infoClose').addEventListener('click', closeInfo);

  /* ===================== SIMULAÇÃO ===================== */
  function setSimApp(a) {
    S.simApp = a;
    $('#appTravessia').setAttribute('aria-pressed', a === 'travessia');
    $('#appEstac').setAttribute('aria-pressed', a === 'estac');
    $('#sideTravessia').hidden = a !== 'travessia';
    $('#sideEstac').hidden = a !== 'estac';
    $('#hudLights').hidden = a !== 'travessia';
    simSerial.clear();
    const src = a === 'travessia' ? simFW : simFWE;
    src.lines.slice(-40).forEach(l => simSerial.add(l));
    if (has3D && S.view === 'simulacao') sim.setApp(a);
  }
  $('#appTravessia').addEventListener('click', () => setSimApp('travessia'));
  $('#appEstac').addEventListener('click', () => setSimApp('estac'));
  $('#simRun').addEventListener('click', e => {
    S.simPaused = !S.simPaused; const b = e.currentTarget;
    b.classList.toggle('stop', !S.simPaused); b.classList.toggle('primary', S.simPaused);
    b.innerHTML = S.simPaused ? '<svg viewBox="0 0 14 14"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg><span>Continuar</span>'
      : '<svg viewBox="0 0 14 14"><rect x="3" y="2" width="3" height="10" fill="currentColor"/><rect x="8" y="2" width="3" height="10" fill="currentColor"/></svg><span>Pausar</span>';
  });
  $$('[data-speed]').forEach(b => b.addEventListener('click', () => {
    S.speed = Number(b.dataset.speed); $$('[data-speed]').forEach(x => x.setAttribute('aria-pressed', x === b));
  }));
  $('#simCode').addEventListener('click', () => openCode(S.simApp === 'estac' ? 'video' : 'travessia'));
  const toggle = (el, fn) => el.addEventListener('click', () => { const on = el.getAttribute('aria-pressed') !== 'true'; el.setAttribute('aria-pressed', on); fn(on, el); });
  $('#sPed').addEventListener('click', () => sim.spawnPed('normal'));
  $('#sBtn').addEventListener('click', () => simFW.pressPedButton());
  toggle($('#sCars'), on => sim.setTraffic(on));
  toggle($('#sAuto'), on => sim.setAutoPeds(on));
  $('#sSlow').addEventListener('click', () => { sim.spawnPed('idoso'); note(simSerial, 'pedestre idoso a 0,55 m/s: deve receber extensões'); });
  $('#sStuck').addEventListener('click', () => { sim.spawnPed('parado'); note(simSerial, 'pessoa vai parar no meio da faixa por 22 s: limite de 2 extensões'); });
  toggle($('#sFault'), (on, el) => { simFW.sensorConectado = !on; el.textContent = on ? 'Reconectar sensor' : 'Desconectar sensor'; note(simSerial, on ? 'cabo do ECHO desconectado' : 'cabo do ECHO reconectado'); });
  $('#sSpam').addEventListener('click', () => {
    const before = { isr: simFW.stats.isr, ped: simFW.stats.pedidos + simFW.stats.repetidos + simFW.stats.ignorados };
    note(simSerial, '10 bordas de descida no D2 em ~90 ms (bounce)');
    for (let i = 0; i < 10; i++) setTimeout(() => simFW.isrBotaoPedestre(), i * 9);
    setTimeout(() => note(simSerial, 'ISR chamada ' + (simFW.stats.isr - before.isr) + '×, pedidos tratados pela FSM: ' + (simFW.stats.pedidos + simFW.stats.repetidos + simFW.stats.ignorados - before.ped)), 400);
  });
  $('#sNight').addEventListener('click', () => { simSerial.add({ text: '> N', kind: 'tx' }); simFW.sendUart('N'); });
  $('#sDay').addEventListener('click', () => { simSerial.add({ text: '> D', kind: 'tx' }); simFW.sendUart('D'); });
  $('#sD4').addEventListener('click', () => simFW.tapModeButton());
  $('#eCar').addEventListener('click', () => sim.spawnCarE());
  $('#eTruck').addEventListener('click', () => { sim.spawnTruck(); note(simSerial, 'caminhão com vão entre cabine e baú'); });
  toggle($('#eAuto'), on => sim.setAutoCars(on));
  toggle($('#eFault'), (on, el) => { simFWE.sensorConectado = !on; el.textContent = on ? 'Reconectar sensor' : 'Desconectar sensor'; note(simSerial, on ? 'HC-SR04 desconectado' : 'HC-SR04 reconectado'); });
  $('#simSerialClear').addEventListener('click', () => simSerial.clear());
  $('#simSerialForm').addEventListener('submit', e => {
    e.preventDefault(); const inp = $('#simSerialInput'); const v = inp.value.trim(); if (!v) return;
    simSerial.add({ text: '> ' + v, kind: 'tx' });
    if (S.simApp === 'estac') note(simSerial, 'o código do vídeo não lê a UART'); else simFW.sendUart(v);
    inp.value = '';
  });

  // HUD
  const NOMES_CURTOS = ['VEIC_VERDE', 'VEIC_AMARELO', 'TODOS_VERM', 'PED_VERDE', 'PED_PISCANDO', 'LIBERANDO'];
  function buildFsmMini() {
    const pos = [[10, 14], [105, 14], [200, 14], [200, 74], [105, 74], [10, 74]];
    let h = '<defs><marker id="mh" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 8 4 0 8z" fill="#3d5a63"/></marker></defs>';
    h += '<path d="M100 30 H103 M195 30 H198 M245 48 V72 M198 90 H197 M103 90 H102 M55 72 V48" marker-end="url(#mh)" stroke-width="1.5"/>';
    pos.forEach((p, i) => { h += '<g class="node" data-i="' + i + '"><rect x="' + p[0] + '" y="' + p[1] + '" width="90" height="32" rx="5"/><text x="' + (p[0] + 45) + '" y="' + (p[1] + 20) + '" text-anchor="middle">S' + i + ' ' + NOMES_CURTOS[i] + '</text></g>'; });
    $('#fsmMini').innerHTML = h;
    // tarefas
    $('#tasks').innerHTML = [['ISR', 'INT0 · D2'], ['FSM', 'prio 3 · 45 ms'], ['SENS', 'prio 2 · 100 ms'], ['IN', 'prio 2 · 50 ms'], ['SIG', 'prio 1 · 20 ms'], ['LOG', 'prio 1 · fila']]
      .map(t => '<div class="task" data-task="' + t[0] + '"><b>' + t[0] + '</b>' + t[1] + '</div>').join('');
  }
  buildFsmMini();
  let hudFlash = { msg: '', t: 0 };
  function flashHud(msg) { hudFlash = { msg, t: performance.now() }; }
  function updateHud() {
    const meta = [];
    if (S.simApp === 'travessia') {
      const p = simFW.phaseInfo();
      $('#hudState').textContent = p.nome;
      const waiting = p.estado === 0 && !simFW.pedidoPendente;
      $('#hudTime').textContent = waiting ? (p.dt / 1000).toFixed(1) + ' s · aguardando pedido' : (Math.max(0, p.dur - p.dt) / 1000).toFixed(1) + ' s restantes';
      $('#hudBar').style.width = (waiting ? 100 : p.frac * 100) + '%';
      $('#hudBar').style.background = ['var(--green)', 'var(--amber)', 'var(--red)', 'var(--teal-2)', 'var(--violet)', 'var(--red)'][p.estado];
      const o = simFW.out;
      $('#lR').classList.toggle('on', o.carR > 0); $('#lY').classList.toggle('on', o.carY > 0); $('#lG').classList.toggle('on', o.carG > 0);
      $('#lPR').classList.toggle('on', !!o.pedR); $('#lPG').classList.toggle('on', !!o.pedG);
      meta.push('<span class="chip">' + (simFW.modoNoturno ? 'NOTURNO · PWM 80' : 'DIURNO · PWM 255') + '</span>');
      meta.push('<span class="chip">' + (simFW.pedidoPendente ? '<span class="t-on">pedido pendente</span>' : 'sem pedido') + '</span>');
      meta.push('<span class="chip">' + (simFW.sensorOk ? 'sensor ' + simFW.distanciaCm.toFixed(0) + ' cm' : '<span class="t-err">sensor FALHA</span>') + '</span>');
      if (p.estado === 4 || simFW.extensoes) meta.push('<span class="chip t-warn">extensões ' + simFW.extensoes + '/2</span>');
      $$('#fsmMini .node').forEach(n => n.classList.toggle('on', Number(n.dataset.i) === p.estado));
      $$('#tasks .task').forEach(n => n.classList.toggle('hot', simFW.t - simFW.taskRuns[n.dataset.task] < (n.dataset.task === 'ISR' ? 400 : 60)));
    } else {
      const f = simFWE;
      $('#hudState').textContent = 'SERVO ' + f.servo + '° · ' + (f.servo ? 'ABERTA' : 'FECHADA');
      $('#hudTime').textContent = f.distance.toFixed(1) + ' cm';
      $('#hudBar').style.width = Math.min(100, f.distance / 4) + '%';
      $('#hudBar').style.background = f.distance < f.threshold ? 'var(--amber)' : 'var(--teal-2)';
      meta.push('<span class="chip">limiar ' + f.threshold + ' cm</span>');
      meta.push('<span class="chip">loop() a cada ~0,5 s</span>');
      meta.push('<span class="chip">' + (f.sensorConectado ? 'sensor ok' : '<span class="t-err">sem eco → 0 cm</span>') + '</span>');
    }
    if (hudFlash.msg && performance.now() - hudFlash.t < 4000) meta.push('<span class="chip t-err">' + esc(hudFlash.msg) + '</span>');
    $('#hudMeta').innerHTML = meta.join('');
  }

  // hover na rua
  const simHost = $('#sim3d'), simTip = $('#simTip');
  simHost.addEventListener('pointermove', e => {
    if (!has3D || e.target.closest('.hud')) { simTip.hidden = true; return; }
    S.lastEvSim = e; S.hoverSim = sim.pick(e); simHost.style.cursor = S.hoverSim ? 'help' : ''; renderSimTip();
  });
  simHost.addEventListener('pointerleave', () => { S.hoverSim = null; simTip.hidden = true; });
  function renderSimTip() {
    const hit = S.hoverSim;
    if (!hit || !S.lastEvSim) { simTip.hidden = true; return; }
    const body = S.simPaused ? '<span class="sub">Simulação pausada. Continue para ver o que está acontecendo.</span>' : sim.live(hit, simFW, simFWE);
    simTip.innerHTML = '<h4>' + esc(sim.nameOf(hit.id)) + '</h4>' + body;
    simTip.hidden = false; window.K3.placeTip(simTip, simHost, S.lastEvSim);
  }

  /* ===================== MODAL DE CÓDIGO ===================== */
  const NOTES = {
    travessia: 'Firmware da equipe: semáforo + cancela com FreeRTOS. Os módulos [M1] a [M7] estão marcados nos comentários. Para rodar no Wokwi, use também diagram.json e libraries.txt.',
    video: 'Código mostrado no vídeo (Arduino Titan, Wokwi), com comentários em português. É a base do projeto: mesmos pinos e mesma fórmula da distância.',
    diagram: 'Circuito completo para o Wokwi: crie um projeto Arduino Uno, cole este conteúdo na aba diagram.json e o firmware na aba sketch.ino.',
    libraries: 'Bibliotecas que o Wokwi instala automaticamente (aba Library Manager).'
  };
  const KW = /^(if|else|for|while|switch|case|break|continue|return|default|const|volatile|static|struct|enum|true|false|void|NULL|sizeof)$/;
  const TY = /^(int|float|bool|char|uint8_t|int16_t|uint32_t|BaseType_t|TickType_t|SemaphoreHandle_t|QueueHandle_t|Servo|Tempos|Estado|Evento|TipoEvento)$/;
  function tokenize(src, lang) {
    const toks = [];
    const re = lang === 'json' ? /("(?:\\.|[^"\\])*")|(-?\b\d+(?:\.\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)/g
      : lang === 'txt' ? /(#.*)/g
        : /(\/\/.*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])')|(#\s*\w+[^\n]*)|(\b\d+(?:\.\d+)?(?:UL|U|L)?\b)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_]\w*)/g;
    let last = 0, m;
    while ((m = re.exec(src))) {
      if (m.index > last) toks.push(['', src.slice(last, m.index)]);
      let cls = '';
      if (lang === 'json') cls = m[1] ? (src[re.lastIndex] === ':' || /^\s*:/.test(src.slice(re.lastIndex, re.lastIndex + 3)) ? 'tk-t' : 'tk-s') : m[2] ? 'tk-n' : 'tk-k';
      else if (lang === 'txt') cls = 'tk-c';
      else if (m[1]) cls = 'tk-c'; else if (m[2]) cls = 'tk-s'; else if (m[3]) cls = 'tk-p'; else if (m[4]) cls = 'tk-n';
      else if (m[5]) cls = KW.test(m[5]) ? 'tk-k' : 'tk-f';
      else if (m[6]) cls = KW.test(m[6]) ? 'tk-k' : TY.test(m[6]) ? 'tk-t' : /^[A-Z][A-Z0-9_]+$/.test(m[6]) ? 'tk-n' : '';
      toks.push([cls, m[0]]); last = re.lastIndex;
    }
    if (last < src.length) toks.push(['', src.slice(last)]);
    return toks;
  }
  function renderCode(file, findStr) {
    const c = window.CODE[file]; const lang = file === 'diagram' ? 'json' : file === 'libraries' ? 'txt' : 'cpp';
    const lines = [['']]; let cur = lines[0];
    tokenize(c.code, lang).forEach(([cls, text]) => {
      text.split('\n').forEach((part, i) => {
        if (i > 0) { cur = ['']; lines.push(cur); }
        if (part) cur[0] += cls ? '<span class="' + cls + '">' + esc(part) + '</span>' : esc(part);
      });
    });
    let hlFrom = -1, hlTo = -1;
    if (findStr) {
      const raw = c.code.split('\n');
      hlFrom = raw.findIndex(l => l.includes(findStr));
      if (hlFrom >= 0) { hlTo = hlFrom; while (hlTo + 1 < raw.length && raw[hlTo + 1].trim() !== '' && hlTo - hlFrom < 24) hlTo++; }
    }
    $('#codePre').innerHTML = lines.map((l, i) => '<span class="l' + (i >= hlFrom && i <= hlTo && hlFrom >= 0 ? ' hl' : '') + '">' + (l[0] || ' ') + '</span>').join('');
    $('#codeNote').textContent = NOTES[file];
    $$('#codeTabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.file === file));
    $('#codeModal').dataset.file = file;
    const wrap = $('#codeWrap');
    if (hlFrom >= 0) requestAnimationFrame(() => { const el = $$('#codePre .l')[hlFrom]; wrap.scrollTop = el.offsetTop - 60; });
    else wrap.scrollTop = 0;
  }
  let lastFocus = null;
  function openCode(file, findStr) {
    lastFocus = document.activeElement;
    $('#codeModal').hidden = false; renderCode(file, findStr); $('#codeClose').focus();
  }
  function closeCode() { $('#codeModal').hidden = true; if (lastFocus) lastFocus.focus(); }
  $$('#codeTabs button').forEach(b => b.addEventListener('click', () => renderCode(b.dataset.file)));
  $('#codeClose').addEventListener('click', closeCode);
  $('#codeModal').addEventListener('click', e => { if (e.target.id === 'codeModal') closeCode(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#codeModal').hidden) closeCode(); });
  $('#codeCopy').addEventListener('click', e => {
    const txt = window.CODE[$('#codeModal').dataset.file].code; const b = e.currentTarget;
    const done = () => { b.textContent = 'Copiado'; setTimeout(() => { b.textContent = 'Copiar'; }, 1500); };
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($('#codePre')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selecionado: Ctrl+C'; };
    try { navigator.clipboard.writeText(txt).then(done, fallback); } catch (err) { fallback(); }
  });

  /* ===================== APRESENTAÇÃO ===================== */
  function blockDiagram() {
    const box = (x, y, w, h, cls, t, s) => '<rect class="dg-box ' + cls + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6" stroke-width="1.5"/>' +
      '<text class="dg-t" x="' + (x + 12) + '" y="' + (y + 22) + '">' + t + '</text>' + (s ? '<text class="dg-s" x="' + (x + 12) + '" y="' + (y + 40) + '">' + s + '</text>' : '');
    const arrow = (x1, y1, x2, y2) => '<path class="dg-a" d="M' + x1 + ' ' + y1 + ' C' + ((x1 + x2) / 2) + ' ' + y1 + ' ' + ((x1 + x2) / 2) + ' ' + y2 + ' ' + x2 + ' ' + y2 + '" marker-end="url(#ah)"/>';
    let s = '<svg viewBox="0 0 980 440" role="img" aria-label="Diagrama de blocos: entradas, processamento e saídas"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="dg-ah" d="M0 0 10 5 0 10z"/></marker></defs>';
    s += '<text class="dg-h" x="20" y="24">ENTRADAS</text><text class="dg-h" x="370" y="24">PROCESSAMENTO · ATmega328P</text><text class="dg-h" x="760" y="24">SAÍDAS E COMUNICAÇÃO</text>';
    const ins = [['Botão de pedestre', 'D2 · INT0 (interrupção)'], ['Botão de modo', 'D4 · polling 50 ms'], ['HC-SR04', 'TRIG D6 → · ECHO D7 ←'], ['Monitor Serial (RX)', 'UART · N D P S']];
    ins.forEach((t, i) => { s += box(20, 44 + i * 96, 220, 56, 'dg-in', t[0], t[1]); });
    s += '<rect class="dg-box dg-proc" x="330" y="44" width="330" height="376" rx="8" stroke-width="1.5"/>';
    const tasks = [['ISR isrBotaoPedestre', 'debounce 200 ms → semáforo'], ['Tarefa FSM · prio 3', '6 estados, timers millis()'], ['Tarefa SENSOR · prio 2', 'pulseIn, falhas, distância'], ['Tarefa ENTRADAS · prio 2', 'botão D4 + UART'], ['Tarefa SINALIZAÇÃO · prio 1', 'PWM, buzzer, rampa do servo'], ['Tarefa LOGGER · prio 1', 'fila de eventos → UART']];
    tasks.forEach((t, i) => { s += box(346, 58 + i * 59, 298, 48, '', t[0], t[1]); });
    const outs = [['LEDs veículos', 'D3 · D5 · D11 (PWM)'], ['LEDs pedestre', 'D12 · D13'], ['Buzzer', 'D8'], ['Servo da cancela', 'D9 · PWM 50 Hz'], ['Monitor Serial (TX)', 'UART 9600 8N1']];
    outs.forEach((t, i) => { s += box(740, 44 + i * 77, 220, 56, 'dg-out', t[0], t[1]); });
    s += arrow(240, 72, 346, 82) + arrow(240, 168, 346, 259) + arrow(240, 264, 346, 200) + arrow(240, 360, 346, 259);
    s += arrow(644, 141, 740, 72) + arrow(644, 318, 740, 72) + arrow(644, 318, 740, 149) + arrow(644, 318, 740, 226) + arrow(644, 318, 740, 303) + arrow(644, 377, 740, 380);
    s += '</svg>';
    $('#blockDiagram').innerHTML = s;
  }
  function fsmDiagram() {
    const N = [[40, 84, 'S0 VEIC_VERDE', 'verde ≥ 10 s', 'var(--green)'], [330, 84, 'S1 VEIC_AMARELO', '3 s', 'var(--amber)'], [620, 84, 'S2 TODOS_VERMELHO', '1 s · cancela desce', 'var(--red)'],
      [620, 244, 'S3 PED_VERDE', '7 s · bipe lento', 'var(--teal-2)'], [330, 244, 'S4 PED_PISCANDO', '4 s · bipe rápido', 'var(--violet)'], [40, 244, 'S5 LIBERANDO', '1,5 s · cancela sobe', 'var(--red)']];
    let s = '<svg viewBox="0 0 900 380" role="img" aria-label="Máquina de estados do semáforo"><defs><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="dg-ah" d="M0 0 10 5 0 10z"/></marker></defs>';
    N.forEach(n => {
      s += '<rect class="dg-box" x="' + n[0] + '" y="' + n[1] + '" width="240" height="64" rx="8" stroke="' + n[4] + '" stroke-width="2"/>' +
        '<text class="dg-t" x="' + (n[0] + 14) + '" y="' + (n[1] + 26) + '">' + n[2] + '</text><text class="dg-s" x="' + (n[0] + 14) + '" y="' + (n[1] + 46) + '">' + n[3] + '</text>';
    });
    const a = (d, lx, ly, t) => '<path class="dg-a" d="' + d + '" marker-end="url(#ah2)"/>' + (t ? '<text class="dg-s" x="' + lx + '" y="' + ly + '">' + t + '</text>' : '');
    s += '<text class="dg-s" x="40" y="26">O pedido do pedestre (ISR) só muda a variável pedidoPendente; nunca interrompe uma fase.</text>';
    s += a('M280 116 H328', 0, 0, '');
    s += '<text class="dg-s" x="250" y="62">pedido pendente</text><text class="dg-s" x="250" y="76">+ verde mínimo</text>';
    s += a('M570 116 H618', 0, 0, '');
    s += a('M740 148 V242', 750, 200, 'tempo');
    s += a('M620 276 H572', 0, 0, '');
    s += a('M330 276 H282', 0, 0, '');
    s += a('M160 242 V150', 170, 200, 'tempo');
    s += a('M430 308 C430 350 480 350 480 312', 492, 346, 'faixa ocupada: +extensão (máx. 2)');
    s += '<text class="dg-s" x="40" y="336">S4 → S5: tempo esgotado com a faixa livre</text><text class="dg-s" x="40" y="350">ou 2 extensões já usadas</text>';
    s += '</svg>';
    $('#fsmDiagram').innerHTML = s;
  }
  function buildTests() {
    const tb = $('#testTable tbody');
    tb.innerHTML = FW.TESTS.map(t => '<tr data-id="' + t.id + '"><td class="mono">' + t.id + '</td><td><b>' + esc(t.nome) + '</b></td><td>' + esc(t.condicao) + '</td><td>' + esc(t.esperado) +
      '</td><td class="obs">—</td><td><span class="res wait">não executado</span><br><button class="btn ghost small" data-run="' + t.id + '" style="margin-top:6px">Executar</button></td></tr>').join('');
    $$('[data-run]').forEach(b => b.addEventListener('click', () => runTest(b.dataset.run)));
  }
  function runTest(id) {
    const t = FW.TESTS.find(x => x.id === id); const row = $('#testTable tr[data-id="' + id + '"]');
    let r; try { r = t.run(); } catch (e) { r = { pass: false, obs: 'Erro: ' + e.message }; }
    row.querySelector('.obs').textContent = r.obs;
    const res = row.querySelector('.res'); res.className = 'res ' + (r.pass ? 'ok' : 'fail'); res.textContent = r.pass ? 'PASSOU' : 'FALHOU';
    return r.pass;
  }
  $('#runTests').addEventListener('click', () => {
    const t0 = performance.now(); let ok = 0;
    FW.TESTS.forEach(t => { if (runTest(t.id)) ok++; });
    $('#testSummary').textContent = ok + ' de ' + FW.TESTS.length + ' testes passaram · ' + Math.round(performance.now() - t0) + ' ms (≈ ' + Math.round(FW.TESTS.length * 25) + ' s de firmware simulado)';
  });

  // equipe (editável, salva no navegador)
  const TEAM_DEFAULT = [
    { who: 'Integrante 1', role: 'Firmware e RTOS', tasks: ['Tarefas FreeRTOS e prioridades', 'Máquina de estados', 'Modo noturno'] },
    { who: 'Integrante 2', role: 'Hardware e montagem', tasks: ['Mapa de conexões', 'Montagem no Wokwi e protoboard', 'Cálculo dos resistores'] },
    { who: 'Integrante 3', role: 'Testes e validação', tasks: ['Plano de testes', 'Cenários de falha e limite', 'Registro dos resultados'] },
    { who: 'Integrante 4', role: 'Documentação e apresentação', tasks: ['Diagrama de blocos', 'Histórico e contexto', 'Roteiro da demonstração'] }
  ];
  function loadTeam() { try { const v = JSON.parse(localStorage.getItem('ti-team')); if (Array.isArray(v)) return v; } catch (e) { /* sem armazenamento */ } return TEAM_DEFAULT; }
  function saveTeam() {
    const data = $$('#team .member').map(m => ({ who: $('.who', m).textContent, role: $('.role', m).textContent, tasks: $$('li', m).map(l => l.textContent) }));
    try { localStorage.setItem('ti-team', JSON.stringify(data)); } catch (e) { /* ignora */ }
  }
  function buildTeam() {
    $('#team').innerHTML = loadTeam().map(m => '<div class="member"><div class="who" contenteditable="true" spellcheck="false">' + esc(m.who) + '</div><div class="role" contenteditable="true">' + esc(m.role) +
      '</div><ul>' + m.tasks.map(t => '<li contenteditable="true">' + esc(t) + '</li>').join('') + '</ul></div>').join('');
    $('#team').addEventListener('input', saveTeam);
  }
  // sumário
  $$('#toc a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const el = document.getElementById(a.dataset.sec); if (el) el.scrollIntoView({ behavior: 'smooth' }); }));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(ents => ents.forEach(en => { if (en.isIntersecting) $$('#toc a').forEach(a => a.classList.toggle('on', a.dataset.sec === en.target.id)); }), { rootMargin: '-30% 0px -60% 0px' });
    $$('.doc section').forEach(s => io.observe(s));
  }
  // demonstrações
  $$('[data-demo]').forEach(a => a.addEventListener('click', () => {
    const d = a.dataset.demo;
    setSimApp('travessia');
    setTimeout(() => {
      if (d === 'normal') { sim.spawnPed('normal'); note(simSerial, 'demonstração: cenário normal'); }
      if (d === 'limite') { sim.spawnPed('idoso'); setTimeout(() => sim.spawnPed('parado'), 2500); note(simSerial, 'demonstração: pedestre idoso e pessoa parada na faixa'); }
      if (d === 'falha') { simFW.sensorConectado = false; const b = $('#sFault'); b.setAttribute('aria-pressed', 'true'); b.textContent = 'Reconectar sensor'; sim.spawnPed('normal'); note(simSerial, 'demonstração: HC-SR04 desconectado'); }
      if (d === 'bounce') $('#sSpam').click();
    }, 300);
  }));

  /* ===================== laço principal ===================== */
  let last = performance.now(), tipT = 0, hudT = 0;
  function loop(now) { frame(now); requestAnimationFrame(loop); }
  // gancho para testes automatizados: avança N segundos de animação
  window.__tick = (sec) => { for (let i = 0; i < sec * 30; i++) frame(last + 1000 / 30); };
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (has3D) {
      if (S.view === 'inicio' || (S.view === 'simulacao' && !S.simPaused)) {
        const k = S.view === 'inicio' ? 1 : S.speed;
        const total = dt * k; const n = Math.ceil(total / 0.04);
        for (let i = 0; i < n; i++) {
          const h = total / n;
          if (S.view === 'inicio' || S.simApp === 'travessia') { simFW.step(h * 1000); sim.step(h, simFW, simFWE); }
          else { simFWE.step(h * 1000); sim.step(h, simFW, simFWE); }
        }
        sim.setNight(S.view === 'inicio' || S.simApp === 'travessia' ? simFW.modoNoturno : false);
        if (S.view === 'simulacao' && S.simApp === 'travessia') buzz(simFW.out.buzzer);
      }
      if (S.view === 'inicio' || S.view === 'simulacao') sim.render();
      if (S.view === 'projeto') {
        if (S.projRunning) projFW.step(dt * 1000);
        proj.update(projFW, dt, S.projRunning, { distance: Number($('#distSlider').value), lastTx: S.tx.proj, lastRx: S.rx.proj });
        proj.render();
        buzz(S.projRunning && projFW.out && projFW.out.buzzer);
        $('#projClock').textContent = fmtClock(S.projRunning ? projFW.t : 0);
      }
      if (S.view !== 'projeto' && S.view !== 'simulacao') buzz(false);
    }
    if (now - tipT > 150) {
      tipT = now;
      if (S.view === 'projeto') { if (S.hoverProj) renderProjTip(); updateInfoLive(); }
      if (S.view === 'simulacao' && S.hoverSim) renderSimTip();
    }
    if (S.view === 'simulacao' && now - hudT > 100) {
      hudT = now; updateHud();
      $('#simClock').textContent = fmtClock(S.simApp === 'travessia' ? simFW.t : simFWE.t);
    }
  }

  /* ===================== início ===================== */
  buildBOM(); blockDiagram(); fsmDiagram(); buildTests(); buildTeam();
  route();
  requestAnimationFrame(loop);
})();
