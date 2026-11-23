/*
 * =====================================================================
 *  TRAVESSIA INTELIGENTE — semáforo de pedestres com cancela automática
 *  ---------------------------------------------------------------------
 *  Base: projeto "Arduino + sensor ultrassônico + servo" (Arduino Titan,
 *  Wokwi). Mantivemos os pinos do vídeo (TRIG 6, ECHO 7, SERVO 9) e a
 *  fórmula da distância, e acrescentamos semáforo, botão com interrupção,
 *  buzzer, modo noturno e tarefas FreeRTOS.
 *
 *  Placa ........ Arduino Uno R3 (ATmega328P, 16 MHz, 2 KB de RAM)
 *  Bibliotecas .. Servo.h  +  FreeRTOS (feilipu): Arduino_FreeRTOS.h,
 *                 semphr.h, queue.h
 *
 *  MÓDULOS DO FIRMWARE
 *   [M1] Configuração: pinos, tempos por modo, tipos compartilhados
 *   [M2] ISR do botão de pedestre (interrupção externa INT0, pino D2)
 *   [M3] Tarefa SENSOR ....... polling do HC-SR04 a cada 100 ms
 *   [M4] Tarefa ENTRADAS ..... polling do botão de modo (D4) + comandos UART
 *   [M5] Tarefa FSM .......... máquina de estados com timers por millis()
 *   [M6] Tarefa SINALIZAÇÃO .. PWM dos LEDs, buzzer e rampa do servo
 *   [M7] Tarefa LOGGER ....... única tarefa que escreve na UART
 *
 *  PRIORIDADES (maior número = mais prioritário)
 *   FSM = 3  >  SENSOR = ENTRADAS = 2  >  SINALIZAÇÃO = LOGGER = 1
 *   A ISR está acima de todas: só registra o pedido e devolve o controle.
 * =====================================================================
 */

#include <Arduino_FreeRTOS.h>   // núcleo do FreeRTOS (tick pelo Watchdog, ~15 ms)
#include <semphr.h>             // semáforos (ISR -> FSM)
#include <queue.h>              // filas (tarefas -> Logger)
#include <Servo.h>              // servo da cancela (usa o Timer1: PWM de D9/D10 fica reservado)

/* ===================== [M1] CONFIGURAÇÃO ===================== */

// ---- pinos (D6, D7 e D9 iguais ao vídeo) ----
const uint8_t PIN_BTN_PEDESTRE = 2;   // INT0  - botão de pedestre (INPUT_PULLUP)
const uint8_t PIN_CAR_VERDE    = 3;   // PWM   - LED verde dos veículos
const uint8_t PIN_BTN_MODO     = 4;   // GPIO  - botão de modo dia/noite (lido por polling)
const uint8_t PIN_CAR_AMARELO  = 5;   // PWM   - LED amarelo dos veículos
const uint8_t TRIG_PIN         = 6;   // GPIO  - HC-SR04 TRIG (do vídeo)
const uint8_t ECHO_PIN         = 7;   // GPIO  - HC-SR04 ECHO (do vídeo)
const uint8_t PIN_BUZZER       = 8;   // GPIO  - buzzer ativo (sinal sonoro para acessibilidade)
const uint8_t SERVO_PIN        = 9;   // PWM   - servo SG90 da cancela (do vídeo)
const uint8_t PIN_CAR_VERMELHO = 11;  // PWM   - LED vermelho dos veículos
const uint8_t PIN_PED_VERMELHO = 12;  // GPIO  - LED vermelho do pedestre
const uint8_t PIN_PED_VERDE    = 13;  // GPIO  - LED verde do pedestre

// ---- sensor e cancela ----
// No vídeo o limiar era 50 cm. Aqui o sensor fica a 3,5 m de altura olhando
// para o meio da faixa: o chão fica a ~350 cm e uma pessoa embaixo a ~180 cm.
const float   LIMIAR_PRESENCA_CM = 250.0;
const uint8_t SERVO_ABERTA       = 0;    // cancela levantada: carros passam
const uint8_t SERVO_FECHADA      = 90;   // cancela abaixada: bloqueia os carros
const uint8_t FALHAS_PARA_ERRO   = 3;    // leituras seguidas sem eco = sensor com defeito

// ---- tempos de cada fase (ms) por modo ----
struct Tempos {
  uint32_t verdeMin;    // verde mínimo dos veículos antes de atender pedido
  uint32_t amarelo;     // amarelo dos veículos
  uint32_t todosVerm;   // vermelho geral (segurança) + descida da cancela
  uint32_t pedVerde;    // verde do pedestre
  uint32_t pedPisca;    // vermelho piscante do pedestre (fim da travessia)
  uint32_t extensao;    // tempo extra se ainda houver alguém na faixa
  uint8_t  brilho;      // duty cycle PWM dos LEDs (0..255)
};
const Tempos DIA   = { 10000, 3000, 1000,  7000, 4000, 2000, 255 };
const Tempos NOITE = {  4000, 4000, 2000, 10000, 5000, 3000,  80 };  // desafio adicional
const uint32_t T_LIBERANDO   = 1500;   // subida da cancela antes do verde dos carros
const uint8_t  MAX_EXTENSOES = 2;      // limite: nunca prende os carros indefinidamente

// ---- estados da máquina ----
enum Estado : uint8_t {
  VEIC_VERDE,      // S0  carros: verde   | pedestre: vermelho | cancela aberta
  VEIC_AMARELO,    // S1  carros: amarelo | pedestre: vermelho | cancela aberta
  TODOS_VERMELHO,  // S2  todos vermelho  | cancela descendo
  PED_VERDE,       // S3  carros: vermelho| pedestre: verde + bipe lento
  PED_PISCANDO,    // S4  carros: vermelho| pedestre: vermelho piscando + bipe rápido
  LIBERANDO        // S5  todos vermelho  | cancela subindo
};

// ---- eventos enviados ao Logger (códigos pequenos economizam RAM) ----
enum TipoEvento : uint8_t {
  EV_ESTADO, EV_PEDIDO, EV_PEDIDO_IGNORADO, EV_PEDIDO_REPETIDO, EV_MODO,
  EV_DISTANCIA, EV_SENSOR_FALHA, EV_SENSOR_OK, EV_EXTENSAO, EV_LIMITE,
  EV_CMD_INVALIDO, EV_STATUS
};
struct Evento { uint8_t tipo; int16_t valor; uint32_t t; };

// ---- dados compartilhados entre tarefas ----
// volatile: o compilador sempre relê da RAM (valores mudam em outra tarefa/ISR).
volatile Estado   estado        = VEIC_VERDE;
volatile uint32_t inicioFase    = 0;      // instante (millis) em que a fase atual começou
volatile bool     modoNoturno   = false;
volatile bool     pedidoPendente = false;
volatile bool     sensorOk      = true;
volatile float    distanciaCm   = 350.0;  // float = 4 bytes: leitura protegida por seção crítica

SemaphoreHandle_t semPedido;   // semáforo binário: ISR -> FSM
QueueHandle_t     filaLog;     // fila de eventos: qualquer tarefa -> Logger
Servo             cancela;

const char* const NOMES[] = { "VEIC_VERDE", "VEIC_AMARELO", "TODOS_VERMELHO",
                              "PED_VERDE", "PED_PISCANDO", "LIBERANDO" };

// Envia um evento ao Logger sem bloquear (se a fila estiver cheia, descarta).
void logar(uint8_t tipo, int16_t valor = 0) {
  Evento e = { tipo, valor, millis() };
  xQueueSend(filaLog, &e, 0);
}

// Lê a distância de forma atômica (o AVR copia um float em 4 instruções).
float lerDistancia() {
  taskENTER_CRITICAL();
  float d = distanciaCm;
  taskEXIT_CRITICAL();
  return d;
}

/* ===================== [M2] ISR DO BOTÃO ===================== */
// Roda no contexto da interrupção: precisa ser curtíssima.
// Não muda a fase do semáforo — só avisa a FSM, que decide com segurança.
volatile uint32_t ultimoToque = 0;

void isrBotaoPedestre() {
  uint32_t agora = millis();
  if (agora - ultimoToque < 200) return;        // debounce de 200 ms (ignora o "bounce")
  ultimoToque = agora;
  BaseType_t acordouTarefa = pdFALSE;
  xSemaphoreGiveFromISR(semPedido, &acordouTarefa);  // versão "FromISR": segura dentro da ISR
}

/* ===================== [M3] TAREFA SENSOR (polling) ===================== */
void tarefaSensor(void *) {
  uint8_t falhas = 0;
  for (;;) {
    // Mesma sequência do vídeo: pulso de 10 µs no TRIG
    digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    // Timeout de 30 ms (~5 m): sem eco, pulseIn devolve 0 em vez de travar 1 s
    uint32_t dur = pulseIn(ECHO_PIN, HIGH, 30000UL);

    if (dur == 0) {                                   // sem eco: cabo solto ou sensor queimado
      if (++falhas >= FALHAS_PARA_ERRO && sensorOk) {
        sensorOk = false;                             // FSM passa a operar só por tempo
        logar(EV_SENSOR_FALHA);
      }
    } else {
      falhas = 0;
      if (!sensorOk) { sensorOk = true; logar(EV_SENSOR_OK); }
      float d = 0.017 * dur;                          // fórmula do vídeo
      taskENTER_CRITICAL(); distanciaCm = d; taskEXIT_CRITICAL();
    }
    vTaskDelay(pdMS_TO_TICKS(100));                   // libera a CPU por 100 ms
  }
}

/* ===================== [M4] TAREFA ENTRADAS (polling + UART) ===================== */
void aplicarModo(bool noite) {
  if (modoNoturno == noite) return;
  modoNoturno = noite;
  logar(EV_MODO, noite);
}

void tarefaEntradas(void *) {
  uint8_t leituraAnterior = HIGH, estavel = HIGH;
  for (;;) {
    // --- botão de modo: lido a cada 50 ms; debounce = 2 leituras iguais seguidas ---
    uint8_t leitura = digitalRead(PIN_BTN_MODO);
    if (leitura == leituraAnterior && leitura != estavel) {
      estavel = leitura;
      if (estavel == LOW) aplicarModo(!modoNoturno);  // borda de descida = botão apertado
    }
    leituraAnterior = leitura;

    // --- comandos pela UART (Monitor Serial) ---
    while (Serial.available() > 0) {
      char c = toupper(Serial.read());
      if (c == '\n' || c == '\r' || c == ' ') continue;
      switch (c) {
        case 'N': aplicarModo(true);  break;           // modo noturno
        case 'D': aplicarModo(false); break;           // modo diurno
        case 'P': xSemaphoreGive(semPedido); break;    // pedido remoto (teste)
        case 'S': logar(EV_STATUS); break;             // imprime o estado atual
        default:  logar(EV_CMD_INVALIDO, c); break;
      }
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

/* ===================== [M5] TAREFA FSM (máquina de estados) ===================== */
void mudarEstado(Estado novo) {
  estado = novo;
  inicioFase = millis();       // "timer" da fase: comparamos millis() - inicioFase
  logar(EV_ESTADO, novo);
}

// Decide se um pedido é aceito. Nunca corta uma fase no meio.
void registrarPedido() {
  if (estado == VEIC_VERDE || estado == PED_PISCANDO || estado == LIBERANDO) {
    if (pedidoPendente) { logar(EV_PEDIDO_REPETIDO); return; }
    pedidoPendente = true;     // fica guardado até a FSM poder atender
    logar(EV_PEDIDO, estado);
  } else {
    logar(EV_PEDIDO_IGNORADO, estado);  // travessia já em andamento
  }
}

void tarefaMaquinaEstados(void *) {
  TickType_t ultimoTick = xTaskGetTickCount();
  uint8_t extensoes = 0;
  mudarEstado(VEIC_VERDE);

  for (;;) {
    // 1) consome pedidos da ISR sem esperar (timeout 0 = não bloqueia)
    if (xSemaphoreTake(semPedido, 0) == pdTRUE) registrarPedido();

    const Tempos &t = modoNoturno ? NOITE : DIA;
    uint32_t dt = millis() - inicioFase;   // quanto tempo a fase atual já durou

    // 2) transições: cada fase só termina quando o seu tempo acaba
    switch (estado) {
      case VEIC_VERDE:
        if (pedidoPendente && dt >= t.verdeMin) {
          pedidoPendente = false;                    // pedido será atendido agora
          mudarEstado(VEIC_AMARELO);
        }
        break;
      case VEIC_AMARELO:
        if (dt >= t.amarelo)   mudarEstado(TODOS_VERMELHO);
        break;
      case TODOS_VERMELHO:
        if (dt >= t.todosVerm) { extensoes = 0; mudarEstado(PED_VERDE); }
        break;
      case PED_VERDE:
        if (dt >= t.pedVerde)  mudarEstado(PED_PISCANDO);
        break;
      case PED_PISCANDO:
        if (dt >= t.pedPisca) {
          bool ocupado = sensorOk && lerDistancia() < LIMIAR_PRESENCA_CM;
          if (ocupado && extensoes < MAX_EXTENSOES) {
            extensoes++;
            inicioFase = millis() - (t.pedPisca - t.extensao); // restam só "extensao" ms
            logar(EV_EXTENSAO, extensoes);
          } else {
            if (ocupado) logar(EV_LIMITE);           // limite atingido: avisa e segue
            mudarEstado(LIBERANDO);
          }
        }
        break;
      case LIBERANDO:
        if (dt >= T_LIBERANDO) mudarEstado(VEIC_VERDE);
        break;
    }
    // 3) período fixo de 45 ms (3 ticks), sem acumular atraso
    vTaskDelayUntil(&ultimoTick, pdMS_TO_TICKS(45));
  }
}

/* ===================== [M6] TAREFA SINALIZAÇÃO ===================== */
// Converte o estado em saídas físicas. Não decide nada: só "desenha" o estado.
void tarefaSinalizacao(void *) {
  uint8_t anguloAtual = SERVO_ABERTA;
  for (;;) {
    Estado e = estado;
    uint32_t dt = millis() - inicioFase;
    uint8_t  b  = modoNoturno ? NOITE.brilho : DIA.brilho;   // PWM: intensidade do LED

    // --- semáforo dos veículos (PWM) ---
    analogWrite(PIN_CAR_VERDE,    e == VEIC_VERDE   ? b : 0);
    analogWrite(PIN_CAR_AMARELO,  e == VEIC_AMARELO ? b : 0);
    analogWrite(PIN_CAR_VERMELHO, e >= TODOS_VERMELHO ? b : 0);

    // --- semáforo do pedestre ---
    bool piscaLigado = (dt / 250) % 2 == 0;                  // 2 Hz
    digitalWrite(PIN_PED_VERDE,    e == PED_VERDE);
    digitalWrite(PIN_PED_VERMELHO, e == PED_PISCANDO ? piscaLigado : e != PED_VERDE);

    // --- buzzer: bipe lento no verde, rápido no piscante (acessibilidade) ---
    bool bip = false;
    if (e == PED_VERDE)    bip = (dt % 1000) < 100;
    if (e == PED_PISCANDO) bip = (dt % 250)  < 60;
    digitalWrite(PIN_BUZZER, bip);

    // --- cancela: rampa de 3° a cada 20 ms (movimento suave, ~0,6 s para 90°) ---
    bool fechar = (e == TODOS_VERMELHO || e == PED_VERDE || e == PED_PISCANDO);
    uint8_t alvo = fechar ? SERVO_FECHADA : SERVO_ABERTA;
    if (anguloAtual < alvo) anguloAtual = min<uint8_t>(anguloAtual + 3, alvo);
    if (anguloAtual > alvo) anguloAtual = (anguloAtual - alvo < 3) ? alvo : anguloAtual - 3;
    cancela.write(anguloAtual);

    vTaskDelay(pdMS_TO_TICKS(20));   // ~1 tick no AVR (o tick do FreeRTOS é ~15 ms)
  }
}

/* ===================== [M7] TAREFA LOGGER (UART) ===================== */
// Só esta tarefa usa Serial.print: evita que duas tarefas misturem texto na UART.
void tarefaLogger(void *) {
  Evento e;
  for (;;) {
    if (xQueueReceive(filaLog, &e, portMAX_DELAY) != pdTRUE) continue; // dorme até chegar evento
    Serial.print('[');
    Serial.print(e.t / 1000.0, 3);
    Serial.print(F("s] "));
    switch (e.tipo) {
      case EV_ESTADO:          Serial.print(F("ESTADO -> ")); Serial.println(NOMES[e.valor]); break;
      case EV_PEDIDO:          Serial.print(F("PEDIDO registrado durante ")); Serial.println(NOMES[e.valor]); break;
      case EV_PEDIDO_IGNORADO: Serial.print(F("PEDIDO ignorado: travessia em andamento (")); Serial.print(NOMES[e.valor]); Serial.println(')'); break;
      case EV_PEDIDO_REPETIDO: Serial.println(F("PEDIDO repetido: ja estava na fila")); break;
      case EV_MODO:            Serial.println(e.valor ? F("MODO -> NOTURNO (PWM 80)") : F("MODO -> DIURNO (PWM 255)")); break;
      case EV_SENSOR_FALHA:    Serial.println(F("ERRO: HC-SR04 sem eco. Operando so por tempo")); break;
      case EV_SENSOR_OK:       Serial.println(F("HC-SR04 voltou a responder")); break;
      case EV_EXTENSAO:        Serial.print(F("Pedestre na faixa: extensao ")); Serial.print(e.valor); Serial.println(F("/2")); break;
      case EV_LIMITE:          Serial.println(F("LIMITE: extensoes esgotadas, liberando veiculos")); break;
      case EV_CMD_INVALIDO:    Serial.print(F("Comando desconhecido: ")); Serial.println((char)e.valor); break;
      case EV_STATUS:
        Serial.print(F("STATUS estado=")); Serial.print(NOMES[estado]);
        Serial.print(F(" modo=")); Serial.print(modoNoturno ? F("NOTURNO") : F("DIURNO"));
        Serial.print(F(" dist=")); Serial.print(lerDistancia(), 1);
        Serial.print(F("cm sensor=")); Serial.print(sensorOk ? F("OK") : F("FALHA"));
        Serial.print(F(" pedido=")); Serial.println(pedidoPendente ? F("sim") : F("nao"));
        break;
    }
  }
}

/* ===================== SETUP / LOOP ===================== */
void setup() {
  Serial.begin(9600);                          // UART 9600 bps, 8N1

  pinMode(PIN_BTN_PEDESTRE, INPUT_PULLUP);     // botão liga o pino ao GND: solto = HIGH
  pinMode(PIN_BTN_MODO,     INPUT_PULLUP);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_CAR_VERDE, OUTPUT);   pinMode(PIN_CAR_AMARELO, OUTPUT);
  pinMode(PIN_CAR_VERMELHO, OUTPUT);
  pinMode(PIN_PED_VERDE, OUTPUT);   pinMode(PIN_PED_VERMELHO, OUTPUT);

  cancela.attach(SERVO_PIN);
  cancela.write(SERVO_ABERTA);

  semPedido = xSemaphoreCreateBinary();
  filaLog   = xQueueCreate(6, sizeof(Evento));   // 6 eventos x 7 bytes

  // Interrupção externa na borda de descida (botão apertado)
  attachInterrupt(digitalPinToInterrupt(PIN_BTN_PEDESTRE), isrBotaoPedestre, FALLING);

  //          função               nome   pilha  param prioridade
  xTaskCreate(tarefaMaquinaEstados, "FSM",  192,  NULL, 3, NULL);
  xTaskCreate(tarefaSensor,         "SENS", 160,  NULL, 2, NULL);
  xTaskCreate(tarefaEntradas,       "IN",   160,  NULL, 2, NULL);
  xTaskCreate(tarefaSinalizacao,    "SIG",  128,  NULL, 1, NULL);
  xTaskCreate(tarefaLogger,         "LOG",  192,  NULL, 1, NULL);

  Serial.println(F("Travessia Inteligente pronta. Comandos: N=noite D=dia P=pedido S=status"));
  // Na biblioteca FreeRTOS (feilipu) o escalonador inicia sozinho ao fim do setup().
}

void loop() {
  // Vazio: com FreeRTOS, loop() vira a tarefa ociosa (idle). Todo o trabalho está nas tarefas.
}
