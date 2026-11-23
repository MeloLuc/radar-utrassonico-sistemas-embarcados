/*
 * =====================================================================
 *  CÓDIGO DO VÍDEO — "Arduino with ultrasonic sensor + Servo Motor"
 *  Canal: Arduino Titan | Simulador: Wokwi
 *  Comentários em português adicionados pela equipe.
 *
 *  O que faz: mede a distância com o HC-SR04 a cada 0,5 s. Se algo
 *  estiver mais perto que DISTANCE_THRESHOLD, gira o servo para 90°;
 *  caso contrário, volta o servo para 0°. A distância vai para a UART.
 * =====================================================================
 */

#include <Servo.h>                // biblioteca que gera o pulso de 50 Hz do servo (usa o Timer1)

// ---------- constantes (não mudam durante a execução) ----------
const int TRIG_PIN  = 6;          // pino do Arduino ligado ao TRIG do sensor ultrassônico
const int ECHO_PIN  = 7;          // pino do Arduino ligado ao ECHO do sensor ultrassônico
const int SERVO_PIN = 9;          // pino do Arduino ligado ao sinal (fio laranja) do servo
const int DISTANCE_THRESHOLD = 50; // limiar em centímetros: abaixo disso o servo gira

Servo servo;                      // objeto que controla o servo motor

// ---------- variáveis (mudam a cada leitura) ----------
float duration_us, distance_cm;   // duração do eco em µs e distância calculada em cm

void setup() {
  Serial.begin(9600);             // inicia a UART a 9600 bps para o Monitor Serial
  pinMode(TRIG_PIN, OUTPUT);      // TRIG é saída: o Arduino dispara o pulso
  pinMode(ECHO_PIN, INPUT);       // ECHO é entrada: o sensor devolve o tempo de voo
  servo.attach(SERVO_PIN);        // associa o objeto servo ao pino 9
  servo.write(0);                 // posição inicial: 0 graus
}

void loop() {
  // 1) gera um pulso de 10 microssegundos no TRIG
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // 2) mede quanto tempo o pino ECHO fica em nível ALTO (tempo de ida e volta do som)
  duration_us = pulseIn(ECHO_PIN, HIGH);

  // 3) converte para centímetros: som = 343 m/s = 0,0343 cm/µs; divide por 2 (ida e volta)
  //    0,0343 / 2 = 0,01715 ≈ 0,017
  distance_cm = 0.017 * duration_us;

  // 4) decisão: objeto perto -> servo em 90°; longe -> servo em 0°
  if (distance_cm < DISTANCE_THRESHOLD)
    servo.write(90);              // gira o servo para 90 graus
  else
    servo.write(0);               // volta o servo para 0 grau

  // 5) imprime o valor no Monitor Serial
  Serial.print("distance: ");
  Serial.print(distance_cm);
  Serial.println(" cm");

  delay(500);                     // espera 0,5 s (pausa BLOQUEANTE: nada mais roda aqui)
}
