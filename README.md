# Travessia Inteligente

Site 3D para apresentar o projeto: semáforo de pedestres com cancela automática (Arduino Uno + HC-SR04 + servo SG90 + FreeRTOS), feito a partir do vídeo
"Arduino with ultrasonic sensor + Servo Motor | Wokwi" (Arduino Titan).

## Como abrir

Dê dois cliques em `index.html` (funciona direto do arquivo, com internet para carregar o Three.js e as fontes).
Ou rode um servidor local:

```powershell
python -m http.server 8765
```

e acesse http://localhost:8765.

## Publicar na Vercel

É um site estático: não precisa de build.

1. Em vercel.com, clique em **Add New → Project** e importe o repositório do GitHub.
2. Em **Framework Preset**, escolha **Other**. Deixe **Build Command** e **Output Directory** vazios.
3. Clique em **Deploy**. Cada push na `main` publica uma nova versão.

O `vercel.json` define as URLs limpas e os cabeçalhos de cache. O `.vercelignore` deixa as pastas `tools/` e `.claude/` fora do deploy.

## Seções do site

| Aba | Conteúdo |
|---|---|
| Início | Cena 3D da travessia funcionando ao vivo |
| Projeto | Bancada 3D no estilo Wokwi. Clique numa peça para ver especificação, função, ligação e trecho do código. "Mostrar código" abre o firmware comentado. Com a simulação ligada, passar o mouse explica o que cada peça está fazendo. Alterna entre "Sistema completo" e "Circuito do vídeo". |
| Simulação | Aplicação real em 3D: travessia de pedestres com cancela, ou cancela de estacionamento (código original do vídeo). Cenários normais, de falha e de limite, modo noturno, monitor serial e atividade das tarefas RTOS. |
| Apresentação | Problema, histórico, entradas/saídas, diagrama de blocos, mapa de conexões, máquina de estados, protocolos, justificativas, prioridades, plano de testes executável, divisão de tarefas (editável), limitações e referências. |

## Arquivos

- `firmware/travessia_inteligente/` — firmware da equipe (`.ino`), `diagram.json` e `libraries.txt` para o Wokwi
- `firmware/video_original/` — código do vídeo com comentários em português
- `js/firmware.js` — emulador em JS com a mesma lógica do `.ino` e os 12 testes do plano de testes
- `js/project3d.js`, `js/sim3d.js` — cenas 3D (Three.js r128)
- `tools/build-code.js` — depois de editar algum arquivo em `firmware/`, rode `node tools/build-code.js` para atualizar o código exibido no site
