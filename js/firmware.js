/* =====================================================================
 * Emulador em JavaScript dos dois firmwares.
 * A lógica espelha linha a linha os arquivos .ino em /firmware, para que
 * a simulação 3D e o plano de testes executem exatamente as mesmas regras.
 * ===================================================================== */
(function () {
  'use strict';

  const DIA   = { verdeMin: 10000, amarelo: 3000, todosVerm: 1000, pedVerde: 7000,  pedPisca: 4000, extensao: 2000, brilho: 255 };
  const NOITE = { verdeMin: 4000,  amarelo: 4000, todosVerm: 2000, pedVerde: 10000, pedPisca: 5000, extensao: 3000, brilho: 80 };
  const T_LIBERANDO = 1500;
  const MAX_EXTENSOES = 2;
  const LIMIAR_PRESENCA_CM = 250;
  const FALHAS_PARA_ERRO = 3;
  const ESTADOS = ['VEIC_VERDE', 'VEIC_AMARELO', 'TODOS_VERMELHO', 'PED_VERDE', 'PED_PISCANDO', 'LIBERANDO'];
  const S = { VEIC_VERDE: 0, VEIC_AMARELO: 1, TODOS_VERMELHO: 2, PED_VERDE: 3, PED_PISCANDO: 4, LIBERANDO: 5 };

  // períodos das tarefas (ms) — iguais ao firmware (tick de 15 ms do AVR)
  const PERIODOS = { FSM: 45, SENS: 100, IN: 50, SIG: 20 };

  function fmtT(ms) { return '[' + (ms / 1000).toFixed(3) + 's] '; }

  /* ------------------------------------------------------------------ */
  class TravessiaFirmware {
    constructor() { this.listeners = {}; this.reset(); }

    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
    emit(ev, a) { (this.listeners[ev] || []).forEach(f => f(a)); }

    reset() {
      this.t = 0;
      this.estado = S.VEIC_VERDE;
      this.inicioFase = 0;
      this.modoNoturno = false;
      this.pedidoPendente = false;
      this.sensorOk = true;
      this.sensorConectado = true;
      this.distanciaCm = 350;
      this.falhas = 0;
      this.extensoes = 0;
      this.ultimoToque = -1e9;
      this.semPedido = false;        // semáforo binário (ISR -> FSM)
      this.servoAlvo = 0;
      this.servoAngulo = 0;          // ângulo comandado pela rampa de 3°/20 ms
      this.out = { carG: 0, carY: 0, carR: 0, pedG: 0, pedR: 1, buzzer: 0, servo: 0 };
      this.btnModoNivel = 1;         // pino D4 (pull-up: solto = 1)
      this.btnPedNivel = 1;          // pino D2
      this.inPrev = 1; this.inEstavel = 1;
      this.uartRx = [];
      this.fila = [];                // fila de eventos para o logger
      this.lines = [];
      this.next = { FSM: 0, SENS: 0, IN: 0, SIG: 0 };
      this.taskRuns = { ISR: -1e9, FSM: -1e9, SENS: -1e9, IN: -1e9, SIG: -1e9, LOG: -1e9 };
      this.distanceProvider = null;
      this.history = [{ t: 0, estado: S.VEIC_VERDE }];
      this.stats = { pedidos: 0, ignorados: 0, repetidos: 0, extensoes: 0, limites: 0, isr: 0, bounceFiltrado: 0 };
      this.pendingRelease = [];
      this.started = false;
    }

    get tempos() { return this.modoNoturno ? NOITE : DIA; }
    get nomeEstado() { return ESTADOS[this.estado]; }

    /* ---------- registro (logger) ---------- */
    logar(tipo, valor) { this.fila.push({ tipo, valor, t: this.t }); }
    print(txt, kind) {
      const line = { t: this.t, text: txt, kind: kind || 'info' };
      this.lines.push(line);
      if (this.lines.length > 400) this.lines.shift();
      this.emit('log', line);
    }
    tarefaLogger() {
      while (this.fila.length) {
        const e = this.fila.shift();
        this.taskRuns.LOG = this.t;
        const p = fmtT(e.t);
        switch (e.tipo) {
          case 'ESTADO': this.print(p + 'ESTADO -> ' + ESTADOS[e.valor], 'state'); break;
          case 'PEDIDO': this.print(p + 'PEDIDO registrado durante ' + ESTADOS[e.valor], 'event'); break;
          case 'PEDIDO_IGNORADO': this.print(p + 'PEDIDO ignorado: travessia em andamento (' + ESTADOS[e.valor] + ')', 'muted'); break;
          case 'PEDIDO_REPETIDO': this.print(p + 'PEDIDO repetido: ja estava na fila', 'muted'); break;
          case 'MODO': this.print(p + (e.valor ? 'MODO -> NOTURNO (PWM 80)' : 'MODO -> DIURNO (PWM 255)'), 'event'); break;
          case 'SENSOR_FALHA': this.print(p + 'ERRO: HC-SR04 sem eco. Operando so por tempo', 'error'); break;
          case 'SENSOR_OK': this.print(p + 'HC-SR04 voltou a responder', 'event'); break;
          case 'EXTENSAO': this.print(p + 'Pedestre na faixa: extensao ' + e.valor + '/2', 'warn'); break;
          case 'LIMITE': this.print(p + 'LIMITE: extensoes esgotadas, liberando veiculos', 'error'); break;
          case 'CMD_INVALIDO': this.print(p + 'Comando desconhecido: ' + e.valor, 'warn'); break;
          case 'STATUS':
            this.print(p + 'STATUS estado=' + ESTADOS[this.estado] + ' modo=' + (this.modoNoturno ? 'NOTURNO' : 'DIURNO') +
              ' dist=' + this.distanciaCm.toFixed(1) + 'cm sensor=' + (this.sensorOk ? 'OK' : 'FALHA') +
              ' pedido=' + (this.pedidoPendente ? 'sim' : 'nao'), 'info');
            break;
        }
      }
    }

    /* ---------- entradas externas ---------- */
    // [M2] ISR — chamada na borda de descida do D2
    isrBotaoPedestre() {
      this.taskRuns.ISR = this.t;
      this.stats.isr++;
      if (this.t - this.ultimoToque < 200) { this.stats.bounceFiltrado++; return; }
      this.ultimoToque = this.t;
      this.semPedido = true;
    }
    pressPedButton() {
      this.btnPedNivel = 0;
      this.isrBotaoPedestre();
      this.pendingRelease.push({ t: this.t + 150, fn: () => { this.btnPedNivel = 1; } });
    }
    tapModeButton() {
      this.btnModoNivel = 0;
      this.pendingRelease.push({ t: this.t + 200, fn: () => { this.btnModoNivel = 1; } });
    }
    sendUart(str) { for (const c of String(str)) this.uartRx.push(c); }

    /* ---------- [M3] sensor ---------- */
    tarefaSensor() {
      this.taskRuns.SENS = this.t;
      let d = this.distanceProvider ? this.distanceProvider() : 350;
      if (!this.sensorConectado || d == null) {
        if (++this.falhas >= FALHAS_PARA_ERRO && this.sensorOk) { this.sensorOk = false; this.logar('SENSOR_FALHA'); }
      } else {
        this.falhas = 0;
        if (!this.sensorOk) { this.sensorOk = true; this.logar('SENSOR_OK'); }
        d = Math.max(2, Math.min(400, d));
        const dur = Math.round(d / 0.017);           // tempo de eco que o sensor devolveria
        this.ecoUs = dur;
        this.distanciaCm = 0.017 * dur;              // fórmula do vídeo
      }
    }

    /* ---------- [M4] entradas ---------- */
    aplicarModo(noite) {
      if (this.modoNoturno === noite) return;
      this.modoNoturno = noite;
      this.logar('MODO', noite ? 1 : 0);
    }
    tarefaEntradas() {
      this.taskRuns.IN = this.t;
      const leitura = this.btnModoNivel;
      if (leitura === this.inPrev && leitura !== this.inEstavel) {
        this.inEstavel = leitura;
        if (this.inEstavel === 0) this.aplicarModo(!this.modoNoturno);
      }
      this.inPrev = leitura;
      while (this.uartRx.length) {
        const c = this.uartRx.shift().toUpperCase();
        if (c === '\n' || c === '\r' || c === ' ') continue;
        switch (c) {
          case 'N': this.aplicarModo(true); break;
          case 'D': this.aplicarModo(false); break;
          case 'P': this.semPedido = true; break;
          case 'S': this.logar('STATUS'); break;
          default: this.logar('CMD_INVALIDO', c);
        }
      }
    }

    /* ---------- [M5] FSM ---------- */
    mudarEstado(novo) {
      this.estado = novo;
      this.inicioFase = this.t;
      this.history.push({ t: this.t, estado: novo });
      if (this.history.length > 200) this.history.shift();
      this.logar('ESTADO', novo);
      this.emit('state', novo);
    }
    registrarPedido() {
      const e = this.estado;
      if (e === S.VEIC_VERDE || e === S.PED_PISCANDO || e === S.LIBERANDO) {
        if (this.pedidoPendente) { this.stats.repetidos++; this.logar('PEDIDO_REPETIDO'); return; }
        this.pedidoPendente = true;
        this.stats.pedidos++;
        this.logar('PEDIDO', e);
      } else {
        this.stats.ignorados++;
        this.logar('PEDIDO_IGNORADO', e);
      }
    }
    tarefaFSM() {
      this.taskRuns.FSM = this.t;
      if (!this.started) { this.started = true; this.mudarEstado(S.VEIC_VERDE); }
      if (this.semPedido) { this.semPedido = false; this.registrarPedido(); }
      const t = this.tempos;
      const dt = this.t - this.inicioFase;
      switch (this.estado) {
        case S.VEIC_VERDE:
          if (this.pedidoPendente && dt >= t.verdeMin) { this.pedidoPendente = false; this.mudarEstado(S.VEIC_AMARELO); }
          break;
        case S.VEIC_AMARELO: if (dt >= t.amarelo) this.mudarEstado(S.TODOS_VERMELHO); break;
        case S.TODOS_VERMELHO: if (dt >= t.todosVerm) { this.extensoes = 0; this.mudarEstado(S.PED_VERDE); } break;
        case S.PED_VERDE: if (dt >= t.pedVerde) this.mudarEstado(S.PED_PISCANDO); break;
        case S.PED_PISCANDO:
          if (dt >= t.pedPisca) {
            const ocupado = this.sensorOk && this.distanciaCm < LIMIAR_PRESENCA_CM;
            if (ocupado && this.extensoes < MAX_EXTENSOES) {
              this.extensoes++;
              this.stats.extensoes++;
              this.inicioFase = this.t - (t.pedPisca - t.extensao);
              this.logar('EXTENSAO', this.extensoes);
            } else {
              if (ocupado) { this.stats.limites++; this.logar('LIMITE'); }
              this.mudarEstado(S.LIBERANDO);
            }
          }
          break;
        case S.LIBERANDO: if (dt >= T_LIBERANDO) this.mudarEstado(S.VEIC_VERDE); break;
      }
    }

    /* ---------- [M6] sinalização ---------- */
    tarefaSinalizacao() {
      this.taskRuns.SIG = this.t;
      const e = this.estado, dt = this.t - this.inicioFase, b = this.tempos.brilho;
      const o = this.out;
      o.carG = e === S.VEIC_VERDE ? b : 0;
      o.carY = e === S.VEIC_AMARELO ? b : 0;
      o.carR = e >= S.TODOS_VERMELHO ? b : 0;
      const pisca = Math.floor(dt / 250) % 2 === 0;
      o.pedG = e === S.PED_VERDE ? 1 : 0;
      o.pedR = e === S.PED_PISCANDO ? (pisca ? 1 : 0) : (e !== S.PED_VERDE ? 1 : 0);
      let bip = false;
      if (e === S.PED_VERDE) bip = (dt % 1000) < 100;
      if (e === S.PED_PISCANDO) bip = (dt % 250) < 60;
      o.buzzer = bip ? 1 : 0;
      const fechar = e === S.TODOS_VERMELHO || e === S.PED_VERDE || e === S.PED_PISCANDO;
      this.servoAlvo = fechar ? 90 : 0;
      if (this.servoAngulo < this.servoAlvo) this.servoAngulo = Math.min(this.servoAngulo + 3, this.servoAlvo);
      if (this.servoAngulo > this.servoAlvo) this.servoAngulo = Math.max(this.servoAngulo - 3, this.servoAlvo);
      o.servo = this.servoAngulo;
    }

    /* ---------- escalonador (prioridade: FSM > SENS = IN > SIG > LOG) ---------- */
    step(dtMs) {
      const end = this.t + dtMs;
      if (this.t === 0 && !this.bootPrinted) {
        this.bootPrinted = true;
        this.print('Travessia Inteligente pronta. Comandos: N=noite D=dia P=pedido S=status', 'muted');
      }
      while (this.t < end) {
        this.t = Math.min(end, this.t + 5);
        for (let i = this.pendingRelease.length - 1; i >= 0; i--) {
          if (this.t >= this.pendingRelease[i].t) { this.pendingRelease[i].fn(); this.pendingRelease.splice(i, 1); }
        }
        if (this.t >= this.next.FSM) { this.tarefaFSM(); this.next.FSM += PERIODOS.FSM; }
        if (this.t >= this.next.SENS) { this.tarefaSensor(); this.next.SENS += PERIODOS.SENS; }
        if (this.t >= this.next.IN) { this.tarefaEntradas(); this.next.IN += PERIODOS.IN; }
        if (this.t >= this.next.SIG) { this.tarefaSinalizacao(); this.next.SIG += PERIODOS.SIG; }
        if (this.fila.length) this.tarefaLogger();
      }
    }

    phaseInfo() {
      const t = this.tempos, dt = this.t - this.inicioFase;
      const durs = [t.verdeMin, t.amarelo, t.todosVerm, t.pedVerde, t.pedPisca, T_LIBERANDO];
      const dur = durs[this.estado];
      return { estado: this.estado, nome: ESTADOS[this.estado], dt, dur, frac: Math.min(1, dt / dur) };
    }
  }

  /* ------------------------------------------------------------------ */
  // Emulador do código ORIGINAL do vídeo (loop + delay(500)).
  class VideoFirmware {
    constructor(threshold) { this.threshold = threshold || 50; this.listeners = {}; this.reset(); }
    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
    emit(ev, a) { (this.listeners[ev] || []).forEach(f => f(a)); }
    reset() {
      this.t = 0; this.nextLoop = 0; this.servo = 0; this.distance = 0; this.duration = 0;
      this.sensorConectado = true; this.distanceProvider = null; this.lines = []; this.loops = 0;
      this.out = { servo: 0 }; this.taskRuns = { LOOP: -1e9 };
    }
    print(text, kind) {
      const line = { t: this.t, text, kind: kind || 'info' };
      this.lines.push(line); if (this.lines.length > 400) this.lines.shift();
      this.emit('log', line);
    }
    loop() {
      this.taskRuns.LOOP = this.t; this.loops++;
      let d = this.distanceProvider ? this.distanceProvider() : 400;
      let extra = 0;
      if (!this.sensorConectado || d == null) {
        // pulseIn sem timeout espera 1 s e devolve 0 -> distância 0 cm (< limiar!)
        this.duration = 0; extra = 1000;
      } else {
        d = Math.max(2, Math.min(400, d));
        this.duration = Math.round(d / 0.017);
      }
      this.distance = 0.017 * this.duration;
      this.servo = this.distance < this.threshold ? 90 : 0;
      this.out.servo = this.servo;
      this.print('distance: ' + this.distance.toFixed(2) + ' cm', this.servo ? 'event' : 'info');
      this.nextLoop = this.t + 500 + extra + Math.round(this.duration / 1000);
    }
    step(dtMs) {
      const end = this.t + dtMs;
      while (this.t < end) {
        this.t = Math.min(end, this.t + 5);
        if (this.t >= this.nextLoop) this.loop();
      }
    }
  }

  /* ------------------------------------------------------------------ */
  // PLANO DE TESTES automatizado: cada teste roda uma instância nova do
  // firmware em tempo acelerado e compara com o resultado esperado.
  function seqFrom(fw, fromT) {
    return fw.history.filter(h => h.t >= fromT).map(h => ({ n: ESTADOS[h.estado], t: h.t }));
  }
  function durations(fw) {
    const h = fw.history, out = [];
    for (let i = 1; i < h.length; i++) out.push({ n: ESTADOS[h[i - 1].estado], d: h[i].t - h[i - 1].t });
    return out;
  }
  const near = (a, b, tol) => Math.abs(a - b) <= (tol || 60);

  const TESTS = [
    {
      id: 'T01', nome: 'Ciclo normal completo',
      condicao: 'Pedido no botão D2 aos 12 s (verde mínimo já cumprido), sensor livre (350 cm).',
      esperado: 'VERDE → AMARELO 3 s → TODOS_VERM 1 s → PED_VERDE 7 s → PISCANDO 4 s → LIBERANDO 1,5 s → VERDE.',
      run() {
        const fw = new TravessiaFirmware(); fw.distanceProvider = () => 350;
        fw.step(12000); fw.pressPedButton(); fw.step(20000);
        const ds = durations(fw).slice(1, 7);
        const exp = [['VEIC_AMARELO', 3000], ['TODOS_VERMELHO', 1000], ['PED_VERDE', 7000], ['PED_PISCANDO', 4000], ['LIBERANDO', 1500]];
        const ok = exp.every((e, i) => ds[i + 1] && ds[i + 1].n === e[0] && near(ds[i + 1].d, e[1]));
        return { pass: ok && fw.estado === S.VEIC_VERDE, obs: ds.slice(1).map(d => d.n + ' ' + (d.d / 1000).toFixed(2) + 's').join(' → ') };
      }
    },
    {
      id: 'T02', nome: 'Verde mínimo respeitado',
      condicao: 'Pedido logo após o verde começar (t = 0,5 s).',
      esperado: 'Pedido fica pendente; AMARELO só começa em ≈ 10 s.',
      run() {
        const fw = new TravessiaFirmware(); fw.step(500); fw.pressPedButton(); fw.step(12000);
        const am = fw.history.find(h => h.estado === S.VEIC_AMARELO);
        return { pass: !!am && near(am.t, 10000, 60), obs: am ? 'AMARELO iniciou em ' + (am.t / 1000).toFixed(3) + ' s' : 'AMARELO não ocorreu' };
      }
    },
    {
      id: 'T03', nome: 'Bounce do botão (limite)',
      condicao: '10 bordas de descida em 90 ms no D2 (contato mecânico trepidando).',
      esperado: 'ISR chamada 10×, apenas 1 pedido registrado (debounce 200 ms).',
      run() {
        const fw = new TravessiaFirmware(); fw.step(11000);
        for (let i = 0; i < 10; i++) { fw.isrBotaoPedestre(); fw.step(10); }
        fw.step(200);
        return { pass: fw.stats.isr === 10 && fw.stats.pedidos === 1, obs: 'ISR: ' + fw.stats.isr + ' chamadas · filtradas: ' + fw.stats.bounceFiltrado + ' · pedidos: ' + fw.stats.pedidos };
      }
    },
    {
      id: 'T04', nome: 'Pedido durante travessia',
      condicao: 'Botão apertado 2 s após o PED_VERDE começar.',
      esperado: 'Pedido ignorado; PED_VERDE dura os 7 s completos (não reinicia).',
      run() {
        const fw = new TravessiaFirmware(); fw.step(11000); fw.pressPedButton(); fw.step(6200);
        fw.pressPedButton(); fw.step(8000);
        const d = durations(fw).find(x => x.n === 'PED_VERDE');
        return { pass: fw.stats.ignorados === 1 && d && near(d.d, 7000), obs: 'ignorados: ' + fw.stats.ignorados + ' · PED_VERDE durou ' + (d ? (d.d / 1000).toFixed(2) : '?') + ' s' };
      }
    },
    {
      id: 'T05', nome: 'Pedido no piscante vai para o próximo ciclo',
      condicao: 'Botão apertado durante PED_PISCANDO.',
      esperado: 'Ciclo atual termina normalmente; novo AMARELO ocorre após novo verde mínimo de 10 s.',
      run() {
        const fw = new TravessiaFirmware(); fw.step(11000); fw.pressPedButton(); fw.step(13000);
        const ok1 = fw.estado === S.PED_PISCANDO; fw.pressPedButton(); fw.step(16000);
        const verdes = fw.history.filter(h => h.estado === S.VEIC_VERDE);
        const amarelos = fw.history.filter(h => h.estado === S.VEIC_AMARELO);
        const vLast = verdes[verdes.length - 1];   // verde que começou depois do LIBERANDO
        const gap = amarelos[1] && vLast ? amarelos[1].t - vLast.t : NaN;
        return { pass: ok1 && near(gap, 10000, 60), obs: 'pedido em PISCANDO: ' + (ok1 ? 'sim' : 'não') + ' · 2º amarelo ' + (gap / 1000).toFixed(2) + ' s após o verde' };
      }
    },
    {
      id: 'T06', nome: 'Pedestre lento na faixa (extensão)',
      condicao: 'Sensor lê 180 cm (pessoa sob o sensor) no fim do piscante, livre depois de 1 extensão.',
      esperado: '1 extensão de 2 s e depois LIBERANDO.',
      run() {
        const fw = new TravessiaFirmware(); let occ = true; fw.distanceProvider = () => occ ? 180 : 350;
        fw.step(11000); fw.pressPedButton(); fw.step(14900);  // ~fim do piscante
        fw.step(400); occ = false; fw.step(4000);
        const d = durations(fw).find(x => x.n === 'PED_PISCANDO');
        return { pass: fw.stats.extensoes === 1 && fw.stats.limites === 0 && d && near(d.d, 6000, 80), obs: 'extensões: ' + fw.stats.extensoes + ' · PISCANDO durou ' + (d ? (d.d / 1000).toFixed(2) : '?') + ' s' };
      }
    },
    {
      id: 'T07', nome: 'Pessoa parada na faixa (limite)',
      condicao: 'Sensor sempre ocupado (150 cm) durante toda a travessia.',
      esperado: 'Exatamente 2 extensões, aviso LIMITE na UART e os veículos são liberados.',
      run() {
        const fw = new TravessiaFirmware(); fw.distanceProvider = () => 150;
        fw.step(11000); fw.pressPedButton(); fw.step(25000);
        const lib = fw.history.some(h => h.estado === S.LIBERANDO);
        return { pass: fw.stats.extensoes === 2 && fw.stats.limites === 1 && lib, obs: 'extensões: ' + fw.stats.extensoes + ' · LIMITE: ' + fw.stats.limites + ' · liberou: ' + (lib ? 'sim' : 'não') };
      }
    },
    {
      id: 'T08', nome: 'Falha do sensor (cabo solto)',
      condicao: 'HC-SR04 desconectado antes do pedido.',
      esperado: 'Após 3 leituras sem eco: ERRO na UART, sem extensões; ciclo continua por tempo.',
      run() {
        const fw = new TravessiaFirmware(); fw.step(5000); fw.sensorConectado = false; fw.step(6000);
        fw.pressPedButton(); fw.step(20000);
        const erro = fw.lines.some(l => l.text.includes('ERRO'));
        return { pass: !fw.sensorOk && erro && fw.stats.extensoes === 0 && fw.estado === S.VEIC_VERDE && fw.history.length >= 7, obs: 'sensorOk=' + fw.sensorOk + ' · ERRO impresso: ' + (erro ? 'sim' : 'não') + ' · ciclos completos: ' + (fw.history.filter(h => h.estado === S.LIBERANDO).length) };
      }
    },
    {
      id: 'T09', nome: 'Modo noturno por UART',
      condicao: 'Comando "N" no Monitor Serial e pedido aos 5 s.',
      esperado: 'Brilho PWM 80; verde mínimo 4 s; PED_VERDE 10 s.',
      run() {
        const fw = new TravessiaFirmware(); fw.sendUart('N'); fw.step(5000); fw.pressPedButton(); fw.step(9000);
        const brilho = fw.out.carR;
        fw.step(14000);
        const d = durations(fw).find(x => x.n === 'PED_VERDE');
        return { pass: fw.modoNoturno && brilho === 80 && d && near(d.d, 10000), obs: 'modo noturno: ' + fw.modoNoturno + ' · PWM vermelho: ' + brilho + ' · PED_VERDE ' + (d ? (d.d / 1000).toFixed(2) : '?') + ' s' };
      }
    },
    {
      id: 'T10', nome: 'Botão de modo por polling',
      condicao: 'Botão D4 apertado por 200 ms, duas vezes.',
      esperado: 'Alterna DIURNO → NOTURNO → DIURNO (borda detectada pelo polling de 50 ms).',
      run() {
        const fw = new TravessiaFirmware(); fw.step(1000); fw.tapModeButton(); fw.step(500);
        const a = fw.modoNoturno; fw.tapModeButton(); fw.step(500);
        return { pass: a === true && fw.modoNoturno === false, obs: 'após 1º toque: ' + (a ? 'NOTURNO' : 'DIURNO') + ' · após 2º: ' + (fw.modoNoturno ? 'NOTURNO' : 'DIURNO') };
      }
    },
    {
      id: 'T11', nome: 'Comando inválido na UART',
      condicao: 'Envio de "X" pelo Monitor Serial.',
      esperado: 'Mensagem "Comando desconhecido: X" e estado inalterado.',
      run() {
        const fw = new TravessiaFirmware(); fw.step(1000); const e0 = fw.estado; fw.sendUart('X'); fw.step(200);
        const msg = fw.lines.find(l => l.text.includes('desconhecido'));
        return { pass: !!msg && fw.estado === e0, obs: msg ? msg.text : 'sem mensagem' };
      }
    },
    {
      id: 'T12', nome: 'Código original: sensor sem eco',
      condicao: 'Firmware do vídeo com HC-SR04 desconectado.',
      esperado: 'pulseIn() devolve 0 → distância 0 cm → servo vai a 90° (falha insegura que o firmware novo corrige).',
      run() {
        const fw = new VideoFirmware(50); fw.distanceProvider = () => 300; fw.step(1200);
        const s0 = fw.servo; fw.sensorConectado = false; fw.step(2500);
        return { pass: s0 === 0 && fw.servo === 90, obs: 'servo com sensor ok: ' + s0 + '° · desconectado: ' + fw.servo + '° · última leitura ' + fw.distance.toFixed(2) + ' cm' };
      }
    }
  ];

  window.FW = { TravessiaFirmware, VideoFirmware, TESTS, ESTADOS, S, DIA, NOITE, T_LIBERANDO, MAX_EXTENSOES, LIMIAR_PRESENCA_CM };
})();
