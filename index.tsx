
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
  Realizado = 'Ok',
  Cancelado = 'C',
  NaoRealizado = 'N',
}
const STATUS_LABELS: Record<Status, string> = {
  [Status.Programado]: 'Programado',
  [Status.Realizado]: 'Realizado',
  [Status.Cancelado]: 'Cancelado',
  [Status.NaoRealizado]: 'Não Realizado',
};
const STATUS_CLASS_MAP: Record<Status, string> = {
    [Status.Programado]: 'programado',
    [Status.Realizado]: 'realizado',
    [Status.Cancelado]: 'cancelado',
    [Status.NaoRealizado]: 'nao-realizado',
};
const STATUS_COLOR_MAP: Record<Status, string> = {
    [Status.Programado]: '#fef08a',
    [Status.Realizado]: '#bbf7d0',
    [Status.Cancelado]: '#bfdbfe',
    [Status.NaoRealizado]: '#fecaca',
};
const STATUS_CYCLE: Status[] = [Status.Programado, Status.Realizado, Status.Cancelado, Status.NaoRealizado];

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

interface ManpowerAllocationData {
    [role: string]: {
        [weekYear: string]: number; // e.g., "2025-29"
    };
}
interface ManpowerAllocation {
    roles: string[];
    hasSecondShift: boolean;
    data: {
        adm: ManpowerAllocationData;
        shift2: ManpowerAllocationData;
    };
}
interface DailyManpowerAllocation {
    [activityId: string]: {
        [date: string]: { // YYYY-MM-DD
            [role: string]: number;
        }
    }
}

interface Project {
  id: string;
  name: string;
  lastModified: number;
  title: string;
  startDate: string;
  programmerName: string;
  liveData: ScheduleData;
  savedPlan: ScheduleData | null;
  manpowerAllocation: ManpowerAllocation;
  dailyManpowerAllocation: DailyManpowerAllocation;
}
type UserProjects = Record<string, Project>;

type Page = 'schedule' | 'dashboard' | 'comparison' | 'manpower' | 'dailyAllocation' | 'manpowerDashboard';

interface RenderableRow {
    group: Grupo;
    task: TarefaPrincipal;
    activity: Atividade;
    renderGroup: boolean;
    groupRowSpan: number;
    renderTask: boolean;
    taskRowSpan: number;
    wbsId: string;
    isLastInGroup: boolean;
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
const getWeekYear = (date: Date): string => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    // Thursday in current week decides the year.
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    // Get year of Thursday
    const year = d.getUTCFullYear();
    // Get first day of year
    const yearStart = new Date(Date.UTC(year, 0, 1));
    // Calculate full weeks to nearest Thursday
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${year}-${weekNo.toString().padStart(2, '0')}`;
};
const getDatesOfWeek = (weekYear: string): Date[] => {
    const [year, weekNo] = weekYear.split('-').map(Number);
    const d = new Date(Date.UTC(year, 0, 1 + (weekNo - 1) * 7));
    const dayOfWeek = d.getUTCDay();
    const diff = d.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(d.setUTCDate(diff));
    
    return Array.from({length: 7}, (_, i) => {
        const date = new Date(monday);
        date.setUTCDate(monday.getUTCDate() + i);
        return date;
    });
};
const getDateRangeOfWeek = (weekYear: string): string => {
    const [year, weekNo] = weekYear.split('-').map(Number);
    // Find the date of the first day (Monday) of the week
    const d = new Date(Date.UTC(year, 0, 1 + (weekNo - 1) * 7));
    const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, ..
    const diff = d.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust when day is Sunday to get Monday
    const monday = new Date(d.setUTCDate(diff));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    
    const format = (dt: Date) => `${dt.getUTCDate().toString().padStart(2, '0')}/${(dt.getUTCMonth() + 1).toString().padStart(2, '0')}`;
    
    return `${format(monday)} - ${format(sunday)}`;
};

const isBrazilianHoliday = (date: Date): boolean => {
    const day = date.getUTCDate();
    const month = date.getUTCMonth() + 1; // 1-12

    const holidays = [
        '1-1',   // Confraternização Universal
        '4-21',  // Tiradentes
        '5-1',   // Dia do Trabalho
        '9-7',   // Independência do Brasil
        '10-12', // Nossa Senhora Aparecida
        '11-2',  // Finados
        '11-15', // Proclamação da República
        '12-25'  // Natal
    ];
    
    return holidays.includes(`${month}-${day}`);
};

const getRoleAbbreviation = (role: string): string => {
    const lowerRole = role.toLowerCase();
    if (lowerRole.includes('supervisor de caldeiraria')) return 'Sup Cald';
    if (lowerRole.includes('supervisor de solda')) return 'Sup Solda';
    if (lowerRole.includes('caldeireiro')) return 'Cald';
    if (lowerRole.includes('soldador')) return 'Sold';
    if (lowerRole.includes('traçador')) return 'Traç';
    if (lowerRole.includes('operador de oxicorte')) return 'Op Oxicorte';
    if (lowerRole.includes('tratamento térmico')) return 'Trat Térm';
    if (lowerRole.includes('inspetor de solda')) return 'Insp Solda';
    if (lowerRole.includes('inspetor de ultrassom')) return 'Insp UT';
    if (lowerRole.includes('inspetor de rx')) return 'Insp RX';
    if (lowerRole.includes('inspetor dimensional')) return 'Insp Dim';
    
    const words = role.split(' ');
    if (words.length > 1) {
        return words.map(w => w.substring(0, 1)).join('').toUpperCase() + words[words.length - 1].substring(0, 3);
    }
    return role.substring(0, 5);
};


const deepClone = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

// --- AGENTE DE IA PARA EXCLUSÃO (Implementação do Usuário) ---
const aiDeletionAgent = (
    data: ScheduleData,
    idToDelete: string,
    type: 'group' | 'task' | 'activity'
): ScheduleData => {
    let newData = deepClone(data);

    if (type === 'group') {
        newData = newData.filter(g => g.id !== idToDelete);
    } else if (type === 'task') {
        newData = newData.map(group => {
            const newTarefas = group.tarefas.filter(t => t.id !== idToDelete);
            return { ...group, tarefas: newTarefas };
        }).filter(g => g.tarefas.length > 0);
    } else if (type === 'activity') {
        newData = newData.map(group => {
            const newTarefas = group.tarefas.map(task => {
                const newActivities = task.activities.filter(a => a.id !== idToDelete);
                return { ...task, activities: newActivities };
            }).filter(t => t.activities.length > 0);
            return { ...group, tarefas: newTarefas };
        }).filter(g => g.tarefas.length > 0);
    }
    
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
const PREDEFINED_MANPOWER_ROLES = [
    // Supervisão
    'Supervisor de caldeiraria',
    'Supervisor de solda',
    // Ofícios
    'Caldeireiro',
    'Soldador',
    'Traçador',
    'Operador de oxicorte',
    'Tratamento térmico',
    // Inspeção
    'Inspetor de solda',
    'Inspetor de ultrassom',
    'Inspetor de RX',
    'Inspetor dimensional',
];

const MANPOWER_CATEGORIES = {
    'Supervisão': ['Supervisor de caldeiraria', 'Supervisor de solda'],
    'Ofícios': ['Caldeireiro', 'Soldador', 'Traçador', 'Operador de oxicorte', 'Tratamento térmico'],
    'Inspeção': ['Inspetor de solda', 'Inspetor de ultrassom', 'Inspetor de RX', 'Inspetor dimensional'],
};

const createNewProject = (name: string): Project => ({
  id: generateId(),
  name,
  lastModified: Date.now(),
  title: 'Nova Programação Semanal',
  startDate: formatDate(new Date('2025-07-14T00:00:00Z')),
  programmerName: 'Não definido',
  liveData: [],
  savedPlan: null,
  manpowerAllocation: {
    roles: [...PREDEFINED_MANPOWER_ROLES],
    hasSecondShift: false,
    data: {
        adm: {},
        shift2: {}
    }
  },
  dailyManpowerAllocation: {}
});

// --- EXPORT AGENTS ---
const exportToExcelAgent = (filteredData: ScheduleData, dates: Date[], title: string, addToast: (message: string, type: 'success' | 'error') => void) => {
    if (filteredData.length === 0) {
        addToast("Não há dados para exportar.", "error");
        return;
    }

    const baseCols = 5;
    const wsData: any[][] = [];
    const merges: XLSX.Range[] = [];

    // --- Create Headers ---
    const dateHeaders = dates.map(d => ({
        week: `Semana ${getWeek(d)}`,
        dayName: getDayAbbr(d),
        dayNum: d.getUTCDate()
    }));
    const header1 = ['', '', '', '', '', ...dateHeaders.map(h => h.week)];
    const header2 = ['Fase/Agrupador', 'COMPONENTE', 'SETOR', 'TAREFA PRINCIPAL', 'ATIVIDADE', ...dateHeaders.map(h => h.dayName)];
    const header3 = ['', '', '', '', '', ...dateHeaders.map(h => h.dayNum)];
    wsData.push(header1, header2, header3);

    // Merge week headers
    let currentWeek = '';
    let weekColStart = baseCols;
    dateHeaders.forEach((h, i) => {
        if (h.week !== currentWeek) {
            if (currentWeek) merges.push({ s: { r: 0, c: weekColStart }, e: { r: 0, c: baseCols + i - 1 } });
            currentWeek = h.week;
            weekColStart = baseCols + i;
        }
    });
    if (currentWeek) merges.push({ s: { r: 0, c: weekColStart }, e: { r: 0, c: baseCols + dateHeaders.length - 1 } });
    
    // Merge main headers
    merges.push({ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } });
    merges.push({ s: { r: 1, c: 1 }, e: { r: 2, c: 1 } });
    merges.push({ s: { r: 1, c: 2 }, e: { r: 2, c: 2 } });
    merges.push({ s: { r: 1, c: 3 }, e: { r: 2, c: 3 } });
    merges.push({ s: { r: 1, c: 4 }, e: { r: 2, c: 4 } });


    // --- Create Body ---
    let rowIndex = wsData.length;
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

            const activities = task.activities.length > 0 ? task.activities : [{ id: `empty-${task.id}`, name: '', schedule: {} }];
            activities.forEach(activity => {
                const row: any[] = [group.fa, group.componente, group.setor, task.title, activity.name];
                dates.forEach(date => {
                    const status = activity.schedule[formatDate(date)];
                    row.push(status || '');
                });
                wsData.push(row);
                rowIndex++;
            });
        });
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!merges'] = merges;
    ws['!cols'] = [ {wch:15}, {wch:15}, {wch:15}, {wch:40}, {wch:40}, ...Array(dates.length).fill({wch: 4}) ];

    // --- Apply Styles ---
    const borderStyle = { style: 'thin', color: { rgb: "000000" } };
    const allBorders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
    const headerFill = { fgColor: { rgb: "DDEBF7" } };
    const weekendFill = { fgColor: { rgb: "B4C6E7" } };
    const programadoFill = { fgColor: { rgb: "FFFF00" } }; // Yellow
    const realizadoFill = { fgColor: { rgb: "C6EFCE" } }; // Green
    const centerAlign = { horizontal: 'center', vertical: 'center', wrapText: true };
    const leftAlign = { vertical: 'center', wrapText: true };

    for (let R = 0; R < wsData.length; ++R) {
        for (let C = 0; C < wsData[R].length; ++C) {
            const cell_address = { c: C, r: R };
            const cell_ref = XLSX.utils.encode_cell(cell_address);
            if (!ws[cell_ref]) ws[cell_ref] = { v: '' };
            ws[cell_ref].s = { border: allBorders, alignment: (C < baseCols && R > 2) ? leftAlign : centerAlign };

            // Header Styles
            if (R < 3) {
                ws[cell_ref].s.fill = headerFill;
                ws[cell_ref].s.font = { bold: true };
            }
            // Weekend Styles
            if (C >= baseCols) {
                const dayName = dateHeaders[C - baseCols].dayName;
                if (dayName === 'SÁB' || dayName === 'DOM') {
                    ws[cell_ref].s.fill = weekendFill;
                }
            }
            // Status Styles
            if (R > 2) {
                const status = ws[cell_ref].v;
                if (status === Status.Programado) ws[cell_ref].s.fill = programadoFill;
                if (status === Status.Realizado) ws[cell_ref].s.fill = realizadoFill;
            }
        }
    }

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
        let lastTaskInGroupIndex = group.tarefas.length - 1;

        group.tarefas.forEach((task, taskIndex) => {
            const taskRowSpan = task.activities.length || 1;
            let isFirstRowOfTask = true;
            let lastActivityInTaskIndex = task.activities.length - 1;

            if (task.activities.length === 0) {
                const row: any[] = [];
                if (isFirstRowOfGroup) {
                    row.push({ content: group.fa, rowSpan: groupRowSpan });
                    row.push({ content: group.componente, rowSpan: groupRowSpan });
                    row.push({ content: group.setor, rowSpan: groupRowSpan });
                    isFirstRowOfGroup = false;
                }
                row.push({ content: task.title, rowSpan: taskRowSpan });
                row.push(''); // Empty activity cell
                row.push(...Array(dates.length).fill(''));
                
                const isLastRowOfGroup = taskIndex === lastTaskInGroupIndex;
                if(isLastRowOfGroup){
                    row.forEach(cell => {
                        if(typeof cell === 'object' && cell !== null) {
                           (cell as any).styles = {...((cell as any).styles || {}), borderBottom: {width: 2, color: [200, 208, 216]}};
                        }
                    });
                }
                body.push(row);

            } else {
                task.activities.forEach((activity, activityIndex) => {
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
                        const status = activity.schedule[formatDate(date)];
                        row.push(status ? status : '');
                    });
                     
                    const isLastRowOfGroup = (taskIndex === lastTaskInGroupIndex && activityIndex === lastActivityInTaskIndex);
                    if(isLastRowOfGroup){
                        row.forEach(cell => {
                            if(typeof cell === 'object' && cell !== null) {
                                (cell as any).styles = {...((cell as any).styles || {}), borderBottom: {width: 2, color: [200, 208, 216]}};
                            }
                        });
                    }

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
            cellPadding: 6, 
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
                const dateIndex = data.column.index - 5;
                const currentDate = dates[dateIndex];
                const dayAbbr = getDayAbbr(currentDate);
                const isHoliday = isBrazilianHoliday(currentDate);
                const isWeekendOrHoliday = dayAbbr === 'SÁB' || dayAbbr === 'DOM' || isHoliday;

                // Draw background for weekends/holidays
                if (isWeekendOrHoliday) {
                    doc.setFillColor(224, 236, 255); // Light blue
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                }
                
                // Draw status color on top
                const status = data.cell.text[0] as Status;
                if (status && STATUS_COLOR_MAP[status]) {
                    doc.setFillColor(STATUS_COLOR_MAP[status]);
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                }
                
                // Redraw text to ensure it's on top of any background
                if (status) {
                    doc.setTextColor(50, 50, 50);
                    doc.text(String(status), data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2, {
                       align: 'center' as const,
                       baseline: 'middle' as const
                   });
                }
                
                // Redraw border to ensure it's visible over the fill
                doc.setDrawColor(45, 55, 72); // Same as grid color
                doc.setLineWidth(0.5);
                doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'S');
            }
        },
         didParseCell: (data) => {
            if (data.section === 'body' && Array.isArray(data.row.raw)) {
                const cellWithBorder = data.row.raw.find((cell: any) =>
                    typeof cell === 'object' && cell !== null && !Array.isArray(cell) && cell.styles?.borderBottom
                );

                if (cellWithBorder) {
                    (data.cell.styles as any).borderBottom = (cellWithBorder as any).styles.borderBottom;
                }
            }
        }
    });
    doc.save(`${title.replace(/ /g, '_')}.pdf`);
};

const exportManpowerToPdfAgent = (
    roles: string[],
    data: ManpowerAllocation['data'],
    hasSecondShift: boolean,
    weeks: string[],
    title: string
) => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });

    doc.setFontSize(16);
    doc.text(`Alocação de Mão de Obra - ${title}`, 40, 40);

    const generateTableForShift = (shiftKey: 'adm' | 'shift2', startY: number): number => {
        doc.setFontSize(12);
        doc.text(shiftKey === 'adm' ? "Turno ADM" : "2º Turno", 40, startY - 5);

        const head: any[] = [[]];
        head[0].push({ content: 'Mão de Obra', styles: { halign: 'left' } });
        weeks.forEach(week => {
            const [year, weekNum] = week.split('-');
            const dateRange = getDateRangeOfWeek(week);
            head[0].push({ content: `Semana ${weekNum} (${year})\n${dateRange}`, styles: { halign: 'center' } });
        });
        head[0].push('Total (H-Sem)');

        const body: any[] = [];
        const shiftData = data[shiftKey];
        const weeklyTotals: Record<string, number> = {};
        weeks.forEach(w => weeklyTotals[w] = 0);

        roles.forEach(role => {
            const rowData: (string|number)[] = [role];
            let total = 0;
            weeks.forEach(week => {
                const quantity = shiftData[role]?.[week] || 0;
                rowData.push(quantity > 0 ? quantity : '');
                total += quantity;
                weeklyTotals[week] += quantity;
            });
            rowData.push(total > 0 ? total : '');
            body.push(rowData);
        });
        
        const grandTotal = Object.values(weeklyTotals).reduce((sum, val) => sum + val, 0);

        const foot: any[] = [[]];
        foot[0].push({ content: 'TOTAL GERAL (H-Sem)', styles: { halign: 'left', fontStyle: 'bold' } });
        weeks.forEach(week => {
            const total = weeklyTotals[week];
            foot[0].push({ content: total > 0 ? String(total) : '', styles: { fontStyle: 'bold' } });
        });
        foot[0].push({ content: grandTotal > 0 ? String(grandTotal) : '', styles: { fontStyle: 'bold' } });

        autoTable(doc, {
            head: head,
            body: body,
            foot: foot,
            startY: startY,
            theme: 'grid',
            headStyles: { fillColor: [233, 238, 245], textColor: [45, 55, 72], fontStyle: 'bold' },
            footStyles: { fillColor: [233, 238, 245], textColor: [45, 55, 72] },
            styles: { fontSize: 8, cellPadding: 3, halign: 'center' },
            columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } }
        });

        return (doc as any).lastAutoTable.finalY;
    };

    let finalY = generateTableForShift('adm', 70);
    if (hasSecondShift) {
        generateTableForShift('shift2', finalY + 30);
    }


    doc.save(`Alocacao_MO_${title.replace(/ /g, '_')}.pdf`);
};

const exportDailyAllocationToPdfAgent = (
    project: Project,
    dates: Date[],
    filteredData: ScheduleData,
    title: string
) => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
    doc.text(`Alocação Diária de Mão de Obra - ${title}`, 40, 40);

    const head: any[][] = [[], []];
    head[0].push({ content: 'Tarefa Principal', rowSpan: 2 });
    head[0].push({ content: 'Atividade', rowSpan: 2 });

    const weekHeaders: { content: string, colSpan: number }[] = [];
    if (dates.length > 0) {
        let currentWeek = getWeek(dates[0]);
        let dayCount = 0;
        dates.forEach((date, index) => {
            const week = getWeek(date);
            if (week !== currentWeek) {
                weekHeaders.push({ content: `Semana ${currentWeek}`, colSpan: dayCount });
                currentWeek = week;
                dayCount = 1;
            } else {
                dayCount++;
            }
            if (index === dates.length - 1) {
                weekHeaders.push({ content: `Semana ${currentWeek}`, colSpan: dayCount });
            }
        });
    }
    head[0].push(...weekHeaders as any);
    head[1].push(...dates.map(date => `${getDayAbbr(date)} ${date.getUTCDate()}`));

    const body: any[] = [];
    filteredData.forEach(group => {
        group.tarefas.forEach(task => {
            task.activities.forEach(activity => {
                const row: any[] = [{ content: task.title }, { content: activity.name }];
                dates.forEach(date => {
                    const dateStr = formatDate(date);
                    const allocations = project.dailyManpowerAllocation[activity.id]?.[dateStr];
                    if (allocations && Object.keys(allocations).length > 0) {
                        const cellText = Object.entries(allocations)
                            .map(([role, qty]) => `${getRoleAbbreviation(role)}: ${qty}`)
                            .join('\n');
                        row.push(cellText);
                    } else {
                        row.push('');
                    }
                });
                body.push(row);
            });
        });
    });

    autoTable(doc, {
        head: head,
        body: body,
        startY: 60,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2, valign: 'middle' },
        headStyles: { halign: 'center', fillColor: [233, 238, 245], textColor: [45, 55, 72] },
        columnStyles: {
            0: { halign: 'left', cellWidth: 150 },
            1: { halign: 'left', cellWidth: 150 },
        },
    });

    doc.save(`Alocacao_Diaria_${title.replace(/ /g, '_')}.pdf`);
};

const exportDashboardToPdfAgent = (stats: any, chartImage: string | null, title: string, programmerName: string, selectedWeekInfo: string) => {
    const doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;

    doc.setFontSize(16);
    doc.text(`Dashboard do Projeto: ${title}`, margin, 20);
    doc.setFontSize(10);
    doc.text(`Responsável: ${programmerName}`, margin, 28);
    doc.text(`Dados para: ${selectedWeekInfo}`, margin, 36);

    const statData = [
        ['Total Programado', stats.totalProgramado],
        ['Total Realizado', stats.totalRealizado],
        ['Total Cancelado', stats.totalCancelado],
        ['Não Realizado', stats.totalNaoRealizado],
    ];
    autoTable(doc, {
        startY: 42,
        head: [['Métrica de Status', 'Valor']],
        body: statData,
        theme: 'striped',
        margin: { left: margin, right: margin },
    });

    let finalY = (doc as any).lastAutoTable.finalY;

    const componentData = Array.from(stats.tasksPerComponent.entries()).map(([componente, count]) => [componente, count]);
    if(componentData.length > 0) {
        autoTable(doc, {
            startY: finalY + 10,
            head: [['Componente', 'Nº de Atividades']],
            body: componentData,
            theme: 'striped',
            margin: { left: margin, right: margin },
        });
        finalY = (doc as any).lastAutoTable.finalY;
    }
    
    if (chartImage) {
        const spaceForChart = pageHeight - finalY - margin - 10; // 10 for padding below
        if (spaceForChart > 50) { // Only add if there's reasonable space
            try {
                const imgProps = doc.getImageProperties(chartImage);
                const imgWidth = pageWidth - (margin * 2);
                let imgHeight = (imgProps.height * imgWidth) / imgProps.width;
                
                if (imgHeight > spaceForChart) {
                    imgHeight = spaceForChart; // Scale height to fit
                }

                doc.addImage(chartImage, 'PNG', margin, finalY + 10, imgWidth, imgHeight);
            } catch(e) {
                console.error("Error adding chart image to PDF:", e);
                doc.text("Não foi possível renderizar o gráfico.", margin, finalY + 10);
            }
        }
    }
    
    doc.save(`Dashboard_${title.replace(/ /g, '_')}.pdf`);
};

const exportManpowerDashboardToPdfAgent = (chartImage: string | null, title: string, programmerName: string, selectedWeekInfo: string) => {
    const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    doc.setFontSize(16);
    doc.text(`Dashboard de Mão de Obra: ${title}`, margin, 20);
    doc.setFontSize(10);
    doc.text(`Responsável: ${programmerName}`, margin, 28);
    doc.text(`Dados para: ${selectedWeekInfo}`, margin, 36);

    if (chartImage) {
        try {
            const imgProps = doc.getImageProperties(chartImage);
            const availableWidth = pageWidth - (margin * 2);
            const availableHeight = pageHeight - 45 - margin;
            let imgHeight = (imgProps.height * availableWidth) / imgProps.width;
            let imgWidth = availableWidth;

            if (imgHeight > availableHeight) {
                imgHeight = availableHeight;
                imgWidth = (imgProps.width * imgHeight) / imgProps.height;
            }

            doc.addImage(chartImage, 'PNG', margin, 45, imgWidth, imgHeight);
        } catch(e) {
            console.error("Error adding chart image to PDF:", e);
            doc.text("Não foi possível renderizar o gráfico.", margin, 45);
        }
    } else {
        doc.text("Gráfico não disponível.", margin, 45);
    }
    
    doc.save(`Dashboard_MO_${title.replace(/ /g, '_')}.pdf`);
};

// --- AI SERVICE ---
const analyzeDeletionImpactWithAI = async (
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
        name: `${g.fa} / ${g.componente}`,
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
    - "Ok" ou similar => \`"Ok"\` (Realizado)
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
    | { type: 'BATCH_DELETE_ITEMS'; payload: { id: string; type: 'group' | 'task' | 'activity' }[] }
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
        
        case 'BATCH_DELETE_ITEMS': {
            const newData = action.payload.reduce(
                (currentData, itemToDelete) => {
                    return aiDeletionAgent(currentData, itemToDelete.id, itemToDelete.type);
                },
                state.liveData
            );
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
                <h1>Plataforma Avançada de Programação</h1>
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
                 <p className="developer-credit">Desenvolvido por: Waldenir Oliveira</p>
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

const DeletionModal = ({ isOpen, onClose, selectedItems, onConfirm, ai, data, addToast }: {
    isOpen: boolean;
    onClose: () => void;
    selectedItems: SelectedItem[];
    onConfirm: (itemsToDelete: { id: string, type: 'group' | 'task' | 'activity' }[]) => void;
    ai: GoogleGenAI | null;
    data: ScheduleData;
    addToast: (message: string, type: 'success' | 'error') => void;
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [analysis, setAnalysis] = useState('');

    useEffect(() => {
        if (isOpen && selectedItems.length > 0 && ai) {
            const performAnalysis = async () => {
                setIsLoading(true);
                setAnalysis('');
                try {
                    const result = await analyzeDeletionImpactWithAI(ai, data, selectedItems);
                    setAnalysis(result.analysis);
                } catch (error) {
                    addToast(`Erro do assistente de IA: ${error instanceof Error ? error.message : 'Erro desconhecido'}`, "error");
                    setAnalysis("Não foi possível obter a análise da IA. A exclusão procederá de forma padrão.");
                } finally {
                    setIsLoading(false);
                }
            };
            performAnalysis();
        }
    }, [isOpen, selectedItems, ai, data, addToast]);

    if (!isOpen || selectedItems.length === 0) return null;

    const handleConfirm = () => {
        onConfirm(selectedItems);
        onClose();
    };

    const typeLabels: Record<string, string> = { group: 'Grupo', task: 'Tarefa Principal', activity: 'Atividade' };

    return (
        <div className="modal-overlay">
            <div className="modal-content wide" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
                <h2 id="delete-modal-title">Confirmação de Exclusão Inteligente</h2>
                <p>Você está prestes a excluir os seguintes {selectedItems.length} itens:</p>
                <ul className="item-to-delete-list">
                    {selectedItems.map(item => (
                        <li key={item.id}>
                            <strong>{typeLabels[item.type]}:</strong> {item.name} (WBS: {item.wbsId})
                        </li>
                    ))}
                </ul>

                <div className="ai-analysis-section">
                    {isLoading ? (
                        <div className="loading-spinner">
                            <span className="material-icons spin" aria-hidden="true">sync</span>
                            <p>Analisando o impacto da exclusão...</p>
                        </div>
                    ) : (
                        <div className="ai-analysis-result">
                            <span className="material-icons" aria-hidden="true">smart_toy</span>
                            <p>{analysis}</p>
                        </div>
                    )}
                </div>

                <div className="modal-actions">
                    <button onClick={onClose} className="cancel-button" disabled={isLoading}>Cancelar</button>
                    <button onClick={handleConfirm} className="submit-button danger" disabled={isLoading}>
                        {isLoading ? 'Aguarde...' : `Confirmar Exclusão de ${selectedItems.length} Itens`}
                    </button>
                </div>
            </div>
        </div>
    );
};

const PrintScheduleModal = ({ isOpen, onClose, onConfirm, weeksToPrint, setWeeksToPrint }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    weeksToPrint: number;
    setWeeksToPrint: (weeks: number) => void;
}) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="print-modal-title">
                <h2 id="print-modal-title">Configurar Impressão do Cronograma</h2>
                <p>Selecione quantas semanas a partir da data de início você deseja incluir na impressão.</p>
                <div className="form-group">
                    <label htmlFor="weeks-to-print">Número de Semanas:</label>
                    <input
                        id="weeks-to-print"
                        type="number"
                        value={weeksToPrint}
                        onChange={e => setWeeksToPrint(parseInt(e.target.value, 10) || 1)}
                        min="1"
                    />
                </div>
                <div className="modal-actions">
                    <button onClick={onClose} className="cancel-button">Cancelar</button>
                    <button onClick={onConfirm} className="submit-button">Confirmar Impressão</button>
                </div>
            </div>
        </div>
    );
};

const Sidebar = ({
    handleUndo, handleRedo, historyIndex, historyLength,
    handleSavePlan,
    setImportModalOpen, setSaveModalOpen, setLoadModalOpen, handleSaveProject,
    handleExportExcel, onExportPdfClick,
    handleDateChange, startDate,
    goToWeekInput, setGoToWeekInput, handleGoToWeek,
    selectedItems, handleDeleteSelectedItems, handleClearAll
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
                <h3>Exportar</h3>
                <button className="control-button" onClick={handleExportExcel}><span className="material-icons" aria-hidden="true">download</span> Exportar para Excel</button>
                <button className="control-button" onClick={onExportPdfClick}><span className="material-icons" aria-hidden="true">picture_as_pdf</span> Exportar para PDF</button>
            </div>

            <div className="control-section ai-agent-status">
                <h3>Agente de Exclusão</h3>
                <div className="agent-status-item">
                    <span className="material-icons agent-active" aria-hidden="true">smart_toy</span>
                    <span>Agente de Organização: <strong>Ativo</strong></span>
                </div>
                {selectedItems.length === 0 ? (
                    <p className="agent-description">
                        Clique em uma linha para selecioná-la. Use Ctrl/Cmd+Click para selecionar múltiplos itens.
                    </p>
                ) : (
                    <div className="selection-info">
                        {selectedItems.length === 1 ? (
                            <>
                                <p><strong>ID:</strong> {selectedItems[0].wbsId}</p>
                                <p><strong>Nome:</strong> {selectedItems[0].name}</p>
                                <p><strong>Tipo:</strong> {typeLabels[selectedItems[0].type]}</p>
                            </>
                        ) : (
                            <p><strong>{selectedItems.length} itens selecionados.</strong></p>
                        )}
                         <button className="control-button danger" onClick={handleDeleteSelectedItems} disabled={selectedItems.length === 0}>
                            <span className="material-icons" aria-hidden="true">delete_forever</span>
                            Excluir {selectedItems.length > 1 ? 'Itens Selecionados' : 'Item Selecionado'}
                        </button>
                    </div>
                )}
                 <button className="control-button danger" onClick={handleClearAll} style={{width: '100%', marginTop: '12px'}}>
                    <span className="material-icons" aria-hidden="true">delete_sweep</span>
                    Limpar Todo o Cronograma
                </button>
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
                        <th 
                            key={i} 
                            rowSpan={3}
                            className={`col-sticky col-sticky-${i+1}`} 
                            style={{ width: columnWidths[i], left: stickyColumnPositions[i], verticalAlign: 'middle', textAlign: 'center' }}
                        >
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
                {dates.map((date, i) => <th key={i} className={getDayAbbr(date) === 'SÁB' ? 'saturday-col' : getDayAbbr(date) === 'DOM' ? 'sunday-col' : ''}>{getDayAbbr(date)}</th>)}
            </tr>
            <tr>
                {dates.map((date, i) => (
                    <th key={i} style={{ width: columnWidths[headers.length + i] }} className={getDayAbbr(date) === 'SÁB' ? 'saturday-col' : getDayAbbr(date) === 'DOM' ? 'sunday-col' : ''}>
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
    selectedItems, onRowClick,
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
    selectedItems?: SelectedItem[];
    onRowClick?: (event: React.MouseEvent, item: SelectedItem) => void;
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
            const wbsGroupIndex = data.findIndex(g => g.id === group.id) + 1;
            const groupWbs = `${wbsGroupIndex}`;
            
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
                    isLastInGroup: true,
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
                    const isLast = taskIndex === group.tarefas.length - 1;
                    rows.push({
                        group, task,
                        activity: { id: `empty-${task.id}`, name: '', schedule: {} },
                        renderGroup: isFirstRowOfGroup, groupRowSpan,
                        renderTask: isFirstRowOfTask, taskRowSpan: 1,
                        wbsId: taskWbs,
                        isLastInGroup: isLast
                    });
                    isFirstRowOfGroup = false;
                } else {
                    task.activities.forEach((activity, activityIndex) => {
                        const isLast = (taskIndex === group.tarefas.length - 1) && (activityIndex === task.activities.length - 1);
                        const activityWbs = `${taskWbs}.${activityIndex + 1}`;
                        rows.push({
                            group, task, activity,
                            renderGroup: isFirstRowOfGroup,
                            groupRowSpan,
                            renderTask: isFirstRowOfTask,
                            taskRowSpan,
                            wbsId: activityWbs,
                            isLastInGroup: isLast
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
            {renderableRows.map((row) => {
                const isDraggingGroup = draggedGroupInfo?.group.id === row.group.id;
                const isDropTarget = !isComparison && draggedGroupInfo && dropTargetId === row.group.id && draggedGroupInfo.group.id !== row.group.id;
                
                const rowEntity = getRowEntity(row);
                const isSelected = !isComparison && selectedItems?.some(s => s.id === rowEntity.id);
                
                const trClass = [
                    isComparison ? (planType === 'planned' ? 'planned-row' : 'real-row') : '',
                    isDraggingGroup ? 'group-dragging' : '',
                    isSelected ? 'selected-row' : '',
                    isDropTarget ? 'drop-target-top' : '',
                    row.isLastInGroup ? 'group-divider' : '',
                ].join(' ').trim();

                return (
                    <tr 
                        key={row.activity.id + (planType || '')} 
                        className={trClass}
                        onClick={(e) => !isComparison && onRowClick?.(e, rowEntity)}
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
                            const dayAbbr = getDayAbbr(date);
                            const cellClasses = ['status-cell'];
                            if(status) cellClasses.push(STATUS_CLASS_MAP[status]);
                            if(isActive) cellClasses.push('active-cell');
                            if(dayAbbr === 'SÁB') cellClasses.push('saturday-col');
                            if(dayAbbr === 'DOM') cellClasses.push('sunday-col');
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

const DashboardView = ({ data, title, programmerName }: { data: ScheduleData, title: string, programmerName: string }) => {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<string>('all');

  const availableWeeks = useMemo(() => {
    const weekSet = new Set<string>();
    data.forEach(group => {
        group.tarefas.forEach(task => {
            task.activities.forEach(activity => {
                Object.keys(activity.schedule).forEach(dateStr => {
                    weekSet.add(getWeekYear(new Date(dateStr + 'T00:00:00Z')));
                });
            });
        });
    });
    return Array.from(weekSet).sort();
  }, [data]);

  const stats = useMemo(() => {
    let totalProgramado = 0;
    let totalRealizado = 0;
    let totalCancelado = 0;
    let totalNaoRealizado = 0;
    const tasksPerComponent = new Map<string, number>();

    let weekDates: Date[] | null = null;
    if (selectedWeek !== 'all') {
        weekDates = getDatesOfWeek(selectedWeek);
    }
    const weekDateStrings = weekDates ? new Set(weekDates.map(formatDate)) : null;

    data.forEach(group => {
      let taskCount = 0;
      group.tarefas.forEach(task => {
        let activityInWeek = false;
        task.activities.forEach(activity => {
          let activityHasTaskInWeek = false;
          Object.entries(activity.schedule).forEach(([date, status]) => {
             if (weekDateStrings && !weekDateStrings.has(date)) {
                return;
             }
             activityHasTaskInWeek = true;
             if (status === Status.Programado) totalProgramado++;
             if (status === Status.Realizado) totalRealizado++;
             if (status === Status.Cancelado) totalCancelado++;
             if (status === Status.NaoRealizado) totalNaoRealizado++;
          });
          if(activityHasTaskInWeek) {
            activityInWeek = true;
          }
        });
        if (activityInWeek) {
             taskCount += task.activities.length;
        }
      });
      if(taskCount > 0){
        tasksPerComponent.set(group.componente, (tasksPerComponent.get(group.componente) || 0) + taskCount);
      }
    });

    return { totalProgramado, totalRealizado, totalCancelado, totalNaoRealizado, tasksPerComponent };
  }, [data, selectedWeek]);
  
  const handlePrint = () => {
      let chartImage = null;
      if (chartInstance.current) {
          chartImage = chartInstance.current.toBase64Image();
      }
      const selectElement = document.querySelector('.dashboard-view select') as HTMLSelectElement;
      const selectedWeekInfo = selectElement ? selectElement.options[selectElement.selectedIndex].text : 'Todas as Semanas';
      exportDashboardToPdfAgent(stats, chartImage, title, programmerName, selectedWeekInfo);
  };

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
                        data: [stats.totalProgramado, stats.totalRealizado, stats.totalCancelado, stats.totalNaoRealizado],
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
      <div className="view-header">
        <div>
            <h2>Dashboard do Projeto</h2>
            <p className="dashboard-subtitle">{title} - Responsável: {programmerName}</p>
        </div>
        <div className="dashboard-controls">
            <select value={selectedWeek} onChange={e => setSelectedWeek(e.target.value)}>
                <option value="all">Todas as Semanas</option>
                {availableWeeks.map(week => {
                    const [year, weekNum] = week.split('-');
                    const dateRange = getDateRangeOfWeek(week);
                    return (
                        <option key={week} value={week}>Semana {weekNum} ({year}) {dateRange}</option>
                    );
                })}
            </select>
            <button className="control-button" onClick={handlePrint}>
                <span className="material-icons" aria-hidden="true">print</span> Imprimir
            </button>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Programado</h3>
          <p>{stats.totalProgramado}</p>
        </div>
        <div className="stat-card">
          <h3>Total Realizado</h3>
          <p style={{color: STATUS_COLOR_MAP[Status.Realizado]}}>{stats.totalRealizado}</p>
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
            {stats.tasksPerComponent.size > 0 ? (
                 <ul>
                    {Array.from(stats.tasksPerComponent.entries()).map(([componente, count]) => (
                        <li key={componente}><strong>{componente}:</strong> {count} atividades</li>
                    ))}
                </ul>
            ) : <p>Nenhuma atividade encontrada para a semana selecionada.</p>}
           
        </div>
    </div>
  );
};

const ManpowerPrintModal = ({ isOpen, onClose, onConfirm, allWeeks, selectedWeeks, setSelectedWeeks }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    allWeeks: string[];
    selectedWeeks: Set<string>;
    setSelectedWeeks: React.Dispatch<React.SetStateAction<Set<string>>>;
}) => {
    if (!isOpen) return null;

    const handleToggleWeek = (week: string) => {
        const newSelection = new Set(selectedWeeks);
        if (newSelection.has(week)) {
            newSelection.delete(week);
        } else {
            newSelection.add(week);
        }
        setSelectedWeeks(newSelection);
    };

    const handleSelectAll = () => setSelectedWeeks(new Set(allWeeks));
    const handleClearAll = () => setSelectedWeeks(new Set());
    
    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Selecionar Semanas para Impressão</h2>
                <div className="filter-quick-actions" style={{ justifyContent: 'flex-start', gap: '16px', paddingLeft: 0 }}>
                     <button onClick={handleSelectAll}>Selecionar Todas</button>
                     <button onClick={handleClearAll}>Limpar Seleção</button>
                </div>
                <ul className="weeks-to-print-list">
                    {allWeeks.map(week => (
                        <li key={week}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={selectedWeeks.has(week)}
                                    onChange={() => handleToggleWeek(week)}
                                />
                                Semana {week.split('-')[1]} ({week.split('-')[0]})
                            </label>
                        </li>
                    ))}
                </ul>
                 <div className="modal-actions">
                    <button onClick={onClose} className="cancel-button">Cancelar</button>
                    <button onClick={onConfirm} className="submit-button">Confirmar Impressão</button>
                </div>
            </div>
        </div>
    );
};


const ManpowerAllocationTable = ({
    shiftKey, shiftLabel, roles, data, weeks,
    onQuantityChange, onAddRole, onDeleteRole, onRepeatWeek,
    newRoleName, setNewRoleName
}: {
    shiftKey: 'adm' | 'shift2';
    shiftLabel: string;
    roles: string[];
    data: ManpowerAllocationData;
    weeks: string[];
    onQuantityChange: (role: string, week: string, value: string) => void;
    onAddRole: () => void;
    onDeleteRole: (role: string) => void;
    onRepeatWeek: (weekIndex: number) => void;
    newRoleName?: string;
    setNewRoleName?: React.Dispatch<React.SetStateAction<string>>;
}) => {
    const weeklyTotals = useMemo(() => {
        const totals: Record<string, number> = {};
        weeks.forEach(week => {
            totals[week] = roles.reduce((sum, role) => sum + (data[role]?.[week] || 0), 0);
        });
        return totals;
    }, [weeks, roles, data]);

    const grandTotal = useMemo(() => Object.values(weeklyTotals).reduce((sum, val) => sum + val, 0), [weeklyTotals]);
    
    const handleRoleNameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); onAddRole(); }
    };

    return (
        <div className="shift-table-container">
            <h3 className="shift-table-header">{shiftLabel}</h3>
            <div className="table-wrapper">
                <table className="manpower-table">
                    <thead>
                        <tr>
                            <th className="sticky-col role-header">Mão de Obra</th>
                            {weeks.map((week, index) => {
                                const [year, weekNum] = week.split('-');
                                return (
                                    <th key={week}>
                                        <div className="week-header-content">
                                            <span>Semana {weekNum} ({year})</span>
                                            {index > 0 && (
                                                <button onClick={() => onRepeatWeek(index)} className="repeat-week-btn" title="Repetir alocação da semana anterior">
                                                    <span className="material-icons">replay</span>
                                                </button>
                                            )}
                                        </div>
                                        <small className="week-date-range">{getDateRangeOfWeek(week)}</small>
                                    </th>
                                );
                            })}
                             <th className="total-col-end">Total (H-Sem)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {roles.map(role => {
                            const rowTotal = Object.values(data[role] || {}).reduce((sum, val) => sum + val, 0);
                            return (
                                <tr key={role}>
                                    <td className="sticky-col role-cell">
                                        <span>{role}</span>
                                        <button onClick={() => onDeleteRole(role)} className="delete-role-btn" title={`Excluir ${role}`}>
                                            <span className="material-icons">delete_outline</span>
                                        </button>
                                    </td>
                                    {weeks.map(week => {
                                        const currentValue = data[role]?.[week] || 0;
                                        return (
                                            <td key={week}>
                                                <div className="custom-number-input">
                                                    <button onClick={() => onQuantityChange(role, week, String(Math.max(0, currentValue - 1)))}>-</button>
                                                    <span className="number-display">{currentValue}</span>
                                                    <button onClick={() => onQuantityChange(role, week, String(currentValue + 1))}>+</button>
                                                </div>
                                            </td>
                                        );
                                    })}
                                    <td className="total-col-end">{rowTotal > 0 ? rowTotal : ''}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                         <tr className="summary-total-row">
                            <td className="sticky-col"><strong>TOTAL (H-Sem)</strong></td>
                            {weeks.map(week => (
                                <td key={week}>
                                    <strong>{weeklyTotals[week] > 0 ? weeklyTotals[week] : ''}</strong>
                                </td>
                            ))}
                            <td className="total-col-end">
                                <strong>{grandTotal > 0 ? grandTotal : ''}</strong>
                            </td>
                        </tr>
                        {newRoleName !== undefined && setNewRoleName && (
                        <tr>
                            <td className="sticky-col add-role-cell">
                                <input
                                    type="text"
                                    value={newRoleName}
                                    onChange={e => setNewRoleName(e.target.value)}
                                    onKeyDown={handleRoleNameKeyDown}
                                    placeholder="Digitar outra mão de obra"
                                />
                            </td>
                            <td colSpan={weeks.length + 1} className="add-role-cell">
                                <button onClick={onAddRole} className="control-button">Adicionar</button>
                            </td>
                        </tr>
                        )}
                    </tfoot>
                </table>
            </div>
        </div>
    );
};


const ManpowerAllocationView = ({ project, setProject, dates, title }: {
    project: Project,
    setProject: React.Dispatch<React.SetStateAction<Project | null>>,
    dates: Date[],
    title: string,
}) => {
    const [newRoleName, setNewRoleName] = useState('');
    const [hideEmptyRoles, setHideEmptyRoles] = useState(false);
    const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
    const [selectedWeeksForPrint, setSelectedWeeksForPrint] = useState<Set<string>>(new Set());

    const weeks = useMemo(() => {
        const weekSet = new Set<string>();
        dates.forEach(date => {
            weekSet.add(getWeekYear(date));
        });
        return Array.from(weekSet).sort();
    }, [dates]);
    
    if (!project.manpowerAllocation) {
        return <div className="placeholder-view">Dados de alocação de mão de obra não encontrados.</div>;
    }

    const { roles, data, hasSecondShift } = project.manpowerAllocation;
    
    const handleQuantityChange = (shift: 'adm' | 'shift2') => (role: string, week: string, value: string) => {
        const quantity = parseInt(value, 10);
        setProject(prevProject => {
            if (!prevProject) return null;
            const newProject = deepClone(prevProject);
            const shiftData = newProject.manpowerAllocation.data[shift];
            if (!shiftData[role]) {
                shiftData[role] = {};
            }
            if (isNaN(quantity) || quantity <= 0) {
                delete shiftData[role][week];
            } else {
                shiftData[role][week] = quantity;
            }
            return newProject;
        });
    };

    const handleAddRole = () => {
        if (newRoleName.trim() === '') return;
        setProject(prevProject => {
            if (!prevProject) return null;
            if (prevProject.manpowerAllocation.roles.includes(newRoleName.trim())) return prevProject;
            const newProject = deepClone(prevProject);
            newProject.manpowerAllocation.roles.push(newRoleName.trim());
            return newProject;
        });
        setNewRoleName('');
    };
    
    const handleDeleteRole = (roleToDelete: string) => {
        if (window.confirm(`Tem certeza que deseja excluir a mão de obra "${roleToDelete}"? Esta ação não pode ser desfeita.`)) {
            setProject(prevProject => {
                if (!prevProject) return null;
                const newProject = deepClone(prevProject);
                newProject.manpowerAllocation.roles = newProject.manpowerAllocation.roles.filter(r => r !== roleToDelete);
                delete newProject.manpowerAllocation.data.adm[roleToDelete];
                delete newProject.manpowerAllocation.data.shift2[roleToDelete];
                return newProject;
            });
        }
    };
    
    const handleRepeatWeek = (shift: 'adm' | 'shift2') => (weekIndex: number) => {
        if (weekIndex === 0) return;
        const currentWeek = weeks[weekIndex];
        const prevWeek = weeks[weekIndex - 1];
        setProject(prevProject => {
            if (!prevProject) return null;
            const newProject = deepClone(prevProject);
            const { roles, data } = newProject.manpowerAllocation;
            const shiftData = data[shift];
            roles.forEach(role => {
                const prevWeekValue = shiftData[role]?.[prevWeek];
                if (!shiftData[role]) shiftData[role] = {};
                if (prevWeekValue !== undefined && prevWeekValue > 0) {
                    shiftData[role][currentWeek] = prevWeekValue;
                } else {
                    delete shiftData[role][currentWeek];
                }
            });
            return newProject;
        });
    };
    
    const handleToggleShift = (e: React.ChangeEvent<HTMLInputElement>) => {
        const isChecked = e.target.checked;
        setProject(p => {
            if (!p) return null;
            const newProject = deepClone(p);
            newProject.manpowerAllocation.hasSecondShift = isChecked;
            if (!isChecked) {
                newProject.manpowerAllocation.data.shift2 = {}; // Clear data when disabling
            }
            return newProject;
        });
    };
    
    const filteredRoles = useMemo(() => {
        if (!hideEmptyRoles) return roles;
        return roles.filter(role => {
            const totalAdm = Object.values(data.adm[role] || {}).reduce((sum, val) => sum + val, 0);
            const totalShift2 = Object.values(data.shift2[role] || {}).reduce((sum, val) => sum + val, 0);
            return (totalAdm + totalShift2) > 0;
        });
    }, [roles, data, hideEmptyRoles]);

    const handlePrint = () => {
        setSelectedWeeksForPrint(new Set(weeks));
        setIsPrintModalOpen(true);
    };

    const handleConfirmPrint = () => {
        const weeksToPrint = Array.from(selectedWeeksForPrint).sort();
        if (weeksToPrint.length === 0) {
            setIsPrintModalOpen(false);
            return;
        }
        
        exportManpowerToPdfAgent(filteredRoles, data, hasSecondShift, weeksToPrint, title);
        setIsPrintModalOpen(false);
    };

    return (
        <div className="manpower-view">
            <div className="view-header">
                <h2>Alocação de Mão de Obra por Semana</h2>
                <div className="view-controls">
                     <label className="toggle-switch">
                        <input type="checkbox" checked={hasSecondShift} onChange={handleToggleShift} />
                        <span className="slider"></span>
                         Habilitar 2º Turno
                    </label>
                    <label className="toggle-switch">
                        <input type="checkbox" checked={hideEmptyRoles} onChange={e => setHideEmptyRoles(e.target.checked)} />
                        <span className="slider"></span>
                         Ocultar MO não alocada
                    </label>
                    <button className="control-button" onClick={handlePrint}>
                        <span className="material-icons" aria-hidden="true">print</span> Imprimir Programação
                    </button>
                </div>
            </div>
            
            <ManpowerAllocationTable
                shiftKey="adm"
                shiftLabel="Turno ADM"
                roles={filteredRoles}
                data={data.adm}
                weeks={weeks}
                onQuantityChange={handleQuantityChange('adm')}
                onAddRole={handleAddRole}
                onDeleteRole={handleDeleteRole}
                onRepeatWeek={handleRepeatWeek('adm')}
                newRoleName={newRoleName}
                setNewRoleName={setNewRoleName}
            />

            {hasSecondShift && (
                 <ManpowerAllocationTable
                    shiftKey="shift2"
                    shiftLabel="2º Turno"
                    roles={filteredRoles}
                    data={data.shift2}
                    weeks={weeks}
                    onQuantityChange={handleQuantityChange('shift2')}
                    onAddRole={handleAddRole}
                    onDeleteRole={handleDeleteRole}
                    onRepeatWeek={handleRepeatWeek('shift2')}
                />
            )}
            
            <ManpowerPrintModal 
                isOpen={isPrintModalOpen}
                onClose={() => setIsPrintModalOpen(false)}
                onConfirm={handleConfirmPrint}
                allWeeks={weeks}
                selectedWeeks={selectedWeeksForPrint}
                setSelectedWeeks={setSelectedWeeksForPrint}
            />
        </div>
    );
};

const DailyAllocationView = ({ project, setProject, dates, filteredData, title }: {
    project: Project;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    dates: Date[];
    filteredData: ScheduleData;
    title: string;
}) => {
    const [editingCell, setEditingCell] = useState<{ activityId: string; date: string } | null>(null);
    const [draggedRole, setDraggedRole] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{ activityId: string; date: string } | null>(null);
    const [dateColWidth, setDateColWidth] = useState(80);

    const columnWidths = useMemo(() => {
        const staticWidths = [50, 180, 180];
        const dateWidths = Array(dates.length).fill(dateColWidth);
        return [...staticWidths, ...dateWidths];
    }, [dates.length, dateColWidth]);

    const handleCellDoubleClick = (activityId: string, date: string) => {
        setEditingCell({ activityId, date });
    };
    
    const handlePrint = () => {
        exportDailyAllocationToPdfAgent(project, dates, filteredData, title);
    };

    const handleAllocationChange = (activityId: string, date: string, role: string, quantityStr: string) => {
        const quantity = parseInt(quantityStr, 10);
        setProject(prev => {
            if (!prev) return null;
            const newProject = deepClone(prev);
            const allocations = newProject.dailyManpowerAllocation;
            if (!allocations[activityId]) allocations[activityId] = {};
            if (!allocations[activityId][date]) allocations[activityId][date] = {};

            if (isNaN(quantity) || quantity <= 0) {
                delete allocations[activityId][date][role];
                if (Object.keys(allocations[activityId][date]).length === 0) {
                    delete allocations[activityId][date];
                }
            } else {
                allocations[activityId][date][role] = quantity;
            }
            return newProject;
        });
    };

    const handleDrop = (activityId: string, date: string) => {
        if (!draggedRole) return;
        
        const currentQty = project.dailyManpowerAllocation[activityId]?.[date]?.[draggedRole] || 0;
        const newQty = currentQty + 1;
        handleAllocationChange(activityId, date, draggedRole, String(newQty));
        
        setDraggedRole(null);
        setDropTarget(null);
    };
    
    const dailyTotals = useMemo(() => {
        const totals: Record<string, Record<string, number>> = {};
        for (const date of dates) {
            const dateStr = formatDate(date);
            totals[dateStr] = {};
            project.manpowerAllocation.roles.forEach(role => {
                totals[dateStr][role] = 0;
            });
        }
        
        filteredData.forEach(group => {
            group.tarefas.forEach(task => {
                task.activities.forEach(activity => {
                    if(project.dailyManpowerAllocation[activity.id]) {
                        Object.entries(project.dailyManpowerAllocation[activity.id]).forEach(([dateStr, roles]) => {
                            if (totals[dateStr]) {
                                Object.entries(roles).forEach(([role, quantity]) => {
                                    if(totals[dateStr][role] !== undefined) {
                                        totals[dateStr][role] += quantity;
                                    }
                                });
                            }
                        });
                    }
                });
            });
        });
        
        return totals;
    }, [project, dates, filteredData]);
    
    const weeklyAvailable = useMemo(() => {
        const available: Record<string, Record<string, number>> = {}; // { [weekYear]: { [role]: quantity } }
        const { roles, data, hasSecondShift } = project.manpowerAllocation;
        dates.forEach(date => {
            const weekYear = getWeekYear(date);
            if (!available[weekYear]) {
                available[weekYear] = {};
                roles.forEach(role => {
                    const admQty = data.adm[role]?.[weekYear] || 0;
                    const shift2Qty = hasSecondShift ? (data.shift2[role]?.[weekYear] || 0) : 0;
                    available[weekYear][role] = admQty + shift2Qty;
                });
            }
        });
        return available;
    }, [project.manpowerAllocation, dates]);

    const dailyGrandTotals = useMemo(() => {
        const grandTotals: Record<string, { allocated: number; available: number }> = {};
        for (const date of dates) {
            const dateStr = formatDate(date);
            const weekYear = getWeekYear(date);

            const allocated = Object.values(dailyTotals[dateStr] || {}).reduce((sum, val) => sum + val, 0);
            const available = Object.values(weeklyAvailable[weekYear] || {}).reduce((sum, val) => sum + val, 0);
            
            grandTotals[dateStr] = { allocated, available };
        }
        return grandTotals;
    }, [dates, dailyTotals, weeklyAvailable]);
    
    const weekHeaders = useMemo(() => {
        const weekMap = new Map<string, number>();
        dates.forEach(date => {
            const weekYear = getWeekYear(date);
            weekMap.set(weekYear, (weekMap.get(weekYear) || 0) + 1);
        });
        return Array.from(weekMap.entries()).map(([week, count]) => ({ name: `Semana ${week.split('-')[1]}`, count }));
    }, [dates]);

    return (
        <div className="daily-allocation-view">
            <div className="view-header">
                <h2>Alocação Diária de Mão de Obra</h2>
                <div className="view-controls daily-allocation-controls">
                     <div className="zoom-control">
                        <span className="material-icons">zoom_out</span>
                        <input
                            type="range"
                            min="40"
                            max="150"
                            value={dateColWidth}
                            onChange={e => setDateColWidth(Number(e.target.value))}
                        />
                        <span className="material-icons">zoom_in</span>
                    </div>
                    <button className="control-button" onClick={handlePrint}>
                        <span className="material-icons" aria-hidden="true">print</span> Imprimir Alocação
                    </button>
                </div>
            </div>
             <div className="daily-allocation-content">
                 <div className="mo-draggables-panel">
                    <h3>Mão de Obra</h3>
                    {Object.entries(MANPOWER_CATEGORIES).map(([category, rolesInCategory]) => (
                        <details key={category} open>
                            <summary>{category}</summary>
                            {rolesInCategory
                                .filter(role => project.manpowerAllocation.roles.includes(role))
                                .map(role => (
                                <div 
                                    key={role}
                                    className="mo-draggable-item"
                                    draggable
                                    onDragStart={(e) => {
                                        setDraggedRole(role);
                                        e.dataTransfer.setData("text/plain", role);
                                        e.dataTransfer.effectAllowed = "copy";
                                    }}
                                    onDragEnd={() => setDraggedRole(null)}
                                >
                                    {role}
                                </div>
                            ))}
                        </details>
                    ))}
                    {(() => {
                        const customRoles = project.manpowerAllocation.roles.filter(r => !PREDEFINED_MANPOWER_ROLES.includes(r));
                        if (customRoles.length === 0) return null;
                        return (
                            <details open>
                                <summary>Outros</summary>
                                {customRoles.map(role => (
                                    <div 
                                        key={role}
                                        className="mo-draggable-item"
                                        draggable
                                        onDragStart={(e) => {
                                            setDraggedRole(role);
                                            e.dataTransfer.setData("text/plain", role);
                                            e.dataTransfer.effectAllowed = "copy";
                                        }}
                                        onDragEnd={() => setDraggedRole(null)}
                                    >
                                        {role}
                                    </div>
                                ))}
                            </details>
                        );
                    })()}
                </div>
                <div className="table-wrapper">
                    <table className="daily-allocation-table" style={{ width: columnWidths.reduce((a, b) => a + b, 0) }}>
                        <thead>
                            <tr className="week-header-row">
                                <th style={{width: columnWidths[0]}}></th>
                                <th style={{width: columnWidths[1]}}></th>
                                <th style={{width: columnWidths[2]}}></th>
                                {weekHeaders.map((week, index) => (
                                     <th key={index} colSpan={week.count}>{week.name}</th>
                                ))}
                            </tr>
                            <tr>
                                <th style={{width: columnWidths[0]}}>ID</th>
                                <th style={{width: columnWidths[1]}}>Tarefa Principal</th>
                                <th style={{width: columnWidths[2]}}>Atividade</th>
                                {dates.map((date, i) => (
                                    <th key={formatDate(date)} style={{width: columnWidths[3 + i]}} className={getDayAbbr(date) === 'SÁB' ? 'saturday-col' : getDayAbbr(date) === 'DOM' ? 'sunday-col' : ''}>
                                        {getDayAbbr(date)}<br/>{date.getUTCDate()}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredData.flatMap((group, gIdx) =>
                                group.tarefas.flatMap((task, tIdx) =>
                                    task.activities.map((activity, aIdx) => {
                                        const wbs = `${gIdx + 1}.${tIdx + 1}.${aIdx + 1}`;
                                        return (
                                        <tr key={activity.id}>
                                            <td>{wbs}</td>
                                            <td>{task.title}</td>
                                            <td>{activity.name}</td>
                                            {dates.map(date => {
                                                const dateStr = formatDate(date);
                                                const dayAbbr = getDayAbbr(date);
                                                const cellAllocation = project.dailyManpowerAllocation[activity.id]?.[dateStr] || {};
                                                const isEditing = editingCell?.activityId === activity.id && editingCell?.date === dateStr;
                                                const scheduleStatus = activity.schedule[dateStr];
                                                const isDropTarget = dropTarget?.activityId === activity.id && dropTarget?.date === dateStr;

                                                const cellClasses = [
                                                    'allocation-cell',
                                                    dayAbbr === 'SÁB' ? 'saturday-col' : '',
                                                    dayAbbr === 'DOM' ? 'sunday-col' : '',
                                                    isDropTarget ? 'drop-target' : '',
                                                    scheduleStatus ? STATUS_CLASS_MAP[scheduleStatus] : '',
                                                ].filter(Boolean).join(' ');

                                                return (
                                                    <td
                                                        key={dateStr}
                                                        className={cellClasses}
                                                        onDoubleClick={() => handleCellDoubleClick(activity.id, dateStr)}
                                                        onDragOver={(e) => {
                                                            if (draggedRole) {
                                                                e.preventDefault();
                                                                setDropTarget({ activityId: activity.id, date: dateStr });
                                                            }
                                                        }}
                                                        onDragLeave={() => setDropTarget(null)}
                                                        onDrop={(e) => {
                                                            e.preventDefault();
                                                            handleDrop(activity.id, dateStr);
                                                        }}
                                                    >
                                                    {isEditing ? (
                                                        <div className="allocation-cell-editor" onClick={e => e.stopPropagation()}>
                                                            {project.manpowerAllocation.roles.map(role => (
                                                                <div key={role} className="editor-row">
                                                                    <label>{role}</label>
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        value={cellAllocation[role] || ''}
                                                                        onChange={e => handleAllocationChange(activity.id, dateStr, role, e.target.value)}
                                                                        placeholder="0"
                                                                        autoFocus={role === project.manpowerAllocation.roles[0]}
                                                                    />
                                                                </div>
                                                            ))}
                                                             <button onClick={() => setEditingCell(null)}>Fechar</button>
                                                        </div>
                                                    ) : (
                                                        <div className="allocation-summary">
                                                            {Object.entries(cellAllocation).map(([role, qty]) => (
                                                                <div key={role}>{getRoleAbbreviation(role)}: <strong>{qty}</strong></div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    )})
                                )
                            )}
                        </tbody>
                        <tfoot>
                            <tr className="summary-header-row">
                                <th colSpan={3}>Resumo de Alocação Diária</th>
                                {dates.map(date => <th key={formatDate(date)}>{getDayAbbr(date)}</th>)}
                            </tr>
                            {project.manpowerAllocation.roles.map(role => {
                                return (
                                    <tr key={role} className="summary-total-row">
                                        <td colSpan={3}>{role}</td>
                                        {dates.map(date => {
                                            const dateStr = formatDate(date);
                                            const weekYear = getWeekYear(date);
                                            const totalDaily = dailyTotals[dateStr]?.[role] || 0;
                                            const availableWeekly = weeklyAvailable[weekYear]?.[role] || 0;
                                            const isSuperAllocated = totalDaily > availableWeekly;
                                            return (
                                                <td key={dateStr} className={isSuperAllocated ? 'super-allocated' : ''}>
                                                    {totalDaily} / {availableWeekly}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                             <tr className="summary-total-row grand-total">
                                <td colSpan={3}><strong>TOTAL GERAL</strong></td>
                                {dates.map(date => {
                                    const dateStr = formatDate(date);
                                    const totals = dailyGrandTotals[dateStr];
                                    const isSuperAllocated = totals.allocated > totals.available;
                                    return (
                                        <td key={dateStr} className={isSuperAllocated ? 'super-allocated' : ''}>
                                            <strong>{totals.allocated} / {totals.available}</strong>
                                        </td>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    </table>
                </div>
             </div>
        </div>
    );
};

const ManpowerDashboardView = ({ project, dates, title, programmerName }: {
    project: Project;
    dates: Date[];
    title: string;
    programmerName: string;
}) => {
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<Chart | null>(null);
    const [chartMode, setChartMode] = useState<'byRole' | 'byWeek'>('byRole');
    
    const availableWeeks = useMemo(() => {
        const weekSet = new Set<string>();
        dates.forEach(date => {
            weekSet.add(getWeekYear(date));
        });
        const manpowerWeeks = new Set(Object.keys(project.manpowerAllocation.data.adm).concat(Object.keys(project.manpowerAllocation.data.shift2)));
        manpowerWeeks.forEach(w => {
            if (Object.values(project.manpowerAllocation.data.adm).some(roleData => roleData[w] > 0) ||
                Object.values(project.manpowerAllocation.data.shift2).some(roleData => roleData[w] > 0)) {
                weekSet.add(w);
            }
        });
        return Array.from(weekSet).sort();
    }, [dates, project.manpowerAllocation.data]);
    
    const [selectedWeek, setSelectedWeek] = useState<string>(() => availableWeeks[0] || 'all');

    useEffect(() => {
        if (availableWeeks.length > 0 && !availableWeeks.includes(selectedWeek)) {
            setSelectedWeek(availableWeeks[0]);
        }
    }, [availableWeeks, selectedWeek]);
    
    const chartData = useMemo(() => {
        const { roles, data, hasSecondShift } = project.manpowerAllocation;
        if (chartMode === 'byRole') {
            if (selectedWeek === 'all' || !selectedWeek) return { labels: [], datasets: [] };
        
            const labels = roles.filter(role => {
                const admQty = data.adm[role]?.[selectedWeek] || 0;
                const shift2Qty = data.shift2[role]?.[selectedWeek] || 0;
                return admQty > 0 || shift2Qty > 0;
            });

            const admData = labels.map(role => data.adm[role]?.[selectedWeek] || 0);
            const shift2Data = hasSecondShift ? labels.map(role => data.shift2[role]?.[selectedWeek] || 0) : [];
            
            const datasets: any[] = [{
                label: 'Turno ADM',
                data: admData,
                backgroundColor: 'rgba(74, 144, 226, 0.8)',
                borderColor: 'rgba(74, 144, 226, 1)',
                borderWidth: 1
            }];

            if (hasSecondShift) {
                datasets.push({
                    label: '2º Turno',
                    data: shift2Data,
                    backgroundColor: 'rgba(255, 159, 64, 0.8)',
                    borderColor: 'rgba(255, 159, 64, 1)',
                    borderWidth: 1
                });
            }
            return { labels, datasets };
        } else { // byWeek mode
            const weeklyTotals: { [week: string]: { adm: number; shift2: number } } = {};
            availableWeeks.forEach(week => {
                let admTotal = 0;
                let shift2Total = 0;
                roles.forEach(role => {
                    admTotal += data.adm[role]?.[week] || 0;
                    if(data.shift2[role]) {
                       shift2Total += data.shift2[role][week] || 0;
                    }
                });
                weeklyTotals[week] = { adm: admTotal, shift2: shift2Total };
            });

            const labels = availableWeeks.map(w => `Semana ${w.split('-')[1]}`);
            const admData = availableWeeks.map(w => weeklyTotals[w].adm);
            const shift2Data = hasSecondShift ? availableWeeks.map(w => weeklyTotals[w].shift2) : [];
            
            const datasets: any[] = [{
                label: 'Turno ADM',
                data: admData,
                backgroundColor: 'rgba(74, 144, 226, 0.8)',
            }];

            if (hasSecondShift) {
                datasets.push({
                    label: '2º Turno',
                    data: shift2Data,
                    backgroundColor: 'rgba(255, 159, 64, 0.8)',
                });
            }
            return { labels, datasets };
        }

    }, [chartMode, selectedWeek, project.manpowerAllocation, availableWeeks]);

    useEffect(() => {
        // Plugin to draw data labels on bars
        const dataLabelsPlugin = {
            id: 'customDataLabels',
            afterDatasetsDraw: (chart: Chart) => {
                const { ctx } = chart;
                ctx.save();
        
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    if (!meta.hidden) {
                        ctx.font = 'bold 11px var(--font-family)';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        
                        meta.data.forEach((element, index) => {
                            const dataVal = dataset.data[index];
                            if (dataVal && typeof dataVal === 'number' && dataVal > 0) {
                                const { x, y, base } = element.getProps(['x', 'y', 'base']);
                                const barHeight = base - y;
                                
                                if (barHeight > 15) { // Only draw if bar is tall enough
                                    const yPos = y + (barHeight / 2);
                                    
                                    // Use a contrasting color for the text
                                    const barColor = (dataset.backgroundColor as string[] | string);
                                    const color = Array.isArray(barColor) ? barColor[index] : barColor;
                                    const r = parseInt(color.substring(color.indexOf('(') + 1, color.indexOf(',')));
                                    const g = parseInt(color.substring(color.indexOf(',') + 1, color.lastIndexOf(',')));
                                    const b = parseInt(color.substring(color.lastIndexOf(',') + 1, color.indexOf(')')));
                                    const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
                                    ctx.fillStyle = brightness > 155 ? '#2d3748' : '#ffffff';
                                    
                                    ctx.fillText(String(dataVal), x, yPos);
                                }
                            }
                        });
                    }
                });
                ctx.restore();
            },
        };
        
        if (chartRef.current) {
            if (chartInstance.current) {
                chartInstance.current.destroy();
            }
            const ctx = chartRef.current.getContext('2d');
            if (ctx) {
                chartInstance.current = new Chart(ctx, {
                    type: 'bar',
                    data: chartData,
                    plugins: [dataLabelsPlugin],
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'top' },
                            title: { 
                                display: true, 
                                text: chartMode === 'byRole' 
                                    ? `Histograma de Mão de Obra para a Semana ${selectedWeek.split('-')[1]}`
                                    : 'Total de Mão de Obra por Semana'
                            }
                        },
                        scales: {
                            x: { stacked: chartMode === 'byRole' },
                            y: { stacked: chartMode === 'byRole', beginAtZero: true, title: { display: true, text: 'Quantidade de Pessoas' } }
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
    }, [chartData, selectedWeek, chartMode]);

    const handlePrint = () => {
        let chartImage = null;
        if (chartInstance.current) {
            chartImage = chartInstance.current.toBase64Image();
        }
        const selectElement = document.getElementById('week-select-mo') as HTMLSelectElement;
        const selectedWeekInfo = chartMode === 'byRole' 
            ? (selectElement ? selectElement.options[selectElement.selectedIndex].text : 'N/A')
            : 'Todas as Semanas';
        exportManpowerDashboardToPdfAgent(chartImage, title, programmerName, selectedWeekInfo);
    };
    
    return (
        <div className="manpower-dashboard-view">
            <div className="view-header">
                <div>
                    <h2>Dashboard de Mão de Obra</h2>
                    <p className="dashboard-subtitle">{title} - Responsável: {programmerName}</p>
                </div>
                <div className="dashboard-controls">
                     <div className="chart-mode-toggle">
                        <button className={chartMode === 'byRole' ? 'active' : ''} onClick={() => setChartMode('byRole')}>Por Função</button>
                        <button className={chartMode === 'byWeek' ? 'active' : ''} onClick={() => setChartMode('byWeek')}>Total por Semana</button>
                    </div>
                    {chartMode === 'byRole' && (
                    <>
                        <label htmlFor="week-select-mo">Selecionar Semana:</label>
                        <select id="week-select-mo" value={selectedWeek} onChange={e => setSelectedWeek(e.target.value)}>
                            {availableWeeks.map(week => {
                                const [year, weekNum] = week.split('-');
                                const dateRange = getDateRangeOfWeek(week);
                                return (
                                <option key={week} value={week}>Semana {weekNum} ({year}) {dateRange}</option>
                                );
                            })}
                        </select>
                    </>
                    )}
                    <button className="control-button" onClick={handlePrint}>
                        <span className="material-icons" aria-hidden="true">print</span> Imprimir
                    </button>
                </div>
            </div>
            <div className="chart-container">
                {chartData.labels.length > 0 ? (
                    <canvas ref={chartRef}></canvas>
                ) : (
                    <p>Nenhuma mão de obra alocada para a(s) semana(s) selecionada(s).</p>
                )}
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
  const [isSaveModalOpen, setisSaveModalOpen] = useState(false);
  const [isDeletionModalOpen, setDeletionModalOpen] = useState(false);
  const [isPrintModalOpen, setPrintModalOpen] = useState(false);
  const [weeksToPrint, setWeeksToPrint] = useState(4);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('schedule');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  
  const [draggedGroupInfo, setDraggedGroupInfo] = useState<{ group: Grupo, index: number } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const [columnWidths, setColumnWidths] = useState<number[]>([50, 120, 130, 130, 280, 250].concat(Array(28).fill(35)));
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
          handleLoadProject(projectToLoad.id);
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
    setisSaveModalOpen(false);
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
        // Backwards compatibility for manpower shifts
        if (projectToLoad.manpowerAllocation && !(projectToLoad.manpowerAllocation.data as any).adm) {
            const oldData = projectToLoad.manpowerAllocation.data as unknown as ManpowerAllocationData;
            projectToLoad.manpowerAllocation.data = {
                adm: oldData,
                shift2: {}
            };
            projectToLoad.manpowerAllocation.hasSecondShift = false;
        }

        if (!projectToLoad.dailyManpowerAllocation) {
            projectToLoad.dailyManpowerAllocation = {};
        }
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
    if (liveData.length === 0) {
        addToast("Não é possível definir um cronograma vazio como base.", "error");
        return;
    }
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

  const handleConfirmDeletion = useCallback((itemsToDelete: { id: string, type: 'group' | 'task' | 'activity' }[]) => {
    dispatch({ type: 'BATCH_DELETE_ITEMS', payload: itemsToDelete });
    const message = itemsToDelete.length > 1
        ? `${itemsToDelete.length} itens foram excluídos com sucesso.`
        : `O item selecionado foi excluído com sucesso.`;
    addToast(message, 'success');
    setSelectedItems([]); // Clear selection after deletion
  }, [addToast]);

  const handleDeleteSelectedItems = useCallback(() => {
    if (selectedItems.length === 0) return;
    setDeletionModalOpen(true);
  }, [selectedItems]);

  const handleClearAll = useCallback(() => {
    if (window.confirm("TEM CERTEZA? Esta ação vai apagar TODOS os grupos, tarefas e atividades do projeto. A ação pode ser desfeita com o botão 'Desfazer'.")) {
        dispatch({ type: 'CLEAR_ALL' });
        setSelectedItems([]);
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
      setSelectedItems([]); // Deselect when filters change
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
    if (isNaN(newDate.getTime())) {
        addToast("Data de início inválida.", "error");
        return;
    }
    setCurrentStartDate(newDate);
    if(activeProject){
        setActiveProject(p => p ? { ...p, startDate: newDateStr } : null);
    }
  }, [activeProject, addToast]);

  const handleExportExcel = () => exportToExcelAgent(filteredData, dates, title, addToast);
  
  const handleConfirmPrint = () => {
    if (!activeProject) return;
    if (weeksToPrint <= 0) {
        addToast("O número de semanas deve ser maior que zero.", "error");
        return;
    }
    const printDates = Array.from({ length: weeksToPrint * 7 }, (_, i) => {
        const d = new Date(currentStartDate);
        d.setUTCDate(currentStartDate.getUTCDate() + i);
        return d;
    });
    exportToPdfAgent(filteredData, printDates, title, addToast, activeProject.lastModified, activeProject.programmerName);
    setPrintModalOpen(false);
  };
  
  const scheduleHeaders = useMemo(() => ['ID', 'Fase/Agrupador', 'COMPONENTE', 'SETOR', 'TAREFA PRINCIPAL', 'ATIVIDADE'], []);
  const comparisonHeaders = useMemo(() => ['ID', 'Fase/Agrupador', 'COMPONENTE', 'SETOR', 'TAREFA PRINCIPAL', 'ATIVIDADE', 'PLANO'], []);
  const headers = currentPage === 'comparison' ? comparisonHeaders : scheduleHeaders;

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
    dispatch({ type: 'MOVE_GROUP', payload: { fromId: draggedGroupInfo.group.id, toId: dropTargetId } });
    handleDragEnd();
  }, [draggedGroupInfo, dropTargetId]);
  
  const handleDragEnd = useCallback(() => {
      setDraggedGroupInfo(null);
      setDropTargetId(null);
  }, []);
  
  const handleRowClick = useCallback((event: React.MouseEvent, item: SelectedItem) => {
    const isCtrlPressed = event.ctrlKey || event.metaKey;
    setSelectedItems(prev => {
        const isAlreadySelected = prev.some(s => s.id === item.id);
        if (isCtrlPressed) {
            if (isAlreadySelected) {
                return prev.filter(s => s.id !== item.id);
            } else {
                return [...prev, item];
            }
        } else {
            if (isAlreadySelected && prev.length === 1) {
                return [];
            }
            return [item];
        }
    });
  }, []);
  
  // Column resizing logic
  const stickyColumnPositions = useMemo(() => {
    const positions = [0];
    for (let i = 0; i < columnWidths.length -1; i++) {
        positions.push(positions[i] + columnWidths[i]);
    }
    return positions;
  }, [columnWidths]);

  const handleResizeStart = useCallback((columnIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    setResizingInfo({
      isResizing: true,
      columnIndex,
      startX: e.clientX,
      startWidth: columnWidths[columnIndex]
    });
  }, [columnWidths]);

  const handleResize = useCallback((e: MouseEvent) => {
    if (!resizingInfo.isResizing || resizingInfo.columnIndex === null) return;
    const dx = e.clientX - resizingInfo.startX;
    const newWidth = Math.max(30, resizingInfo.startWidth + dx);
    setColumnWidths(currentWidths => {
      const newWidths = [...currentWidths];
      newWidths[resizingInfo.columnIndex!] = newWidth;
      return newWidths;
    });
  }, [resizingInfo]);

  const handleResizeEnd = useCallback(() => {
    setResizingInfo({ isResizing: false, columnIndex: null, startX: 0, startWidth: 0 });
  }, []);

  useEffect(() => {
    if (resizingInfo.isResizing) {
      window.addEventListener('mousemove', handleResize);
      window.addEventListener('mouseup', handleResizeEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [resizingInfo.isResizing, handleResize, handleResizeEnd]);

  if (!currentUser) {
    return <AuthScreen onLogin={handleLogin} onRegister={handleRegister} />;
  }

  return (
    <div className={`app-wrapper ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <ToastContainer toasts={toasts} setToasts={setToasts} />
      {isImportModalOpen && <ImportModal isOpen={isImportModalOpen} onClose={() => setImportModalOpen(false)} onImportSchedule={handleImportSchedule} onImportFA={handleImportFA} />}
      {isLoadModalOpen && <LoadModal schedules={Object.values(projects[currentUser] || {})} onLoad={handleLoadProject} onDelete={handleDeleteProject} onClose={() => setLoadModalOpen(false)} />}
      {isSaveModalOpen && <SaveModal onClose={() => setisSaveModalOpen(false)} onSave={handleNewProject}/>}
      {isDeletionModalOpen && <DeletionModal isOpen={isDeletionModalOpen} onClose={() => setDeletionModalOpen(false)} selectedItems={selectedItems} onConfirm={handleConfirmDeletion} ai={ai} data={liveData} addToast={addToast}/>}
      {isPrintModalOpen && <PrintScheduleModal isOpen={isPrintModalOpen} onClose={() => setPrintModalOpen(false)} onConfirm={handleConfirmPrint} weeksToPrint={weeksToPrint} setWeeksToPrint={setWeeksToPrint} />}
      {openFilter && <FilterDropdown columnKey={openFilter.column} allOptions={filterOptions[openFilter.column]} activeSelections={activeFilters[openFilter.column] || new Set()} onApply={handleApplyFilter} onClose={handleCloseFilter} position={openFilter.rect}/>}
      
      <div className="app-content">
        <div className="app-header">
           <div className="header-left">
            <button className="sidebar-toggle control-button" onClick={() => setSidebarCollapsed(!isSidebarCollapsed)} aria-label="Alternar barra lateral">
                <span className="material-icons">{isSidebarCollapsed ? 'menu_open' : 'menu'}</span>
            </button>
            <h1 contentEditable suppressContentEditableWarning onBlur={e => handleTextUpdate('', 'title', e.currentTarget.textContent || '')}>{title}</h1>
            <nav className="header-nav">
                <button className={`nav-tab ${currentPage === 'schedule' ? 'active' : ''}`} onClick={() => setCurrentPage('schedule')}>Programação</button>
                <button className={`nav-tab ${currentPage === 'manpower' ? 'active' : ''}`} onClick={() => setCurrentPage('manpower')}>Alocação de MO</button>
                <button className={`nav-tab ${currentPage === 'dailyAllocation' ? 'active' : ''}`} onClick={() => setCurrentPage('dailyAllocation')}>Alocação Diária</button>
                <button className={`nav-tab ${currentPage === 'dashboard' ? 'active' : ''}`} onClick={() => setCurrentPage('dashboard')}>Dashboard</button>
                <button className={`nav-tab ${currentPage === 'manpowerDashboard' ? 'active' : ''}`} onClick={() => setCurrentPage('manpowerDashboard')}>Dashboard de MO</button>
                <button className={`nav-tab ${currentPage === 'comparison' ? 'active' : ''}`} onClick={() => setCurrentPage('comparison')} disabled={!savedPlan}>Comparativo</button>
            </nav>
           </div>
           <div className="header-controls">
                <div className="header-item-editable">
                    <span className="label">Responsável:</span>
                    <span className="editable-field" contentEditable suppressContentEditableWarning onBlur={e => handleTextUpdate('', 'programmerName', e.currentTarget.textContent || '')}>{activeProject?.programmerName}</span>
                </div>
                <div className="user-info">
                    <span className="material-icons">account_circle</span>
                    <span>{currentUser}</span>
                </div>
                <button className="control-button" onClick={handleLogout} aria-label="Sair"><span className="material-icons">logout</span></button>
            </div>
        </div>
        <div className="app-container">
            {!isSidebarCollapsed && (
              <Sidebar 
                handleUndo={handleUndo} handleRedo={handleRedo} historyIndex={historyIndex} historyLength={history.length}
                handleSavePlan={handleSavePlan}
                setImportModalOpen={setImportModalOpen} setSaveModalOpen={setisSaveModalOpen} setLoadModalOpen={setLoadModalOpen}
                handleSaveProject={handleSaveProject}
                handleExportExcel={handleExportExcel} onExportPdfClick={() => setPrintModalOpen(true)}
                handleDateChange={handleDateChange} startDate={currentStartDate}
                goToWeekInput={goToWeekInput} setGoToWeekInput={setGoToWeekInput} handleGoToWeek={handleGoToWeek}
                selectedItems={selectedItems} handleDeleteSelectedItems={handleDeleteSelectedItems} handleClearAll={handleClearAll}
              />
            )}
            <main className="main-content" ref={gridRef}>
              {!activeProject ? (
                <div className="no-project-view">
                    <span className="material-icons" style={{ fontSize: '4rem', color: '#94a3b8' }}>folder_off</span>
                    <h2>Nenhum Projeto Ativo</h2>
                    <p>Crie um novo projeto ou carregue um existente para começar.</p>
                </div>
              ) : (
                <>
                  {currentPage === 'schedule' && (
                    <div className="table-wrapper">
                      <table className="schedule-table" style={{ width: columnWidths.reduce((a, b) => a + b, 0) }}>
                          <ScheduleHeader dates={dates} headers={headers} columnWidths={columnWidths} onResizeStart={handleResizeStart} stickyColumnPositions={stickyColumnPositions} onOpenFilter={handleOpenFilter} activeFilters={activeFilters}/>
                          <ScheduleBody
                              data={filteredData}
                              dates={dates}
                              isComparison={false}
                              planType={null}
                              columnWidths={columnWidths}
                              stickyColumnPositions={stickyColumnPositions}
                              selectedItems={selectedItems}
                              onRowClick={handleRowClick}
                              activeCell={activeCell}
                              onCellMouseDown={handleCellMouseDown}
                              onCellMouseEnter={handleCellMouseEnter}
                              interaction={interaction}
                              onTextUpdate={handleTextUpdate}
                              onAddItem={handleAddItem}
                              draggedGroupInfo={draggedGroupInfo}
                              onGroupDragStart={handleGroupDragStart}
                              onGroupDrop={handleGroupDrop}
                              onDragEnd={handleDragEnd}
                              onDropTargetChange={setDropTargetId}
                              dropTargetId={dropTargetId}
                          />
                      </table>
                    </div>
                  )}
                  {currentPage === 'dashboard' && <DashboardView data={liveData} title={title} programmerName={activeProject.programmerName}/>}
                  {currentPage === 'comparison' && <ComparisonView savedPlan={savedPlan} liveData={liveData} dates={dates} columnWidths={[50, 120, 130, 130, 280, 250, 80].concat(Array(dates.length).fill(35))} onResizeStart={handleResizeStart} stickyColumnPositions={stickyColumnPositions} title={title}/>}
                  {currentPage === 'manpower' && <ManpowerAllocationView project={activeProject} setProject={setActiveProject} dates={dates} title={title}/>}
                  {currentPage === 'dailyAllocation' && <DailyAllocationView project={activeProject} setProject={setActiveProject} dates={dates} filteredData={filteredData} title={title}/>}
                  {currentPage === 'manpowerDashboard' && <ManpowerDashboardView project={activeProject} dates={dates} title={title} programmerName={activeProject.programmerName}/>}
                  </>
              )}
            </main>
        </div>
      </div>
      <footer className="app-footer">
          Plataforma de Programação Avançada-V5
      </footer>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);