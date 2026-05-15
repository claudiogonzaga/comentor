# Sons de coruja — notificações do CoMentor

Cada arquivo `.wav` é o som de notificação de uma espécie de coruja. O usuário
escolhe a espécie em **Configurações → Som das notificações**.

| Arquivo | Espécie | Vocalização |
|---|---|---|
| `owl_suindara.wav` | Suindara (*Tyto furcata*) | grito raspado |
| `owl_cabure.wav` | Caburé (*Glaucidium brasilianum*) | série de assobios curtos |
| `owl_buraqueira.wav` | Coruja-buraqueira (*Athene cunicularia*) | dois toques "cu-cuuu" |
| `owl_murucututu.wav` | Murucututu (*Pulsatrix perspicillata*) | batidas graves acelerando |
| `owl_mocho.wav` | Mocho-orelhudo (*Asio clamator*) | assobio único descendente |
| `owl_listrada.wav` | Coruja-listrada (*Strix hylophila*) | pio rítmico "u u u-u" |

## Estes sons são sintetizados

Os `.wav` atuais foram **gerados por síntese** (`scripts/generate_owl_sounds.py`),
não são gravações reais. Isso foi necessário porque o ambiente de build não tinha
acesso de rede aos bancos de áudio (xeno-canto, Wikimedia Commons). Eles imitam o
ritmo da chamada de cada espécie, mas não o timbre real.

## Trocar por gravações reais

Para usar gravações de verdade, baixe clipes curtos (2-6s, mono) de uma fonte
com licença permissiva — recomendado: [xeno-canto.org](https://xeno-canto.org)
(busque pelo nome científico, filtre por licença Creative Commons) — e
substitua os arquivos **mantendo exatamente os mesmos nomes**.

Requisitos: `.wav` PCM, ≤ 30 segundos, ideal mono 44.1 kHz. Depois de trocar é
preciso um novo build nativo (`eas build`) — sons são assets nativos e não vão
via OTA. No Android os canais de notificação são imutáveis: o app cria um canal
novo (`comentor-owl-<id>-vN`) quando o som muda, então a versão do canal deve
ser incrementada em `src/services/notifications.ts` se você trocar o áudio.

Regenerar os sons sintetizados: `python3 scripts/generate_owl_sounds.py`
