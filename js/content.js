/* =====================================================================
 * Conteúdo das peças: especificação, função, funcionamento no projeto,
 * ligações e explicação ao vivo (hover com o sistema ligado).
 * ===================================================================== */
(function () {
  'use strict';
  const S = () => window.FW.S;
  const nome = e => window.FW.ESTADOS[e];
  const seg = ms => (ms / 1000).toFixed(1) + ' s';
  const pwmPct = v => Math.round(v / 255 * 100) + '%';
  const on = (v, txt) => v ? '<b class="t-on">' + (txt || 'LIGADO') + '</b>' : '<b class="t-off">desligado</b>';

  function faseTxt(fw) {
    const p = fw.phaseInfo();
    const rest = p.estado === S().VEIC_VERDE && !fw.pedidoPendente ? 'aguardando pedido' : 'restam ' + seg(Math.max(0, p.dur - p.dt));
    return '<span class="chip st-' + p.estado + '">' + p.nome + '</span> ' + rest;
  }

  const LED_SPEC = (cor, vf) => [
    ['Tipo', 'LED difuso 5 mm, ' + cor],
    ['Tensão direta (Vf)', vf],
    ['Corrente máx.', '20 mA contínua'],
    ['Corrente no projeto', '≈ ' + ((5 - parseFloat(vf.replace(',', '.'))) / 220 * 1000).toFixed(1) + ' mA com 220 Ω'],
    ['Terminais', 'anodo (perna longa, +) e catodo (perna curta, chanfro, −)']
  ];

  const PARTS = {
    arduino: {
      nome: 'Arduino Uno R3', qtd: 1, cat: 'Processamento', video: true,
      specs: [
        ['Microcontrolador', 'ATmega328P (AVR 8 bits)'],
        ['Clock', '16 MHz (cristal)'],
        ['Memória', '32 KB Flash · 2 KB SRAM · 1 KB EEPROM'],
        ['E/S digitais', '14 pinos (6 com PWM: 3, 5, 6, 9, 10, 11)'],
        ['Entradas analógicas', '6 (ADC de 10 bits)'],
        ['Interrupções externas', 'INT0 = D2 · INT1 = D3'],
        ['Timers', 'Timer0 (millis/PWM 5-6) · Timer1 (Servo) · Timer2 (PWM 3-11)'],
        ['Alimentação', '5 V pela USB ou 7–12 V no jack'],
        ['Corrente por pino', '20 mA recomendado (40 mA máx.)']
      ],
      funcao: 'É o cérebro do sistema. Lê as entradas (botões, sensor, UART), executa o firmware e aciona as saídas (LEDs, buzzer, servo).',
      como: 'Roda o FreeRTOS com 5 tarefas e 1 rotina de interrupção. A tarefa FSM decide a fase do semáforo; as outras leem o sensor, os botões e a UART, acionam as saídas e escrevem no Monitor Serial.',
      ligacao: 'USB → computador (alimentação 5 V e UART). Pinos D2–D13 → periféricos (ver mapa de conexões).',
      code: { travessia: 'void setup()', video: 'void setup()' },
      live(fw, v) {
        if (v === 'video') return 'Executando <code>loop()</code> nº ' + fw.loops + '. Fica a maior parte do tempo parado em <code>delay(500)</code>: enquanto espera, não faz mais nada.';
        const ativo = k => (fw.t - fw.taskRuns[k] < 120) ? '<b class="t-on">' + k + '</b>' : '<span class="t-off">' + k + '</span>';
        return 'FreeRTOS em execução · ' + ['ISR', 'FSM', 'SENS', 'IN', 'SIG', 'LOG'].map(ativo).join(' · ') +
          '<br>Fase: ' + faseTxt(fw) + '<br>Modo ' + (fw.modoNoturno ? '<b>NOTURNO</b>' : '<b>DIURNO</b>') + ' · pedido pendente: ' + (fw.pedidoPendente ? '<b class="t-on">sim</b>' : 'não') +
          '<br>LED <b>L</b> da placa espelha o D13 (verde do pedestre).';
      }
    },
    hcsr04: {
      nome: 'Sensor ultrassônico HC-SR04', qtd: 1, cat: 'Entrada', video: true,
      specs: [
        ['Alimentação', '5 V · 15 mA'],
        ['Alcance', '2 cm a 400 cm'],
        ['Resolução', '≈ 0,3 cm'],
        ['Ângulo de medição', '≈ 15° (cone)'],
        ['Frequência', '40 kHz (ultrassom)'],
        ['Disparo', 'pulso TTL de 10 µs no TRIG'],
        ['Saída', 'pulso no ECHO com largura = tempo de ida e volta'],
        ['Ciclo recomendado', '≥ 60 ms entre medições']
      ],
      funcao: 'Mede distância por eco. No vídeo, detecta um objeto perto e gira o servo. No projeto, fica a 3,5 m de altura sobre a faixa e detecta se ainda há pedestre atravessando.',
      como: 'A tarefa SENSOR faz polling a cada 100 ms: pulso de 10 µs no TRIG, mede o ECHO com pulseIn() (timeout de 30 ms) e calcula distância = 0,017 × tempo. Chão livre ≈ 350 cm; pessoa embaixo ≈ 180 cm. Abaixo de 250 cm a faixa conta como ocupada. Três leituras sem eco = sensor com defeito.',
      ligacao: 'VCC → 5V · TRIG → D6 · ECHO → D7 · GND → GND',
      code: { travessia: 'void tarefaSensor', video: 'gera um pulso de 10' },
      live(fw, v) {
        if (v === 'video') return 'Último eco: <b>' + fw.duration + ' µs</b> → <b>' + fw.distance.toFixed(1) + ' cm</b>. ' +
          (fw.distance < fw.threshold ? 'Menor que ' + fw.threshold + ' cm → manda o servo para <b>90°</b>.' : 'Maior que ' + fw.threshold + ' cm → servo em <b>0°</b>.');
        if (!fw.sensorConectado || !fw.sensorOk) return '<b class="t-err">Sem eco.</b> ' + (fw.sensorOk ? 'Contando falhas: ' + fw.falhas + '/3.' : 'Sensor marcado com FALHA: a FSM ignora extensões e trabalha só por tempo.');
        const occ = fw.distanciaCm < 250;
        return 'Polling a cada 100 ms. Eco de <b>' + (fw.ecoUs || 0) + ' µs</b> × 0,017 = <b>' + fw.distanciaCm.toFixed(1) + ' cm</b>.<br>' +
          (occ ? '<b class="t-warn">Faixa ocupada</b> (&lt; 250 cm): se o piscante acabar agora, a FSM concede extensão.' : 'Faixa livre (≥ 250 cm).');
      }
    },
    servo: {
      nome: 'Micro servo SG90 (cancela)', qtd: 1, cat: 'Saída', video: true,
      specs: [
        ['Tensão', '4,8 V a 6 V'],
        ['Torque', '1,8 kgf·cm (4,8 V)'],
        ['Velocidade', '0,1 s / 60°'],
        ['Curso', '≈ 180°'],
        ['Sinal', 'PWM 50 Hz (período 20 ms), pulso 0,5–2,4 ms'],
        ['Corrente', '≈ 100–250 mA em movimento, até 650 mA travado'],
        ['Fios', 'marrom = GND · vermelho = V+ · laranja = sinal']
      ],
      funcao: 'Movimenta a cancela. 0° = cancela levantada (carros passam); 90° = cancela abaixada (bloqueia os carros).',
      como: 'A biblioteca Servo usa o Timer1 para gerar o pulso de 50 Hz no D9. A tarefa SINALIZAÇÃO aplica uma rampa de 3° a cada 20 ms (≈ 0,6 s de 0° a 90°) para o braço não bater. A cancela desce em TODOS_VERMELHO e sobe em LIBERANDO.',
      ligacao: 'Laranja → D9 · Vermelho → 5V · Marrom → GND',
      code: { travessia: 'cancela: rampa', video: 'decisão: objeto perto' },
      live(fw, v) {
        if (v === 'video') return 'Comando atual: <code>servo.write(' + fw.servo + ')</code> → pulso de ' + (fw.servo ? '1,47' : '0,54') + ' ms a cada 20 ms.';
        return 'Alvo <b>' + fw.servoAlvo + '°</b> · posição <b>' + fw.servoAngulo + '°</b> · ' +
          (fw.servoAngulo >= 88 ? 'cancela <b class="t-err">abaixada</b>: carros bloqueados.' : fw.servoAngulo <= 2 ? 'cancela <b class="t-on">levantada</b>.' : '<b class="t-warn">em movimento</b> (rampa de 3°/20 ms).');
      }
    },
    ledCarR: {
      nome: 'LED vermelho · veículos', qtd: 1, cat: 'Saída', grupo: 'LEDs 5 mm',
      specs: LED_SPEC('vermelho', '2,0 V'), pino: 11,
      funcao: 'Luz vermelha do semáforo dos carros.',
      como: 'Ligado com analogWrite(11, brilho) nas fases TODOS_VERMELHO, PED_VERDE, PED_PISCANDO e LIBERANDO. O PWM (Timer2, ~490 Hz) reduz o brilho para 31% no modo noturno.',
      ligacao: 'D11 → anodo · catodo → resistor 220 Ω → GND',
      code: { travessia: 'semáforo dos veículos (PWM)' },
      live: (fw) => 'D11 com PWM ' + on(fw.out.carR, fw.out.carR + '/255 (' + pwmPct(fw.out.carR) + ')') + '. Fase: ' + faseTxt(fw)
    },
    ledCarY: {
      nome: 'LED amarelo · veículos', qtd: 1, cat: 'Saída', grupo: 'LEDs 5 mm',
      specs: LED_SPEC('amarelo', '2,1 V'), pino: 5,
      funcao: 'Avisa os motoristas que o vermelho vem a seguir.',
      como: 'Aceso só na fase VEIC_AMARELO (3 s de dia, 4 s à noite). Usa o PWM do D5 (Timer0).',
      ligacao: 'D5 → anodo · catodo → resistor 220 Ω → GND',
      code: { travessia: 'semáforo dos veículos (PWM)' },
      live: (fw) => 'D5 com PWM ' + on(fw.out.carY, fw.out.carY + '/255') + '. Fase: ' + faseTxt(fw)
    },
    ledCarG: {
      nome: 'LED verde · veículos', qtd: 1, cat: 'Saída', grupo: 'LEDs 5 mm',
      specs: LED_SPEC('verde', '2,2 V'), pino: 3,
      funcao: 'Libera o fluxo de veículos.',
      como: 'Aceso em VEIC_VERDE. Mesmo com pedido pendente, o verde dura no mínimo 10 s (4 s à noite) para não travar o trânsito.',
      ligacao: 'D3 → anodo · catodo → resistor 220 Ω → GND',
      code: { travessia: 'semáforo dos veículos (PWM)' },
      live: (fw) => 'D3 com PWM ' + on(fw.out.carG, fw.out.carG + '/255') + '. ' + (fw.estado === 0 ? 'Verde há ' + seg(fw.t - fw.inicioFase) + ' (mínimo ' + seg(fw.tempos.verdeMin) + ').' : 'Fase: ' + faseTxt(fw))
    },
    ledPedR: {
      nome: 'LED vermelho · pedestre', qtd: 1, cat: 'Saída', grupo: 'LEDs 5 mm',
      specs: LED_SPEC('vermelho', '2,0 V'), pino: 12,
      funcao: 'Indica "não atravesse". Pisca no fim da travessia.',
      como: 'digitalWrite(12): aceso em todas as fases menos PED_VERDE. Em PED_PISCANDO alterna a 2 Hz: (dt / 250) % 2.',
      ligacao: 'D12 → anodo · catodo → resistor 220 Ω → GND',
      code: { travessia: 'semáforo do pedestre' },
      live: (fw) => 'D12 ' + on(fw.out.pedR, 'HIGH') + (fw.estado === 4 ? ' · <b class="t-warn">piscando a 2 Hz</b>' : '') + '. Fase: ' + faseTxt(fw)
    },
    ledPedG: {
      nome: 'LED verde · pedestre', qtd: 1, cat: 'Saída', grupo: 'LEDs 5 mm',
      specs: LED_SPEC('verde', '2,2 V'), pino: 13,
      funcao: 'Indica "pode atravessar".',
      como: 'Aceso só em PED_VERDE (7 s de dia, 10 s à noite). O LED "L" da placa também acende, porque está ligado ao D13.',
      ligacao: 'D13 → anodo · catodo → resistor 220 Ω → GND',
      code: { travessia: 'semáforo do pedestre' },
      live: (fw) => 'D13 ' + on(fw.out.pedG, 'HIGH') + '. Fase: ' + faseTxt(fw)
    },
    resistor: {
      nome: 'Resistores 220 Ω', qtd: 5, cat: 'Passivo',
      specs: [
        ['Valor', '220 Ω ± 5% (vermelho, vermelho, marrom, dourado)'],
        ['Potência', '1/4 W'],
        ['Dissipação no projeto', '≈ 0,04 W por resistor'],
        ['Cálculo', 'R = (5 V − Vf) / I = (5 − 2) / 0,0136 ≈ 220 Ω']
      ],
      funcao: 'Limitam a corrente de cada LED para cerca de 14 mA, abaixo dos 20 mA do pino do Arduino e do LED.',
      como: 'Um resistor em série com cada um dos 5 LEDs, entre o catodo e o barramento GND da protoboard.',
      ligacao: 'catodo do LED → resistor → barramento GND',
      code: {},
      live: (fw) => {
        const n = [fw.out.carR, fw.out.carY, fw.out.carG, fw.out.pedR, fw.out.pedG].filter(Boolean).length;
        return n + ' de 5 resistores conduzindo agora (≈ 13,6 mA cada, menos no modo noturno por causa do PWM).';
      }
    },
    btnPed: {
      nome: 'Botão de pedestre (D2)', qtd: 1, cat: 'Entrada', grupo: 'Botões táteis',
      specs: [
        ['Tipo', 'chave tátil 12 × 12 mm, 4 terminais'],
        ['Contato', 'normalmente aberto, 50 mA / 12 V'],
        ['Bounce', '1–10 ms de trepidação ao apertar'],
        ['Pull-up', 'interno do ATmega (20–50 kΩ)'],
        ['Interrupção', 'INT0, borda de descida (FALLING)']
      ],
      funcao: 'O pedestre solicita a travessia.',
      como: 'Ao apertar, o D2 vai de HIGH para LOW e dispara a ISR. A ISR filtra o bounce (200 ms), entrega um semáforo binário à FSM e retorna. A FSM decide se aceita o pedido; a fase em andamento nunca é cortada.',
      ligacao: 'um terminal → D2 · terminal oposto → GND',
      code: { travessia: 'void isrBotaoPedestre' },
      clicavel: true,
      live: (fw) => {
        const ha = fw.t - fw.ultimoToque;
        return '<b>Clique para apertar.</b> D2 = ' + (fw.btnPedNivel ? 'HIGH (solto)' : '<b class="t-on">LOW (apertado)</b>') +
          '<br>ISR chamada ' + fw.stats.isr + '× · bounce filtrado ' + fw.stats.bounceFiltrado + '× · ' + (ha < 1e8 ? 'último toque há ' + seg(ha) : 'nenhum toque') +
          '<br>Pedido pendente: ' + (fw.pedidoPendente ? '<b class="t-on">sim</b>' : 'não');
      }
    },
    btnModo: {
      nome: 'Botão de modo dia/noite (D4)', qtd: 1, cat: 'Entrada', grupo: 'Botões táteis',
      specs: [
        ['Tipo', 'chave tátil 12 × 12 mm'],
        ['Leitura', 'polling a cada 50 ms (sem interrupção)'],
        ['Debounce', '2 leituras iguais seguidas'],
        ['Pull-up', 'interno (INPUT_PULLUP)']
      ],
      funcao: 'Alterna entre modo diurno e noturno (desafio adicional). O mesmo efeito pode ser obtido com os comandos N e D pela UART.',
      como: 'É uma entrada secundária, sem urgência: a tarefa ENTRADAS consulta o pino a cada 50 ms e só aceita a mudança quando duas leituras seguidas concordam. Isso já filtra o bounce.',
      ligacao: 'um terminal → D4 · terminal oposto → GND',
      code: { travessia: 'botão de modo: lido' },
      clicavel: true,
      live: (fw) => '<b>Clique para alternar.</b> D4 = ' + (fw.btnModoNivel ? 'HIGH' : '<b class="t-on">LOW</b>') + ' · última consulta há ' + Math.round(fw.t - fw.taskRuns.IN) + ' ms<br>Modo atual: <b>' + (fw.modoNoturno ? 'NOTURNO (PWM 80)' : 'DIURNO (PWM 255)') + '</b>'
    },
    buzzer: {
      nome: 'Buzzer ativo 5 V (D8)', qtd: 1, cat: 'Saída',
      specs: [
        ['Tipo', 'ativo (oscilador interno)'],
        ['Frequência', '≈ 2,3 kHz'],
        ['Tensão', '3,5–5,5 V'],
        ['Corrente', '≈ 25 mA'],
        ['Pressão sonora', '≈ 85 dB a 10 cm']
      ],
      funcao: 'Sinal sonoro para pessoas com deficiência visual.',
      como: 'Por ser ativo, basta digitalWrite(8, HIGH): o Timer2 fica livre para o PWM dos LEDs (tone() usaria o Timer2). Bipe de 100 ms por segundo no verde do pedestre; bipe rápido (4 por segundo) no piscante.',
      ligacao: '+ → D8 · − → GND',
      code: { travessia: 'buzzer: bipe' },
      live: (fw) => 'D8 ' + on(fw.out.buzzer, 'HIGH (bip)') + ' · ' + (fw.estado === 3 ? 'padrão lento: 100 ms a cada 1 s' : fw.estado === 4 ? '<b class="t-warn">padrão rápido</b>: 60 ms a cada 250 ms' : 'em silêncio fora da travessia')
    },
    protoboard: {
      nome: 'Protoboard 400 pontos', qtd: 1, cat: 'Montagem',
      specs: [['Pontos', '400 (300 de terminais + 100 de barramento)'], ['Barramentos', '2 pares (+ e −)'], ['Passo', '2,54 mm']],
      funcao: 'Base de montagem sem solda para LEDs, resistores, botões e buzzer.',
      como: 'O barramento azul (−) recebe o GND do Arduino e distribui para resistores, botões e buzzer.',
      ligacao: 'GND do Arduino → barramento −',
      code: {},
      live: () => 'Distribuindo o GND comum para 8 componentes.'
    },
    jumpers: {
      nome: 'Jumpers macho-macho', qtd: 20, cat: 'Montagem',
      specs: [['Bitola', '22 AWG'], ['Comprimento', '10–20 cm'], ['Cores', 'vermelho = 5 V · preto = GND · demais = sinal']],
      funcao: 'Ligam os pinos do Arduino aos componentes.',
      como: 'Padrão de cores do projeto: vermelho para 5 V, preto para GND, laranja para o servo e cores distintas para cada sinal.',
      ligacao: '—',
      code: {},
      live: () => 'Cores: vermelho = 5 V, preto = GND, demais = sinais.'
    },
    usb: {
      nome: 'Cabo USB A-B', qtd: 1, cat: 'Alimentação', video: true,
      specs: [['Alimentação', '5 V, até 500 mA (porta USB)'], ['Dados', 'UART virtual pelo ATmega16U2'], ['Taxa', '9600 bps, 8N1']],
      funcao: 'Alimenta o circuito e leva a UART até o Monitor Serial do computador.',
      como: 'O Logger escreve os eventos; o computador envia os comandos N, D, P e S.',
      ligacao: 'Computador ↔ conector USB-B da placa',
      code: { travessia: 'void tarefaLogger', video: 'Serial.begin' },
      live: (fw, v) => v === 'video' ? 'TX: "distance: …" a cada 0,5 s.' : 'UART 9600 bps · ' + fw.lines.length + ' linhas enviadas ao Monitor Serial.'
    }
  };

  window.PARTS = PARTS;
})();
