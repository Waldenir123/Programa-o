import React, { useState, useMemo, useCallback, useEffect, useRef, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Chart } from 'chart.js/auto';

// --- TYPES AND ENUMS ---
enum Status {
  Programado = 'X',
  Concluido = 'Ok',
  Cancelado = 'C',
  NaoRealizado = 'N',
}
const STATUS_LABELS: Record<Status, string> = {
  [Status.Programado]: 'Programado',
  [Status.Concluido]: 'Concluído',
  [Status.Cancelado]: 'Cancelado',
  [Status.NaoRealizado]: 'Não Realizado',
};
const STATUS_CLASS_MAP: Record<Status, string> = {
    [Status.Programado]: 'programado',
    [Status.Concluido]: 'concluido',
    [Status.Cancelado]: 'cancelado',
    [Status.NaoRealizado]: 'nao-realizado',
};
const STATUS_COLOR_MAP: Record<Status, string> = {
    [Status.Programado]: '#ffeb3b',
    [Status.Concluido]: '#4ADE80',
    [Status.Cancelado]: '#60A5FA',
    [Status.NaoRealizado]: '#F87171',
};
const STATUS_CYCLE: Status[] = [Status.Programado, Status.Concluido, Status.Cancelado, Status.NaoRealizado];

interface Atividade {
  id: string;
  name: string;
  schedule: Record<string, Status>;
}
interface TarefaPrincipal {
  id: string;
  title: string;
  activities: Atividade[];
}
interface Grupo {
  id: string;
  componente: string;
  setor: string;
  fa: string;
  tarefas: TarefaPrincipal[];
}
type ScheduleData = Grupo[];

interface Project {
  id: string;
  name: string;
  lastModified: number;
  title: string;
  startDate: string;
  programmerName: string;
  liveData: ScheduleData;
  savedPlan: ScheduleData | null;
}
type UserProjects = Record<string, Project>;

type Page = 'schedule' | 'dashboard' | 'comparison';

interface RenderableRow {
    group: Grupo;
    task: TarefaPrincipal;
    activity: Atividade;
    renderGroup: boolean;
    groupRowSpan: number;
    renderTask: boolean;
    taskRowSpan: number;
    wbsId: string;
}

type SelectedItem = {
    id: string;
    name: string;
    type: 'group' | 'task' | 'activity';
    wbsId: string;
};

type ToastMessage = {
    id: number;
    message: string;
    type: 'success' | 'error';
};

// --- UTILITY FUNCTIONS ---
const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
const formatDate = (date: Date): string => date.toISOString().split('T')[0];
const getDayAbbr = (date: Date) => ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'][date.getUTCDay()];
const getWeek = (date: Date) => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};
const deepClone = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

// --- AGENTE DE IA PARA EXCLUSÃO (Implementação do Usuário) ---
const aiDeletionAgent = (
    data: ScheduleData,
    idToDelete: string,
    type: 'group' | 'task' | 'activity'
): ScheduleData => {
    // Caso 1: Excluir um grupo inteiro. Simples e direto.
    if (type === 'group') {
        return data.filter(g => g.id !== idToDelete);
    }

    // Para itens aninhados, mapeamos e criamos novos objetos apenas no caminho da alteração
    const newData = data.map(group => {
        const isTaskInGroup = type === 'task' && group.tarefas.some(t => t.id === idToDelete);
        const isActivityInGroup = type === 'activity' && group.tarefas.some(t => t.activities.some(a => a.id === idToDelete));

        // Se o item a ser excluído não está neste grupo, retorna o objeto do grupo original para otimização
        if (!isTaskInGroup && !isActivityInGroup) {
            return group;
        }

        let newTarefas;
        if (isTaskInGroup) {
            // Caso 2: Excluir uma tarefa principal
            newTarefas = group.tarefas.filter(t => t.id !== idToDelete);
        } else { // isActivityInGroup é verdadeiro
            // Caso 3: Excluir uma atividade
            newTarefas = group.tarefas.map(task => {
                const isActivityInTask = task.activities.some(a => a.id === idToDelete);
                // Se a atividade não está nesta tarefa, retorna o objeto da tarefa original
                if (!isActivityInTask) {
                    return task;
                }
                const newActivities = task.activities.filter(a => a.id !== idToDelete);
                // Retorna um novo objeto de tarefa com a lista de atividades atualizada
                return { ...task, activities: newActivities };
            })
            // Limpa as tarefas que podem ter ficado vazias após a remoção da atividade
            .filter(t => t.activities.length > 0);
        }

        // Retorna um novo objeto de grupo com a lista de tarefas atualizada
        return { ...group, tarefas: newTarefas };
    })
    // Limpa os grupos que podem ter ficado vazios após a remoção da tarefa
    .filter(g => g.tarefas.length > 0);

    return newData;
};


const findContiguousBlock = (activity: Atividade, startDateStr: string) => {
    const schedule = activity.schedule;
    if (!schedule[startDateStr]) return { originalSchedule: {}, length: 0 };

    const sortedDates = Object.keys(schedule)
        .map(d => new Date(d + 'T00:00:00Z'))
        .sort((a, b) => a.getTime() - b.getTime());

    const formattedDates = sortedDates.map(formatDate);
    const startIndex = formattedDates.indexOf(startDateStr);
    if (startIndex === -1) return { originalSchedule: {}, length: 0 };

    let blockStart = startIndex;
    while (blockStart > 0) {
        const current = sortedDates[blockStart];
        const prev = sortedDates[blockStart - 1];
        const diff = (current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        if (diff > 1) break;
        blockStart--;
    }

    let blockEnd = startIndex;
    while (blockEnd < formattedDates.length - 1) {
        const current = sortedDates[blockEnd];
        const next = sortedDates[blockEnd + 1];
        const diff = (next.getTime() - current.getTime()) / (1000 * 60 * 60 * 24);
        if (diff > 1) break;
        blockEnd++;
    }

    const blockDates = formattedDates.slice(blockStart, blockEnd + 1);
    const originalSchedule: Record<string, Status> = {};
    blockDates.forEach(date => {
        originalSchedule[date] = schedule[date];
    });

    return { originalSchedule, length: blockDates.length };
};

// --- INITIAL DATA ---
const createNewProject = (name: string): Project => ({
  id: generateId(),
  name,
  lastModified: Date.now(),
  title: 'Nova Programação Semanal',
  startDate: formatDate(new Date('2025-07-14T00:00:00Z')),
  programmerName: 'Não definido',
  liveData: [],
  savedPlan: null,
});

// --- EXPORT AGENTS ---
const exportToExcelAgent = (filteredData: ScheduleData, dates: Date[], title: string, addToast: (message: string, type: 'success' | 'error') => void) => {
    if (filteredData.length === 0) {
        addToast("Não há dados filtrados para exportar.", "error");
        return;
    }
    const headerRows = 3;
    const baseCols = 5;

    const dateHeaders = dates.map(d => ({
        week: `Semana ${getWeek(d)}`,
        dayName: getDayAbbr(d),
        dayNum: d.getUTCDate()
    }));

    const header1 = [
        'Fase/Agrupador', 'COMPONENTE', 'SETOR', 'TAREFA PRINCIPAL', 'ATIVIDADE',
        ...dateHeaders.map(h => h.week)
    ];
    const header2 = Array(baseCols).fill('').concat(dateHeaders.map(h => h.dayName) as any);
    const header3 = Array(baseCols).fill('').concat(dateHeaders.map(h => h.dayNum) as any);

    const body: any[][] = [];
    const merges: XLSX.Range[] = [];
    let rowIndex = headerRows;

    filteredData.forEach(group => {
        const groupStartRow = rowIndex;
        let groupRowSpan = 0;
        group.tarefas.forEach(task => { groupRowSpan += task.activities.length > 0 ? task.activities.length : 1; });

        if (groupRowSpan > 1) {
            merges.push({ s: { r: groupStartRow, c: 0 }, e: { r: groupStartRow + groupRowSpan - 1, c: 0 } });
            merges.push({ s: { r: groupStartRow, c: 1 }, e: { r: groupStartRow + groupRowSpan - 1, c: 1 } });
            merges.push({ s: { r: groupStartRow, c: 2 }, e: { r: groupStartRow + groupRowSpan - 1, c: 2 } });
        }

        group.tarefas.forEach(task => {
            const taskStartRow = rowIndex;
            const taskRowSpan = task.activities.length > 0 ? task.activities.length : 1;
            if (taskRowSpan > 1) {
                merges.push({ s: { r: taskStartRow, c: 3 }, e: { r: taskStartRow + taskRowSpan - 1, c: 3 } });
            }

            if (task.activities.length === 0) {
                const row: any[] = [group.fa, group.componente, group.setor, task.title, ''];
                dates.forEach(date => row.push(''));
                body.push(row);
                rowIndex++;
            } else {
                task.activities.forEach(activity => {
                    const row: any[] = [group.fa, group.componente, group.setor, task.title, activity.name];
                    dates.forEach(date => {
                        row.push(activity.schedule[formatDate(date)] || '');
                    });
                    body.push(row);
                    rowIndex++;
                });
            }
        });
    });

    let currentWeek = '';
    let weekColStart = baseCols;
    dateHeaders.forEach((h, i) => {
        if (h.week !== currentWeek) {
            if (currentWeek) {
                merges.push({ s: { r: 0, c: weekColStart }, e: { r: 0, c: baseCols + i - 1 } });
            }
            currentWeek = h.week;
            weekColStart = baseCols + i;
        }
    });
    if (currentWeek) {
        merges.push({ s: { r: 0, c: weekColStart }, e: { r: 0, c: baseCols + dateHeaders.length - 1 } });
    }

    const wsData = [header1, header2, header3, ...body];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!merges'] = merges;
    
    ws['!cols'] = [ {wch:15}, {wch:15}, {wch:15}, {wch:40}, {wch:35} ];
    dates.forEach((_, i) => {
        ws['!cols']![baseCols + i] = { wch: 4 };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cronograma');
    XLSX.writeFile(wb, `${title.replace(/ /g, '_')}.xlsx`);
};

const exportToPdfAgent = (filteredData: ScheduleData, dates: Date[], title: string, addToast: (message: string, type: 'success' | 'error') => void, lastModified: number, programmerName: string) => {
    if (filteredData.length === 0) {
        addToast("Não há dados filtrados para exportar.", "error");
        return;
    }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });

    // Header
    doc.setFontSize(16);
    doc.setTextColor(45, 55, 72);
    doc.text(title, 40, 40);

    // Sub-header info
    const updatedDate = new Date(lastModified).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    doc.setFontSize(9);
    doc.setTextColor(100);

    // Programmer name on the left
    doc.text(`Responsável: ${programmerName}`, 40, 55);

    // Last update date on the right
    doc.text(`Última Atualização: ${updatedDate}`, doc.internal.pageSize.getWidth() - 40, 40, { align: 'right' as const });

    const head: any[] = [
        [
            { content: 'Fase/Agrupador', rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' as const } },
            { content: 'COMPONENTE', rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' as const } },
            { content: 'SETOR', rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' as const } },
            { content: 'TAREFA PRINCIPAL', rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' as const } },
            { content: 'ATIVIDADE', rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' as const } },
        ],
        [],
        []
    ];

    const weekHeaders: { content: string, colSpan: number, styles: { halign: 'center' } }[] = [];
    if (dates.length > 0) {
        let currentWeek = getWeek(dates[0]);
        let dayCount = 0;
        dates.forEach((date, index) => {
            const week = getWeek(date);
            if (week !== currentWeek) {
                weekHeaders.push({ content: `Semana ${currentWeek}`, colSpan: dayCount, styles: { halign: 'center' as const } });
                currentWeek = week;
                dayCount = 1;
            } else {
                dayCount++;
            }
            if (index === dates.length - 1) {
                weekHeaders.push({ content: `Semana ${currentWeek}`, colSpan: dayCount, styles: { halign: 'center' as const } });
            }
        });
    }
    head[0].push(...weekHeaders);
    head[1].push(...dates.map(date => ({ content: getDayAbbr(date), styles: { halign: 'center' as const } })));
    head[2].push(...dates.map(date => ({ content: date.getUTCDate().toString(), styles: { halign: 'center' as const } })));


    const body: any[] = [];
    filteredData.forEach(group => {
        const groupRowSpan = group.tarefas.reduce((acc, t) => acc + (t.activities.length || 1), 0);
        let isFirstRowOfGroup = true;
        group.tarefas.forEach((task) => {
            const taskRowSpan = task.activities.length || 1;
            let isFirstRowOfTask = true;
            if (task.activities.length === 0) {
                const row = [];
                if (isFirstRowOfGroup) {
                    row.push({ content: group.fa, rowSpan: groupRowSpan });
                    row.push({ content: group.componente, rowSpan: groupRowSpan });
                    row.push({ content: group.setor, rowSpan: groupRowSpan });
                    isFirstRowOfGroup = false;
                }
                row.push({ content: task.title, rowSpan: taskRowSpan });
                row.push(''); // Empty activity cell
                row.push(...Array(dates.length).fill(''));
                body.push(row);
            } else {
                task.activities.forEach((activity) => {
                    const row: any[] = [];
                    if (isFirstRowOfGroup) {
                        row.push({ content: group.fa, rowSpan: groupRowSpan });
                        row.push({ content: group.componente, rowSpan: groupRowSpan });
                        row.push({ content: group.setor, rowSpan: groupRowSpan });
                        isFirstRowOfGroup = false;
                    }
                    if (isFirstRowOfTask) {
                        row.push({ content: task.title, rowSpan: taskRowSpan });
                        isFirstRowOfTask = false;
                    }
                    row.push(activity.name);
                    dates.forEach(date => {
                        const dayAbbr = getDayAbbr(date);
                        const status = activity.schedule[formatDate(date)];
                        // FIX: Do not schedule activities on Sundays during export.
                        if (dayAbbr === 'DOM') {
                            row.push('');
                        } else {
                            row.push(status ? status : '');
                        }
                    });
                    body.push(row);
                });
            }
        });
    });

    autoTable(doc, {
        head: head,
        body: body,
        startY: 70,
        theme: 'grid',
        headStyles: { 
            fillColor: [233, 238, 245], 
            textColor: [45, 55, 72], 
            fontStyle: 'bold' as const,
            lineWidth: 0.5,
            lineColor: [45, 55, 72] 
        },
        styles: { 
            fontSize: 7, 
            cellPadding: 2, 
            valign: 'middle' as const, 
            halign: 'center' as const,
            lineColor: [45, 55, 72],
            lineWidth: 0.5,
        },
        columnStyles: {
            0: { cellWidth: 70, fontStyle: 'bold' as const, halign: 'left' as const },
            1: { cellWidth: 70, fontStyle: 'bold' as const, halign: 'left' as const },
            2: { cellWidth: 70, fontStyle: 'bold' as const, halign: 'left' as const },
            3: { cellWidth: 140, fontStyle: 'bold' as const, halign: 'left' as const },
            4: { cellWidth: 110, halign: 'left' as const },
        },
        didDrawCell: (data) => {
             if (data.section === 'body' && data.column.index >= 5) {
                const status = data.cell.text[0] as Status;
                 if (status && STATUS_COLOR_MAP[status]) {
                     doc.setFillColor(STATUS_COLOR_MAP[status]);
                     doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                     doc.setTextColor(50, 50, 50);
                     doc.text(String(status), data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2, {
                        align: 'center' as const,
                        baseline: 'middle' as const
                    });
                 }
            }
        }
    });
    doc.save(`${title.replace(/ /g, '_')}.pdf`);
};

// --- AI SERVICE ---
const parseFADetailWithAI = async (ai: GoogleGenAI, text: string, fileData: { mimeType: string, data: string } | null): Promise<Omit<Grupo, 'id'>[]> => {
    const schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                fa: { type: Type.STRING, description: "O número da FA, formatado como 'FA XXXXX'." },
                componente: { type: Type.STRING, description: "O nome do componente." },
                setor: { type: Type.STRING, description: "O centro de custo ou setor responsável." },
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
            required: ['fa', 'componente', 'setor', 'tarefas'],
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
    - Como a imagem/texto não fornece 'COMPONENTE' de forma explícita, use o texto "Aguardando Definição" para o campo \`componente\`.

3.  **Identificar as Tarefas Principais (Operações):**
    - As Operações (ex: "PREPARAÇÃO E USINAGEM", "TRAÇAGEM E CORTE") são as \`tarefas\` principais.
    - Para cada Operação, extraia a sua descrição (ex: 'PREPARAÇÃO E USINAGEM').
    - O 'Centro de Custo' associado a cada Operação (ex: 'IPU') deve ser usado como o valor para o campo \`setor\` do grupo. Se houver múltiplos Centros de Custo, use o da primeira operação encontrada.

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

const parseScheduleWithAI = async (ai: GoogleGenAI, text: string, fileData: { mimeType: string, data: string } | null): Promise<ScheduleData> => {
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
                title: { type: Type.STRING },
                activities: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      schedule: {
                        type: Type.ARRAY,
                        description: "Uma lista de datas e seus respectivos status para esta atividade.",
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

    const prompt = `Você é um assistente especialista em planejamento de projetos, focado em extrair dados estruturados de cronogramas visuais, como os de PDFs ou imagens.

**Objetivo Principal:**
Sua tarefa é interpretar o cronograma fornecido e extrair não apenas as datas, mas também o **STATUS** de cada atividade em cada data, convertendo tudo em um formato JSON estruturado.

**Identificação da Hierarquia (REGRA CRÍTICA):**
- **Tarefas Principais:** Geralmente em **negrito**. NÃO terão marcações de data ('X', 'OK', etc.).
- **Atividades:** Geralmente **não estão em negrito**, aninhadas sob uma Tarefa Principal. **Somente as linhas de Atividade contêm as marcações de data/status**.
- **Grupos:** As colunas "COMPONENTE" e "SETOR" definem grupos (respeitando células mescladas).

**Extração de Datas e Status (REGRA CRÍTICA):**
Esta é a parte mais importante.
1.  Primeiro, identifique as datas no cabeçalho e converta-as para o formato \`YYYY-MM-DD\`.
2.  Para cada linha de **Atividade**, percorra horizontalmente a grade.
3.  Na intersecção de uma Atividade com uma data, **leia o texto da célula** (ex: "OK", "X", "N", "C").
4.  **Mapeie o texto lido para o status correspondente** e adicione um objeto \`{ "date": "YYYY-MM-DD", "status": "STATUS_MAPEADO" }\` ao array \`schedule\` da atividade.
5.  **Regras de Mapeamento de Status:**
    - "Ok" ou similar => \`"Ok"\` (Concluído)
    - "X", "P" ou uma marcação genérica => \`"X"\` (Programado)
    - "N" ou "NR" => \`"N"\` (Não Realizado)
    - "C" => \`"C"\` (Cancelado)
    - Se a célula estiver vazia, ignore-a. Não adicione nada ao array \`schedule\`.

**Formato de Saída:**
- Retorne **APENAS** um array JSON válido que corresponda ao esquema fornecido.
- Não inclua explicações, formatação markdown (como \`\`\`json\`\`\`) ou comentários. A resposta deve começar com \`[\` e terminar com \`]\`.

**Exemplo de Processo de Raciocínio:**

Dada uma entrada visual como esta:
| COMPONENTE        | ATIVIDADE            | 04/08/25 | 05/08/25 | 06/08/25 |
|-------------------|----------------------|----------|----------|----------|
| ANTEPARA DE VANTE | PREPARAÇÃO           | X        | OK       |          |
|                   | INSPEÇÃO VISUAL      |          | N        | C        |

Seu Raciocínio:
1.  **Grupo:** Identifico \`componente: "ANTEPARA DE VANTE"\`.
2.  **Atividades:** "PREPARAÇÃO" e "INSPEÇÃO VISUAL".
3.  **Extração de Datas e Status:**
    - Para "PREPARAÇÃO":
        - Vejo "X" em "04/08/25". Adiciono \`{ "date": "2025-08-04", "status": "X" }\`.
        - Vejo "OK" em "05/08/25". Adiciono \`{ "date": "2025-08-05", "status": "Ok" }\`.
        - A célula de 06/08/25 está vazia, ignoro.
    - Para "INSPEÇÃO VISUAL":
        - Vejo "N" em "05/08/25". Adiciono \`{ "date": "2025-08-05", "status": "N" }\`.
        - Vejo "C" em "06/08/25". Adiciono \`{ "date": "2025-08-06", "status": "C" }\`.
4.  **Montagem do JSON:** Monto os dados na estrutura final. A atividade "PREPARAÇÃO" terá \`"schedule": [{"date": "2025-08-04", "status": "X"}, {"date": "2025-08-05", "status": "Ok"}]\`.

Agora, por favor, processe os seguintes dados de cronograma:`;
    
    const contentParts: any[] = [{ text: prompt + `\n\nDados de texto (se houver): """${text}"""` }];
    if (fileData) { contentParts.push({ inlineData: { mimeType: fileData.mimeType, data: fileData.data } }); }
    
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

    return parsedJson.map((group: any) => ({
      id: generateId(),
      fa: (group.fa || 'N/A').substring(0, 200),
      componente: (group.componente || 'Componente').substring(0, 200),
      setor: (group.setor || 'Setor').substring(0, 200),
      tarefas: Array.isArray(group.tarefas) ? group.tarefas.map((tarefa: any) => ({
        id: generateId(),
        title: (tarefa.title || 'Tarefa').substring(0, 500),
        activities: Array.isArray(tarefa.activities) ? tarefa.activities.map((activity: any) => ({
          id: generateId(),
          name: (activity.name || 'Atividade').substring(0, 500),
          schedule: Array.isArray(activity.schedule) ? activity.schedule.reduce((acc: Record<string, Status>, item: any) => {
            if (item && typeof item.date === 'string' && item.date.match(/^\d{4}-\d{2}-\d{2}$/) && typeof item.status === 'string' && Object.values(Status).includes(item.status as Status)) {
                acc[item.date] = item.status as Status;
            }
            return acc;
          }, {}) : {},
        })) : [],
      })) : [],
    }));
};


// --- NEW STATE MANAGEMENT (useReducer) ---

// Define the shape of the state managed by the reducer
interface ScheduleState {
    liveData: ScheduleData;
    history: ScheduleData[];
    historyIndex: number;
}

// Define the actions that can be dispatched
type ScheduleAction =
    | { type: 'LOAD_DATA'; payload: ScheduleData }
    | { type: 'SET_DATA'; payload: ScheduleData }
    | { type: 'UNDO' }
    | { type: 'REDO' }
    | { type: 'ADD_ITEM'; payload: { type: 'group' | 'task' | 'activity'; parentId?: string } }
    | { type: 'DELETE_ITEM'; payload: { type: 'group' | 'task' | 'activity'; id: string } }
    | { type: 'UPDATE_TEXT'; payload: { id: string; field: 'componente' | 'setor' | 'fa' | 'tarefa' | 'atividade'; value: string } }
    | { type: 'UPDATE_SCHEDULE'; payload: ScheduleData }
    | { type: 'MOVE_GROUP'; payload: { fromId: string, toId: string | null } }
    | { type: 'CLEAR_ALL' };

// The reducer function that handles state transitions
const scheduleReducer = (state: ScheduleState, action: ScheduleAction): ScheduleState => {
    // Helper to create a new state with history tracking
    const createNewStateWithHistory = (newData: ScheduleData): ScheduleState => {
        const newHistory = [...state.history.slice(0, state.historyIndex + 1), newData];
        return {
            ...state,
            liveData: newData,
            history: newHistory,
            historyIndex: newHistory.length - 1,
        };
    };

    switch (action.type) {
        case 'LOAD_DATA':
            return {
                liveData: action.payload,
                history: [action.payload],
                historyIndex: 0,
            };

        case 'SET_DATA':
            return createNewStateWithHistory(action.payload);

        case 'CLEAR_ALL':
            return createNewStateWithHistory([]);

        case 'ADD_ITEM': {
            const { type, parentId } = action.payload;
            const newActivity = { id: generateId(), name: 'Nova Atividade', schedule: {} };
            const newTask = { id: generateId(), title: 'Nova Tarefa Principal', activities: [newActivity] };
            const newGroup = { id: generateId(), fa: 'NOVA FASE', componente: 'Novo Componente', setor: 'Novo Setor', tarefas: [newTask] };

            const newData = (() => {
                if (type === 'group') {
                    return [...state.liveData, newGroup];
                }
                if (type === 'task' && parentId) {
                    return state.liveData.map(group =>
                        group.id === parentId
                            ? { ...group, tarefas: [...group.tarefas, newTask] }
                            : group
                    );
                }
                if (type === 'activity' && parentId) {
                    return state.liveData.map(group => ({
                        ...group,
                        tarefas: group.tarefas.map(task =>
                            task.id === parentId
                                ? { ...task, activities: [...task.activities, newActivity] }
                                : task
                        ),
                    }));
                }
                return state.liveData;
            })();
            return createNewStateWithHistory(newData);
        }

        case 'DELETE_ITEM': {
            const { type, id } = action.payload;
            const newData = aiDeletionAgent(state.liveData, id, type);
            // By unconditionally creating a new state history entry, we trust React's core
            // diffing algorithm to correctly and efficiently update the UI. The new agent
            // ensures the changes are properly structured for this.
            return createNewStateWithHistory(newData);
        }

        case 'UPDATE_TEXT': {
            const { id, field, value } = action.payload;
            const newData = state.liveData.map(group => {
                if ((field === 'componente' || field === 'setor' || field === 'fa') && group.id === id) {
                    return { ...group, [field]: value };
                }
                let taskUpdated = false;
                const newTarefas = group.tarefas.map(tarefa => {
                    if (field === 'tarefa' && tarefa.id === id) {
                        taskUpdated = true;
                        return { ...tarefa, title: value };
                    }
                    let activityUpdated = false;
                    const newActivities = tarefa.activities.map(activity => {
                        if (field === 'atividade' && activity.id === id) {
                            activityUpdated = true;
                            return { ...activity, name: value };
                        }
                        return activity;
                    });
                    if (activityUpdated) {
                        taskUpdated = true;
                        return { ...tarefa, activities: newActivities };
                    }
                    return tarefa;
                });
                if (taskUpdated) {
                    return { ...group, tarefas: newTarefas };
                }
                return group;
            });
            return createNewStateWithHistory(newData);
        }

        case 'UPDATE_SCHEDULE':
             return createNewStateWithHistory(action.payload);
        
        case 'MOVE_GROUP': {
            const { fromId, toId } = action.payload;
            const data = [...state.liveData];
            const fromIndex = data.findIndex(g => g.id === fromId);
            if (fromIndex === -1) return state;

            const [movedGroup] = data.splice(fromIndex, 1);
            
            if (toId === null) {
                data.push(movedGroup);
            } else {
                const toIndex = data.findIndex(g => g.id === toId);
                if (toIndex === -1) return state;
                data.splice(toIndex, 0, movedGroup);
            }
            return createNewStateWithHistory(data);
        }

        case 'UNDO': {
            if (state.historyIndex <= 0) return state;
            const newIndex = state.historyIndex - 1;
            return {
                ...state,
                historyIndex: newIndex,
                liveData: state.history[newIndex],
            };
        }

        case 'REDO': {
            if (state.historyIndex >= state.history.length - 1) return state;
            const newIndex = state.historyIndex + 1;
            return {
                ...state,
                historyIndex: newIndex,
                liveData: state.history[newIndex],
            };
        }

        default:
            return state;
    }
};

// --- Custom Hook for Schedule Interaction Logic ---
const useScheduleInteraction = (
    liveData: ScheduleData,
    dispatch: React.Dispatch<ScheduleAction>
) => {
    const [interaction, setInteraction] = useState<{
        type: 'paint' | 'drag' | null;
        activityId: string | null;
        startDate: string | null;
        dropDate: string | null;
        block?: { originalSchedule: Record<string, Status>; length: number; };
        paintedCells?: Record<string, Record<string, Status>>;
    }>({ type: null, activityId: null, startDate: null, dropDate: null });
    const [activeCell, setActiveCell] = useState<{ activityId: string; date: string } | null>(null);

    const handleCellMouseDown = useCallback((event: React.MouseEvent, activityId: string, dateStr: string) => {
        if (event.button !== 0 || activityId.startsWith('empty-')) return;
        event.preventDefault();

        setActiveCell({ activityId, date: dateStr });

        const activity = liveData.flatMap(g => g.tarefas.flatMap(t => t.activities)).find(a => a.id === activityId);
        if (!activity) return;

        const currentStatus = activity.schedule[dateStr];

        if (!currentStatus) {
            setInteraction({
                type: 'paint',
                activityId,
                startDate: dateStr,
                dropDate: dateStr,
                paintedCells: { [activityId]: { [dateStr]: Status.Programado } }
            });
        } else {
            const block = findContiguousBlock(activity, dateStr);
            setInteraction({
                type: 'drag',
                activityId,
                startDate: dateStr,
                dropDate: dateStr,
                block,
            });
        }
        document.body.classList.add('dragging');
    }, [liveData]);

    const handleCellMouseEnter = useCallback((activityId: string, dateStr: string) => {
        if (!interaction.type || activityId !== interaction.activityId) return;

        if (interaction.type === 'paint') {
            setInteraction(prev => {
                if(!prev.paintedCells) return prev;
                const newPaintedCells = deepClone(prev.paintedCells);
                if (!newPaintedCells[activityId]) newPaintedCells[activityId] = {};
                newPaintedCells[activityId][dateStr] = Status.Programado;
                return { ...prev, paintedCells: newPaintedCells, dropDate: dateStr };
            });
        } else if (interaction.type === 'drag') {
            setInteraction(prev => ({ ...prev, dropDate: dateStr }));
        }
    }, [interaction.type, interaction.activityId]);

    const handleGlobalMouseUp = useCallback(() => {
        if (!interaction.type) return;
        
        document.body.classList.remove('dragging');
        if(!interaction.activityId || !interaction.startDate) {
            setInteraction({ type: null, activityId: null, startDate: null, dropDate: null });
            return;
        }

        const { type, activityId, startDate, paintedCells, block, dropDate } = interaction;
        const isClick = startDate === dropDate;
        const newData = deepClone(liveData);
        const activity = newData.flatMap(g => g.tarefas.flatMap(t => t.activities)).find(a => a.id === activityId);
        
        if (activity) {
            if (isClick) {
                const currentStatus = activity.schedule[startDate];
                const currentIndex = currentStatus ? STATUS_CYCLE.indexOf(currentStatus) : -1;
                const nextStatus = (currentIndex === STATUS_CYCLE.length - 1) ? undefined : STATUS_CYCLE[currentIndex + 1];
                if (nextStatus) {
                    activity.schedule[startDate] = nextStatus;
                } else {
                    delete activity.schedule[startDate];
                }
            } else if (type === 'paint' && paintedCells) {
                Object.keys(paintedCells[activityId]).forEach((date) => {
                    activity.schedule[date] = Status.Programado;
                });
            } else if (type === 'drag' && block && dropDate) {
                Object.keys(block.originalSchedule).forEach(dateStr => delete activity.schedule[dateStr]);
                const offset = Math.round((new Date(dropDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
                Object.entries(block.originalSchedule).forEach(([dateStr, status]) => {
                    const newDate = new Date(dateStr + 'T00:00:00Z');
                    newDate.setUTCDate(newDate.getUTCDate() + offset);
                    activity.schedule[formatDate(newDate)] = status;
                });
            }
        }

        dispatch({ type: 'UPDATE_SCHEDULE', payload: newData });
        setInteraction({ type: null, activityId: null, startDate: null, dropDate: null });
    }, [interaction, liveData, dispatch]);

    useEffect(() => {
        if (interaction.type) {
          window.addEventListener('mouseup', handleGlobalMouseUp);
        }
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, [interaction.type, handleGlobalMouseUp]);

    return { interaction, activeCell, setActiveCell, handleCellMouseDown, handleCellMouseEnter };
};


// --- CHILD COMPONENTS ---

const Toast = ({ message, type, onDismiss }: { message: string, type: 'success' | 'error', onDismiss: () => void }) => {
    useEffect(() => {
        const timer = setTimeout(onDismiss, 5000);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div className={`toast ${type}`} role="alert">
            <p>{message}</p>
            <button onClick={onDismiss} aria-label="Fechar">&times;</button>
        </div>
    );
};

const ToastContainer = ({ toasts, setToasts }: { toasts: ToastMessage[], setToasts: React.Dispatch<React.SetStateAction<ToastMessage[]>> }) => {
    const dismissToast = (id: number) => {
        setToasts(currentToasts => currentToasts.filter(t => t.id !== id));
    };

    return (
        <div className="toast-container">
            {toasts.map(toast => (
                <Toast key={toast.id} {...toast} onDismiss={() => dismissToast(toast.id)} />
            ))}
        </div>
    );
};

const AuthScreen = ({ onLogin, onRegister }: { onLogin: (u: string, p: string) => boolean; onRegister: (u: string, p: string) => boolean }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');

        if (isLogin) {
            if (!onLogin(username, password)) {
                setError('Credenciais inválidas. Tente novamente.');
            }
        } else {
            const success = onRegister(username, password);
            if (success) {
                setSuccessMessage('Registro concluído com sucesso! Faça o login para continuar.');
                setIsLogin(true);
                setPassword('');
            } else {
                setError('Nome de usuário já existe.');
            }
        }
    };
    
    const handleTabSwitch = (loginView: boolean) => {
        setIsLogin(loginView);
        setError('');
        setSuccessMessage('');
    };

    return (
        <div className="auth-screen">
            <div className="auth-form-container">
                <h1>Bem-vindo!</h1>
                <p>Acesse ou crie sua conta para continuar.</p>
                <div className="auth-tabs">
                    <button className={isLogin ? 'active' : ''} onClick={() => handleTabSwitch(true)}>Login</button>
                    <button className={!isLogin ? 'active' : ''} onClick={() => handleTabSwitch(false)}>Registrar</button>
                </div>
                <form onSubmit={handleSubmit}>
                    {error && <p className="auth-error">{error}</p>}
                    {successMessage && <p className="auth-success">{successMessage}</p>}
                    <div className="form-group">
                        <label htmlFor="username">Usuário</label>
                        <input type="text" id="username" value={username} onChange={e => setUsername(e.target.value)} required />
                    </div>
                    <div className="form-group">
                        <label htmlFor="password">Senha</label>
                        <input type="password" id="password" value={password} onChange={e => setPassword(e.target.value)} required />
                    </div>
                    <button type="submit" className="submit-button">{isLogin ? 'Entrar' : 'Criar Conta'}</button>
                </form>
            </div>
        </div>
    );
};

const ImportModal = ({ isOpen, onClose, onImportSchedule, onImportFA }: { 
    isOpen: boolean, 
    onClose: () => void, 
    onImportSchedule: (text: string, file: File | null) => Promise<void>,
    onImportFA: (text: string, file: File | null) => Promise<void> 
}) => {
    const [text, setText] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleScheduleSubmit = async () => {
        setIsProcessing(true);
        try {
            await onImportSchedule(text, file);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFASubmit = async () => {
        if (!file && !text) return;
        setIsProcessing(true);
        try {
            await onImportFA(text, file);
        } finally {
            setIsProcessing(false);
        }
    };
    
    const triggerFileSelect = () => fileInputRef.current?.click();

    return (
        <div className="modal-overlay">
            <div className="modal-content wide" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
                <h2 id="import-modal-title">Importar Cronograma com IA</h2>
                <p>Para um cronograma geral, cole texto ou envie um arquivo. Para uma Folha de Atividades (FA), envie o arquivo de imagem/PDF.</p>
                <textarea 
                    value={text} 
                    onChange={e => setText(e.target.value)} 
                    placeholder="Cole o texto de um cronograma geral ou de uma FA aqui..."
                    rows={8}
                    disabled={isProcessing}
                ></textarea>
                <div style={{ margin: '16px 0' }}>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} disabled={isProcessing} accept="image/*,application/pdf" />
                    <button onClick={triggerFileSelect} className="control-button" disabled={isProcessing}>
                        <span className="material-icons" aria-hidden="true">upload_file</span>
                        {file ? `Arquivo: ${file.name}` : 'Selecionar Arquivo (Imagem ou PDF)'}
                    </button>
                </div>
                <div className="modal-actions">
                    <button onClick={onClose} className="cancel-button" disabled={isProcessing}>Cancelar</button>
                    <button onClick={handleFASubmit} className="submit-button" disabled={isProcessing || (!text && !file)}>
                        {isProcessing ? 'Processando...' : 'Importar Detalhe da FA'}
                    </button>
                    <button onClick={handleScheduleSubmit} className="submit-button" disabled={isProcessing || (!text && !file)}>
                        {isProcessing ? 'Processando...' : 'Importar Cronograma Geral'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const SaveModal = ({ onClose, onSave, currentName }: { onClose: () => void, onSave: (name: string) => void, currentName?: string }) => {
    const [name, setName] = useState(currentName || `Novo Projeto ${new Date().toLocaleDateString()}`);
    return (
        <div className="modal-overlay">
            <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="save-modal-title">
                <h2 id="save-modal-title">Salvar/Criar Projeto</h2>
                <p>Dê um nome para este planejamento.</p>
                <div className="form-group">
                    <label htmlFor="projectName">Nome do Projeto</label>
                    <input id="projectName" type="text" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="modal-actions">
                    <button onClick={onClose} className="cancel-button">Cancelar</button>
                    <button onClick={() => onSave(name)} className="submit-button" disabled={!name.trim()}>Salvar</button>
                </div>
            </div>
        </div>
    );
};

const LoadModal = ({ schedules, onLoad, onDelete, onClose }: { schedules: Project[], onLoad: (id: string) => void, onDelete: (id: string) => void, onClose: () => void }) => {
    return (
        <div className="modal-overlay">
            <div className="modal-content wide" role="dialog" aria-modal="true" aria-labelledby="load-modal-title">
                <h2 id="load-modal-title">Carregar Planejamento</h2>
                <ul className="schedule-load-list">
                    {schedules.length > 0 ? schedules.map(s => (
                        <li key={s.id}>
                            <div className="schedule-info">
                                <span className="schedule-name">{s.name}</span>
                                <span className="schedule-date">Modificado em: {new Date(s.lastModified).toLocaleString()}</span>
                            </div>
                            <div className="schedule-actions">
                                <button className="submit-button" onClick={() => onLoad(s.id)}>Carregar</button>
                                <button className="control-button danger" onClick={() => onDelete(s.id)}>Excluir</button>
                            </div>
                        </li>
                    )) : (
                        <p>Nenhum projeto salvo encontrado.</p>
                    )}
                </ul>
                <div className="modal-actions">
                    <button onClick={onClose} className="cancel-button">Fechar</button>
                </div>
            </div>
        </div>
    );
};

const Sidebar = ({
    handleUndo, handleRedo, historyIndex, historyLength,
    handleClearAll, handleSavePlan,
    setImportModalOpen, setSaveModalOpen, setLoadModalOpen, handleSaveProject,
    handleExportExcel, handleExportPdf,
    handleDateChange, startDate,
    dateColumnWidth, handleZoomChange,
    goToWeekInput, setGoToWeekInput, handleGoToWeek,
    selectedItem, handleDeleteSelectedItem,
}) => {
    const typeLabels: Record<string, string> = {
        group: 'Grupo',
        task: 'Tarefa Principal',
        activity: 'Atividade'
    };
    return (
        <div className="control-panel">
            <div className="control-section">
                <h3>Ações Rápidas</h3>
                <button className="control-button" onClick={handleUndo} disabled={historyIndex <= 0}><span className="material-icons" aria-hidden="true">undo</span> Desfazer</button>
                <button className="control-button" onClick={handleRedo} disabled={historyIndex >= historyLength - 1}><span className="material-icons" aria-hidden="true">redo</span> Refazer</button>
                <button className="control-button" onClick={() => setImportModalOpen(true)}><span className="material-icons" aria-hidden="true">input</span> Importar com IA</button>
            </div>

            <div className="control-section">
                <h3>Gerenciar Projeto</h3>
                <button className="submit-button" onClick={handleSaveProject}><span className="material-icons" aria-hidden="true">save</span> Salvar Alterações</button>
                <button className="control-button" onClick={handleSavePlan} title="Salva o cronograma atual como o 'Planejado' para comparações futuras."><span className="material-icons" aria-hidden="true">bookmark_add</span> Definir como Base</button>
                <button className="control-button" onClick={() => setSaveModalOpen(true)}><span className="material-icons" aria-hidden="true">create_new_folder</span> Novo Projeto</button>
                <button className="control-button" onClick={() => setLoadModalOpen(true)}><span className="material-icons" aria-hidden="true">folder_open</span> Carregar Projeto</button>
                <button className="control-button danger" onClick={handleClearAll}><span className="material-icons" aria-hidden="true">delete_sweep</span> Limpar Cronograma</button>
            </div>

            <div className="control-section">
                <h3>Navegação</h3>
                <div className="date-nav">
                    <label htmlFor="start-date">Data de Início:</label>
                    <input id="start-date" type="date" value={formatDate(startDate)} onChange={e => handleDateChange(e.target.value)} />
                    <div className="date-nav-buttons">
                        <button onClick={() => handleDateChange(formatDate(new Date(startDate.getTime() - 7 * 86400000)))}>&lt; Sem</button>
                        <button onClick={() => handleDateChange(formatDate(new Date()))}>Hoje</button>
                        <button onClick={() => handleDateChange(formatDate(new Date(startDate.getTime() + 7 * 86400000)))}>Sem &gt;</button>
                    </div>
                    <div className="week-nav">
                        <label htmlFor="week-input">Ir para Semana:</label>
                        <div className="week-nav-controls">
                            <input
                                id="week-input"
                                type="number"
                                value={goToWeekInput}
                                onChange={e => setGoToWeekInput(Number(e.target.value))}
                                min="1"
                                max="53"
                            />
                            <button onClick={handleGoToWeek}>Ir</button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="control-section">
                <h3>Visualização</h3>
                <div className="zoom-control">
                    <label htmlFor="zoom-slider">Zoom da Linha do Tempo ({dateColumnWidth}px)</label>
                    <input
                        id="zoom-slider"
                        type="range"
                        min="20"
                        max="120"
                        value={dateColumnWidth}
                        onChange={e => handleZoomChange(Number(e.target.value))}
                    />
                </div>
            </div>
             <div className="control-section">
                <h3>Exportar</h3>
                <button className="control-button" onClick={handleExportExcel}><span className="material-icons" aria-hidden="true">download</span> Exportar para Excel</button>
                <button className="control-button" onClick={handleExportPdf}><span className="material-icons" aria-hidden="true">picture_as_pdf</span> Exportar para PDF</button>
            </div>

            <div className="control-section ai-agent-status">
                <h3>Agente de Exclusão</h3>
                <div className="agent-status-item">
                    <span className="material-icons agent-active" aria-hidden="true">smart_toy</span>
                    <span>Agente de Organização: <strong>Ativo</strong></span>
                </div>
                {selectedItem ? (
                    <div className="selection-info">
                        <p><strong>ID:</strong> {selectedItem.wbsId}</p>
                        <p><strong>Nome:</strong> {selectedItem.name}</p>
                        <p><strong>Tipo:</strong> {typeLabels[selectedItem.type]}</p>
                        <button className="control-button danger" onClick={handleDeleteSelectedItem}>
                            <span className="material-icons" aria-hidden="true">delete_forever</span>
                            Excluir Item Selecionado
                        </button>
                    </div>
                ) : (
                    <p className="agent-description">
                        Clique em uma linha da tabela para selecioná-la para exclusão.
                    </p>
                )}
            </div>

            <div className="control-section">
                <h3>Legenda</h3>
                <ul className="legend-list">
                    {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <li key={key}><span className="legend-color-box" style={{ backgroundColor: STATUS_COLOR_MAP[key as Status] }}></span>{label}</li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

const FilterDropdown = ({ columnKey, allOptions, activeSelections, onApply, onClose, position }: {
    columnKey: string;
    allOptions: string[];
    activeSelections: Set<string>;
    onApply: (columnKey: string, selections: Set<string>) => void;
    onClose: () => void;
    position: DOMRect;
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [currentSelections, setCurrentSelections] = useState(() => new Set(activeSelections));

    const filteredOptions = useMemo(() => {
        return allOptions.filter(opt => opt.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [allOptions, searchTerm]);

    const handleToggle = (option: string) => {
        const newSelections = new Set(currentSelections);
        if (newSelections.has(option)) {
            newSelections.delete(option);
        } else {
            newSelections.add(option);
        }
        setCurrentSelections(newSelections);
    };

    const handleSelectAll = () => setCurrentSelections(new Set(filteredOptions));
    const handleClear = () => setCurrentSelections(new Set());
    const handleApply = () => onApply(columnKey, currentSelections);

    return (
        <div className="filter-dropdown-overlay" onClick={onClose}>
            <div className="filter-dropdown" style={{ top: position.bottom + 5, left: position.left }} onClick={e => e.stopPropagation()}>
                <div className="filter-search">
                    <input
                        type="text"
                        placeholder="Pesquisar..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        autoFocus
                    />
                </div>
                <div className="filter-quick-actions">
                     <button onClick={handleSelectAll}>Selecionar Tudo</button>
                     <button onClick={handleClear}>Limpar Seleção</button>
                </div>
                <ul className="filter-options-list">
                    {filteredOptions.map(option => (
                        <li key={option}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={currentSelections.has(option)}
                                    onChange={() => handleToggle(option)}
                                />
                                {option}
                            </label>
                        </li>
                    ))}
                </ul>
                <div className="filter-main-actions">
                    <button className="cancel-button" onClick={onClose}>Cancelar</button>
                    <button className="submit-button" onClick={handleApply}>Aplicar</button>
                </div>
            </div>
        </div>
    );
};

const columnKeyMap: Record<string, string> = {
    'Fase/Agrupador': 'fa',
    'COMPONENTE': 'componente',
    'SETOR': 'setor',
    'TAREFA PRINCIPAL': 'tarefaPrincipal',
};

const ScheduleHeader = ({ dates, headers, columnWidths, onResizeStart, stickyColumnPositions, onOpenFilter, activeFilters }: {
    dates: Date[];
    headers: string[];
    columnWidths: number[];
    onResizeStart: (index: number, e: React.MouseEvent) => void;
    stickyColumnPositions: number[];
    onOpenFilter: (column: string, rect: DOMRect) => void;
    activeFilters: Record<string, Set<string>>;
}) => {
    const weekHeaders = useMemo(() => {
        const weeks: { name: string, count: number }[] = [];
        if (dates.length > 0) {
            dates.forEach(date => {
                const weekName = `Semana ${getWeek(date)}`;
                if (weeks.length === 0 || weeks[weeks.length - 1].name !== weekName) {
                    weeks.push({ name: weekName, count: 1 });
                } else {
                    weeks[weeks.length - 1].count++;
                }
            });
        }
        return weeks;
    }, [dates]);

    return (
        <thead>
            <tr>
                {headers.map((header, i) => {
                    const columnKey = columnKeyMap[header];
                    const isFilterable = !!columnKey;
                    const isFilterActive = activeFilters[columnKey]?.size > 0;

                    return (
                        <th key={i} className={`col-sticky col-sticky-${i+1}`} style={{ width: columnWidths[i], left: stickyColumnPositions[i] }}>
                            <div className="header-content">
                                <span>{header}</span>
                                {isFilterable && (
                                    <button
                                        className={`filter-icon-button ${isFilterActive ? 'active' : ''}`}
                                        onClick={(e) => onOpenFilter(columnKey, e.currentTarget.getBoundingClientRect())}
                                        aria-label={`Filtrar ${header}`}
                                    >
                                        <span className="material-icons" aria-hidden="true">filter_list</span>
                                    </button>
                                )}
                            </div>
                            <div className="resize-handle" onMouseDown={e => onResizeStart(i, e)}></div>
                        </th>
                    );
                })}
                {weekHeaders.map((week, i) => (
                    <th key={week.name} colSpan={week.count} className="week-header">
                        {week.name}
                        {i === weekHeaders.length -1 && <div className="resize-handle" onMouseDown={e => onResizeStart(headers.length + dates.length -1, e)}></div>}
                    </th>
                ))}
            </tr>
            <tr>
                {headers.map((_, i) => <th key={i} className={`col-sticky col-sticky-${i+1}`} style={{ width: columnWidths[i], left: stickyColumnPositions[i] }}></th>)}
                {dates.map((date, i) => <th key={i} className={getDayAbbr(date) === 'SÁB' || getDayAbbr(date) === 'DOM' ? 'weekend' : ''}>{getDayAbbr(date)}</th>)}
            </tr>
            <tr>
                {headers.map((_, i) => <th key={i} className={`col-sticky col-sticky-${i+1}`} style={{ width: columnWidths[i], left: stickyColumnPositions[i] }}></th>)}
                {dates.map((date, i) => (
                    <th key={i} style={{ width: columnWidths[headers.length + i] }} className={getDayAbbr(date) === 'SÁB' || getDayAbbr(date) === 'DOM' ? 'weekend' : ''}>
                        {date.getUTCDate()}
                        <div className="resize-handle" onMouseDown={e => onResizeStart(headers.length + i, e)}></div>
                    </th>
                ))}
            </tr>
        </thead>
    );
};

const ScheduleBody = ({ 
    data, dates,
    isComparison, planType, columnWidths, stickyColumnPositions,
    selectedItem, setSelectedItem,
    // Optional props for full interactivity
    activeCell, onCellMouseDown, onCellMouseEnter, interaction,
    onTextUpdate, onAddItem, 
    draggedGroupInfo, onGroupDragStart, onGroupDrop, onDragEnd, onDropTargetChange, dropTargetId
}: { 
    data: ScheduleData;
    dates: Date[];
    isComparison: boolean;
    planType: 'planned' | 'real' | null;
    columnWidths: number[];
    stickyColumnPositions: number[];
    selectedItem?: SelectedItem | null;
    setSelectedItem?: (item: SelectedItem | null) => void;
    activeCell?: { activityId: string; date: string } | null;
    onCellMouseDown?: (e: React.MouseEvent, activityId: string, dateStr: string) => void;
    onCellMouseEnter?: (activityId: string, dateStr: string) => void;
    interaction?: any;
    onTextUpdate?: (id: string, field: 'componente' | 'setor' | 'fa' | 'tarefa' | 'atividade', value: string) => void;
    onAddItem?: (type: 'group' | 'task' | 'activity', parentId?: string) => void;
    draggedGroupInfo?: { group: Grupo, index: number } | null;
    onGroupDragStart?: (group: Grupo, index: number) => void;
    onGroupDrop?: () => void;
    onDragEnd?: () => void;
    onDropTargetChange?: (id: string | null) => void;
    dropTargetId?: string | null;
}) => {
    const renderableRows: RenderableRow[] = useMemo(() => {
        const rows: RenderableRow[] = [];
        const filteredData = data.filter(group => group.tarefas.length > 0 || (group.fa || group.componente));

        filteredData.forEach((group, groupIndex) => {
            const visibleGroups = data.map((g, i) => ({...g, originalIndex: i})).filter(g => {
                const groupWbs = `${g.originalIndex + 1}`;
                return filteredData.some(fg => fg.id === g.id);
            });
            const wbsGroupIndex = visibleGroups.findIndex(g => g.id === group.id);
            const groupWbs = `${wbsGroupIndex + 1}`;
            
            if (group.tarefas.length === 0) {
                 rows.push({
                    group,
                    task: { id: `empty-group-${group.id}`, title: '', activities: [] },
                    activity: { id: `empty-group-activity-${group.id}`, name: '', schedule: {} },
                    renderGroup: true,
                    groupRowSpan: 1,
                    renderTask: true,
                    taskRowSpan: 1,
                    wbsId: groupWbs,
                });
                return;
            }

            let groupRowSpan = 0;
            group.tarefas.forEach(task => { groupRowSpan += task.activities.length || 1; });
            
            let isFirstRowOfGroup = true;
            group.tarefas.forEach((task, taskIndex) => {
                const taskWbs = `${groupWbs}.${taskIndex + 1}`;
                const taskRowSpan = task.activities.length || 1;
                let isFirstRowOfTask = true;

                if (task.activities.length === 0) {
                    rows.push({
                        group, task,
                        activity: { id: `empty-${task.id}`, name: '', schedule: {} },
                        renderGroup: isFirstRowOfGroup, groupRowSpan,
                        renderTask: isFirstRowOfTask, taskRowSpan: 1,
                        wbsId: taskWbs,
                    });
                    isFirstRowOfGroup = false;
                } else {
                    task.activities.forEach((activity, activityIndex) => {
                        const activityWbs = `${taskWbs}.${activityIndex + 1}`;
                        rows.push({
                            group, task, activity,
                            renderGroup: isFirstRowOfGroup,
                            groupRowSpan,
                            renderTask: isFirstRowOfTask,
                            taskRowSpan,
                            wbsId: activityWbs,
                        });
                        isFirstRowOfGroup = false;
                        isFirstRowOfTask = false;
                    });
                }
            });
        });
        return rows;
    }, [data]);

    const getRowEntity = (row: RenderableRow): SelectedItem => {
        if (row.activity.id && !row.activity.id.startsWith('empty')) {
            return { id: row.activity.id, name: row.activity.name, type: 'activity', wbsId: row.wbsId };
        }
        if (row.task.id && !row.task.id.startsWith('empty')) {
            return { id: row.task.id, name: row.task.title, type: 'task', wbsId: row.wbsId };
        }
        return { id: row.group.id, name: row.group.fa, type: 'group', wbsId: row.wbsId };
    };

    return (
        <tbody onDragLeave={() => onDropTargetChange?.(null)}>
            {renderableRows.map((row, rowIndex) => {
                const isDraggingGroup = draggedGroupInfo?.group.id === row.group.id;
                const isDropTarget = !isComparison && draggedGroupInfo && dropTargetId === row.group.id && draggedGroupInfo.group.id !== row.group.id;
                
                const rowEntity = getRowEntity(row);
                const isSelected = !isComparison && selectedItem?.id === rowEntity.id;
                
                const trClass = [
                    isComparison ? (planType === 'planned' ? 'planned-row' : 'real-row') : '',
                    isDraggingGroup ? 'group-dragging' : '',
                    isSelected ? 'selected-row' : '',
                    isDropTarget ? 'drop-target-top' : ''
                ].join(' ').trim();

                return (
                    <tr 
                        key={row.activity.id + (planType || '')} 
                        className={trClass}
                        onClick={() => !isComparison && setSelectedItem?.(isSelected ? null : rowEntity)}
                        onDragOver={(e) => {
                            e.preventDefault();
                            if (!isComparison && onDropTargetChange) {
                                onDropTargetChange(row.group.id);
                            }
                        }}
                        onDrop={onGroupDrop}
                        onDragEnd={onDragEnd}
                    >
                        <td className="col-sticky col-sticky-1 id-cell" style={{ left: stickyColumnPositions[0] }}>
                            {row.wbsId}
                        </td>
                        {row.renderGroup && (
                            <td rowSpan={row.groupRowSpan} className="col-sticky col-sticky-2" style={{ left: stickyColumnPositions[1] }}>
                                <div className="cell-content-wrapper with-drag-handle">
                                    {!isComparison && (
                                        <button
                                            className="material-icons drag-handle"
                                            draggable
                                            onDragStart={() => onGroupDragStart?.(row.group, data.findIndex(g => g.id === row.group.id))}
                                            aria-label="Reordenar grupo"
                                            onClick={e => e.stopPropagation()}
                                        >
                                           drag_indicator
                                        </button>
                                    )}
                                    <span className="cell-text" contentEditable={!isComparison} suppressContentEditableWarning onBlur={e => onTextUpdate?.(row.group.id, 'fa', e.currentTarget.textContent || '')}>{row.group.fa}</span>
                                    {!isComparison && onAddItem && (
                                        <div className="cell-actions">
                                            <button onClick={(e) => { e.stopPropagation(); onAddItem('task', row.group.id); }} aria-label="Adicionar Tarefa"><span className="material-icons" aria-hidden="true">add_circle</span></button>
                                        </div>
                                    )}
                                </div>
                            </td>
                        )}
                        {row.renderGroup && (
                            <td rowSpan={row.groupRowSpan} className="col-sticky col-sticky-3" style={{ left: stickyColumnPositions[2] }}>
                                 <span className="cell-text" contentEditable={!isComparison} suppressContentEditableWarning onBlur={e => onTextUpdate?.(row.group.id, 'componente', e.currentTarget.textContent || '')}>{row.group.componente}</span>
                            </td>
                        )}
                        {row.renderGroup && (
                            <td rowSpan={row.groupRowSpan} className="col-sticky col-sticky-4" style={{ left: stickyColumnPositions[3] }}>
                                 <span className="cell-text" contentEditable={!isComparison} suppressContentEditableWarning onBlur={e => onTextUpdate?.(row.group.id, 'setor', e.currentTarget.textContent || '')}>{row.group.setor}</span>
                            </td>
                        )}
                        {row.renderTask && (
                            <td rowSpan={row.taskRowSpan} className="col-sticky col-sticky-5" style={{ left: stickyColumnPositions[4] }}>
                                <div className="cell-content-wrapper">
                                    <span className="cell-text" contentEditable={!isComparison} suppressContentEditableWarning onBlur={e => onTextUpdate?.(row.task.id, 'tarefa', e.currentTarget.textContent || '')}>{row.task.title}</span>
                                    {!isComparison && onAddItem && (
                                        <div className="cell-actions">
                                            <button onClick={(e) => { e.stopPropagation(); onAddItem('activity', row.task.id); }} aria-label="Adicionar Atividade"><span className="material-icons" aria-hidden="true">add_circle</span></button>
                                        </div>
                                    )}
                                </div>
                            </td>
                        )}
                        <td className="col-sticky col-sticky-6" style={{ left: stickyColumnPositions[5] }}>
                            <div className="cell-content-wrapper">
                                <span className="cell-text" contentEditable={!isComparison} suppressContentEditableWarning onBlur={e => onTextUpdate?.(row.activity.id, 'atividade', e.currentTarget.textContent || '')}>{row.activity.name}</span>
                            </div>
                        </td>
                        {isComparison && <td className="col-sticky col-sticky-7 comparison-label-cell" style={{ left: stickyColumnPositions[6] }}>{planType === 'planned' ? 'Planejado' : 'Real'}</td>}

                        {dates.map(date => {
                            const dateStr = formatDate(date);
                            let status = row.activity.schedule[dateStr];
                            let isGhost = false;
                            
                            const isBeingDragged = interaction?.type === 'drag' &&
                                                 interaction.activityId === row.activity.id &&
                                                 interaction.block?.originalSchedule[dateStr];

                            if (interaction?.type === 'paint' && interaction.activityId === row.activity.id) {
                                const paintedStatus = interaction.paintedCells?.[row.activity.id]?.[dateStr];
                                if (paintedStatus) {
                                    status = paintedStatus;
                                }
                            }

                             if (interaction?.type === 'drag' && interaction.activityId === row.activity.id && interaction.dropDate && interaction.startDate && interaction.block) {
                                const offset = Math.round((new Date(interaction.dropDate).getTime() - new Date(interaction.startDate).getTime()) / (1000 * 60 * 60 * 24));
                                
                                for (const originalDateStr in interaction.block.originalSchedule) {
                                    const newDate = new Date(originalDateStr + 'T00:00:00Z');
                                    newDate.setUTCDate(newDate.getUTCDate() + offset);
                                    if (formatDate(newDate) === dateStr) {
                                        status = interaction.block.originalSchedule[originalDateStr];
                                        isGhost = true;
                                        break;
                                    }
                                }
                            }

                            if (isBeingDragged) {
                                status = undefined;
                            }
                            
                            const isActive = activeCell?.activityId === row.activity.id && activeCell?.date === dateStr;
                            const isWeekend = getDayAbbr(date) === 'SÁB' || getDayAbbr(date) === 'DOM';
                           
                            const cellClasses = ['status-cell'];
                            if(status) cellClasses.push(STATUS_CLASS_MAP[status]);
                            if(isActive) cellClasses.push('active-cell');
                            if(isWeekend) cellClasses.push('weekend');
                            if(isGhost) cellClasses.push('ghost');
                            if(isBeingDragged) cellClasses.push('is-being-dragged');

                            return (
                                <td key={dateStr}
                                    className={cellClasses.join(' ')}
                                    onMouseDown={(e) => { e.stopPropagation(); onCellMouseDown?.(e, row.activity.id, dateStr); }}
                                    onMouseEnter={() => onCellMouseEnter?.(row.activity.id, dateStr)}
                                >
                                    {status && <span className="status-indicator">{status}</span>}
                                </td>
                            );
                        })}
                    </tr>
                )
            })}
             {!isComparison && onAddItem && (
                <tr 
                    className={`add-group-row ${!isComparison && draggedGroupInfo && dropTargetId === null ? 'drop-target-end' : ''}`}
                    onDragOver={(e) => {
                        e.preventDefault();
                        if (onDropTargetChange) onDropTargetChange(null);
                    }}
                    onDrop={onGroupDrop}
                >
                    <td colSpan={6} className="add-group-cell">
                        <button className="add-group-button" onClick={() => onAddItem('group')}>
                            <span className="material-icons" aria-hidden="true">add</span> Adicionar Novo Grupo
                        </button>
                    </td>
                    <td colSpan={dates.length}></td>
                </tr>
            )}
        </tbody>
    );
};

const ComparisonView = ({ savedPlan, liveData, dates, columnWidths, onResizeStart, stickyColumnPositions, title }) => {
    if (!savedPlan) return <div className="placeholder-view">Salve um planejamento base para usar a função de comparação.</div>;

    const headers = ['ID', 'Fase/Agrupador', 'COMPONENTE', 'SETOR', 'TAREFA PRINCIPAL', 'ATIVIDADE', 'PLANO'];

    return (
        <div className="comparison-view">
            <h2>Comparativo: Planejado vs. Real - {title}</h2>
            <div className="table-wrapper">
                <table className="schedule-table">
                    <ScheduleHeader dates={dates} headers={headers} columnWidths={columnWidths} onResizeStart={onResizeStart} stickyColumnPositions={stickyColumnPositions} onOpenFilter={() => {}} activeFilters={{}}/>
                    <ScheduleBody 
                        data={savedPlan} 
                        dates={dates} 
                        isComparison={true} 
                        planType="planned"
                        columnWidths={columnWidths}
                        stickyColumnPositions={stickyColumnPositions}
                    />
                    <ScheduleBody 
                        data={liveData} 
                        dates={dates} 
                        isComparison={true} 
                        planType="real"
                        columnWidths={columnWidths}
                        stickyColumnPositions={stickyColumnPositions}
                    />
                </table>
            </div>
        </div>
    );
};

const DashboardView = ({ data }: { data: ScheduleData }) => {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  const stats = useMemo(() => {
    let totalProgramado = 0;
    let totalConcluido = 0;
    let totalCancelado = 0;
    let totalNaoRealizado = 0;
    const tasksPerComponent = new Map<string, number>();

    data.forEach(group => {
      let taskCount = 0;
      group.tarefas.forEach(task => {
        taskCount += task.activities.length;
        task.activities.forEach(activity => {
          Object.values(activity.schedule).forEach(status => {
            if (status === Status.Programado) totalProgramado++;
            if (status === Status.Concluido) totalConcluido++;
            if (status === Status.Cancelado) totalCancelado++;
            if (status === Status.NaoRealizado) totalNaoRealizado++;
          });
        });
      });
      tasksPerComponent.set(group.componente, (tasksPerComponent.get(group.componente) || 0) + taskCount);
    });

    return { totalProgramado, totalConcluido, totalCancelado, totalNaoRealizado, tasksPerComponent };
  }, [data]);

  useEffect(() => {
    if (chartRef.current) {
        if (chartInstance.current) {
            chartInstance.current.destroy();
        }
        const ctx = chartRef.current.getContext('2d');
        if (ctx) {
            chartInstance.current = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: Object.values(STATUS_LABELS),
                    datasets: [{
                        label: 'Status das Atividades',
                        data: [stats.totalProgramado, stats.totalConcluido, stats.totalCancelado, stats.totalNaoRealizado],
                        backgroundColor: Object.values(STATUS_COLOR_MAP),
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        title: { display: true, text: 'Distribuição de Status das Atividades' }
                    }
                }
            });
        }
    }
     return () => {
        if (chartInstance.current) {
            chartInstance.current.destroy();
            chartInstance.current = null;
        }
    };
  }, [stats]);


  return (
    <div className="dashboard-view">
      <h2>Dashboard do Projeto</h2>
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Programado</h3>
          <p>{stats.totalProgramado}</p>
        </div>
        <div className="stat-card">
          <h3>Total Concluído</h3>
          <p style={{color: STATUS_COLOR_MAP[Status.Concluido]}}>{stats.totalConcluido}</p>
        </div>
        <div className="stat-card">
          <h3>Total Cancelado</h3>
          <p style={{color: STATUS_COLOR_MAP[Status.Cancelado]}}>{stats.totalCancelado}</p>
        </div>
        <div className="stat-card">
          <h3>Não Realizado</h3>
          <p style={{color: STATUS_COLOR_MAP[Status.NaoRealizado]}}>{stats.totalNaoRealizado}</p>
        </div>
      </div>
       <div className="stat-card" style={{ height: '400px', marginBottom: '16px' }}>
          <canvas ref={chartRef}></canvas>
        </div>
        <div className="stat-card">
            <h3>Atividades por Componente</h3>
            <ul>
                {Array.from(stats.tasksPerComponent.entries()).map(([componente, count]) => (
                    <li key={componente}><strong>{componente}:</strong> {count} atividades</li>
                ))}
            </ul>
        </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---
const App = () => {
  // --- STATE MANAGEMENT ---
  const [users, setUsers] = useState<Record<string, string>>(() => JSON.parse(localStorage.getItem('pcp-users') || '{}'));
  const [projects, setProjects] = useState<Record<string, UserProjects>>(() => JSON.parse(localStorage.getItem('pcp-projects') || '{}'));
  const [currentUser, setCurrentUser] = useState<string | null>(() => sessionStorage.getItem('pcp-currentUser'));
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  const [scheduleState, dispatch] = useReducer(scheduleReducer, {
      liveData: [],
      history: [[]],
      historyIndex: 0,
  });
  const { liveData, history, historyIndex } = scheduleState;
  
  const [activeFilters, setActiveFilters] = useState<Record<string, Set<string>>>({});
  const [openFilter, setOpenFilter] = useState<{ column: string; rect: DOMRect } | null>(null);
  
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const [isLoadModalOpen, setLoadModalOpen] = useState(false);
  const [isSaveModalOpen, setSaveModalOpen] = useState(false);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('schedule');
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  
  const [draggedGroupInfo, setDraggedGroupInfo] = useState<{ group: Grupo, index: number } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const [columnWidths, setColumnWidths] = useState<number[]>([50, 120, 130, 130, 280, 250, 80].concat(Array(28).fill(35)));
  const [dateColumnWidth, setDateColumnWidth] = useState(35);
  const [resizingInfo, setResizingInfo] = useState({ isResizing: false, columnIndex: null as number | null, startX: 0, startWidth: 0 });
  const gridRef = useRef<HTMLDivElement>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextToastId = useRef(0);
  
  const {
      interaction,
      activeCell,
      setActiveCell,
      handleCellMouseDown,
      handleCellMouseEnter,
  } = useScheduleInteraction(liveData, dispatch);

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
      setToasts(currentToasts => [
          ...currentToasts,
          { id: nextToastId.current++, message, type }
      ]);
  }, []);

  const ai = useMemo(() => {
    if (!process.env.API_KEY) {
        console.error("A chave de API para o Gemini não está configurada.");
        return null;
    }
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
  }, []);

  // --- DERIVED STATE FROM activeProject ---
  const savedPlan = useMemo(() => activeProject?.savedPlan || null, [activeProject]);
  const title = useMemo(() => activeProject?.title || '', [activeProject]);
  const [currentStartDate, setCurrentStartDate] = useState(() => activeProject?.startDate ? new Date(activeProject.startDate + 'T00:00:00Z') : new Date('2025-07-14T00:00:00Z'));
  const [goToWeekInput, setGoToWeekInput] = useState(() => getWeek(currentStartDate));
  
  useEffect(() => {
    if (activeProject?.startDate) {
        const newDate = new Date(activeProject.startDate + 'T00:00:00Z');
        if (newDate.getTime() !== currentStartDate.getTime()){
            setCurrentStartDate(newDate);
        }
    }
  }, [activeProject?.startDate]);
  
  useEffect(() => {
      setGoToWeekInput(getWeek(currentStartDate));
  }, [currentStartDate]);

  // --- AUTH & PROJECT MANAGEMENT ---
  useEffect(() => {
    if (currentUser && !activeProject) {
        const userProjects = projects[currentUser] || {};
        const lastActiveId = localStorage.getItem(`pcp-lastActive-${currentUser}`);
        const projectToLoad = userProjects[lastActiveId!] || Object.values(userProjects).sort((a,b) => b.lastModified - a.lastModified)[0];
        if (projectToLoad) {
          setActiveProject(projectToLoad);
          dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
        }
    }
  }, [currentUser, projects, activeProject]);

  const handleLogin = (user: string, pass: string) => {
    if (users[user] && users[user] === pass) {
        setCurrentUser(user);
        sessionStorage.setItem('pcp-currentUser', user);
        return true;
    }
    return false;
  };
  
  const handleRegister = (user: string, pass: string) => {
    if (users[user]) {
        return false;
    }
    const newUsers = { ...users, [user]: pass };
    setUsers(newUsers);
    localStorage.setItem('pcp-users', JSON.stringify(newUsers));
    return true;
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setActiveProject(null);
    sessionStorage.removeItem('pcp-currentUser');
  };

  const updateAndPersistProjects = (updatedProjects: Record<string, UserProjects>) => {
      setProjects(updatedProjects);
      localStorage.setItem('pcp-projects', JSON.stringify(updatedProjects));
  };

  const handleNewProject = (name: string) => {
    if (!currentUser) return;
    if (!name.trim()) {
        addToast("O nome do projeto não pode ser vazio.", "error");
        return;
    }
    const newProject = createNewProject(name);
    const updatedProjects = deepClone(projects);
    if (!updatedProjects[currentUser]) updatedProjects[currentUser] = {};
    updatedProjects[currentUser][newProject.id] = newProject;
    
    setActiveProject(newProject);
    dispatch({ type: 'LOAD_DATA', payload: newProject.liveData });
    updateAndPersistProjects(updatedProjects);
    localStorage.setItem(`pcp-lastActive-${currentUser}`, newProject.id);
    setSaveModalOpen(false);
    addToast(`Projeto '${name}' criado com sucesso!`, 'success');
  };
  
  const handleSaveProject = useCallback(() => {
    if (!currentUser || !activeProject) return;
    const projectToSave = { ...activeProject, liveData, lastModified: Date.now() };
    setActiveProject(projectToSave); 
    const updatedProjects = deepClone(projects);
    if (!updatedProjects[currentUser]) updatedProjects[currentUser] = {};
    updatedProjects[currentUser][projectToSave.id] = projectToSave;
    updateAndPersistProjects(updatedProjects);
    addToast(`Projeto '${projectToSave.name}' salvo!`, 'success');
  }, [currentUser, activeProject, liveData, projects, addToast]);

  const handleLoadProject = (projectId: string) => {
    if (!currentUser) return;
    const projectToLoad = projects[currentUser]?.[projectId];
    if (projectToLoad) {
        setActiveProject(projectToLoad);
        setCurrentStartDate(new Date(projectToLoad.startDate + 'T00:00:00Z'));
        dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
        localStorage.setItem(`pcp-lastActive-${currentUser}`, projectId);
        setLoadModalOpen(false);
        addToast(`Projeto '${projectToLoad.name}' carregado.`, 'success');
    }
  };
  
  const handleDeleteProject = (projectId: string) => {
    if (!currentUser || !window.confirm("Tem certeza que deseja excluir este projeto?")) return;
    const deletedProjectName = projects[currentUser]?.[projectId]?.name || 'Projeto';
    const updatedProjects = deepClone(projects);
    if(updatedProjects[currentUser]) {
        delete updatedProjects[currentUser][projectId];
        updateAndPersistProjects(updatedProjects);
        addToast(`Projeto '${deletedProjectName}' excluído.`, 'success');
        if (activeProject?.id === projectId) {
            const nextProject = Object.values(updatedProjects[currentUser] || {}).sort((a,b) => b.lastModified - a.lastModified)[0];
            if (nextProject) {
                handleLoadProject(nextProject.id);
            } else {
                 setActiveProject(null);
                 localStorage.removeItem(`pcp-lastActive-${currentUser}`);
            }
        }
    }
  };
  
  const handleUndo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const handleRedo = useCallback(() => dispatch({ type: 'REDO' }), []);
  
  const handleTextUpdate = useCallback((id: string, field: 'title' | 'componente' | 'setor' | 'fa' | 'tarefa' | 'atividade' | 'programmerName', value: string) => {
    if (!value.trim() && field !== 'programmerName') { // Allow programmerName to be cleared
        addToast("O campo não pode ficar vazio.", "error");
        // This is a bit tricky, might need to re-fetch the old value to revert, or just prevent empty for now.
        return;
    }

    if (field === 'title' && activeProject) {
        setActiveProject(p => p ? { ...p, title: value } : null);
        return;
    }
    
    if (field === 'programmerName' && activeProject) {
        setActiveProject(p => p ? { ...p, programmerName: value } : null);
        return;
    }
    
    dispatch({ type: 'UPDATE_TEXT', payload: { id, field: field as 'componente' | 'setor' | 'fa' | 'tarefa' | 'atividade', value } });

  }, [activeProject, addToast]);
  
  const handleSavePlan = useCallback(() => {
    if (!activeProject || !currentUser) return;
    if (window.confirm("Deseja salvar o estado atual como o novo 'Planejamento Base'? Esta ação substituirá o plano anterior.")) {
      const projectWithSavedPlan = { ...activeProject, savedPlan: deepClone(liveData), lastModified: Date.now() };
      setActiveProject(projectWithSavedPlan);
      
      const updatedProjects = deepClone(projects);
      if (!updatedProjects[currentUser]) updatedProjects[currentUser] = {};
      updatedProjects[currentUser][projectWithSavedPlan.id] = projectWithSavedPlan;
      updateAndPersistProjects(updatedProjects);

      addToast("Planejamento base definido com sucesso!", 'success');
    }
  }, [activeProject, currentUser, projects, addToast, liveData]);

  const handleAddItem = useCallback((type: 'group' | 'task' | 'activity', parentId?: string) => {
      dispatch({ type: 'ADD_ITEM', payload: { type, parentId } });
  }, []);

  const handleDeleteSelectedItem = useCallback(() => {
    if (!selectedItem) return;

    const { type, id, name } = selectedItem;
    const typeLabels = { group: 'Grupo', task: 'Tarefa', activity: 'Atividade' };

    if (window.confirm(`Tem certeza que deseja excluir o item selecionado?\n\nTipo: ${typeLabels[type]}\nNome: ${name}`)) {
        dispatch({ type: 'DELETE_ITEM', payload: { type, id } });
        addToast(`Item '${name}' excluído com sucesso.`, 'success');
        setSelectedItem(null); // Clear selection after deletion
    }
  }, [selectedItem, addToast]);

  const handleClearAll = useCallback(() => {
    if (window.confirm("TEM CERTEZA? Esta ação vai apagar TODOS os grupos, tarefas e atividades do projeto. A ação pode ser desfeita com o botão 'Desfazer'.")) {
        dispatch({ type: 'CLEAR_ALL' });
        setSelectedItem(null);
    }
  }, []);
  
  const handleImportSchedule = useCallback(async (text: string, file: File | null) => {
    if (!ai) {
        addToast("A chave de API para o Gemini não está configurada.", "error");
        return;
    }
    try {
        let fileData: { mimeType: string, data: string } | null = null;
        if (file) {
            fileData = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const result = event.target?.result as string;
                    if (!result) return reject(new Error("Não foi possível ler o arquivo."));
                    resolve({ mimeType: file.type, data: result.split(',')[1] });
                };
                reader.onerror = (error) => reject(error);
                reader.readAsDataURL(file);
            });
        }
        const importedData = await parseScheduleWithAI(ai, text, fileData);
        dispatch({ type: 'SET_DATA', payload: importedData });
        setImportModalOpen(false);
        addToast("Cronograma importado com sucesso!", "success");
    } catch (error) {
        addToast(`Falha ao importar: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [ai, addToast, dispatch]);

  const handleImportFA = useCallback(async (text: string, file: File | null) => {
    if (!ai) {
        addToast("A chave de API para o Gemini não está configurada.", "error");
        return;
    }
    if (!file && !text) {
        addToast("Por favor, selecione um arquivo de imagem da FA ou cole o texto.", "error");
        return;
    }
    try {
        let fileData: { mimeType: string, data: string } | null = null;
        if (file) {
            fileData = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const result = event.target?.result as string;
                    if (!result) return reject(new Error("Não foi possível ler o arquivo."));
                    resolve({ mimeType: file.type, data: result.split(',')[1] });
                };
                reader.onerror = (error) => reject(error);
                reader.readAsDataURL(file);
            });
        }
        
        const importedGroups = await parseFADetailWithAI(ai, text, fileData);

        const hydratedData = importedGroups.map(group => ({
            ...group,
            id: generateId(),
            tarefas: Array.isArray(group.tarefas) ? group.tarefas.map(tarefa => ({
                ...tarefa,
                id: generateId(),
                activities: Array.isArray(tarefa.activities) ? tarefa.activities.map(activity => ({
                    ...activity,
                    id: generateId(),
                    schedule: {} // Add empty schedule
                })) : []
            })) : []
        }));

        dispatch({ type: 'SET_DATA', payload: [...liveData, ...hydratedData] });
        setImportModalOpen(false);
        addToast("FA importada com sucesso e adicionada ao cronograma!", "success");

    } catch (error) {
        addToast(`Falha na importação da FA: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [ai, addToast, dispatch, liveData]);

  const handleOpenFilter = useCallback((column: string, rect: DOMRect) => {
      setOpenFilter({ column, rect });
  }, []);

  const handleCloseFilter = useCallback(() => {
      setOpenFilter(null);
  }, []);

  const handleApplyFilter = useCallback((column: string, selections: Set<string>) => {
      setActiveFilters(prev => ({
          ...prev,
          [column]: selections
      }));
      setOpenFilter(null);
      setSelectedItem(null); // Deselect when filters change
  }, []);
  
  const filterOptions = useMemo(() => {
    if (!liveData) return { fa: [], componente: [], setor: [], tarefaPrincipal: [] };
    const fa = new Set<string>();
    const componente = new Set<string>();
    const setor = new Set<string>();
    const tarefaPrincipal = new Set<string>();

    liveData.forEach(group => {
        fa.add(group.fa);
        componente.add(group.componente);
        setor.add(group.setor);
        group.tarefas.forEach(task => {
            tarefaPrincipal.add(task.title);
        });
    });

    return {
        fa: [...fa].sort(),
        componente: [...componente].sort(),
        setor: [...setor].sort(),
        tarefaPrincipal: [...tarefaPrincipal].sort()
    };
  }, [liveData]);

  const filteredData = useMemo(() => {
    const { fa, componente, setor, tarefaPrincipal } = activeFilters;
    const hasActiveFilters = fa?.size > 0 || componente?.size > 0 || setor?.size > 0 || tarefaPrincipal?.size > 0;

    if (!liveData || !hasActiveFilters) {
        return liveData || [];
    }

    const groupsFiltered = liveData.filter(group => {
        if (fa?.size && !fa.has(group.fa)) return false;
        if (componente?.size && !componente.has(group.componente)) return false;
        if (setor?.size && !setor.has(group.setor)) return false;
        return true;
    });

    if (tarefaPrincipal?.size) {
        return groupsFiltered
            .map(group => ({
                ...group,
                tarefas: group.tarefas.filter(task => tarefaPrincipal.has(task.title)),
            }))
            .filter(group => group.tarefas.length > 0);
    }

    return groupsFiltered;
}, [liveData, activeFilters]);

  const dates = useMemo(() => Array.from({length: 28}, (_, i) => { const d = new Date(currentStartDate); d.setUTCDate(currentStartDate.getUTCDate() + i); return d; }), [currentStartDate]);

  const handleDateChange = useCallback((newDateStr: string) => {
    const newDate = new Date(newDateStr + 'T00:00:00Z');
    setCurrentStartDate(newDate);
    if(activeProject){
        setActiveProject(p => p ? { ...p, startDate: newDateStr } : null);
    }
  }, [activeProject]);

  const handleExportExcel = () => exportToExcelAgent(filteredData, dates, title, addToast);
  const handleExportPdf = () => exportToPdfAgent(filteredData, dates, title, addToast, activeProject!.lastModified, activeProject!.programmerName);
  
  const scheduleHeaders = useMemo(() => ['ID', 'Fase/Agrupador', 'COMPONENTE', 'SETOR', 'TAREFA PRINCIPAL', 'ATIVIDADE'], []);
  const comparisonHeaders = useMemo(() => ['ID', 'Fase/Agrupador', 'COMPONENTE', 'SETOR', 'TAREFA PRINCIPAL', 'ATIVIDADE', 'PLANO'], []);
  const headers = currentPage === 'comparison' ? comparisonHeaders : scheduleHeaders;

  const handleZoomChange = useCallback((newWidth: number) => {
    setDateColumnWidth(newWidth);
    setColumnWidths(currentWidths => {
        const newWidths = [...currentWidths];
        const dateStartIndex = headers.length;
        for (let i = dateStartIndex; i < newWidths.length; i++) {
            newWidths[i] = newWidth;
        }
        return newWidths;
    });
  }, [headers]);

  const handleGoToWeek = useCallback(() => {
    if (!goToWeekInput || goToWeekInput < 1 || goToWeekInput > 53) {
        addToast("Por favor, insira um número de semana válido (1-53).", "error");
        return;
    }
    const year = currentStartDate.getUTCFullYear();
    const d = new Date(Date.UTC(year, 0, 1 + (goToWeekInput - 1) * 7));
    const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const monday = new Date(d.setUTCDate(diff));
    handleDateChange(formatDate(monday));
  }, [goToWeekInput, currentStartDate, handleDateChange, addToast]);

  const handleGroupDragStart = useCallback((group: Grupo, index: number) => {
      setDraggedGroupInfo({ group, index });
  }, []);
  
  const handleGroupDrop = useCallback(() => {
    if (draggedGroupInfo === null || dropTargetId === undefined) {
      handleDragEnd();
      return;
    }
    if (draggedGroupInfo.group.id === dropTargetId) {
      handleDragEnd();
      return;
    }
    
    const fromId = draggedGroupInfo.group.id;
    const toId = dropTargetId; // Can be a group ID or null for the end

    dispatch({ type: 'MOVE_GROUP', payload: { fromId, toId } });
    handleDragEnd();
  }, [draggedGroupInfo, dropTargetId]);
  
  const handleDragEnd = useCallback(() => {
      setDraggedGroupInfo(null);
      setDropTargetId(null);
  }, []);

  useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); handleUndo(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); handleRedo(); }
        if (e.key === 'Delete' && activeCell) {
          e.preventDefault();
          const newData = deepClone(liveData);
          const activity = newData.flatMap(g => g.tarefas.flatMap(t => t.activities)).find(a => a.id === activeCell.activityId);
          if (activity && activity.schedule[activeCell.date]) {
              delete activity.schedule[activeCell.date];
              dispatch({ type: 'UPDATE_SCHEDULE', payload: newData });
          }
          setActiveCell(null);
        }
      };
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (activeCell && !target.closest('.status-cell')) setActiveCell(null);
        if (openFilter && !target.closest('.filter-dropdown')) handleCloseFilter();
        if (selectedItem && !target.closest('.schedule-table, .ai-agent-status')) setSelectedItem(null);
      };
      window.addEventListener('keydown', handleGlobalKeyDown);
      document.addEventListener('click', handleClickOutside);
      return () => {
          window.removeEventListener('keydown', handleGlobalKeyDown);
          document.removeEventListener('click', handleClickOutside);
      };
  }, [handleUndo, handleRedo, activeCell, liveData, openFilter, handleCloseFilter, selectedItem]);
  

  const stickyColumnPositions = useMemo(() => {
    const positions: number[] = [0];
    let accumulatedWidth = 0;
    for (let i = 0; i < headers.length; i++) {
        accumulatedWidth += columnWidths[i] || 0;
        positions.push(accumulatedWidth);
    }
    return positions.slice(0, -1);
  }, [columnWidths, headers]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
        if (resizingInfo.isResizing && resizingInfo.columnIndex !== null) {
            const newWidth = resizingInfo.startWidth + e.clientX - resizingInfo.startX;
            if (newWidth > 40) {
                setColumnWidths(currentWidths => {
                    const newWidths = [...currentWidths];
                    newWidths[resizingInfo.columnIndex!] = newWidth;
                    return newWidths;
                });
            }
        }
    };
    const handleMouseUp = () => {
        if (resizingInfo.isResizing) {
            document.body.style.cursor = 'default';
            setResizingInfo({ isResizing: false, columnIndex: null, startX: 0, startWidth: 0 });
        }
    };
    
    if (resizingInfo.isResizing) document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingInfo]);

  const handleResizeStart = useCallback((columnIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      setResizingInfo({
          isResizing: true,
          columnIndex,
          startX: e.clientX,
          startWidth: columnWidths[columnIndex]
      });
  }, [columnWidths]);
  
  // --- RENDER LOGIC ---
  if (!currentUser) {
      return <AuthScreen onLogin={handleLogin} onRegister={handleRegister} />;
  }

  if (!activeProject) {
    return (
        <div className="app-wrapper">
             <div className="no-project-view">
                 <h2>Bem-vindo, {currentUser}!</h2>
                 <p>Você não tem nenhum projeto ativo. Crie um novo ou carregue um existente.</p>
                 <div className="header-controls">
                    <button className="submit-button" onClick={() => setSaveModalOpen(true)}>Criar Novo Projeto</button>
                    <button className="control-button" onClick={() => setLoadModalOpen(true)} disabled={!projects[currentUser] || Object.keys(projects[currentUser]).length === 0}>Carregar Projeto</button>
                    <button className="control-button" onClick={handleLogout} title="Sair">Sair</button>
                 </div>
             </div>
             {isSaveModalOpen && <SaveModal onClose={() => setSaveModalOpen(false)} onSave={handleNewProject} />}
             {isLoadModalOpen && currentUser && <LoadModal schedules={Object.values(projects[currentUser] || {})} onLoad={handleLoadProject} onDelete={handleDeleteProject} onClose={() => setLoadModalOpen(false)} />}
             <ToastContainer toasts={toasts} setToasts={setToasts} />
        </div>
    )
  }

  return (
    <div className={`app-wrapper ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <header className="app-header">
           <div className="header-left">
              <button className="control-button sidebar-toggle" onClick={() => setSidebarCollapsed(c => !c)} aria-label={isSidebarCollapsed ? "Mostrar menu" : "Ocultar menu"}>
                  <span className="material-icons" aria-hidden="true">{isSidebarCollapsed ? "menu" : "menu_open"}</span>
              </button>
              <h1 contentEditable suppressContentEditableWarning onBlur={e => handleTextUpdate('', 'title', e.currentTarget.textContent || '')} >{title}</h1>
               <div className="header-item-editable">
                    <span className="label">Responsável:</span>
                    <span
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={e => handleTextUpdate('', 'programmerName', e.currentTarget.textContent?.trim() || 'Não definido')}
                        className="editable-field"
                    >
                        {activeProject.programmerName || 'Não definido'}
                    </span>
                </div>
               <div className="header-nav">
                  <button className={`nav-tab ${currentPage === 'schedule' ? 'active' : ''}`} onClick={() => setCurrentPage('schedule')}>Cronograma</button>
                  <button className={`nav-tab ${currentPage === 'dashboard' ? 'active' : ''}`} onClick={() => setCurrentPage('dashboard')}>Dashboard</button>
                  <button className={`nav-tab ${currentPage === 'comparison' ? 'active' : ''}`} onClick={() => setCurrentPage('comparison')} disabled={!savedPlan}>Comparativo</button>
              </div>
          </div>
          <div className="header-controls">
              <div className="user-info">
                  <span className="material-icons" aria-hidden="true">person</span>
                  <span>{currentUser}</span>
              </div>
              <button className="control-button" onClick={handleLogout} aria-label="Sair"><span className="material-icons" aria-hidden="true">logout</span></button>
          </div>
        </header>

        <main className="app-container">
            <Sidebar 
                handleUndo={handleUndo} handleRedo={handleRedo} historyIndex={historyIndex} historyLength={history.length}
                handleClearAll={handleClearAll}
                handleSavePlan={handleSavePlan}
                setImportModalOpen={setImportModalOpen} setSaveModalOpen={setSaveModalOpen} setLoadModalOpen={setLoadModalOpen}
                handleSaveProject={handleSaveProject}
                handleExportExcel={handleExportExcel} handleExportPdf={handleExportPdf}
                startDate={currentStartDate} handleDateChange={handleDateChange}
                dateColumnWidth={dateColumnWidth} handleZoomChange={handleZoomChange}
                goToWeekInput={goToWeekInput} setGoToWeekInput={setGoToWeekInput} handleGoToWeek={handleGoToWeek}
                selectedItem={selectedItem}
                handleDeleteSelectedItem={handleDeleteSelectedItem}
            />
            <div className="main-content">
                {currentPage === 'schedule' && (
                    <div className="table-wrapper" ref={gridRef}>
                        <table className="schedule-table" style={{ width: columnWidths.reduce((a, b) => a + b, 0) }}>
                             <ScheduleHeader dates={dates} headers={scheduleHeaders} columnWidths={columnWidths} onResizeStart={handleResizeStart} stickyColumnPositions={stickyColumnPositions} onOpenFilter={handleOpenFilter} activeFilters={activeFilters}/>
                             <ScheduleBody 
                                data={filteredData} 
                                dates={dates} 
                                activeCell={activeCell}
                                onCellMouseDown={handleCellMouseDown}
                                onCellMouseEnter={handleCellMouseEnter}
                                interaction={interaction}
                                onTextUpdate={handleTextUpdate}
                                onAddItem={handleAddItem}
                                isComparison={false}
                                planType={null}
                                columnWidths={columnWidths}
                                stickyColumnPositions={stickyColumnPositions}
                                draggedGroupInfo={draggedGroupInfo}
                                onGroupDragStart={handleGroupDragStart}
                                onGroupDrop={handleGroupDrop}
                                onDragEnd={handleDragEnd}
                                onDropTargetChange={setDropTargetId}
                                dropTargetId={dropTargetId}
                                selectedItem={selectedItem}
                                setSelectedItem={setSelectedItem}
                             />
                        </table>
                    </div>
                )}
                {currentPage === 'dashboard' && <DashboardView data={liveData} />}
                {currentPage === 'comparison' && <ComparisonView savedPlan={savedPlan} liveData={liveData} dates={dates} columnWidths={columnWidths} onResizeStart={handleResizeStart} stickyColumnPositions={stickyColumnPositions} title={title}/>}
            </div>
        </main>
        
        <footer className="app-footer">
            Programação Semanal v3.1 - Aprimorado por IA
        </footer>

        <ToastContainer toasts={toasts} setToasts={setToasts} />
        {openFilter && (
            <FilterDropdown
                columnKey={openFilter.column}
                allOptions={filterOptions[openFilter.column as keyof typeof filterOptions]}
                activeSelections={activeFilters[openFilter.column] || new Set()}
                onApply={handleApplyFilter}
                onClose={handleCloseFilter}
                position={openFilter.rect}
            />
        )}
        {isImportModalOpen && <ImportModal isOpen={isImportModalOpen} onClose={() => setImportModalOpen(false)} onImportSchedule={handleImportSchedule} onImportFA={handleImportFA} />}
        {isSaveModalOpen && <SaveModal onClose={() => setSaveModalOpen(false)} onSave={handleNewProject} currentName={activeProject?.name} />}
        {isLoadModalOpen && currentUser && <LoadModal schedules={Object.values(projects[currentUser] || {})} onLoad={handleLoadProject} onDelete={handleDeleteProject} onClose={() => setLoadModalOpen(false)} />}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);