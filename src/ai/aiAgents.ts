import { GoogleGenAI, Type } from "@google/genai";
import { ScheduleData, SelectedItem, Status, Grupo, Machine, MachineStatus } from "../state/types";
import { deepClone, generateId, formatDate } from "../utils/dataUtils";

export const aiDeletionAgent = (
    data: ScheduleData,
    idToDelete: string,
    type: 'group' | 'task' | 'activity'
): ScheduleData => {
    const targetId = String(idToDelete).trim();

    if (type === 'group') {
        return data.filter(g => String(g.id).trim() !== targetId);
    } 
    
    if (type === 'task') {
        return data.map(group => {
            const newTarefas = group.tarefas.filter(t => String(t.id).trim() !== targetId);
            if (newTarefas.length === group.tarefas.length) return group;
            return { ...group, tarefas: newTarefas };
        }).filter(g => g.tarefas.length > 0);
    } 
    
    if (type === 'activity') {
        return data.map(group => {
            let groupUpdated = false;
            const newTarefas = group.tarefas.map(task => {
                if (!task.activities) return task;
                const newActivities = task.activities.filter(a => String(a.id).trim() !== targetId);
                if (newActivities.length === task.activities.length) return task;
                groupUpdated = true;
                return { ...task, activities: newActivities };
            });

            if (!groupUpdated) return group;
            return { ...group, tarefas: newTarefas };
        });
    }
    
    return data;
};

export const analyzeDeletionImpactWithAI = async (
    ai: GoogleGenAI,
    data: ScheduleData,
    itemsToDelete: SelectedItem[]
): Promise<{ analysis: string; }> => {
    // Schema for the response
    const schema = {
        type: Type.OBJECT,
        properties: {
            analysis: {
                type: Type.STRING,
                description: "Uma análise concisa em português sobre o impacto da exclusão do(s) item(ns), escrita de forma amigável para o usuário. Mencione os itens pelo nome, se forem poucos, ou resuma o impacto se forem muitos.",
            },
        },
        required: ['analysis'],
    };

    const simplifiedData = data.map((g, gIdx) => ({
        wbs: `${gIdx + 1}`,
        id: g.id,
        name: Object.values(g.customValues || {}).join(' / ') || 'Linha sem nome',
        tasks: g.tarefas.map((t, tIdx) => ({
            wbs: `${gIdx + 1}.${tIdx + 1}`,
            id: t.id,
            name: t.title,
            activities: t.activities.map((a, aIdx) => ({
                wbs: `${gIdx + 1}.${tIdx + 1}.${aIdx + 1}`,
                id: a.id,
                name: a.name
            }))
        }))
    }));

    const itemsList = itemsToDelete.map(item => 
`- **Nome:** "${item.name}"
- **Tipo:** "${item.type}"
- **WBS:** "${item.wbsId}"`
).join('\n');


    const prompt = `Você é um assistente especialista em Planejamento e Controle de Produção (PCP). Sua tarefa é analisar um cronograma e o impacto da exclusão de um conjunto de itens.

**Contexto:**
O usuário solicitou a exclusão dos seguintes itens:
${itemsList}

**Cronograma Completo (formato simplificado):**
\`\`\`json
${JSON.stringify(simplifiedData, null, 2)}
\`\`\`

**Sua Tarefa:**

1.  **Analise o Impacto Consolidado:** Com base nos nomes e na estrutura do cronograma, avalie o impacto da remoção de **TODOS** os itens listados em conjunto. Considere dependências lógicas e o efeito cascata. Por exemplo, se uma tarefa principal e várias de suas atividades forem selecionadas, descreva o impacto de remover o bloco inteiro.

2.  **Formule uma Resposta JSON:**
    - **analysis:** Escreva uma breve mensagem (2-3 frases) para o usuário explicando o impacto principal da exclusão em massa. Seja direto e claro. Ex: "Ao excluir a tarefa 'Montagem Estrutura X' e 2 atividades relacionadas, todo o progresso de montagem para este componente será removido. Isso pode afetar a sequência de soldagem dependente."

**Formato de Saída:**
- Retorne **APENAS** um objeto JSON válido que corresponda ao esquema fornecido.
- Não inclua explicações, formatação markdown (como \`\`\`json\`\`\`) ou comentários. A resposta deve começar com \`{\` e terminar com \`}\`.`;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: schema,
        },
    });

    try {
        const jsonString = response.text.trim();
        const parsedJson = JSON.parse(jsonString);
        
        if (typeof parsedJson.analysis !== 'string') {
            throw new Error("Formato da resposta da IA inválido.");
        }
        
        return parsedJson;

    } catch (e) {
        console.error("Falha ao analisar a resposta da IA como JSON (Deletion Analyzer). Resposta:", response.text, "Erro:", e);
        throw new Error("A resposta da IA (Deletion Analyzer) não é um JSON válido.");
    }
};

export const parseFADetailWithAI = async (ai: GoogleGenAI, text: string, fileData: { mimeType: string, data: string } | null): Promise<Omit<Grupo, 'id'>[]> => {
    const schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                fa: { type: Type.STRING, description: "O número da FA, formatado como 'FA XXXXX'." },
                tarefas: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING, description: "O nome da operação principal (ex: 'TRAÇAGEM E CORTE')." },
                            activities: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        name: { type: Type.STRING, description: "A descrição da suboperação, resumida de forma concisa, incluindo os desenhos de referência no formato '(Ref: ...)' quando disponíveis." },
                                    },
                                    required: ['name'],
                                },
                            },
                        },
                        required: ['title', 'activities'],
                    },
                },
            },
            required: ['fa', 'tarefas'],
        },
    };

    const prompt = `Você é um especialista em Planejamento e Controle de Produção (PCP) com vasta experiência em processos de caldeiraria, soldagem e inspeção industrial. Sua tarefa é analisar os dados de uma Folha de Atividades (FA), que podem vir em formato de **texto**, **imagem**, ou **ambos**, e extrair as informações essenciais para criar um cronograma de produção, estruturando os dados em um formato JSON específico.

**Objetivo Principal:**
Converter os dados da FA em uma estrutura hierárquica de Grupos, Tarefas e Atividades.

**Instruções Detalhadas:**

1.  **Fonte dos Dados:**
    - Analise **tanto o texto quanto a imagem** fornecidos. Use a fonte que for mais clara ou combine informações de ambas se necessário.
    - Se apenas um for fornecido, use-o como a única fonte.

2.  **Identificar o Grupo (FA):**
    - Localize o número da FA. No texto, procure por \`Detalhe da FA: XXXXX\`. Na imagem, estará no título.
    - Este será o único grupo. O campo \`fa\` no JSON de saída deve ser "FA " seguido pelo número (ex: "FA 48233").

3.  **Identificar as Tarefas Principais (Operações):**
    - As Operações (ex: "PREPARAÇÃO E USINAGEM", "TRAÇAGEM E CORTE") são as \`tarefas\` principais.
    - Para cada Operação, extraia a sua descrição (ex: 'PREPARAÇÃO E USINAGEM').

4.  **Identificar as Atividades (Suboperações):**
    - Dentro de cada Tarefa Principal, há uma lista ou tabela de 'Suboperações' (ex: 1.01, 1.02). Cada linha de suboperação é uma \`atividade\`.
    - A coluna 'Descrição' da suboperação contém o trabalho a ser feito.

5.  **RESUMIR A DESCRIÇÃO E EXTRAIR REFERÊNCIAS (Ação Crítica):**
    - Sua habilidade mais importante é **resumir** a descrição longa e técnica da suboperação em um nome de atividade conciso E **extrair os desenhos de referência**.
    - **Passo 1: Resumir a Tarefa:** Foque no verbo e no objeto principal. Remova detalhes redundantes e texto explicativo.
    - **Passo 2: Extrair Desenhos de Referência:** Procure por termos como "Desenho de referência", "Desenhos de referência:", ou códigos de documento como "IS...", "DA-...". Extraia todos os códigos relevantes.
    - **Passo 3: Combinar:** Formate o nome final da atividade como: \`"[Resumo da Tarefa] (Ref: [Desenho 1], [Desenho 2], ...)"\`. Se nenhum desenho for encontrado, retorne apenas o resumo da tarefa.
    - **Exemplo de Resumo e Extração (Baseado no texto fornecido):**
        - **Original:** "1.01 Realizar a preparação das peças para pré usinagem. ... ** Desenhos de referência: - Peças 01 e 02 - IS12027-00000-24-022/023; - Peças 03, 04, 05 e 06 - IS12027-00000-24-024; ..."
        - **Resumo Ideal (campo 'name' da atividade):** "Preparar peças para pré-usinagem (Ref: IS12027-00000-24-022/023, IS12027-00000-24-024, IS12027-00000-24-027)"
    - **Exemplo 2:**
        - **Original:** "1.02 Realizar a pré usinagem das peças 01 e 02 conforme DA-48233. ... ** Desenho de referência IS12027-00000-24-022/023."
        - **Resumo Ideal:** "Pré-usinar peças 01 e 02 (blanks) (Ref: DA-48233, IS12027-00000-24-022/023)"
    - **Exemplo 3 (Sem referência explícita):**
        - **Original:** "1.06	Realizar a transferência de identificação das peças durante a usinagem. ** Se necessário."
        - **Resumo Ideal:** "Transferir identificação durante usinagem"


6.  **Estrutura do JSON de Saída:**
    - A saída deve ser um array JSON contendo **um único objeto de grupo**.
    - Dentro deste grupo, haverá um array de \`tarefas\` (as Operações).
    - Dentro de cada tarefa, haverá um array de \`activities\` (as Suboperações resumidas com referências).
    - Não inclua o campo \`schedule\` para as atividades.

**Formato de Saída:**
- Retorne **APENAS** um array JSON válido que corresponda ao esquema fornecido.
- Não inclua explicações, formatação markdown (como \`\`\`json\`\`\`) ou comentários. A resposta deve começar com \`[\` e terminar com \`]\`.

Agora, por favor, processe os dados da Folha de Atividades fornecidos a seguir.`;

    const contentParts: any[] = [{ text: prompt }];

    if (text) {
        contentParts.push({ text: `\n\n--- INÍCIO DO TEXTO PARA ANÁLISE ---\n${text}\n--- FIM DO TEXTO PARA ANÁLISE ---` });
    }
    if (fileData) {
        contentParts.push({ inlineData: { mimeType: fileData.mimeType, data: fileData.data } });
    }

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: { parts: contentParts },
        config: {
            responseMimeType: "application/json",
            responseSchema: schema
        },
    });
    
    let parsedJson;
    try {
        let jsonString = response.text.trim();
        const match = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
        if (match && match[1]) {
            jsonString = match[1];
        }
        parsedJson = JSON.parse(jsonString);
    } catch (e) {
        console.error("Falha ao analisar a resposta da IA como JSON (FA Parser). Resposta:", response.text, "Erro:", e);
        throw new Error("A resposta da IA (FA Parser) não é um JSON válido.");
    }
    
    if (!Array.isArray(parsedJson)) {
        console.error("AI response is not an array:", parsedJson);
        throw new Error("A resposta da IA não é um cronograma válido (o resultado não é uma lista).");
    }

    return parsedJson;
};

export const parseMachinesWithAI = async (ai: GoogleGenAI, text: string): Promise<Omit<Machine, 'id'>[]> => {
    const schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: "Nome da máquina." },
                category: { type: Type.STRING, description: "Categoria da máquina (Usinagem, Calandragem, Corte, Forno, Cabine de Jato)." },
                status: { type: Type.STRING, description: "Status da máquina.", enum: Object.values(MachineStatus) },
            },
            required: ['name', 'category', 'status'],
        },
    };

    const prompt = `Você é um especialista em gestão de ativos industriais. Sua tarefa é analisar um texto fornecido, que contém informações sobre máquinas de uma fábrica, e extrair os dados estruturados em JSON.

**Categorias Permitidas:** Usinagem, Calandragem, Corte, Forno, Cabine de Jato.
**Status Permitidos:** Em funcionamento, Em manutenção, Descontinuada.

Para cada máquina encontrada no texto, identifique seu nome, categoria e status atual. Se a categoria não estiver explícita, tente inferir pelo nome ou contexto. se não conseguir inferir, use 'Usinagem' como padrão.

**Formato de Saída:**
- Retorne **APENAS** um array JSON válido que corresponda ao esquema fornecido.
- Não inclua explicações ou markdown.`;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt + `\n\nTexto para análise: """${text}"""`,
        config: {
            responseMimeType: "application/json",
            responseSchema: schema,
        },
    });

    try {
        const jsonString = response.text.trim();
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Erro ao analisar resposta da IA para máquinas:", response.text, e);
        throw new Error("A resposta da IA não é um JSON válido.");
    }
};

export const parseScheduleWithAI = async (ai: GoogleGenAI, text: string, fileData: { mimeType: string, data: string } | null): Promise<ScheduleData> => {
    const schema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          fa: { type: Type.STRING },
          componente: { type: Type.STRING },
          setor: { type: Type.STRING },
          tarefas: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: "O título conciso da tarefa principal (texto em negrito). Deve ser um resumo curto, com menos de 150 caracteres." },
                activities: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: "A descrição da atividade (texto normal). Deve ser um resumo curto, com menos de 200 caracteres." },
                      schedule: {
                        type: Type.ARRAY,
                        description: "Para Layouts 1 e 2: Uma lista de datas e seus respectivos status. Para Layout 3, deve ser um array vazio.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                date: {
                                    type: Type.STRING,
                                    description: "A data da atividade no formato YYYY-MM-DD."
                                },
                                status: {
                                    type: Type.STRING,
                                    description: "O status da atividade nesta data.",
                                    enum: Object.values(Status)
                                }
                            }
                        }
                      },
                      startDate: {
                          type: Type.STRING,
                          description: "Para Layout 3: A data de início no formato YYYY-MM-DD. Não usar para Layouts 1 e 2."
                      },
                      endDate: {
                          type: Type.STRING,
                          description: "Para Layout 3: A data de término no formato YYYY-MM-DD. Não usar para Layouts 1 e 2."
                      }
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const prompt = `Você é um assistente especialista em Planejamento e Controle de Produção (PCP), focado em extrair dados estruturados de cronogramas visuais ou textuais.

**Objetivo Principal:**
Sua tarefa é interpretar o cronograma fornecido, que pode ser uma imagem, um PDF, ou texto, e converter seu conteúdo em um formato JSON estruturado.

**IMPORTANTE: Análise de Layout**
Sua primeira tarefa é identificar qual dos três layouts de cronograma a seguir está sendo usado no documento e aplicar as regras de extração correspondentes.

---

### **Layout 1: Hierarquia Explícita**

*   **Como Identificar:** A tabela terá colunas de descrição claramente definidas como \`Fase/Agrupador\`, \`TAREFA PRINCIPAL\`, e \`ATIVIDADE\`.
*   **Regras de Extração (Layout 1):** A estrutura é lida diretamente dessas colunas. Células mescladas se aplicam a todas as linhas subsequentes até um novo valor aparecer.

---

### **Layout 2: Hierarquia Implícita (Texto em Negrito)**

*   **Como Identificar:** A tabela terá menos colunas de descrição e a hierarquia é definida pelo estilo do texto (negrito para tarefas, normal para atividades).
*   **Regras de Extração (Layout 2):** Linhas com texto em **negrito** são \`tarefas\`. Linhas com texto normal aninhadas sob elas são \`atividades\`.

---

### **Layout 3: Lista de Tarefas WBS (Formato Texto/Planilha)**

*   **Como Identificar:** O texto é uma lista de tarefas, não uma grade visual. Cada linha representa uma tarefa e possui um código de WBS (Estrutura Analítica de Projeto) na segunda coluna (ex: \`1.5.1\`). A principal característica é a ausência de um cabeçalho de calendário com datas.

*   **Regras de Extração (Layout 3):**
    1.  **Foco nas Colunas Essenciais:** Cada linha contém várias colunas. Ignore todas, exceto as seguintes:
        *   **Coluna 2:** O código WBS (ex: \`1\`, \`1.5\`, \`1.5.1\`).
        *   **Coluna 5:** O nome/descrição da tarefa.
        *   **Coluna 7:** A data de início no formato \`DD/MM/AA\`.
        *   **Coluna 8:** A data de término no formato \`DD/MM/AA\`.
    2.  **Construir a Hierarquia (Regra Rígida):** A estrutura do projeto (Grupo -> Tarefa -> Atividade) é definida pelo código WBS:
        *   **Grupos:** Linhas com WBS de um nível (ex: \`1\`, \`2\`). Use o nome da Coluna 5 para os campos customizados (customValues) do grupo.
        *   **Tarefas Principais:** Linhas com WBS de dois níveis (ex: \`1.1\`, \`1.5\`). Use o nome da Coluna 5 para o campo \`title\`.
        *   **Atividades:** Linhas com WBS de três ou mais níveis (ex: \`1.1.1\`, \`1.5.3.1\`). Use o nome da Coluna 5 para o campo \`name\`.
    3.  **Regra de Aninhamento:** Aninhe os itens com base em seus códigos WBS. Por exemplo, a tarefa \`1.5\` pertence ao grupo \`1\`. A atividade \`1.5.1\` pertence à tarefa \`1.5\`.
    4.  **Caso Especial - Tarefa sem Atividades:** Se uma linha for uma Tarefa Principal (ex: WBS \`1.3\`) mas não tiver nenhuma Atividade filha abaixo dela, trate-a como se fosse uma Atividade. Crie uma Tarefa Principal com o mesmo nome e insira esta Atividade única dentro dela.
    5.  **Geração do Cronograma (\`startDate\`, \`endDate\`):**
        *   **Apenas para Atividades:** Gere \`startDate\` e \`endDate\` somente para itens identificados como Atividades.
        *   **Extraia as Datas:** Use a data de início da Coluna 7 e a data de término da Coluna 8.
        *   **Formato de Data:** Converta as datas de \`DD/MM/AA\` para \`YYYY-MM-DD\`. Anos como '25' e '26' devem ser convertidos para 2025 e 2026.
        *   **Saída:** Popule os campos \`startDate\` e \`endDate\` no JSON de saída. **NÃO GERE o array \`schedule\` para o Layout 3; deixe-o como um array vazio \`[]\`**.

---

### **Regras Comuns para Todos os Layouts**

1.  **Datas e Status (Layouts 1 e 2):**
    - O cabeçalho contém datas. Reconstrua a data completa. **Converta todas as datas para o formato \`YYYY-MM-DD\`**.
    - Para cada linha de **Atividade**, leia as marcações ('X', 'Ok', etc.) nas colunas de data.
    - Crie o array \`schedule\` com os objetos \`{date, status}\` para cada marcação.
    - **Mapeamento de Status (OBRIGATÓRIO):** "Ok" -> \`"Ok"\`, "X" -> \`"X"\`, "N" -> \`"N"\`, "C" -> \`"C"\`.
    - Ignore células de data vazias.
    - **NÃO GERE os campos \`startDate\` e \`endDate\` para os Layouts 1 e 2.**
2.  **Documentos de Múltiplas Páginas:** Mantenha o contexto das células mescladas de uma página para a outra.
3.  **Regra Crítica de Formatação:** Todos os valores de string no JSON de saída DEVEM ser de uma única linha. Remova quaisquer caracteres de quebra de linha dos textos extraídos.

**Formato de Saída:**
- Retorne **APENAS** um array JSON válido que corresponda ao esquema fornecido.
- Não inclua explicações, formatação markdown (como \`\`\`json\`\`\`) ou comentários. A resposta deve começar com \`[\` e terminar com \`]\`.

Agora, por favor, processe os seguintes dados de cronograma:`;
    
    const contentParts: any[] = [{ text: prompt + `\n\nDados de texto (se houver): """${text}"""` }];
    if (fileData) { contentParts.push({ inlineData: { mimeType: fileData.mimeType, data: fileData.data } }); }
    
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: { parts: contentParts },
        config: { 
            responseMimeType: "application/json", 
            responseSchema: schema,
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 4096 },
        },
    });
    
    let parsedJson;
    try {
        let jsonString = response.text.trim();
        // Handle cases where the AI still wraps the JSON in markdown
        const match = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
        if (match && match[1]) {
            jsonString = match[1];
        }

        // The Gemini API with responseMimeType: "application/json" should return a clean JSON string.
        // We parse it directly. If it fails, the catch block will handle it.
        parsedJson = JSON.parse(jsonString);

    } catch (e) {
        console.error("Falha ao analisar a resposta da IA como JSON. Resposta recebida:", response.text, "Erro:", e);
        let errorMessage = "A resposta da IA não é um JSON válido.";
        if (e instanceof SyntaxError && (e.message.includes("Unexpected end of JSON input") || e.message.includes("Unterminated string in JSON"))) {
            errorMessage = "A resposta da IA parece estar incompleta (truncada). Isso pode ocorrer com cronogramas muito grandes. Tente importar o cronograma em partes menores.";
        }
        throw new Error(errorMessage);
    }
    
    if (!Array.isArray(parsedJson)) {
        console.error("AI response is not an array:", parsedJson);
        throw new Error("A resposta da IA não é um cronograma válido (o resultado não é uma lista).");
    }

    return (parsedJson as any[]).map((group: any) => ({
      id: generateId(),
      customValues: {
        fa: (group.fa || 'N/A').substring(0, 200),
        componente: (group.componente || 'Componente').substring(0, 200),
        setor: (group.setor || 'Setor').substring(0, 200),
      },
      tarefas: Array.isArray(group.tarefas) ? group.tarefas.map((tarefa: any) => ({
        id: generateId(),
        title: (tarefa.title || 'Tarefa').substring(0, 500),
        activities: Array.isArray(tarefa.activities) ? tarefa.activities.map((activity: any) => {
            const newActivity: any = {
                id: generateId(),
                name: (activity.name || 'Atividade').substring(0, 500),
                schedule: {}
            };
            
            // Case 1: Layout 3 with startDate and endDate
            if (activity.startDate && activity.endDate) {
                const schedule: Record<string, Status> = {};
                let currentDate = new Date(activity.startDate + 'T00:00:00Z');
                const endDate = new Date(activity.endDate + 'T00:00:00Z');

                if (!isNaN(currentDate.getTime()) && !isNaN(endDate.getTime())) {
                    while (currentDate <= endDate) {
                        const dayOfWeek = currentDate.getUTCDay();
                        if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0 = Sunday, 6 = Saturday
                            schedule[formatDate(currentDate)] = Status.Programado;
                        }
                        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
                    }
                }
                newActivity.schedule = schedule;
            } 
            // Case 2: Layout 1/2 with schedule array
            else if (Array.isArray(activity.schedule)) {
                newActivity.schedule = activity.schedule.reduce((acc: Record<string, Status>, item: any) => {
                    if (item && typeof item.date === 'string' && item.date.match(/^\d{4}-\d{2}-\d{2}$/) && typeof item.status === 'string' && Object.values(Status).includes(item.status as Status)) {
                        acc[item.date] = item.status as Status;
                    }
                    return acc;
                }, {});
            }

            return newActivity;
        }) : [],
      })) : [],
    }));
};
