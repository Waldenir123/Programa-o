import fs from 'fs';
import path from 'path';

// Helper to generate a unique ID
function makeId(prefix = 'act') {
    return `${prefix}_${Math.random().toString(36).substring(2, 11)}`;
}

enum Status {
    Programado = 'X',
    Realizado = 'Ok',
    Cancelado = 'C',
    NaoRealizado = 'N',
}

const scheduleData = [
  {
    id: makeId('g'),
    customValues: { fa: "GRUPO 37 - FABRICAÇÃO DAS QPS [264] Nº FA 57592" },
    tarefas: [
      {
        id: makeId('t'),
        title: "GRUPO 37 - FABRICAÇÃO DAS QPS [264] Nº FA 57592",
        activities: [
          {
            id: makeId('a'),
            name: "FABRICAÇÃO DOS CORPOS DE PROVA - CORTE/USINAGEM E PREPARAÇÃO DOS CP, CONFORME PLANO DE ENSAIOS - pendente CP de reteste",
            sector: "IPU-F",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
              "2026-06-19": Status.Realizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
              "2026-06-24": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "ENSAIOS/LAUDO FINAL",
            sector: "IQ-LAB",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
              "2026-06-19": Status.Realizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
              "2026-06-24": Status.Programado,
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
              "2026-06-27": Status.Programado,
              "2026-06-28": Status.Programado,
              "2026-07-02": Status.Programado,
              "2026-07-03": Status.Programado,
              "2026-07-04": Status.Programado,
              "2026-07-05": Status.Programado,
              "2026-07-06": Status.Programado,
              "2026-07-08": Status.Programado,
              "2026-07-09": Status.Programado,
              "2026-07-10": Status.Programado,
              "2026-07-11": Status.Programado,
              "2026-07-12": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "GRUPO 37 - FABRICAÇÃO DAS QPS - [299] FA: 57810" },
    tarefas: [
      {
        id: makeId('t'),
        title: "GRUPO 37 - FABRICAÇÃO DAS QPS - [299] FA: 57810",
        activities: [
          {
            id: makeId('a'),
            name: "CORTE/TRANSFERÊNCIA DE INDICAÇÃO",
            sector: "IP-C",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
              "2026-06-22": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "UT DE BORDA (NUCLEO E IBQN) - Pendente UT IBQN",
            sector: "IQ-UT",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
              "2026-06-22": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "OXICORTE DO BISEL E PREPARAÇÃO DO BISEL",
            sector: "IPC-C",
            schedule: {
              "2026-06-19": Status.NaoRealizado,
              "2026-06-23": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "VT/DT/LP DE BISEL",
            sector: "IQ-LP",
            schedule: {
              "2026-06-23": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "MONTAGEM/TRAVAMENTO/MONTAGEM DE AQUECIMENTO",
            sector: "IPC-M",
            schedule: {
              "2026-06-24": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "SOLDAGEM DO SD1",
            sector: "IPS-S",
            schedule: {
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
              "2026-06-29": Status.Programado,
              "2026-06-30": Status.Programado,
              "2026-07-01": Status.Programado,
              "2026-07-02": Status.Programado,
              "2026-07-03": Status.Programado,
              "2026-07-06": Status.Programado,
              "2026-07-07": Status.Programado,
              "2026-07-08": Status.Programado,
              "2026-07-09": Status.Programado,
              "2026-07-10": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "GRUPO 37 - FABRICAÇÃO DAS QPS - [300] FA: 57822" },
    tarefas: [
      {
        id: makeId('t'),
        title: "GRUPO 37 - FABRICAÇÃO DAS QPS - [300] FA: 57822",
        activities: [
          {
            id: makeId('a'),
            name: "EMISSÃO E APROVAÇÃO DA DOCUMENTAÇÃO DO QPS PELO CTMSP [Em substituição ao QPS 267]",
            sector: "IE",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
              "2026-06-19": Status.Realizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
              "2026-06-24": Status.Programado,
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "RECEPÇÃO DO METAL DE BASE E ADIÇÃO",
            sector: "IQ-REC",
            schedule: {
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "CORTE/TRANSFERÊNCIA DE INDICAÇÃO",
            sector: "IPC-C",
            schedule: {
              "2026-06-24": Status.Programado,
              "2026-06-25": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "UT DE BORDA",
            sector: "IQ-UT",
            schedule: {
              "2026-06-26": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "OXICORTE DO BISEL E PREPARAÇÃO DO BISEL",
            sector: "IPC-C",
            schedule: {
              "2026-06-29": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "VT/DT/LP DE BISEL",
            sector: "IQ-LP",
            schedule: {
              "2026-06-30": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "MONTAGEM/TRAVAMENTO/MONTAGEM DE AQUECIMENTO",
            sector: "IPC-M",
            schedule: {
              "2026-07-01": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "SOLDAGEM DO SD1",
            sector: "IPS-S",
            schedule: {
              "2026-07-02": Status.Programado,
              "2026-07-03": Status.Programado,
              "2026-07-06": Status.Programado,
              "2026-07-07": Status.Programado,
              "2026-07-08": Status.Programado,
              "2026-07-09": Status.Programado,
              "2026-07-10": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "QPS 272 - GRUPO 24 - FABRICAÇÃO DA QPS 0272 - FA Nº FA 57621" },
    tarefas: [
      {
        id: makeId('t'),
        title: "QPS 272 - GRUPO 24 - FABRICAÇÃO DA QPS 0272 - FA Nº FA 57621",
        activities: [
          {
            id: makeId('a'),
            name: "FABRICAÇÃO DOS CORPOS DE PROVA - CORTE/USINAGEM E PREPARAÇÃO DOS CP, CONFORME PLANO DE ENSAIOS - pendente CP de reteste",
            sector: "IPU-F",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
              "2026-06-24": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "PREPARAÇÃO AND SOLDA PARA CP DE PELINE",
            sector: "IPS-S",
            schedule: {
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
            }
          },
          {
            id: makeId('a'),
            name: "ENSAIOS/LAUDO FINAL",
            sector: "IQ-LAB",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
              "2026-06-19": Status.Realizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
              "2026-06-24": Status.Programado,
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
              "2026-06-27": Status.Programado,
              "2026-06-28": Status.Programado,
              "2026-06-29": Status.Programado,
              "2026-06-30": Status.Programado,
              "2026-07-01": Status.Programado,
              "2026-07-02": Status.Programado,
              "2026-07-03": Status.Programado,
              "2026-07-06": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "GRUPO 26 - RETRABALHO PREVISTO NA RNC 025/26 E USINAGEM DO CONVÉS DO GV - Nº FA 57534" },
    tarefas: [
      {
        id: makeId('t'),
        title: "GRUPO 26 - RETRABALHO PREVISTO NA RNC 025/26 E USINAGEM DO CONVÉS DO GV - Nº FA 57534",
        activities: [
          {
            id: makeId('a'),
            name: "CONTROLE DIMENSIONAL PELA CALDEIRARIA (NOVA DISPOSIÇÃO/APROVAÇÃO DA RNC 66/26 - RNC-R-26-030-56",
            sector: "IPC-M",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
              "2026-06-19": Status.Realizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "SOLDAGEM SOLDA S-26-030-56, S-26-030-101",
            sector: "IPS-S",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
              "2026-06-19": Status.Cancelado,
            }
          },
          {
            id: makeId('a'),
            name: "REALIZAÇÃO DOS ENDS (VT/LP) PÓS SOLDAGEM",
            sector: "IQ-LP",
            schedule: {
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "REMOÇÃO DOS TRAVAMENTOS AUXILIARES",
            sector: "IPC-M",
            schedule: {
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "INSPEÇÃO DIMENSIONAL",
            sector: "IQ-DT",
            schedule: {
              "2026-06-27": Status.Programado,
              "2026-06-29": Status.Programado,
              "2026-06-30": Status.Programado,
              "2026-07-01": Status.Programado,
              "2026-07-02": Status.Programado,
              "2026-07-03": Status.Programado,
              "2026-07-06": Status.Programado,
              "2026-07-07": Status.Programado,
              "2026-07-08": Status.Programado,
              "2026-07-09": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "MOVIMENTAÇÃO P/ USINAGEM",
            sector: "IPC-MC",
            schedule: {
              "2026-07-04": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "USINAGEM DOS APOIOS DO GV.",
            sector: "IPU",
            schedule: {
              "2026-07-11": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "GRUPO 26 - VASOS E ESTRUTURAS INTERNAS DO LABGENE, CONVÉS DO GV RNC 041-26 FA 57787" },
    tarefas: [
      {
        id: makeId('t'),
        title: "GRUPO 26 - VASOS E ESTRUTURAS INTERNAS DO LABGENE, CONVÉS DO GV RNC 041-26 FA 57787",
        activities: [
          {
            id: makeId('a'),
            name: "Traçagem, corte e identificação da POS. 89",
            sector: "IPC-C",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
            }
          },
          {
            id: makeId('a'),
            name: "Traçagem dos Biseis e corte dos Biseis",
            sector: "IPC-C",
            schedule: {
              "2026-06-17": Status.Realizado,
            }
          },
          {
            id: makeId('a'),
            name: "VT/DT de Bisel",
            sector: "IQ-LP",
            schedule: {
              "2026-06-18": Status.NaoRealizado,
              "2026-06-22": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "Montagem/Travamento da POS. 89 no Convés",
            sector: "IPC-M",
            schedule: {
              "2026-06-19": Status.NaoRealizado,
              "2026-06-22": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "Tratamento térmico e soldagem",
            sector: "IPS-S",
            schedule: {
              "2026-06-24": Status.Programado,
              "2026-06-25": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "Ensaios ENDs FINAIS",
            sector: "IQ-VT",
            schedule: {
              "2026-06-26": Status.Programado,
              "2026-06-27": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "GRUPO 38 - TANQUE DE EXPANSÃO - FABRICAÇÃO DA POS 19 E MONTAGEM/SOLDAGEM Nº FA 57714" },
    tarefas: [
      {
        id: makeId('t'),
        title: "GRUPO 38 - TANQUE DE EXPANSÃO - FABRICAÇÃO DA POS 19 E MONTAGEM/SOLDAGEM Nº FA 57714",
        activities: [
          {
            id: makeId('a'),
            name: "MONTAGEM NO CASCO E POS. 13 - SERÁ FEITA APÓS A CONCLUSÃO DA SOLDAGEM 14 + 16",
            sector: "IPC-M",
            schedule: {
              "2026-07-01": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "SOLDAGEM",
            sector: "IPS-S",
            schedule: {
              "2026-07-01": Status.Programado,
              "2026-07-02": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "ENSAIOS",
            sector: "IQ-LP",
            schedule: {
              "2026-07-02": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "BLOCO 40 - GRUPO 38 - TANQUE DE EXPANSÃO DO TBP - SOLDAGEM DAS POS. 14 + 16 - S-38-026-01@04 Nº FA 57760" },
    tarefas: [
      {
        id: makeId('t'),
        title: "BLOCO 40 - GRUPO 38 - TANQUE DE EXPANSÃO DO TBP - SOLDAGEM DAS POS. 14 + 16 - S-38-026-01@04 Nº FA 57760",
        activities: [
          {
            id: makeId('a'),
            name: "Movimentação/Montagem e Ponteamento as POS. 14 + 16 e travamentos ( 2º Conjunto)",
            sector: "",
            schedule: {}
          },
          {
            id: makeId('a'),
            name: "CONFERÊNCIA DA PERDICULARIDADE PELO CONTROLE DIMENSIONAL",
            sector: "IQ-DT",
            schedule: {
              "2026-06-17": Status.Cancelado,
            }
          },
          {
            id: makeId('a'),
            name: "MONTAGEM DE RESITÊNCIA E SOLDAGEM ( 2º Conjunto)",
            sector: "IPS-S",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
              "2026-06-19": Status.Realizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
              "2026-06-24": Status.Programado,
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
              "2026-06-27": Status.Programado,
              "2026-07-01": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "CONTROLE DIMENSIONAL DO CONJUNTO ( 2º Conjunto)",
            sector: "IPC-M",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
              "2026-06-19": Status.Realizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
              "2026-06-24": Status.Programado,
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
              "2026-06-27": Status.Programado,
              "2026-07-01": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "PREPARAÇÃO E ENDS - (1º E 2º Conjunto)",
            sector: "IQ-LP",
            schedule: {
              "2026-07-03": Status.Programado,
              "2026-07-04": Status.Programado,
              "2026-07-07": Status.Programado,
              "2026-07-08": Status.Programado,
              "2026-07-09": Status.Programado,
              "2026-07-10": Status.Programado,
              "2026-07-11": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "BLOCO 40 - GRUPO 15 - CASCO SUPERIOR SETOR 2 - REMOÇÃO/ENSAIOS E RESSOLDAGEM/ENSAIOS DOS OLHAIS DE BASCULAMENTO - DDM-0819A0-022 Nº FA 57893" },
    tarefas: [
      {
        id: makeId('t'),
        title: "BLOCO 40 - GRUPO 15 - CASCO SUPERIOR SETOR 2 - REMOÇÃO/ENSAIOS E RESSOLDAGEM/ENSAIOS DOS OLHAIS DE BASCULAMENTO - DDM-0819A0-022 Nº FA 57893",
        activities: [
          {
            id: makeId('a'),
            name: "MAPEAMENTO DAS OLHAIS QUE SERÃO REMOVIDO COM AUXILIO DO IQ",
            sector: "IQ-UT",
            schedule: {}
          },
          {
            id: makeId('a'),
            name: "REMOÇÃO DOS OLHAIS",
            sector: "IPS",
            schedule: {}
          },
          {
            id: makeId('a'),
            name: "PEPRARAÇÃO DA REGIÃO",
            sector: "IPC-M",
            schedule: {}
          },
          {
            id: makeId('a'),
            name: "ENSAIO DE VT E LP DOS OLHAIS SEREM REMOVIDOS",
            sector: "IQ-VT",
            schedule: {}
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "SETOR 3 - GRUPO 15 - ENDs nas Juntas das RNC S-15-024-84 e (IND. UT 1, 3, 6, 7, 8, 11, 13, 16, 17 e 18) - RNC 079-24 - SETOR 3 (CAVERNA H) Nº FA 56904 Nº FA 56637" },
    tarefas: [
      {
        id: makeId('t'),
        title: "SETOR 3 - GRUPO 15 - ENDs nas Juntas das RNC S-15-024-84 e (IND. UT 1, 3, 6, 7, 8, 11, 13, 16, 17 e 18) - RNC 079-24 - SETOR 3 (CAVERNA H) Nº FA 56904 Nº FA 56637",
        activities: [
          {
            id: makeId('a'),
            name: "AJUSTE DE ANDAIME",
            sector: "",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
            }
          },
          {
            id: makeId('a'),
            name: "PREPARAÇÃO PARA UT",
            sector: "IPC-M",
            schedule: {
              "2026-06-18": Status.Realizado,
            }
          },
          {
            id: makeId('a'),
            name: "REALIZAR ENSAIO DE UT DOS REPAROS",
            sector: "IQ-UT",
            schedule: {
              "2026-06-19": Status.Realizado,
              "2026-06-20": Status.Realizado,
              "2026-06-21": Status.Cancelado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "SETOR 3 - GRUPO 15 - ULTRASSOM NA JUNTA S-15-024-63(IND_UT_1, 2, 5, 8, 9, 10, 11, 13 e 16) - RNC 081-24 - SETOR 3 (CAVERNA G) Nº FA 56639" },
    tarefas: [
      {
        id: makeId('t'),
        title: "SETOR 3 - GRUPO 15 - ULTRASSOM NA JUNTA S-15-024-63(IND_UT_1, 2, 5, 8, 9, 10, 11, 13 e 16) - RNC 081-24 - SETOR 3 (CAVERNA G) Nº FA 56639",
        activities: [
          {
            id: makeId('a'),
            name: "AJUSTE DE ANDAIME",
            sector: "",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
            }
          },
          {
            id: makeId('a'),
            name: "PREPARAÇÃO PARA UT",
            sector: "IPC-M",
            schedule: {
              "2026-06-18": Status.Realizado,
            }
          },
          {
            id: makeId('a'),
            name: "REALIZAR ENSAIO DE UT DOS REPAROS",
            sector: "IQ-UT",
            schedule: {
              "2026-06-19": Status.Realizado,
              "2026-06-20": Status.Realizado,
              "2026-06-21": Status.Cancelado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "QPS 298 - REVESTIMENTO AUSTENÍTICO Nº FA 57763" },
    tarefas: [
      {
        id: makeId('t'),
        title: "QPS 298 - REVESTIMENTO AUSTENÍTICO Nº FA 57763",
        activities: [
          {
            id: makeId('a'),
            name: "CORTE/IDENTIFICAÇÃO DAS POS/MONTAGEM DO TRATAMENTO TÉRMICO",
            sector: "IPC-C",
            schedule: {}
          },
          {
            id: makeId('a'),
            name: "MOVIMENTAÇÃO PARA ÁREA DE SOLDAGEM\\",
            sector: "IPC-MC",
            schedule: {}
          },
          {
            id: makeId('a'),
            name: "RESOLUÇÃO DE PENDÊNCIAS NO RECEBIMENTO DE CONSUMÍVEIS (IQ E IES)",
            sector: "IQ-REC",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "PREPRAÇÃO DA SUPERFÍCIE",
            sector: "IPC-M",
            schedule: {
              "2026-06-17": Status.NaoRealizado,
              "2026-06-23": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "VT/LP DA SUPERFÍCIE A SOLDAR O REVESTIMENTO",
            sector: "IQ-LP",
            schedule: {
              "2026-06-17": Status.NaoRealizado,
              "2026-06-18": Status.NaoRealizado,
              "2026-06-23": Status.Programado,
              "2026-06-24": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "UT DA SUPERFÍCIE A SOLDAR O REVESTIMENTO",
            sector: "IQ-UT",
            schedule: {
              "2026-06-17": Status.NaoRealizado,
              "2026-06-24": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "MONTAGEM DE RESISTÊNCIA E SOLDAGEM 1º CAMADA",
            sector: "IPS-S",
            schedule: {
              "2026-06-25": Status.Programado,
              "2026-06-29": Status.Programado,
              "2026-06-30": Status.Programado,
              "2026-07-01": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "LP E UT DO REVESTIMENTO APÓS SOLDAGEM DA PRIMEIRA CAMADA",
            sector: "IQ-LP",
            schedule: {
              "2026-07-02": Status.Programado,
              "2026-07-03": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "SOLDAGEM DO REVESTIMENTO",
            sector: "IPS-S",
            schedule: {
              "2026-07-06": Status.Programado,
              "2026-07-07": Status.Programado,
              "2026-07-08": Status.Programado,
              "2026-07-09": Status.Programado,
              "2026-07-10": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "VT, LP, E UT APÓS SOLDAGEM DO REVESTIMENTO",
            sector: "IQ-LP",
            schedule: {}
          },
          {
            id: makeId('a'),
            name: "MOVIMENTAÇÃO PARA O FORNO",
            sector: "IPC-MC",
            schedule: {}
          },
          {
            id: makeId('a'),
            name: "TRATAMENTO TÉRMICO",
            sector: "IPS-TT",
            schedule: {}
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "BLOCO DE CALIBRAÇÃO -153 Nº FA 57700" },
    tarefas: [
      {
        id: makeId('t'),
        title: "BLOCO DE CALIBRAÇÃO -153 Nº FA 57700",
        activities: [
          {
            id: makeId('a'),
            name: "FABRICAÇÃO BC 153 (TRAÇAGEM, CORTE, USINAGEM)",
            sector: "IPU-F",
            schedule: {
              "2026-06-15": Status.NaoRealizado,
              "2026-06-16": Status.NaoRealizado,
              "2026-06-17": Status.NaoRealizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
              "2026-06-24": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "DIMENSIONAL E REGISTRO",
            sector: "IQ-DT",
            schedule: {
              "2026-06-18": Status.Cancelado,
              "2026-06-19": Status.Cancelado,
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
              "2026-06-29": Status.Programado,
              "2026-06-30": Status.Programado,
              "2026-07-01": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "DEMONSTRAÇÃO",
            sector: "IQ-UT",
            schedule: {
              "2026-07-01": Status.Programado,
              "2026-07-02": Status.Programado,
              "2026-07-03": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "BLOCO DE CALIBRAÇÃO - 152 Nº FA 57698" },
    tarefas: [
      {
        id: makeId('t'),
        title: "BLOCO DE CALIBRAÇÃO - 152 Nº FA 57698",
        activities: [
          {
            id: makeId('a'),
            name: "FABRICAÇÃO BC 152 (TRAÇAGEM, CORTE, USINAGEM)",
            sector: "IPU-F",
            schedule: {
              "2026-06-15": Status.NaoRealizado,
              "2026-06-16": Status.NaoRealizado,
              "2026-06-17": Status.NaoRealizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
              "2026-06-24": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "DIMENSIONAL E REGISTRO",
            sector: "IQ-DT",
            schedule: {
              "2026-06-18": Status.Cancelado,
              "2026-06-19": Status.Cancelado,
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
              "2026-06-29": Status.Programado,
              "2026-06-30": Status.Programado,
              "2026-07-01": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "DEMONSTRAÇÃO",
            sector: "IQ-UT",
            schedule: {
              "2026-07-01": Status.Programado,
              "2026-07-02": Status.Programado,
              "2026-07-03": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "FABRICAÇÃO DAS QPS - [273] Nº FA 57625" },
    tarefas: [
      {
        id: makeId('t'),
        title: "FABRICAÇÃO DAS QPS - [273] Nº FA 57625",
        activities: [
          {
            id: makeId('a'),
            name: "UT DE BORDA",
            sector: "IQ-UT",
            schedule: {}
          },
          {
            id: makeId('a'),
            name: "TRAÇAGEM, OXICORTE DO BISEL E PREPARAÇÃO DO BISEL",
            sector: "IPC-C",
            schedule: {
              "2026-06-17": Status.NaoRealizado,
              "2026-06-18": Status.NaoRealizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "VT/DT/LP DE BISEL",
            sector: "IQ-VT",
            schedule: {
              "2026-06-19": Status.NaoRealizado,
              "2026-06-24": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "MOVIMENTAÇÃO PARA O CTT",
            sector: "IPC-MC",
            schedule: {
              "2026-06-20": Status.NaoRealizado,
              "2026-06-24": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "MONTAGEM/TRAVAMENTO/MONTAGEM DE AQUECIMENTO",
            sector: "IPC-M",
            schedule: {
              "2026-06-25": Status.Programado,
              "2026-06-29": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "SOLDAGEM DO SD1",
            sector: "IPS-S",
            schedule: {
              "2026-06-26": Status.Programado,
              "2026-06-29": Status.Programado,
              "2026-06-30": Status.Programado,
              "2026-07-01": Status.Programado,
              "2026-07-02": Status.Programado,
              "2026-07-03": Status.Programado,
              "2026-07-06": Status.Programado,
              "2026-07-07": Status.Programado,
              "2026-07-08": Status.Programado,
              "2026-07-09": Status.Programado,
              "2026-07-10": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "PREPARAÇÃO E ENSAIOS DA CONTRASOLDA",
            sector: "IPS-M",
            schedule: {
              "2026-07-08": Status.Programado,
              "2026-07-09": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "GRUPO 36 - CORREDOR - Traçagem/Transferência de identificação e corte das POS: 6 / 7 / 8 / 11 / 11.1 / 11.2 / 12 // 13 // 17.1 // 17.2 // 18.1 // 18.2 // 18.3 // 18.4 // 19.1 // 19.2 // 19.3 // 19.4 // 20.1 // 20.2 // 20.3 // 20.4. Nº FA 57619" },
    tarefas: [
      {
        id: makeId('t'),
        title: "GRUPO 36 - CORREDOR - Traçagem/Transferência de identificação e corte das POS: 6 / 7 / 8 / 11 / 11.1 / 11.2 / 12 // 13 // 17.1 // 17.2 // 18.1 // 18.2 // 18.3 // 18.4 // 19.1 // 19.2 // 19.3 // 19.4 // 20.1 // 20.2 // 20.3 // 20.4. Nº FA 57619",
        activities: [
          {
            id: makeId('a'),
            name: "PREPARAÇÃO PARA UT DE BORDA",
            sector: "IPC-M",
            schedule: {}
          },
          {
            id: makeId('a'),
            name: "UT DE BORDA",
            sector: "IQ-UT",
            schedule: {
              "2026-06-15": Status.NaoRealizado,
              "2026-06-16": Status.NaoRealizado,
              "2026-06-17": Status.NaoRealizado,
              "2026-06-18": Status.NaoRealizado,
              "2026-07-10": Status.Programado,
              "2026-07-11": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "Traçagem dos Biseis e corte dos Biseis",
            sector: "IPC-C",
            schedule: {
              "2026-06-15": Status.NaoRealizado,
              "2026-06-16": Status.NaoRealizado,
              "2026-06-17": Status.NaoRealizado,
              "2026-06-18": Status.NaoRealizado,
              "2026-06-19": Status.NaoRealizado,
              "2026-06-24": Status.Programado,
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
              "2026-06-27": Status.Programado,
              "2026-06-28": Status.Programado,
              "2026-06-29": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "Movimentação para área do BLOCO 040",
            sector: "IPC-MC",
            schedule: {
              "2026-06-25": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "PREPARAÇÃO DOS BISEIS",
            sector: "IPC-M",
            schedule: {}
          },
          {
            id: makeId('a'),
            name: "VT/DT de Bisel",
            sector: "IQ-VT",
            schedule: {
              "2026-06-30": Status.Programado,
              "2026-07-01": Status.Programado,
              "2026-07-06": Status.Programado,
              "2026-07-07": Status.Programado,
              "2026-07-08": Status.Programado,
              "2026-07-09": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "VIROLA 5 - ENSAIOS FINAIS E [RNC: 020/26 020/26 (ASP -0819-37-030)]" },
    tarefas: [
      {
        id: makeId('t'),
        title: "VIROLA 5 - ENSAIOS FINAIS E [RNC: 020/26 020/26 (ASP -0819-37-030)]",
        activities: [
          {
            id: makeId('a'),
            name: "PREPARAÇÃO PARA RX - 2ª leva",
            sector: "IQ-RX",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
            }
          },
          {
            id: makeId('a'),
            name: "REALIZAR ENSAIO DE RX - 2ª leva e Laudo",
            sector: "IQ-RX",
            schedule: {
              "2026-06-18": Status.Realizado,
              "2026-06-19": Status.Realizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "MOVIMENTAÇÃO PARA ÁREA DO BLOCO 40",
            sector: "IPC-MC",
            schedule: {
              "2026-06-25": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "VT/DT DE BORDE DO CORPO DE PROVA [RNC: 020/26 (ASP -0819-37-030)]",
            sector: "IPC-C",
            schedule: {
              "2026-06-26": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "MOVIMENTAÇÃO PARA FERRAMENTARIA",
            sector: "IPC-MC",
            schedule: {
              "2026-06-27": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "FABRICAÇÃO DOS CORPOS DE PROVA - CORTE/USINAGEM E PREPARAÇÃO DOS CP, CONFORME PLANO DE ENSAIOS",
            sector: "IPU-F",
            schedule: {
              "2026-06-29": Status.Programado,
              "2026-06-30": Status.Programado,
              "2026-07-01": Status.Programado,
              "2026-07-02": Status.Programado,
              "2026-07-03": Status.Programado,
              "2026-07-06": Status.Programado,
              "2026-07-07": Status.Programado,
              "2026-07-08": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "ENSAIOS/LAUDO FINAL",
            sector: "IQ-LAB",
            schedule: {
              "2026-07-06": Status.Programado,
              "2026-07-07": Status.Programado,
              "2026-07-08": Status.Programado,
              "2026-07-09": Status.Programado,
              "2026-07-10": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "Grupo 36 - RNC 027-26 e RNC 028-26 Nº FA 57866" },
    tarefas: [
      {
        id: makeId('t'),
        title: "Grupo 36 - RNC 027-26 e RNC 028-26 Nº FA 57866",
        activities: [
          {
            id: makeId('a'),
            name: "AGUARDANDO APROVAÇÃO DA RNC",
            sector: "CTMSP",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
            }
          },
          {
            id: makeId('a'),
            name: "EMISSÃO E ELABORAÇÃO DA FA PELA IE",
            sector: "IE",
            schedule: {
              "2026-06-15": Status.Realizado,
              "2026-06-16": Status.Realizado,
              "2026-06-17": Status.Realizado,
              "2026-06-18": Status.Realizado,
            }
          },
          {
            id: makeId('a'),
            name: "Verificação da transferência da marcação de origem e Corte",
            sector: "IPC-C",
            schedule: {
              "2026-06-19": Status.NaoRealizado,
              "2026-06-20": Status.NaoRealizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "Movimentação para ferramentaria",
            sector: "IPC-MC",
            schedule: {
              "2026-06-25": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "Verificação da transferência da marcação, corte e fabricação do corpo de prova",
            sector: "IPU-F",
            schedule: {
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
              "2026-06-29": Status.Programado,
              "2026-06-30": Status.Programado,
              "2026-07-01": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "Ensaios destrutivos.",
            sector: "IQ-LAB",
            schedule: {
              "2026-07-02": Status.Programado,
              "2026-07-03": Status.Programado,
              "2026-07-06": Status.Programado,
              "2026-07-07": Status.Programado,
              "2026-07-08": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "Compilação e verificação dos registros e fechamento da RNC",
            sector: "IQ",
            schedule: {
              "2026-07-09": Status.Programado,
              "2026-07-10": Status.Programado,
              "2026-07-11": Status.Programado,
            }
          }
        ]
      }
    ]
  },
  {
    id: makeId('g'),
    customValues: { fa: "BM ENISA - 001 - AMOSTRA Nº FA 57809" },
    tarefas: [
      {
        id: makeId('t'),
        title: "BM ENISA - 001 - AMOSTRA Nº FA 57809",
        activities: [
          {
            id: makeId('a'),
            name: "CORTE E FABRICAÇÃO DO CORPO",
            sector: "IPU-F",
            schedule: {
              "2026-06-15": Status.NaoRealizado,
              "2026-06-16": Status.NaoRealizado,
              "2026-06-17": Status.NaoRealizado,
              "2026-06-22": Status.Programado,
              "2026-06-23": Status.Programado,
              "2026-06-24": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "Ensaios destrutivos.",
            sector: "IQ-DT",
            schedule: {
              "2026-06-18": Status.Cancelado,
              "2026-06-19": Status.Cancelado,
              "2026-06-25": Status.Programado,
              "2026-06-26": Status.Programado,
            }
          },
          {
            id: makeId('a'),
            name: "Compilação e verificação dos registros",
            sector: "IQ-UT",
            schedule: {}
          }
        ]
      }
    ]
  }
];

// Write the corrected perfect schedule to src/parsed_schedule.json
fs.writeFileSync(
    path.join(process.cwd(), 'src/parsed_schedule.json'), 
    JSON.stringify({ liveData: scheduleData, summaryData: scheduleData, startDate: "2026-06-15", name: "Nova Programação Semanal 25@28" }, null, 2), 
    'utf-8'
);
console.log("Successfully generated perfect schedule JSON!");
